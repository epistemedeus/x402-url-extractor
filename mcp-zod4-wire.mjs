import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const typeNames = {
  any: "Any", array: "Array", boolean: "Boolean", catch: "Catch", default: "Default",
  enum: "Enum", intersection: "Intersection", literal: "Literal", never: "Never",
  null: "Null", nullable: "Nullable", number: "Number", object: "Object",
  optional: "Optional", record: "Record", string: "String", tuple: "Tuple",
  union: "Union", unknown: "Unknown",
};
const merchantNodes = new WeakSet();

function oldChecks(schema) {
  return (schema._zod.def.checks || []).map((instance) => {
    merchantNodes.add(instance);
    const check = instance._zod.def;
    switch (check.check) {
      case "min_length": return { kind: "min", value: check.minimum };
      case "max_length": return { kind: "max", value: check.maximum };
      case "length_equals": return { kind: "length", value: check.length };
      case "string_format": return { ...check, kind: check.format, regex: check.pattern };
      case "number_format": return { kind: "int" };
      case "custom":
        if (check.fn === Number.isInteger) return { kind: "int" };
        throw new Error("unsupported_merchant_schema_check:custom");
      case "greater_than": return { kind: "min", value: check.value, inclusive: check.inclusive };
      case "less_than": return { kind: "max", value: check.value, inclusive: check.inclusive };
      case "multiple_of": return { kind: "multipleOf", value: check.value };
      default: throw new Error(`unsupported_merchant_schema_check:${check.check}`);
    }
  });
}

export function asMerchantZodObject(schemaOrShape) {
  return schemaOrShape?._zod ? schemaOrShape : z.object(schemaOrShape || {});
}

// Preserve the existing MCP JSON Schema dialects by projecting schema metadata.
// The descriptor is serialization input only. Every parsed value goes to Zod 4.
export function merchantWireDescriptor(schema, seen = new WeakMap()) {
  if (seen.has(schema)) return seen.get(schema);
  merchantNodes.add(schema);
  const def = schema._zod.def;
  if (!typeNames[def?.type]) throw new Error(`unsupported_merchant_schema:${def?.type}`);
  const shape = {
    _def: { typeName: `Zod${typeNames[def.type]}`, description: schema.description },
    description: schema.description,
    isOptional: () => z.safeParse(schema, undefined).success,
  };
  seen.set(schema, shape);
  const out = shape._def;
  const describe = (child) => merchantWireDescriptor(child, seen);
  switch (def.type) {
    case "string":
    case "number":
      out.checks = oldChecks(schema);
      break;
    case "object":
      out.unknownKeys = def.catchall?._zod.def.type === "never" ? "strict" : def.catchall?._zod.def.type === "unknown" ? "passthrough" : "strip";
      out.catchall = out.unknownKeys === "strip" && def.catchall ? describe(def.catchall) : { _def: { typeName: "ZodNever" } };
      {
        const fields = Object.fromEntries(Object.entries(def.shape).map(([key, child]) => [key, describe(child)]));
        out.shape = () => fields;
      }
      break;
    case "array":
      out.type = describe(def.element);
      for (const check of oldChecks(schema)) {
        if (check.kind === "min") out.minLength = { value: check.value };
        if (check.kind === "max") out.maxLength = { value: check.value };
        if (check.kind === "length") out.exactLength = { value: check.value };
      }
      break;
    case "union":
      out.options = def.options.map(describe);
      break;
    case "intersection":
      out.left = describe(def.left);
      out.right = describe(def.right);
      break;
    case "tuple":
      out.items = def.items.map(describe);
      out.rest = def.rest ? describe(def.rest) : null;
      break;
    case "enum":
      out.values = Object.values(def.entries);
      break;
    case "literal":
      if (def.values.length !== 1) throw new Error("unsupported_merchant_multi_literal");
      out.value = def.values[0];
      break;
    case "record":
      out.keyType = describe(def.keyType);
      out.valueType = describe(def.valueType);
      break;
    case "optional":
    case "nullable":
    case "catch":
    case "default":
      out.innerType = describe(def.innerType);
      if (def.type === "default") out.defaultValue = () => def.defaultValue;
      break;
  }
  return shape;
}

export function legacyMcpJsonSchema(schema, io) {
  const object = asMerchantZodObject(schema);
  const def = object._zod.def;
  if (io === "input" && def.type === "object" && !def.catchall && !Object.keys(def.shape).length) {
    return z.toJSONSchema(object, { target: "draft-7", io });
  }
  return zodToJsonSchema(merchantWireDescriptor(object), {
    strictUnions: true, pipeStrategy: io,
  });
}

