import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { boundCounter, jsonSchemaSafeParse } from "./json-schema-safe-parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const GENERATED = JSON.parse(readFileSync(join(here, "canonical-contracts.generated.json"), "utf8"));

export const RESOURCES = Object.freeze({
  EXTRACT: "/extract",
  READ: "/read",
  EXTRACT_BATCH: "/extract/batch",
  LOCKFILE: "/lockfile-pin-delta",
});

export const EXTRACT_CONTRACT = "x402-url-extractor.extractMcpOutputSchema";
export const READ_CONTRACT = "x402-url-extractor.readMcpOutputSchema";
export const EXTRACT_BATCH_CONTRACT = "x402-url-extractor.extractBatchOutputSchema";
export const LOCKFILE_CONTRACT = "x402-url-extractor.lockfilePinDeltaOutputSchema";

export const CANONICAL_PIN = Object.freeze({
  merchantSha: GENERATED.merchantSha,
  binding: GENERATED.binding,
});

export const MAX_RESPONSE_BYTES = 10_485_760;

const RESOURCE_SCHEMA = Object.freeze({
  [RESOURCES.EXTRACT]: GENERATED.schemas.extract,
  [RESOURCES.READ]: GENERATED.schemas.read,
  [RESOURCES.EXTRACT_BATCH]: GENERATED.schemas.batchHttp,
});

let owningParsers = null;

/**
 * H01 same-repo bind. Pass merchant extractMcpOutputSchema.safeParse,
 * readMcpOutputSchema.safeParse, and extractBatchOutputSchema (HTTP JSON Schema)
 * or a parse function. Do not import this experiment as a private sibling path.
 */
export function bindOwningContracts({
  extractSuccessParse,
  readSuccessParse,
  batchHttpParse,
  lockfileHttpParse,
} = {}) {
  owningParsers = {
    [RESOURCES.EXTRACT]: wrapOwningParse(extractSuccessParse),
    [RESOURCES.READ]: wrapOwningParse(readSuccessParse),
    [RESOURCES.EXTRACT_BATCH]: wrapOwningParse(batchHttpParse),
    [RESOURCES.LOCKFILE]: wrapOwningParse(lockfileHttpParse),
  };
}

export function resetOwningContracts() {
  owningParsers = null;
}

export function contractNameForResource(resource) {
  if (resource === RESOURCES.EXTRACT) return EXTRACT_CONTRACT;
  if (resource === RESOURCES.READ) return READ_CONTRACT;
  if (resource === RESOURCES.EXTRACT_BATCH) return EXTRACT_BATCH_CONTRACT;
  if (resource === RESOURCES.LOCKFILE) return LOCKFILE_CONTRACT;
  return null;
}

export function isSupportedTarget(method, resource) {
  if (resource === RESOURCES.EXTRACT || resource === RESOURCES.READ) return method === "GET";
  if (resource === RESOURCES.EXTRACT_BATCH || resource === RESOURCES.LOCKFILE) return method === "POST";
  return false;
}

export function parseJsonBytes(bytes) {
  if (!bytes || bytes.length === 0) {
    return { ok: false, reason: "missing_body", value: null };
  }
  let text;
  try {
    text = Buffer.from(bytes).toString("utf8");
  } catch {
    return { ok: false, reason: "malformed_body", value: null };
  }
  if (!text.trim()) {
    return { ok: false, reason: "missing_body", value: null };
  }
  try {
    return { ok: true, reason: null, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "malformed_body", value: null };
  }
}

export function checkDeclaredContract(resource, value, method = null) {
  if (method && !isSupportedTarget(method, resource)) {
    return unsupported("unsupported_method");
  }
  const owning = owningParsers?.[resource];
  if (owning) return owning(value);
  const schema = RESOURCE_SCHEMA[resource];
  if (!schema) return unsupported("unsupported_resource");
  return jsonSchemaSafeParse(schema, value);
}

export function generatedBatchMcpSchema() {
  return GENERATED.schemas.batchMcp;
}

export function generatedHttpSchema(resource) {
  return RESOURCE_SCHEMA[resource] || null;
}

function wrapOwningParse(parse) {
  if (typeof parse !== "function") return null;
  return (value) => {
    const result = parse(value);
    if (result && typeof result.success === "boolean") {
      if (result.success) {
        return {
          ok: true,
          schemaErrors: 0,
          requiredPresent: boundCounter(Object.keys(value || {}).length),
          codes: [],
        };
      }
      const issues = Array.isArray(result.error?.issues) ? result.error.issues : [];
      return {
        ok: false,
        schemaErrors: boundCounter(issues.length || 1),
        requiredPresent: 0,
        codes: issues.slice(0, 16).map((issue) => (
          Array.isArray(issue.path) && issue.path.length ? issue.path.join(".") : "schema"
        )),
      };
    }
    if (isAdapterResult(result)) return result;
    if (isJsonSchemaDocument(result)) return jsonSchemaSafeParse(result, value);
    throw new Error("owning parser must return Zod safeParse, jsonSchemaSafeParse, or a JSON Schema document");
  };
}

function isAdapterResult(result) {
  return Boolean(
    result
    && typeof result.ok === "boolean"
    && typeof result.schemaErrors === "number"
  );
}

function isJsonSchemaDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (
    typeof value.type === "string"
    || Array.isArray(value.type)
    || Array.isArray(value.anyOf)
    || Object.hasOwn(value, "properties")
    || value.additionalProperties !== undefined
  );
}

function unsupported(code) {
  return {
    ok: false,
    unsupported: true,
    schemaErrors: 0,
    requiredPresent: 0,
    codes: [code],
  };
}

export { boundCounter };
