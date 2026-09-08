import Ajv2020 from 'ajv/dist/2020.js';
import { issue } from './issues.mjs';
import { encodeToken, isPlainObject } from './pointer.mjs';

export const DIALECT = 'https://json-schema.org/draft/2020-12/schema';
// AJV owns keyword semantics; the adapter only bounds the offline recipe.
const unsupported = new Set(['$ref', '$dynamicRef', '$recursiveRef', '$id', '$anchor',
  '$dynamicAnchor', '$defs', 'definitions', 'pattern', 'patternProperties', 'format',
  'contentMediaType', 'contentEncoding', 'contentSchema', 'default', 'nullable']);
const single = new Set(['items', 'additionalProperties', 'propertyNames', 'contains',
  'not', 'if', 'then', 'else', 'unevaluatedProperties', 'unevaluatedItems']);
const groups = new Set(['properties', 'dependentSchemas']);
const arrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

function compiler() {
  return new Ajv2020({ strict: true, strictTypes: false, strictTuples: false,
    strictRequired: false, allowUnionTypes: true, allErrors: false, ownProperties: true,
    coerceTypes: false, useDefaults: false, removeAdditional: false, addUsedSchema: false });
}

export function compileBuyerSchema(schema, limits) {
  const issues = [];
  let nodes = 0;
  function walk(node, pointer = '', depth = 1) {
    if (issues.length) return;
    const fail = (code, message) => issues.push(issue({ code, message, pointer }));
    if (++nodes > limits.maxSchemaNodes) return fail('schema.unsupported_size', 'Schema node cap exceeded');
    if (depth > limits.maxSchemaDepth) return fail('schema.unsupported_depth', 'Schema depth cap exceeded');
    if (typeof node === 'boolean') return;
    if (!isPlainObject(node)) return fail('schema.malformed', 'Schema node must be an object or boolean');
    for (const [key, value] of Object.entries(node)) {
      if (unsupported.has(key)) return fail('schema.unsupported', `Unsupported offline keyword: ${key}`);
      if (key === '$schema' && (pointer !== '' || value !== DIALECT)) {
        return fail('schema.unsupported', 'Only the root 2020-12 dialect is supported');
      }
      const at = `${pointer}/${encodeToken(key)}`;
      if (single.has(key)) walk(value, at, depth + 1);
      if (groups.has(key) && isPlainObject(value)) {
        for (const [name, child] of Object.entries(value)) walk(child, `${at}/${encodeToken(name)}`, depth + 1);
      }
      if (arrays.has(key) && Array.isArray(value)) value.forEach((child, i) => walk(child, `${at}/${i}`, depth + 1));
    }
  }
  walk(schema);
  if (issues.length) return { issues, validate: null };
  try {
    return { issues, validate: compiler().compile(schema) };
  } catch (error) {
    return { issues: [issue({ code: 'schema.unsupported', message: error.message })], validate: null };
  }
}

export function inspectJsonSchema(schema, limits) { return compileBuyerSchema(schema, limits).issues; }

export function validateJsonSchema(value, schema, { limits, failures, validate }) {
  const pending = [[value, '']];
  while (pending.length) {
    const [node, pointer] = pending.pop();
    if (typeof node === 'string' && Buffer.byteLength(node) > limits.maxStringBytes) {
      failures.push(issue({ code: 'json.string_oversized', message: 'Mapped string exceeds maxStringBytes', pointer }));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) pending.push([child, `${pointer}/${encodeToken(key)}`]);
    }
  }
  validate ??= compileBuyerSchema(schema, limits).validate;
  if (!validate) { failures.push(issue({ code: 'schema.unsupported', message: 'Invalid buyer schema' })); return; }
  if (!validate(value)) {
    for (const error of validate.errors ?? []) {
      const property = error.params.missingProperty ?? error.params.additionalProperty;
      failures.push(issue({ code: `json.${error.keyword}`, message: error.message,
        pointer: error.instancePath + (property == null ? '' : `/${encodeToken(property)}`), field: property }));
    }
  }
}