// Register the compatibility view through the SDK's public protocol server.
// The SDK retains ownership of tools/call and its native Zod 4 validation.
export function setLegacyMcpToolList(mcp, entries) {
  for (const [, tool] of entries) {
    if (tool.inputSchema) merchantNodes.add(tool.inputSchema);
    if (tool.outputSchema) merchantNodes.add(tool.outputSchema);
  }
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: entries.filter(([, tool]) => tool.enabled).map(([name, tool]) => ({
      name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema
        ? legacyMcpJsonSchema(tool.inputSchema, "input")
        : { type: "object", properties: {} },
      ...(tool.outputSchema ? { outputSchema: legacyMcpJsonSchema(tool.outputSchema, "output") } : {}),
      annotations: tool.annotations,
      execution: tool.execution,
      _meta: tool._meta,
    })),
  }));
}

function merchantIssueMessage(issue) {
  if (!merchantNodes.has(issue.inst)) return undefined;
  const { code, input, expected, origin, format } = issue;
  const received = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
  switch (code) {
    case "invalid_type":
      if (input === undefined) return "Required";
      if (expected === "int") return "Expected integer, received float";
      return `Expected ${expected === "record" ? "object" : expected}, received ${received}`;
    case "invalid_format":
      return format === "regex" ? "Invalid" : `Invalid ${format}`;
    case "invalid_union":
      return issue.discriminator
        ? `Invalid discriminator value. Expected ${issue.options.map(value => `'${value}'`).join(" | ")}`
        : "Invalid input";
    case "invalid_value": {
      if (issue.inst._zod.def.type === "literal") return `Invalid literal value, expected ${JSON.stringify(issue.values[0])}`;
      const values = issue.values.map(value => `'${value}'`).join(" | ");
      if (typeof input !== "string") return input === undefined ? "Required" : `Expected ${values}, received ${received}`;
      return `Invalid enum value. Expected ${values}, received '${input}'`;
    }
    case "unrecognized_keys":
      return `Unrecognized key(s) in object: ${issue.keys.map(key => `'${key}'`).join(", ")}`;
    case "too_small":
    case "too_big": {
      const minimum = code === "too_small";
      const limit = minimum ? issue.minimum : issue.maximum;
      const exact = issue.inst._zod.def.check === "length_equals";
      if (origin === "array" || origin === "string") {
        const label = origin === "array" ? "Array" : "String";
        const unit = origin === "array" ? "element(s)" : "character(s)";
        return `${label} must contain ${exact ? "exactly" : minimum ? "at least" : "at most"} ${limit} ${unit}`;
      }
      if (origin === "number") {
        return `Number must be ${minimum ? "greater" : "less"} than${issue.inclusive ? " or equal to" : ""} ${limit}`;
      }
      break;
    }
    case "not_multiple_of": return `Number must be a multiple of ${issue.divisor}`;
  }
}

const previousError = z.config().customError;
z.config({ customError: (issue) => merchantIssueMessage(issue) ?? previousError?.(issue) });

function applyStringChecks(json, checks = []) {
  const patterns = [];
  for (const check of checks) {
    if (check.kind === "min" && typeof check.value === "number") json.minLength = Math.max(json.minLength ?? 0, check.value);
    else if (check.kind === "max" && typeof check.value === "number") {
      json.maxLength = json.maxLength === undefined ? check.value : Math.min(json.maxLength, check.value);
    } else if (check.kind === "length" && typeof check.value === "number") {
      json.minLength = check.value;
      json.maxLength = check.value;
    } else if (check.kind === "regex" && check.regex) patterns.push(String(check.regex.source));
    else if (check.kind === "url") json.format = "uri";
    else if (check.kind === "email") json.format = "email";
    else if (check.kind === "uuid") json.format = "uuid";
  }
  if (patterns.length === 1) json.pattern = patterns[0];
  return json;
}

function applyNumberChecks(json, checks = []) {
  for (const check of checks) {
    if (check.kind === "int") json.type = "integer";
    else if (check.kind === "multipleOf" && typeof check.value === "number") json.multipleOf = check.value;
    else if (check.kind === "min" && typeof check.value === "number") {
      const key = check.inclusive === false ? "exclusiveMinimum" : "minimum";
      json[key] = json[key] === undefined ? check.value : Math.max(json[key], check.value);
    } else if (check.kind === "max" && typeof check.value === "number") {
      const key = check.inclusive === false ? "exclusiveMaximum" : "maximum";
      json[key] = json[key] === undefined ? check.value : Math.min(json[key], check.value);
    }
  }
  return json;
}

function unwrapAnnotation(schema) {
  let current = schema;
  let required = true;
  let description = schema?.description;
  let defaultValue;
  const seen = new Set();
  while (current && ["ZodOptional", "ZodDefault"].includes(current._def.typeName)) {
    if (seen.has(current)) break;
    seen.add(current);
    if (current.description) description = description || current.description;
    if (current._def.typeName === "ZodDefault") {
      required = false;
      try { defaultValue = current._def.defaultValue(); } catch { defaultValue = undefined; }
    }
    if (current._def.typeName === "ZodOptional") required = false;
    current = current._def.innerType;
  }
  return { current, required, description: description ?? current?.description, defaultValue };
}

