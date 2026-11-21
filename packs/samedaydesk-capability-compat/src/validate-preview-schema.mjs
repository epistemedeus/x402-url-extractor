/**
 * Hand-rolled JSON Schema subset checker for the preview.v1 envelope.
 * No new dependency: supports the constructs used in
 * schema/capability-provider.preview.v1.schema.json ($ref, oneOf, type,
 * const, enum, required, properties, additionalProperties, items, pattern,
 * minimum, minItems, minLength).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PREVIEW_SCHEMA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../schema/capability-provider.preview.v1.schema.json",
);

export function loadPreviewSchema() {
  return JSON.parse(readFileSync(PREVIEW_SCHEMA_PATH, "utf8"));
}

export function validatePreviewEnvelope(value, schema = loadPreviewSchema()) {
  const errors = [];
  check(value, schema, schema, "$", errors);
  return errors;
}

export function assertPreviewEnvelope(value, schema = loadPreviewSchema()) {
  const errors = validatePreviewEnvelope(value, schema);
  if (errors.length) {
    const error = new Error(`preview.v1 schema mismatch: ${errors.join("; ")}`);
    error.errors = errors;
    throw error;
  }
  return value;
}

function check(value, subschema, root, path, errors) {
  if (!subschema || typeof subschema !== "object" || Array.isArray(subschema)) {
    errors.push(`${path}: invalid schema`);
    return;
  }
  if (subschema.$ref) {
    check(value, resolveRef(subschema.$ref, root), root, path, errors);
    return;
  }
  if (subschema.oneOf || subschema.anyOf) {
    const options = subschema.oneOf || subschema.anyOf;
    const matches = [];
    for (const option of options) {
      const optionErrors = [];
      check(value, option, root, path, optionErrors);
      if (optionErrors.length === 0) matches.push(option);
    }
    if (subschema.oneOf && matches.length !== 1) {
      errors.push(`${path}: expected to match exactly one oneOf option, matched ${matches.length}`);
    } else if (subschema.anyOf && matches.length === 0) {
      errors.push(`${path}: expected to match at least one anyOf option`);
    }
    return;
  }
  if (Object.hasOwn(subschema, "const") && !Object.is(value, subschema.const)) {
    errors.push(`${path}: expected const ${JSON.stringify(subschema.const)}`);
    return;
  }
  if (subschema.enum && !subschema.enum.includes(value)) {
    errors.push(`${path}: expected one of ${subschema.enum.join(", ")}`);
    return;
  }
  if (subschema.type && !matchesType(value, subschema.type)) {
    errors.push(`${path}: expected type ${[].concat(subschema.type).join("|")}`);
    return;
  }
  if (typeof value === "string") {
    if (typeof subschema.minLength === "number" && value.length < subschema.minLength) {
      errors.push(`${path}: shorter than minLength ${subschema.minLength}`);
    }
    if (typeof subschema.pattern === "string" && !new RegExp(subschema.pattern).test(value)) {
      errors.push(`${path}: did not match pattern ${subschema.pattern}`);
    }
  }
  if (typeof value === "number" && typeof subschema.minimum === "number" && value < subschema.minimum) {
    errors.push(`${path}: below minimum ${subschema.minimum}`);
  }
  if (Array.isArray(value)) {
    if (typeof subschema.minItems === "number" && value.length < subschema.minItems) {
      errors.push(`${path}: fewer than minItems ${subschema.minItems}`);
    }
    if (subschema.items) {
      value.forEach((item, index) => check(item, subschema.items, root, `${path}[${index}]`, errors));
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value) && subschema.properties) {
    for (const key of subschema.required || []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}: missing required property ${key}`);
    }
    const known = new Set(Object.keys(subschema.properties));
    for (const [key, child] of Object.entries(value)) {
      if (known.has(key)) {
        check(child, subschema.properties[key], root, `${path}.${key}`, errors);
      } else if (subschema.additionalProperties === false) {
        errors.push(`${path}: unexpected property ${key}`);
      } else if (subschema.additionalProperties && typeof subschema.additionalProperties === "object") {
        check(child, subschema.additionalProperties, root, `${path}.${key}`, errors);
      }
    }
  }
}

function matchesType(value, type) {
  const types = Array.isArray(type) ? type : [type];
  return types.some((expected) => {
    if (expected === "null") return value === null;
    if (expected === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    if (expected === "array") return Array.isArray(value);
    if (expected === "integer") return typeof value === "number" && Number.isInteger(value);
    if (expected === "number") return typeof value === "number" && Number.isFinite(value);
    return typeof value === expected;
  });
}

function resolveRef(ref, root) {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) throw new Error(`unsupported $ref: ${ref}`);
  let current = root;
  for (const part of ref.slice(2).split("/")) {
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!current || !Object.hasOwn(current, key)) throw new Error(`unresolved $ref: ${ref}`);
    current = current[key];
  }
  return current;
}
