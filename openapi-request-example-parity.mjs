/**
 * Deterministic projection of the authoritative Bazaar discovery-contract
 * request examples into the generated OpenAPI 3.1 documents, plus strict
 * generated-surface gates.
 *
 * Amendment 1 (request-example parity):
 * - Canonical discovery-contract examples are authoritative. An existing
 *   authored parameter/media example must be canonically equal to the
 *   canonical value or the canonical value overwrites it deterministically;
 *   silent authored precedence is forbidden.
 * - The Circle gateway GET alias is mapped explicitly onto its canonical GET
 *   request contract (`GET /commerce/payment-offer-preflight`).
 * - Schema conformance uses the repository's locked, standards-complete JSON
 *   Schema 2020-12 validator (@cfworker/json-schema, synchronous, local refs
 *   only). Custom dialects, $id rebasing, and non-local references fail
 *   closed; anything the validator cannot compile fails closed.
 * - Semantic equality is structural (object key order insensitive); JSON
 *   stringify order equality is never used.
 * - The public `signature` exception is scoped to exactly
 *   GET /chain/solana-transaction-receipt query field `signature` with the
 *   canonical public Solana base58 schema; the key is rejected everywhere else.
 * - Credential-bearing URL examples (userinfo, fragments, sensitive query
 *   keys/values, embedded credential material) are rejected; ordinary public
 *   URLs stay valid.
 *
 * Single source of truth: examples are taken exclusively from
 * `getDiscoveryRequestContract` through the injected resolver. This module
 * never authors or stores a second example table.
 */

import { Validator } from "@cfworker/json-schema";

const OPENAPI_OPERATION_METHODS = ["get", "post"];
const JSON_SCHEMA_2020_12 = "2020-12";

