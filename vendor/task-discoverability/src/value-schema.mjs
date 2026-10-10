import Ajv2020 from "ajv/dist/2020.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const DIALECT = "https://json-schema.org/draft/2020-12/schema";

export const VALIDATOR = Object.freeze({
  package: "ajv",
  version: "8.20.0",
  license: "MIT",
  dialect: DIALECT,
  module: "ajv/dist/2020.js",
  coerceTypes: false,
  useDefaults: false,
});

const ANNOTATIONS = new Set([
  "description",
  "title",
  "summary",
  "$comment",
  "deprecated",
  "examples",
  "example",
  "default",
  "readOnly",
  "writeOnly",
]);

const SUPPORTED = new Set([
  "$schema",
  "type",
  "enum",
  "const",
  "multipleOf",
  "maximum",
  "exclusiveMaximum",
  "minimum",
  "exclusiveMinimum",
  "maxLength",
  "minLength",
  "pattern",
  "maxItems",
  "minItems",
  "uniqueItems",
  "maxProperties",
  "minProperties",
  "required",
  "dependentRequired",
  "properties",
  "patternProperties",
  "additionalProperties",
  "items",
  "prefixItems",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
]);

const REFUSED = new Set(["$ref", "$dynamicRef", "$recursiveRef"]);
const SECRET = /api[-_]?key|authorization|credential|password|secret|token|cookie/i;

function compiler() {
  return new Ajv2020({
    strict: true,
    strictTypes: false,
    strictTuples: false,
    strictRequired: false,
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    validateSchema: true,
    addUsedSchema: false,
  });
}

function walk(node) {
  if (node === true) return { state: "unknown", reason: "unconstrained-schema" };
  if (node === false) return { state: "ok" };
  if (!isPlainObject(node)) return { state: "refused", reason: "schema-not-object" };
  if (node.$schema !== undefined && node.$schema !== DIALECT) {
    return { state: "unknown", reason: "unsupported-dialect", keyword: "$schema" };
  }
  for (const key of Object.keys(node)) {
    if (REFUSED.has(key)) return { state: "refused", reason: "unresolved-schema-ref", keyword: key };
    if (ANNOTATIONS.has(key)) continue;
    if (!SUPPORTED.has(key)) return { state: "unknown", reason: "unsupported-constraint", keyword: key };
  }
  const nested = [];
  if (isPlainObject(node.properties)) {
    for (const [name, child] of Object.entries(node.properties)) {
      if (isPlainObject(child) && Object.keys(child).some((key) => REFUSED.has(key))) {
        return { state: "refused", reason: "unresolved-schema-ref", keyword: name };
      }
      nested.push(child);
    }
  }
  if (isPlainObject(node.patternProperties)) nested.push(...Object.values(node.patternProperties));
  if (node.additionalProperties !== undefined && node.additionalProperties !== false) {
    nested.push(node.additionalProperties);
  }
  if (node.items !== undefined && node.items !== false) nested.push(node.items);
  if (Array.isArray(node.prefixItems)) nested.push(...node.prefixItems);
  for (const key of ["allOf", "anyOf", "oneOf"]) {
    if (Array.isArray(node[key])) nested.push(...node[key]);
  }
  for (const key of ["not", "if", "then", "else"]) {
    if (node[key] !== undefined) nested.push(node[key]);
  }
  for (const child of nested) {
    const result = walk(child);
    if (result.state !== "ok") return result;
  }
  return { state: "ok" };
}

function stripAnnotations(node) {
  if (Array.isArray(node)) return node.map(stripAnnotations);
  if (!isPlainObject(node)) return node;
  const copy = {};
  for (const [key, value] of Object.entries(node)) {
    if (ANNOTATIONS.has(key)) continue;
    if (key === "properties" || key === "patternProperties") {
      const inner = {};
      for (const [name, child] of Object.entries(value)) inner[name] = stripAnnotations(child);
      copy[key] = inner;
    } else if (key === "items" || key === "additionalProperties" || key === "not" || key === "if" || key === "then" || key === "else") {
      copy[key] = stripAnnotations(value);
    } else if ((key === "allOf" || key === "anyOf" || key === "oneOf" || key === "prefixItems") && Array.isArray(value)) {
      copy[key] = value.map(stripAnnotations);
    } else {
      copy[key] = value;
    }
  }
  return copy;
}

