// Zod 3 schemas stay the merchant's validation authority. The 2026 MCP SDK
// cannot convert Zod 3 into JSON Schema, and the root zod package stays on
// 3.25.76. This adapter advertises a JSON Schema projection and validates
// with the original Zod 3 safeParse, including defaults, strips, and refinements.
import { z } from "zod";

function isZod(value) {
  return Boolean(value) && typeof value === "object" && typeof value._def?.typeName === "string";
}

function asZodSchema(schemaOrShape) {
  if (isZod(schemaOrShape)) return schemaOrShape;
  if (!schemaOrShape || typeof schemaOrShape !== "object" || Array.isArray(schemaOrShape)) {
    throw new Error("mcp_modern_schema_shape");
  }
  for (const value of Object.values(schemaOrShape)) {
    if (!isZod(value)) throw new Error("mcp_modern_schema_field");
  }
  return z.object(schemaOrShape);
}

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
  while (current && (current._def?.typeName === "ZodOptional" || current._def?.typeName === "ZodDefault" || current._def?.typeName === "ZodNullable" && false)) {
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
  return { current, required, description, defaultValue };
}

export function zod3JsonSchema(schema, stack = new Set()) {
  if (!isZod(schema)) throw new Error("mcp_modern_schema_zod");
  if (stack.has(schema)) throw new Error("mcp_modern_schema_cycle");
  const typeName = schema._def.typeName;
  if (typeName === "ZodEffects" || typeName === "ZodBranded" || typeName === "ZodCatch" || typeName === "ZodPipeline") {
    stack.add(schema);
    const inner = typeName === "ZodPipeline" ? schema._def.in : (schema._def.schema || schema._def.type || schema._def.innerType);
    const json = zod3JsonSchema(inner, stack);
    stack.delete(schema);
    if (schema.description && !json.description) json.description = schema.description;
    return json;
  }
  if (typeName === "ZodOptional" || typeName === "ZodDefault") {
    const unwrapped = unwrapAnnotation(schema);
    const json = zod3JsonSchema(unwrapped.current, stack);
    if (unwrapped.description) json.description = unwrapped.description;
    if (unwrapped.defaultValue !== undefined) json.default = unwrapped.defaultValue;
    return json;
  }
  if (typeName === "ZodNullable") {
    return { anyOf: [zod3JsonSchema(schema._def.innerType, stack), { type: "null" }] };
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
  if (typeName === "ZodNativeEnum") {
    const values = [...new Set(Object.values(schema._def.values || {}))];
    const json = { enum: values };
    if (values.every((value) => typeof value === "string")) json.type = "string";
    if (schema.description) json.description = schema.description;
    return json;
  }
  if (typeName === "ZodArray") {
    const json = { type: "array", items: zod3JsonSchema(schema._def.type, stack) };
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
      const json = zod3JsonSchema(unwrapped.current, stack);
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
      json.additionalProperties = zod3JsonSchema(schema._def.catchall, stack);
    } else json.additionalProperties = true;
    if (schema.description) json.description = schema.description;
    return json;
  }
  if (typeName === "ZodRecord") {
    return {
      type: "object",
      additionalProperties: zod3JsonSchema(schema._def.valueType, stack),
      ...(schema.description ? { description: schema.description } : {}),
    };
  }
  if (typeName === "ZodUnion" || typeName === "ZodDiscriminatedUnion") {
    const options = schema._def.options || [];
    return {
      anyOf: options.map((option) => zod3JsonSchema(option, stack)),
      ...(schema.description ? { description: schema.description } : {}),
    };
  }
  if (typeName === "ZodIntersection") {
    return { allOf: [zod3JsonSchema(schema._def.left, stack), zod3JsonSchema(schema._def.right, stack)] };
  }
  if (typeName === "ZodAny" || typeName === "ZodUnknown") return {};
  if (typeName === "ZodNull") return { type: "null" };
  throw new Error(`mcp_modern_schema_unsupported:${typeName}`);
}

export function zod3StandardSchema(schemaOrShape) {
  const zodSchema = asZodSchema(schemaOrShape);
  const jsonSchema = zod3JsonSchema(zodSchema);
  const rootType = jsonSchema.type;
  if (rootType !== "object" && !jsonSchema.anyOf && !jsonSchema.allOf) {
    throw new Error(`mcp_modern_schema_not_object:${zodSchema._def?.typeName || "shape"}`);
  }
  return {
    "~standard": {
      version: 1,
      vendor: "samedaydesk-zod3",
      jsonSchema: {
        input: () => jsonSchema,
        output: () => jsonSchema,
      },
      validate(data) {
        const parsed = zodSchema.safeParse(data);
        if (parsed.success) return { value: parsed.data };
        return {
          issues: parsed.error.issues.map((issue) => ({ message: issue.message, path: issue.path })),
        };
      },
    },
  };
}