const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// Same sensitivity classes as discovery-contract.mjs so a projected example can
// never surface a credential-like input name onto the generated surface. The
// bare key `signature` is NOT globally exempt: see
// PUBLIC_SOLANA_SIGNATURE_QUERY for the single scoped exception.
const SENSITIVE_KEY = /(?:^|[-_.])(auth|authorization|bearer|cookie|credential|jwt|otp|pass(?:word)?|secret|session|signature|token)(?:$|[-_.])/i;
const SENSITIVE_KEY_COLLAPSED = /(?:api|access|auth|authorization|bearer|client|cookie|credential|private|session)?(?:jwt|key|otp|pass|password|secret|signature|token)$/i;
const CREDENTIAL_VALUE_PATTERNS = [
  /^(?:bearer|basic|token)\s+\S+/i,
  /^sk-[A-Za-z0-9_-]+$/,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
const UNRESOLVED_TEMPLATE = /\{[^{}]*\}/;

// The single public `signature` exception: a Solana transaction signature is
// public ledger data (same class as an EVM transactionHash), carried only by
// this exact method-route and query field, under this exact canonical public
// base58 schema. Every other occurrence of the key is rejected.
export const PUBLIC_SOLANA_SIGNATURE_QUERY = Object.freeze({
  method: "GET",
  route: "/chain/solana-transaction-receipt",
  field: "signature",
  schemaPattern: "^[1-9A-HJ-NP-Za-km-z]{80,90}$",
});

// Explicit alias mapping from generated access paths onto their canonical
// discovery request contracts. The Circle gateway GET path serves the same
// canonical payment-offer-preflight GET request contract.
export const REQUEST_CONTRACT_ALIASES = Object.freeze({
  "GET /gateway/commerce/payment-offer-preflight": "GET /commerce/payment-offer-preflight",
});

// Exact canonical paid surface inventory. The AgentCash profile additionally
// exposes the Circle gateway GET alias when the gateway is enabled.
const CANONICAL_PAID_GET_ROUTES = Object.freeze([
  "/chain/solana-transaction-receipt",
  "/chain/transaction-receipt",
  "/commerce/contract-qualified-search",
  "/commerce/payment-offer-preflight",
  "/commerce/seller-integrity-audit",
  "/commerce/settlement-proof",
  "/deep-audit",
  "/defi/morpho-market-underwrite",
  "/defi/morpho-position",
  "/defi/morpho-preliquidation-replay",
  "/defi/morpho-protection",
  "/distribution/agent-discoverability-audit",
  "/distribution/agent-surface-budget-audit",
  "/enrich",
  "/extract",
  "/read",
  "/scan",
  "/schemaforge",
  "/wallet-enrich",
  "/work/opportunity-preflight",
]);
const CANONICAL_PAID_POST_ROUTES = Object.freeze([
  "/commerce/payment-offer-preflight",
  "/security/stateful-wallet-policy-conformance",
  "/security/wallet-policy-conformance",
  "/work/opportunity-preflight",
]);
export const EXPECTED_PAID_METHOD_ROUTE_COUNTS = Object.freeze({
  agentcash: 25,
  mpp: 24,
});

export function expectedPaidMethodRoutes({ profile, circleGatewayEnabled = false } = {}) {
  const routes = [
    ...CANONICAL_PAID_GET_ROUTES.map((route) => `GET ${route}`),
    ...CANONICAL_PAID_POST_ROUTES.map((route) => `POST ${route}`),
  ];
  if (circleGatewayEnabled && profile !== "mpp") routes.push("GET /gateway/commerce/payment-offer-preflight");
  return routes.sort();
}

// Dialects accepted by the fail-closed schema validator: JSON Schema 2020-12
// and the OpenAPI 3.1 base dialect (which defines no extra assertion
// vocabulary). Every other declared dialect is rejected.
const ACCEPTED_SCHEMA_DIALECTS = new Set([
  "https://json-schema.org/draft/2020-12/schema",
  "https://spec.openapis.org/oas/3.1/dialect/base",
]);

// Assertion and applicator keywords the locked 2020-12 validator evaluates.
// Anything outside this set (or the annotation set below) fails closed
// instead of being silently ignored.
const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  "$schema", "$ref", "$defs", "definitions",
  "type", "enum", "const",
  "multipleOf", "maximum", "exclusiveMaximum", "minimum", "exclusiveMinimum",
  "maxLength", "minLength", "pattern", "format",
  "maxItems", "minItems", "uniqueItems", "contains", "maxContains", "minContains",
  "items", "prefixItems", "additionalItems",
  "maxProperties", "minProperties", "required", "properties", "patternProperties",
  "additionalProperties", "propertyNames", "dependentRequired", "dependentSchemas",
  "if", "then", "else", "allOf", "anyOf", "oneOf", "not",
  "unevaluatedItems", "unevaluatedProperties",
]);
// Annotations and metadata: they never carry assertion semantics, so ignoring
// them cannot hide a constraint violation.
const ANNOTATION_SCHEMA_KEYWORDS = new Set([
  "title", "description", "default", "deprecated", "readOnly", "writeOnly",
  "examples", "example", "$comment", "contentMediaType", "contentEncoding",
  "xml", "externalDocs", "discriminator",
]);
const SUBSCHEMA_MAP_KEYWORDS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const SUBSCHEMA_ARRAY_KEYWORDS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const SUBSCHEMA_KEYWORDS = new Set([
  "items", "additionalProperties", "unevaluatedItems", "unevaluatedProperties",
  "contains", "propertyNames", "not", "if", "then", "else", "additionalItems",
]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalJsonPointerRef(value) {
  return typeof value === "string" && (value === "#" || value.startsWith("#/"));
}

function visitSchemaTree(schema, path, onSchema) {
  const visit = (node, location) => {
    if (typeof node === "boolean") return;
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${location}[${index}]`));
      return;
    }
    if (!isPlainObject(node)) return;
    onSchema(node, location);
    for (const [key, entry] of Object.entries(node)) {
      if (SUBSCHEMA_MAP_KEYWORDS.has(key) && isPlainObject(entry)) {
        for (const [name, sub] of Object.entries(entry)) visit(sub, `${location}.${key}.${name}`);
      } else if (SUBSCHEMA_ARRAY_KEYWORDS.has(key) && Array.isArray(entry)) {
        entry.forEach((sub, index) => visit(sub, `${location}.${key}[${index}]`));
      } else if (SUBSCHEMA_KEYWORDS.has(key)) {
        visit(entry, `${location}.${key}`);
      }
    }
  };
  visit(schema, path);
}

function unsupportedKeywordFindings(schema, path = "schema") {
  const findings = [];
  visitSchemaTree(schema, path, (node, location) => {
    for (const key of Object.keys(node)) {
      if (key.startsWith("x-")) continue;
      if (!SUPPORTED_SCHEMA_KEYWORDS.has(key) && !ANNOTATION_SCHEMA_KEYWORDS.has(key)) {
        findings.push(`${location}: unsupported schema keyword "${key}" (fail closed)`);
      }
    }
  });
  return findings;
}

/**
 * Structural semantic equality: objects compare independently of key order,
 * arrays compare element-wise in order. Never JSON.stringify order equality.
 */
export function valuesCanonicallyEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((entry, index) => valuesCanonicallyEqual(entry, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    if (!leftKeys.every((key, index) => key === rightKeys[index])) return false;
    return leftKeys.every((key) => valuesCanonicallyEqual(left[key], right[key]));
  }
  return false;
}

export function isSensitiveExampleName(name, { allowPublicSolanaSignatureField = false } = {}) {
  if (typeof name !== "string") return false;
  if (PROTOTYPE_KEYS.has(name)) return true;
  if (allowPublicSolanaSignatureField && name === PUBLIC_SOLANA_SIGNATURE_QUERY.field) return false;
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
 * Reject credential-bearing URL examples while keeping ordinary public URLs
 * valid: URL userinfo, fragments, sensitive query keys, credential-like query
 * values, nested URL credential channels, and other hidden credential
 * channels are rejected.
 */
export function credentialBearingUrlFindings(value, path = "$") {
  const findings = [];
  if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) return findings;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    findings.push(`${path}: example looks like a URL but does not parse`);
    return findings;
  }
  if (url.username || url.password) findings.push(`${path}: URL example embeds userinfo credentials`);
  if (url.hash) findings.push(`${path}: URL example carries a fragment channel`);
  for (const [key, entry] of url.searchParams.entries()) {
    if (isSensitiveExampleName(key)) findings.push(`${path}: URL example query key ${key} is credential-like`);
    if (isCredentialLikeValue(entry)) findings.push(`${path}: URL example query value for ${key} is credential-like`);
    if (typeof entry === "string" && /^https?:\/\//i.test(entry)) {
      let nested;
      try {
        nested = new URL(entry);
      } catch {
        nested = null;
      }
      if (nested?.username || nested?.password) {
        findings.push(`${path}: URL example query value for ${key} embeds userinfo credentials`);
      }
      if (nested?.hash) {
        findings.push(`${path}: URL example query value for ${key} carries a fragment channel`);
      }
    }
  }
  if (isCredentialLikeValue(url.search)) findings.push(`${path}: URL example query carries credential-like material`);
  if (isCredentialLikeValue(decodeURIComponent(url.pathname))) {
    findings.push(`${path}: URL example path carries credential-like material`);
  }
  return findings;
}

/**
 * Recursively reject credential-like keys or values, unresolved templates,
 * prototype names, and credential-bearing URLs anywhere inside an example
 * tree.
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
    findings.push(...credentialBearingUrlFindings(value, path));
    return findings;
  }
  for (const [name, entry] of Object.entries(value)) {
    if (PROTOTYPE_KEYS.has(name)) findings.push(`${path}.${name}: prototype name in example`);
    else if (isSensitiveExampleName(name)) findings.push(`${path}.${name}: credential-like example key`);
    findings.push(...unsafeExampleFindings(entry, `${path}.${name}`));
  }
  return findings;
}

/**
 * Fail-closed integrity prescan for one schema tree: reject custom dialects,
 * $id base-URI rebasing, and every non-local reference before compilation.
 * Local JSON-pointer references (#, #/...) and the rest of the JSON Schema
 * 2020-12 vocabulary are delegated to the locked standards-complete validator.
 */
function schemaIntegrityFindings(schema, path = "schema") {
  const findings = [];
  visitSchemaTree(schema, path, (node, location) => {
    if (node.$schema !== undefined && !ACCEPTED_SCHEMA_DIALECTS.has(node.$schema)) {
      findings.push(`${location}: unsupported schema dialect ${JSON.stringify(node.$schema)} (fail closed)`);
    }
    if (node.$id !== undefined) {
      findings.push(`${location}: schema declares $id; base-URI rebasing is rejected (fail closed)`);
    }
    if (node.$ref !== undefined && !isLocalJsonPointerRef(node.$ref)) {
      findings.push(`${location}: non-local $ref ${JSON.stringify(node.$ref)} is rejected (local refs only)`);
    }
    if (node.$dynamicRef !== undefined || node.$recursiveRef !== undefined) {
      findings.push(`${location}: dynamic/recursive $ref is rejected (fail closed)`);
    }
  });
  return findings;
}

/**
 * Standards-complete JSON Schema 2020-12 conformance check backed by the
 * repository's locked @cfworker/json-schema validator (synchronous, local
 * refs only). Unsupported or hostile schema material fails closed instead of
 * being ignored: unresolvable references, custom dialects, $id rebasing, and
 * non-local $refs all produce findings. String examples additionally reject
 * credential-bearing URLs.
 */
export function validateExampleAgainstSchema(value, schema, path = "$") {
  const errors = [];
  if (!isPlainObject(schema)) return errors;
  for (const finding of schemaIntegrityFindings(schema)) errors.push(`${path}: ${finding}`);
  for (const finding of unsupportedKeywordFindings(schema)) errors.push(`${path}: ${finding}`);
  if (errors.length) return errors;
  let output;
  try {
    output = new Validator(schema, JSON_SCHEMA_2020_12, false).validate(value);
  } catch (error) {
    return [`${path}: schema failed to compile (fail closed): ${String(error?.message || error)}`];
  }
  for (const entry of output.errors) {
    const at = entry.instanceLocation === "#" ? "" : String(entry.instanceLocation).replace(/^#/, "");
    errors.push(`${path}${at}: ${entry.error}`);
  }
  if (typeof value === "string") {
    for (const finding of credentialBearingUrlFindings(value)) {
      errors.push(`${path}: ${finding.slice(finding.indexOf(": ") + 2)}`);
    }
  }
  return errors;
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

function clearAuthoredParameterExample(parameter) {
  delete parameter.examples;
  if (isPlainObject(parameter.schema)) {
    delete parameter.schema.example;
    delete parameter.schema.examples;
  }
}

function publicSignatureExceptionApplies(label) {
  return label === `${PUBLIC_SOLANA_SIGNATURE_QUERY.method} ${PUBLIC_SOLANA_SIGNATURE_QUERY.route}`;
}

/**
 * Canonical examples are authoritative: safety and fail-closed schema
 * conformance of the canonical value are enforced before any overwrite is
 * considered. The scoped public Solana signature exception is honored only on
 * its exact method-route and query field, and only under the canonical public
 * base58 schema.
 */
function enforceCanonicalQueryInputSafety(label, schema, name, value) {
  const exceptionApplies = publicSignatureExceptionApplies(label);
  if (isSensitiveExampleName(name, { allowPublicSolanaSignatureField: exceptionApplies })) {
    throw new Error(`Discovery contract ${label} carries an unsafe accepted example for required query input ${name}`);
  }
  if (exceptionApplies && name === PUBLIC_SOLANA_SIGNATURE_QUERY.field) {
    if (schema?.type !== "string" || schema.pattern !== PUBLIC_SOLANA_SIGNATURE_QUERY.schemaPattern) {
      throw new Error(`Discovery contract ${label} query input ${name} must carry the canonical public Solana base58 schema (${PUBLIC_SOLANA_SIGNATURE_QUERY.schemaPattern})`);
    }
  }
  if (hasUnresolvedTemplate(value)) {
    throw new Error(`Discovery contract ${label} carries an unresolved template example for required query input ${name}`);
  }
  if (isCredentialLikeValue(value)) {
    throw new Error(`Discovery contract ${label} carries a credential-like accepted example for required query input ${name}`);
  }
  for (const finding of credentialBearingUrlFindings(value)) {
    throw new Error(`Discovery contract ${label} carries a credential-bearing URL example for required query input ${name}: ${finding.slice(finding.indexOf(": ") + 2)}`);
  }
  for (const error of validateExampleAgainstSchema(value, schema, `$.${name}`)) {
    throw new Error(`Discovery contract ${label} accepted example for required query input ${name} violates its schema: ${error}`);
  }
}

function applyQueryExamples(operation, label, contract) {
  const required = contract.schema?.properties?.queryParams?.required;
  if (!Array.isArray(required) || required.length === 0) {
    throw new Error(`Discovery contract ${label} declares no required query keys`);
  }
  const queryParams = contract.example?.queryParams;
  let applied = 0;
  let verified = 0;
  let overwritten = 0;
  for (const name of required) {
    if (typeof name !== "string") throw new Error(`Discovery contract ${label} has a non-string required query key`);
    const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
    const parameter = parameters.find((entry) => isPlainObject(entry) && entry.in === "query" && entry.name === name);
    if (!parameter) {
      throw new Error(`OpenAPI ${label} declares no query parameter for required discovery input ${name}`);
    }
    const value = isPlainObject(queryParams) ? queryParams[name] : undefined;
    if (!isScalarQueryValue(value)) {
      throw new Error(`Discovery contract ${label} lacks a scalar accepted example for required query input ${name}`);
    }
    enforceCanonicalQueryInputSafety(label, parameter.schema, name, value);
    const current = parameterExampleValue(parameter);
    if (current !== undefined && valuesCanonicallyEqual(current, value)) {
      verified += 1;
      continue;
    }
    clearAuthoredParameterExample(parameter);
    parameter.example = structuredClone(value);
    if (current === undefined) applied += 1;
    else overwritten += 1;
  }
  return { applied, verified, overwritten };
}

function applyBodyExample(operation, label, contract) {
  const mediaType = operation.requestBody?.content?.["application/json"];
  if (!isPlainObject(mediaType)) {
    throw new Error(`OpenAPI ${label} lacks an application/json request body for its declared JSON contract`);
  }
  const body = contract.example?.body;
  if (!isPlainObject(body)) {
    throw new Error(`Discovery contract ${label} lacks a JSON body example`);
  }
  const unsafe = unsafeExampleFindings(body);
  if (unsafe.length) {
    throw new Error(`Discovery contract ${label} carries an unsafe body example: ${unsafe.join("; ")}`);
  }
  if (!isPlainObject(mediaType.schema)) {
    throw new Error(`OpenAPI ${label} JSON request body lacks a schema`);
  }
  const schemaErrors = validateExampleAgainstSchema(body, mediaType.schema);
  if (schemaErrors.length) {
    throw new Error(`Discovery contract ${label} accepted body example violates its schema: ${schemaErrors.join("; ")}`);
  }
  const current = mediaType.example !== undefined
    ? mediaType.example
    : singletonExampleValue(mediaType.examples);
  if (current !== undefined && valuesCanonicallyEqual(current, body)) {
    return { applied: 0, verified: 1, overwritten: 0 };
  }
  delete mediaType.examples;
  mediaType.example = structuredClone(body);
  if (current === undefined) return { applied: 1, verified: 0, overwritten: 0 };
  return { applied: 0, verified: 0, overwritten: 1 };
}

/**
 * Resolve the canonical request contract for a generated operation label,
 * following the explicit alias map (e.g. the Circle gateway GET path onto its
 * canonical GET request contract) when the label itself is undeclared.
 */
function resolveCanonicalRequestContract(label, resolveRequestContract) {
  const direct = resolveRequestContract(label);
  if (direct) return direct;
  const canonicalRouteKey = REQUEST_CONTRACT_ALIASES[label];
  return canonicalRouteKey ? resolveRequestContract(canonicalRouteKey) : null;
}

/**
 * Project discovery-contract request examples into every paid OpenAPI
 * operation with canonical authority: an existing authored example must be
 * canonically equal to the canonical value or the canonical value overwrites
 * deterministically. Undeclared contracts are skipped so the pre-listener
 * startup build (which runs before payment-middleware registration declares
 * them) stays a pure no-op; the post-registration generation gate audits the
 * complete paid surface so nothing example-less can be served.
 */
export function applyDiscoveryRequestExamples(document, resolveRequestContract) {
  if (!isPlainObject(document?.paths)) throw new Error("OpenAPI document is missing paths");
  if (typeof resolveRequestContract !== "function") throw new Error("resolveRequestContract is required");
  let queryApplied = 0;
  let queryVerified = 0;
  let queryOverwritten = 0;
  let bodyApplied = 0;
  let bodyVerified = 0;
  let bodyOverwritten = 0;
  for (const [pathname, pathItem] of Object.entries(document.paths)) {
    if (!isPlainObject(pathItem)) continue;
    for (const method of OPENAPI_OPERATION_METHODS) {
      const operation = pathItem[method];
      if (!isPlainObject(operation) || !operation["x-payment-info"]) continue;
      const label = `${method.toUpperCase()} ${pathname}`;
      const contract = resolveCanonicalRequestContract(label, resolveRequestContract);
      if (!contract) continue;
      if (method === "get") {
        const receipt = applyQueryExamples(operation, label, contract);
        queryApplied += receipt.applied;
        queryVerified += receipt.verified;
        queryOverwritten += receipt.overwritten;
      } else {
        const receipt = applyBodyExample(operation, label, contract);
        bodyApplied += receipt.applied;
        bodyVerified += receipt.verified;
        bodyOverwritten += receipt.overwritten;
      }
    }
  }
  return {
    ok: true,
    queryExamples: queryApplied,
    bodyExamples: bodyApplied,
    queryVerified,
    queryOverwritten,
    bodyVerified,
    bodyOverwritten,
  };
}

function auditPaidOperation(findings, method, route, operation) {
  const label = `${method} ${route}`;
  const successSchema = operation.responses?.["200"]?.content?.["application/json"]?.schema;
  if (!isPlainObject(successSchema)) {
    findings.push(`${label}: paid operation lost its formal 200 JSON response schema`);
  }
  if (method === "GET") {
    const exceptionApplies = publicSignatureExceptionApplies(label);
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
      if (isSensitiveExampleName(name, { allowPublicSolanaSignatureField: exceptionApplies })) {
        findings.push(`${label}: required query input ${name} is credential-like`);
      }
      if (exceptionApplies && name === PUBLIC_SOLANA_SIGNATURE_QUERY.field) {
        if (parameter.schema?.type !== "string" || parameter.schema?.pattern !== PUBLIC_SOLANA_SIGNATURE_QUERY.schemaPattern) {
          findings.push(`${label}: required query input ${name} must carry the canonical public Solana base58 schema (${PUBLIC_SOLANA_SIGNATURE_QUERY.schemaPattern})`);
        }
      }
      if (hasUnresolvedTemplate(example)) findings.push(`${label}: required query input ${name} example contains an unresolved template`);
      if (isCredentialLikeValue(example)) findings.push(`${label}: required query input ${name} example is credential-like`);
      for (const finding of credentialBearingUrlFindings(example)) findings.push(`${label}: required query input ${name} ${finding.slice(finding.indexOf(": ") + 2)}`);
      for (const error of validateExampleAgainstSchema(example, parameter.schema, `$.${name}`)) {
        findings.push(`${label}: required query input ${name}: ${error}`);
      }
    }
    return;
  }
  const mediaType = operation.requestBody?.content?.["application/json"];
  if (!isPlainObject(mediaType)) {
    findings.push(`${label}: paid JSON-body POST lacks an application/json request body`);
    return;
  }
  if (!isPlainObject(mediaType.schema)) {
    findings.push(`${label}: JSON request body lacks a schema`);
  }
  const example = mediaType.example !== undefined
    ? mediaType.example
    : singletonExampleValue(mediaType.examples);
  if (example === undefined) {
    findings.push(`${label}: JSON request body lost its accepted construction example`);
    return;
  }
  if (!isPlainObject(example)) {
    findings.push(`${label}: JSON request body example is not an object`);
    return;
  }
  for (const unsafe of unsafeExampleFindings(example)) findings.push(`${label}: ${unsafe}`);
  for (const error of validateExampleAgainstSchema(example, mediaType.schema)) {
    findings.push(`${label}: ${error}`);
  }
}

function paidMethodRoutesOf(document) {
  const routes = [];
  for (const [pathname, pathItem] of Object.entries(document.paths || {})) {
    if (!isPlainObject(pathItem)) continue;
    for (const method of OPENAPI_OPERATION_METHODS) {
      const operation = pathItem[method];
      if (!isPlainObject(operation) || !operation["x-payment-info"]) continue;
      routes.push(`${method.toUpperCase()} ${pathname}`);
    }
  }
  return routes.sort();
}

/**
 * Generated-surface parity gate over EVERY generated paid operation — all
 * canonical paid actions, both POST aliases, and the Circle gateway GET alias,
 * not only the 22 /api/actions catalog entries. Reconciles the exact paid
 * inventory, requires a request example, a formal 200 JSON response schema,
 * and safety parity on each, and rejects the public `signature` key anywhere
 * outside its single scoped exception. Returns human-readable findings; an
 * empty list means the surface is fully example-, schema-, and safety-parity
 * clean.
 */
export function collectOpenApiRequestExampleFindings({ document, actions, expectedPaidMethodRoutes: expectedRoutes } = {}) {
  if (!isPlainObject(document?.paths)) throw new Error("OpenAPI document is missing paths");
  const findings = [];
  const paidRoutes = paidMethodRoutesOf(document);
  for (const label of paidRoutes) {
    const [method, ...rest] = label.split(" ");
    const pathname = rest.join(" ");
    const operation = document.paths[pathname][method.toLowerCase()];
    auditPaidOperation(findings, method, pathname, operation);
  }
  if (expectedRoutes !== undefined) {
    const expected = [...expectedRoutes].sort();
    if (paidRoutes.length !== expected.length || paidRoutes.some((route, index) => route !== expected[index])) {
      findings.push(`paid inventory drift: document has [${paidRoutes.join(", ")}] but expected [${expected.join(", ")}]`);
    }
  }
  if (actions !== undefined) {
    if (!Array.isArray(actions) || actions.length === 0) throw new Error("canonical paid actions are required");
    for (const action of actions) {
      const method = String(action?.method || "GET").toUpperCase();
      const route = typeof action?.route === "string" ? action.route : "";
      if (!paidRoutes.includes(`${method} ${route}`)) {
        findings.push(`${method} ${route}: canonical catalog action missing from the generated paid surface`);
      }
    }
  }
  return findings;
}

/**
 * Strict post-discovery-registration, pre-listen generation gate. Both public
 * documents are regenerated after every discovery contract is declared and
 * audited against the exact paid inventories (25 AgentCash and 24 MPP
 * method-routes). Any missing, renamed, or drifted canonical request contract
 * — any lost request example, lost formal success schema, unsafe example, or
 * inventory drift — fails startup instead of serving a drifted document.
 */
export function assertGeneratedOpenApiSurfaceGate({ documents, circleGatewayEnabled = false, resolveRequestContract } = {}) {
  if (!isPlainObject(documents)) throw new Error("generated OpenAPI documents are required");
  if (typeof resolveRequestContract !== "function") throw new Error("resolveRequestContract is required");
  const problems = [];
  for (const profile of ["agentcash", "mpp"]) {
    const document = documents[profile];
    if (!isPlainObject(document?.paths)) {
      problems.push(`${profile}: OpenAPI document is missing paths`);
      continue;
    }
    const expected = expectedPaidMethodRoutes({ profile, circleGatewayEnabled });
    if (expected.length !== EXPECTED_PAID_METHOD_ROUTE_COUNTS[profile]) {
      problems.push(`${profile}: canonical expected inventory is ${EXPECTED_PAID_METHOD_ROUTE_COUNTS[profile]} method-routes but resolved to ${expected.length}`);
    }
    for (const label of expected) {
      if (!resolveCanonicalRequestContract(label, resolveRequestContract)) {
        problems.push(`${profile}: ${label}: missing canonical request contract`);
      }
    }
    for (const finding of collectOpenApiRequestExampleFindings({ document, expectedPaidMethodRoutes: expected })) {
      problems.push(`${profile}: ${finding}`);
    }
  }
  if (problems.length) {
    throw new Error(`generated OpenAPI surface generation gate failed:\n- ${problems.join("\n- ")}`);
  }
  return {
    ok: true,
    agentcash: EXPECTED_PAID_METHOD_ROUTE_COUNTS.agentcash,
    mpp: EXPECTED_PAID_METHOD_ROUTE_COUNTS.mpp,
  };
}
