const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_NODES = 4_000;
const MAX_ERRORS = 16;

export function jsonSchemaSafeParse(schema, value) {
  const errors = [];
  let nodes = 0;
  walk(schema, value, "$", errors, () => {
    nodes += 1;
    return nodes <= MAX_NODES;
  });
  return {
    ok: errors.length === 0,
    schemaErrors: bound(errors.length),
    requiredPresent: countRequiredPresent(schema, value),
    codes: errors.slice(0, MAX_ERRORS),
  };
}

function walk(schema, value, path, errors, budget) {
  if (errors.length >= MAX_ERRORS) return;
  if (!budget()) {
    errors.push("node_limit");
    return;
  }
  if (schema === true) return;
  if (!isPlainObject(schema)) {
    if (schema === false) errors.push(path);
    return;
  }
  if (Object.keys(schema).length === 0) return;
  if (Array.isArray(schema.anyOf)) {
    for (const option of schema.anyOf) {
      const inner = [];
      walk(option, value, path, inner, budget);
      if (inner.length === 0) return;
    }
    errors.push(path);
    return;
  }
  if (!matchesType(schema.type, value, schema.format, schema.const, schema.enum, schema.pattern, schema, path, errors, budget)) {
    return;
  }
}

function matchesType(type, value, format, constValue, enumValue, pattern, schema, path, errors, budget) {
  const types = type === undefined ? null : Array.isArray(type) ? type : [type];
  if (types && !types.some((item) => valueMatchesType(item, value, format, pattern))) {
    errors.push(path);
    return false;
  }
  if (constValue !== undefined && !Object.is(value, constValue)) {
    errors.push(path);
    return false;
  }
  if (Array.isArray(enumValue) && !enumValue.includes(value)) {
    errors.push(path);
    return false;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(path);
      return false;
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(path);
      return false;
    }
  }
  if (isPlainObject(value) && (schema.properties || schema.additionalProperties !== undefined || schema.required)) {
    return walkObject(schema, value, path, errors, budget);
  }
  if (Array.isArray(value) && (schema.items !== undefined || schema.minItems !== undefined || schema.maxItems !== undefined)) {
    return walkArray(schema, value, path, errors, budget);
  }
  return true;
}

function valueMatchesType(type, value, format, pattern) {
  if (type === "null") return value === null;
  if (type === "object") return isPlainObject(value);
  if (type === "array") return Array.isArray(value);
  if (type === "string") {
    if (typeof value !== "string") return false;
    if (format === "date-time" && !DATETIME_RE.test(value)) return false;
    if (typeof pattern === "string") {
      try {
        if (!new RegExp(pattern).test(value)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  if (type === "integer") return Number.isInteger(value) && Number.isFinite(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  return true;
}

function walkObject(schema, value, path, errors, budget) {
  if (!isPlainObject(value)) {
    errors.push(path);
    return false;
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}`);
  }
  const properties = schema.properties || {};
  for (const key of Object.keys(value)) {
    if (Object.hasOwn(properties, key)) {
      walk(properties[key], value[key], `${path}.${key}`, errors, budget);
      continue;
    }
    if (schema.additionalProperties === false) {
      errors.push(`${path}.${key}`);
    } else if (isPlainObject(schema.additionalProperties)) {
      walk(schema.additionalProperties, value[key], `${path}.${key}`, errors, budget);
    }
  }
  return true;
}

function walkArray(schema, value, path, errors, budget) {
  if (!Array.isArray(value)) {
    errors.push(path);
    return false;
  }
  if (Number.isInteger(schema.minItems) && value.length < schema.minItems) errors.push(path);
  if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) errors.push(path);
  if (schema.items === undefined) return true;
  for (let i = 0; i < value.length; i += 1) {
    walk(schema.items, value[i], `${path}[${i}]`, errors, budget);
  }
  return true;
}

function countRequiredPresent(schema, value) {
  if (!isPlainObject(schema) || !Array.isArray(schema.required) || !isPlainObject(value)) return 0;
  let n = 0;
  for (const key of schema.required) {
    if (Object.hasOwn(value, key)) n += 1;
  }
  return bound(n);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function boundCounter(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(99, Math.trunc(n));
}

function bound(value) {
  return boundCounter(value);
}
