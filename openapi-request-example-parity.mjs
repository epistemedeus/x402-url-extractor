/**
 * Deterministic projection of the authoritative Bazaar discovery-contract
 * request examples into the generated OpenAPI 3.1 document, plus a generated-
 * surface parity gate that fails whenever a canonical paid operation loses its
 * accepted request construction example.
 *
 * Single source of truth: examples are taken exclusively from
 * `getDiscoveryRequestContract` through the injected resolver. This module
 * never authors or stores a second example table.
 */

const OPENAPI_OPERATION_METHODS = ["get", "post"];

const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// Public on-chain identifiers that carry "signature"-like names but are not
// credentials: a Solana transaction signature is public ledger data, the same
// class as an EVM transactionHash.
const PUBLIC_CHAIN_IDENTIFIER_KEYS = new Set(["signature"]);
// Same sensitivity classes as discovery-contract.mjs so a projected example can
// never surface a credential-like input name onto the generated surface.
const SENSITIVE_KEY = /(?:^|[-_.])(auth|authorization|bearer|cookie|credential|jwt|otp|pass(?:word)?|secret|session|signature|token)(?:$|[-_.])/i;
const SENSITIVE_KEY_COLLAPSED = /(?:api|access|auth|authorization|bearer|client|cookie|credential|private|session)?(?:jwt|key|otp|pass|password|secret|signature|token)$/i;
const CREDENTIAL_VALUE_PATTERNS = [
  /^(?:bearer|basic|token)\s+\S+/i,
  /^sk-[A-Za-z0-9_-]+$/,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
const UNRESOLVED_TEMPLATE = /\{[^{}]*\}/;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqualValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isSensitiveExampleName(name) {
  if (typeof name !== "string") return false;
  if (PROTOTYPE_KEYS.has(name)) return true;
  if (PUBLIC_CHAIN_IDENTIFIER_KEYS.has(name)) return false;
  return SENSITIVE_KEY.test(name)
    || SENSITIVE_KEY_COLLAPSED.test(name.replaceAll(/[-_.]/g, ""));
}

export function isScalarQueryValue(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "boolean";
}

export function isCredentialLikeValue(value) {
  if (typeof value !== "string") return false;
  return CREDENTIAL_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

export function hasUnresolvedTemplate(value) {
  return typeof value === "string" && UNRESOLVED_TEMPLATE.test(value);
}

/**
 * Recursively reject credential-like keys or values, unresolved templates, and
 * prototype names anywhere inside a projected example tree.
 */
export function unsafeExampleFindings(value, path = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      findings.push(...unsafeExampleFindings(entry, `${path}[${index}]`));
    });
    return findings;
  }
  if (!isPlainObject(value)) {
    if (hasUnresolvedTemplate(value)) findings.push(`${path}: unresolved template in example value`);
    if (isCredentialLikeValue(value)) findings.push(`${path}: credential-like example value`);
    return findings;
  }
  for (const [name, entry] of Object.entries(value)) {
    if (PROTOTYPE_KEYS.has(name)) findings.push(`${path}.${name}: prototype name in example`);
    else if (isSensitiveExampleName(name)) findings.push(`${path}.${name}: credential-like example key`);
    findings.push(...unsafeExampleFindings(entry, `${path}.${name}`));
  }
  return findings;
}

function matchesType(value, type) {
  switch (type) {
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "array": return Array.isArray(value);
    case "object": return isPlainObject(value);
    default: return true;
  }
}

function validateFormat(value, format, path, errors) {
  if (format === "uri") {
    let url = null;
    try {
      url = new URL(value);
    } catch {
      url = null;
    }
    if (!url) errors.push(`${path}: example is not a valid URI`);
    else if (url.username || url.password) errors.push(`${path}: URI example embeds credentials`);
    return;
  }
  if (format === "date-time" && Number.isNaN(Date.parse(value))) {
    errors.push(`${path}: example is not a valid date-time`);
  }
}

/**
 * Minimal, standards-valid OpenAPI 3.1 schema conformance check used by the
 * parity gate. Supports the constraint vocabulary this document emits
 * (type, enum, const, pattern, min/max and exclusive bounds, length bounds,
 * format, items, properties, required, additionalProperties).
 */