function requiredGaps(schema, example) {
  if (!Array.isArray(schema.required)) {
    return { fieldsAvailable: "unknown", gaps: ["required-list-absent"], stop: "unknown" };
  }
  if (!isPlainObject(example)) {
    if (schema.required.length === 0 && (example === undefined || example === null)) {
      return { fieldsAvailable: true, gaps: [], stop: null, exampleObject: {} };
    }
    return { fieldsAvailable: false, gaps: ["example-not-object"], stop: "invalid" };
  }
  const gaps = [];
  for (const key of schema.required) {
    if (Object.prototype.hasOwnProperty.call(example, key) && example[key] !== undefined) continue;
    const prop = isPlainObject(schema.properties) ? schema.properties[key] : undefined;
    if (isPlainObject(prop) && Object.prototype.hasOwnProperty.call(prop, "default")) {
      gaps.push(SECRET.test(key) ? `secret-default-not-applied:${key}` : `default-not-applied:${key}`);
    } else if (
      isPlainObject(prop)
      && (Object.prototype.hasOwnProperty.call(prop, "example")
        || Object.prototype.hasOwnProperty.call(prop, "examples"))
    ) {
      gaps.push(`example-not-applied:${key}`);
    } else {
      gaps.push(`required-absent:${key}`);
    }
  }
  return {
    fieldsAvailable: gaps.length === 0,
    gaps,
    stop: gaps.length === 0 ? null : "invalid",
    exampleObject: example,
  };
}

function unknownResult(reason, keyword, dialectAssumed) {
  return {
    fieldsAvailable: "unknown",
    valueSchemaValid: "unknown",
    applicationConstructible: "unknown",
    constructed: null,
    gaps: [keyword ? `${reason}:${keyword}` : reason],
    dialect: DIALECT,
    dialectAssumed,
    validator: { ...VALIDATOR },
  };
}

export function assessValue(schema, example, options = {}) {
  const declaredDialect = typeof options.dialect === "string" ? options.dialect : null;
  const dialectAssumed = declaredDialect === null && !(isPlainObject(schema) && typeof schema.$schema === "string");
  if (declaredDialect !== null && declaredDialect !== DIALECT) {
    return unknownResult("unsupported-dialect", declaredDialect, false);
  }
  if (schema === true) return unknownResult("unconstrained-schema", null, dialectAssumed);
  if (schema === false) {
    return {
      fieldsAvailable: false,
      valueSchemaValid: false,
      applicationConstructible: false,
      constructed: null,
      gaps: ["schema-rejects-all-values"],
      dialect: DIALECT,
      dialectAssumed,
      validator: { ...VALIDATOR },
    };
  }
  if (!isPlainObject(schema)) {
    return {
      fieldsAvailable: false,
      valueSchemaValid: "refused",
      applicationConstructible: false,
      constructed: null,
      gaps: ["schema-not-object"],
      dialect: DIALECT,
      dialectAssumed,
      validator: { ...VALIDATOR },
    };
  }
  const classified = walk(schema);
  if (classified.state === "unknown") {
    return unknownResult(classified.reason, classified.keyword, dialectAssumed);
  }
  if (classified.state === "refused") {
    return {
      fieldsAvailable: "unknown",
      valueSchemaValid: "refused",
      applicationConstructible: false,
      constructed: null,
      gaps: [classified.keyword ? `${classified.reason}:${classified.keyword}` : classified.reason],
      dialect: DIALECT,
      dialectAssumed,
      validator: { ...VALIDATOR },
    };
  }
  const required = requiredGaps(schema, example);
  if (required.stop === "unknown") {
    return {
      fieldsAvailable: "unknown",
      valueSchemaValid: "unknown",
      applicationConstructible: "unknown",
      constructed: null,
      gaps: required.gaps,
      dialect: DIALECT,
      dialectAssumed,
      validator: { ...VALIDATOR },
    };
  }
  if (required.stop === "invalid") {
    return {
      fieldsAvailable: required.fieldsAvailable,
      valueSchemaValid: false,
      applicationConstructible: false,
      constructed: null,
      gaps: required.gaps,
      dialect: DIALECT,
      dialectAssumed,
      validator: { ...VALIDATOR },
    };
  }
  let validate;
  try {
    validate = compiler().compile(stripAnnotations(schema));
  } catch (error) {
    return unknownResult("unsupported-constraint", error.message, dialectAssumed);
  }
  const candidate = required.exampleObject;
  const valid = validate(candidate);
  if (!valid) {
    const paths = (validate.errors || []).map((error) => {
      const missing = error.params && (error.params.missingProperty || error.params.additionalProperty);
      return `value-schema-invalid:${error.instancePath || ""}${missing ? `/${missing}` : ""}:${error.keyword}`;
    });
    return {
      fieldsAvailable: true,
      valueSchemaValid: false,
      applicationConstructible: false,
      constructed: null,
      gaps: paths.length > 0 ? paths : ["value-schema-invalid"],
      dialect: DIALECT,
      dialectAssumed,
      validator: { ...VALIDATOR },
    };
  }
  return {
    fieldsAvailable: true,
    valueSchemaValid: true,
    applicationConstructible: true,
    constructed: JSON.parse(JSON.stringify(candidate)),
    gaps: [],
    dialect: DIALECT,
    dialectAssumed,
    validator: { ...VALIDATOR },
  };
}