function modernJson(schema, stack = new Set()) {
  if (stack.has(schema)) throw new Error("mcp_modern_schema_cycle");
  const typeName = schema._def.typeName;
  if (typeName === "ZodCatch") {
    stack.add(schema);
    const json = modernJson(schema._def.innerType, stack);
    stack.delete(schema);
    if (schema.description && !json.description) json.description = schema.description;
    return json;
  }
  if (typeName === "ZodOptional" || typeName === "ZodDefault") {
    const unwrapped = unwrapAnnotation(schema);
    const json = modernJson(unwrapped.current, stack);
    if (unwrapped.description) json.description = unwrapped.description;
    if (unwrapped.defaultValue !== undefined) json.default = unwrapped.defaultValue;
    return json;
  }
  if (typeName === "ZodNullable") {
    return { anyOf: [modernJson(schema._def.innerType, stack), { type: "null" }] };
  }
  if (typeName === "ZodString") {
    const json = { type: "string" };
    if (schema.description) json.description = schema.description;
    return applyStringChecks(json, schema._def.checks);
  }
  if (typeName === "ZodNumber") {
    const json = { type: "number" };
    if (schema.description) json.description = schema.description;
    return applyNumberChecks(json, schema._def.checks);
  }
  if (typeName === "ZodBoolean") {
    return schema.description ? { type: "boolean", description: schema.description } : { type: "boolean" };
  }
  if (typeName === "ZodLiteral") {
    const value = schema._def.value;
    const json = { const: value };
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      json.type = value === null ? "null" : typeof value;
    }
    if (schema.description) json.description = schema.description;
    return json;
  }
  if (typeName === "ZodEnum") {
    const values = schema._def.values || [];
    const json = { enum: values };
    if (values.every((value) => typeof value === "string")) json.type = "string";
    if (schema.description) json.description = schema.description;
    return json;
  }
  if (typeName === "ZodArray") {
    const json = { type: "array", items: modernJson(schema._def.type, stack) };
    const min = schema._def.minLength?.value;
    const max = schema._def.maxLength?.value;
    if (typeof min === "number") json.minItems = min;
    if (typeof max === "number") json.maxItems = max;
    if (schema.description) json.description = schema.description;
    return json;
  }
  if (typeName === "ZodObject") {
    stack.add(schema);
    const shape = schema._def.shape();
    const properties = {};
    const required = [];
    for (const [key, field] of Object.entries(shape)) {
      const unwrapped = unwrapAnnotation(field);
      const json = modernJson(unwrapped.current, stack);
      if (unwrapped.description) json.description = unwrapped.description;
      if (unwrapped.defaultValue !== undefined) json.default = unwrapped.defaultValue;
      properties[key] = json;
      if (unwrapped.required) required.push(key);
    }
    stack.delete(schema);
    const json = { type: "object", properties };
    if (required.length > 0) json.required = required;
    if (schema._def.unknownKeys === "strict") json.additionalProperties = false;
    else if (schema._def.catchall && schema._def.catchall._def?.typeName !== "ZodNever") {
      json.additionalProperties = modernJson(schema._def.catchall, stack);
    } else json.additionalProperties = true;
    if (schema.description) json.description = schema.description;
    return json;
  }
  if (typeName === "ZodRecord") {
    return {
      type: "object",
      additionalProperties: modernJson(schema._def.valueType, stack),
      ...(schema.description ? { description: schema.description } : {}),
    };
  }
  if (typeName === "ZodUnion") {
    const options = schema._def.options || [];
    return {
      anyOf: options.map((option) => modernJson(option, stack)),
      ...(schema.description ? { description: schema.description } : {}),
    };
  }
  if (typeName === "ZodIntersection") {
    return { allOf: [modernJson(schema._def.left, stack), modernJson(schema._def.right, stack)] };
  }
  if (typeName === "ZodAny" || typeName === "ZodUnknown") return {};
  if (typeName === "ZodNull") return { type: "null" };
  throw new Error(`mcp_modern_schema_unsupported:${typeName}`);
}

export function merchantMcpJsonSchema(schemaOrShape) {
  return modernJson(merchantWireDescriptor(asMerchantZodObject(schemaOrShape)));
}

export function merchantMcpStandardSchema(schemaOrShape) {
  const schema = asMerchantZodObject(schemaOrShape);
  const projection = merchantMcpJsonSchema(schema);
  if (projection.type !== "object" && !projection.anyOf && !projection.allOf) {
    throw new Error("mcp_modern_schema_not_object");
  }
  return {
    "~standard": {
      ...schema["~standard"],
      jsonSchema: { input: () => projection, output: () => projection },
    },
  };
}