export function validateExampleAgainstSchema(value, schema, path = "$") {
  const errors = [];
  if (!isPlainObject(schema)) return errors;
  if (schema.const !== undefined && !deepEqualValues(value, schema.const)) {
    errors.push(`${path}: example does not match const`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => deepEqualValues(entry, value))) {
    errors.push(`${path}: example is not one of the enumerated values`);
  }
  const types = Array.isArray(schema.type) ? schema.type : (schema.type !== undefined ? [schema.type] : []);
  if (types.length && !types.some((type) => matchesType(value, type))) {
    errors.push(`${path}: example is not of type ${types.join("|")}`);
    return errors;
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: example is below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: example is above maximum`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path}: example is at or below exclusiveMinimum`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) errors.push(`${path}: example is at or above exclusiveMaximum`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: example is shorter than minLength`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: example is longer than maxLength`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: example does not match pattern`);
    if (schema.format !== undefined) validateFormat(value, schema.format, path, errors);
  }
  if (Array.isArray(value) && isPlainObject(schema.items)) {
    value.forEach((entry, index) => {
      errors.push(...validateExampleAgainstSchema(entry, schema.items, `${path}[${index}]`));
    });
  }
  if (isPlainObject(value)) {
    for (const name of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.hasOwn(value, name)) errors.push(`${path}.${name}: required by schema but absent from example`);
    }
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    for (const [name, entry] of Object.entries(value)) {
      if (isPlainObject(properties[name])) {
        errors.push(...validateExampleAgainstSchema(entry, properties[name], `${path}.${name}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${name}: not allowed by additionalProperties:false`);
      }
    }
  }
  return errors;
}

function parameterHasExample(parameter) {
  return parameter.example !== undefined
    || isPlainObject(parameter.examples)
    || (isPlainObject(parameter.schema)
      && (parameter.schema.example !== undefined || isPlainObject(parameter.schema.examples)));
}

function singletonExampleValue(examples) {
  if (!isPlainObject(examples) || Object.keys(examples).length !== 1) return undefined;
  const [only] = Object.values(examples);
  return isPlainObject(only) && "value" in only ? only.value : undefined;
}

export function parameterExampleValue(parameter) {
  if (!isPlainObject(parameter)) return undefined;
  if (parameter.example !== undefined) return parameter.example;
  const fromExamples = singletonExampleValue(parameter.examples);
  if (fromExamples !== undefined) return fromExamples;
  if (isPlainObject(parameter.schema)) {
    if (parameter.schema.example !== undefined) return parameter.schema.example;
    return singletonExampleValue(parameter.schema.examples);
  }
  return undefined;
}

function applyQueryExamples(operation, label, contract) {
  const required = contract.schema?.properties?.queryParams?.required;
  if (!Array.isArray(required) || required.length === 0) {
    throw new Error(`Discovery contract ${label} declares no required query keys`);
  }
  const queryParams = contract.example?.queryParams;
  let applied = 0;
  for (const name of required) {
    if (typeof name !== "string") throw new Error(`Discovery contract ${label} has a non-string required query key`);
    const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
    const parameter = parameters.find((entry) => isPlainObject(entry) && entry.in === "query" && entry.name === name);
    if (!parameter) {
      throw new Error(`OpenAPI ${label} declares no query parameter for required discovery input ${name}`);
    }
    if (parameterHasExample(parameter)) continue;
    const value = isPlainObject(queryParams) ? queryParams[name] : undefined;
    if (!isScalarQueryValue(value)) {
      throw new Error(`Discovery contract ${label} lacks a scalar accepted example for required query input ${name}`);
    }
    if (isSensitiveExampleName(name) || hasUnresolvedTemplate(value) || isCredentialLikeValue(value)) {
      throw new Error(`Discovery contract ${label} carries an unsafe accepted example for required query input ${name}`);
    }
    parameter.example = structuredClone(value);
    applied += 1;
  }
  return applied;
}

function applyBodyExample(operation, label, contract) {
  const mediaType = operation.requestBody?.content?.["application/json"];
  if (!isPlainObject(mediaType)) {
    throw new Error(`OpenAPI ${label} lacks an application/json request body for its declared JSON contract`);
  }
  if (mediaType.example !== undefined || isPlainObject(mediaType.examples)) return 0;
  const body = contract.example?.body;
  if (!isPlainObject(body)) {
    throw new Error(`Discovery contract ${label} lacks a JSON body example`);
  }
  const unsafe = unsafeExampleFindings(body);
  if (unsafe.length) {
    throw new Error(`Discovery contract ${label} carries an unsafe body example: ${unsafe.join("; ")}`);
  }
  mediaType.example = structuredClone(body);
  return 1;
}

/**
 * Project discovery-contract request examples into every paid OpenAPI
 * operation. Undeclared contracts are skipped so the pre-listener startup
 * build (which runs before payment-middleware registration declares them)
 * stays a pure no-op; declared-but-drifted contracts fail loudly instead of
 * silently dropping an accepted request example.
 */
export function applyDiscoveryRequestExamples(document, resolveRequestContract) {
  if (!isPlainObject(document?.paths)) throw new Error("OpenAPI document is missing paths");
  if (typeof resolveRequestContract !== "function") throw new Error("resolveRequestContract is required");
  let queryExamples = 0;
  let bodyExamples = 0;
  for (const [pathname, pathItem] of Object.entries(document.paths)) {
    if (!isPlainObject(pathItem)) continue;
    for (const method of OPENAPI_OPERATION_METHODS) {
      const operation = pathItem[method];
      if (!isPlainObject(operation) || !operation["x-payment-info"]) continue;
      const label = `${method.toUpperCase()} ${pathname}`;
      const contract = resolveRequestContract(label);
      if (!contract) continue;
      if (method === "get") queryExamples += applyQueryExamples(operation, label, contract);
      else bodyExamples += applyBodyExample(operation, label, contract);
    }
  }
  return { ok: true, queryExamples, bodyExamples };
}

/**
 * Generated-surface parity gate over every canonical paid action. Returns a
 * list of human-readable findings; an empty list means every required query
 * input and JSON body still carries a scalar-safe, schema-valid accepted
 * construction example.
 */
export function collectOpenApiRequestExampleFindings({ document, actions } = {}) {
  if (!isPlainObject(document?.paths)) throw new Error("OpenAPI document is missing paths");
  if (!Array.isArray(actions) || actions.length === 0) throw new Error("canonical paid actions are required");
  const findings = [];
  for (const action of actions) {
    const method = String(action?.method || "GET").toUpperCase();
    const route = typeof action?.route === "string" ? action.route : "";
    if (!/^\/[^?#]+$/.test(route)) {
      findings.push(`${method} ${route}: canonical action route is malformed`);
      continue;
    }
    const label = `${method} ${route}`;
    const operation = isPlainObject(document.paths[route]) ? document.paths[route][method.toLowerCase()] : undefined;
    if (!isPlainObject(operation)) {
      findings.push(`${label}: no OpenAPI operation for canonical paid action`);
      continue;
    }
    if (operation["x-payment-info"] === undefined) {
      findings.push(`${label}: canonical paid operation lost x-payment-info`);
    }
    if (method === "GET") {
      const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
      for (const parameter of parameters.filter((entry) => isPlainObject(entry) && entry.in === "query" && entry.required === true)) {
        const name = String(parameter.name);
        const example = parameterExampleValue(parameter);
        if (example === undefined) {
          findings.push(`${label}: required query input ${name} lost its accepted request example`);
          continue;
        }
        if (!isScalarQueryValue(example)) {
          findings.push(`${label}: required query input ${name} example is not a non-empty scalar`);
          continue;
        }
        if (isSensitiveExampleName(name)) findings.push(`${label}: required query input ${name} is credential-like`);
        if (hasUnresolvedTemplate(example)) findings.push(`${label}: required query input ${name} example contains an unresolved template`);
        if (isCredentialLikeValue(example)) findings.push(`${label}: required query input ${name} example is credential-like`);
        for (const error of validateExampleAgainstSchema(example, parameter.schema, `$.${name}`)) {
          findings.push(`${label}: required query input ${name}: ${error}`);
        }
      }
      continue;
    }
    const mediaType = operation.requestBody?.content?.["application/json"];
    if (!isPlainObject(mediaType)) {
      findings.push(`${label}: paid JSON-body POST lacks an application/json request body`);
      continue;
    }
    const example = mediaType.example !== undefined
      ? mediaType.example
      : singletonExampleValue(mediaType.examples);
    if (example === undefined) {
      findings.push(`${label}: JSON request body lost its accepted construction example`);
      continue;
    }
    if (!isPlainObject(example)) {
      findings.push(`${label}: JSON request body example is not an object`);
      continue;
    }
    for (const unsafe of unsafeExampleFindings(example)) findings.push(`${label}: ${unsafe}`);
    for (const error of validateExampleAgainstSchema(example, mediaType.schema)) {
      findings.push(`${label}: ${error}`);
    }
  }
  return findings;
}