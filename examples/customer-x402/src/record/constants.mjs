import {
  EXTRACT_BATCH_AMOUNT_ATOMIC,
  EXTRACT_BATCH_PRODUCT,
  EXTRACT_BATCH_SCHEMA_VERSION,
} from "../../../../extract-batch-config.mjs";

export const MAPPING_SCHEMA_VERSION = "pilot.c29.buyer-record-projection.mapping.v1";
export const RESULT_SCHEMA_VERSION = "pilot.c29.buyer-record-projection.result.v1";
export const TRANSFORMER_NAME = "pilot-c29-buyer-record-projection";
export const TRANSFORMER_VERSION = "0.1.0";

export const KINDS = Object.freeze(["extract", "extract_batch", "json"]);
export const BASES = Object.freeze(["document", "row", "item"]);
export const ON_MISSING = Object.freeze(["omit", "null"]);
export const ITEM_CARDINALITY = Object.freeze(["array", "one"]);
export const ITEM_WHEN_MISSING = Object.freeze(["empty", "fail"]);
export const RECORD_STATUSES = Object.freeze(["success", "partial", "invalid"]);
export const JOB_STATUSES = Object.freeze(["success", "partial", "failure"]);

export const MERCHANT_BATCH_PRODUCT = EXTRACT_BATCH_PRODUCT;
export const MERCHANT_BATCH_SCHEMA_VERSION = EXTRACT_BATCH_SCHEMA_VERSION;
export const MERCHANT_BATCH_AMOUNT_ATOMIC = EXTRACT_BATCH_AMOUNT_ATOMIC;
export const MERCHANT_BATCH_SOURCE_STATUSES = Object.freeze([
  "pending", "success", "partial", "failure", "unknown", "skipped_duplicate",
]);
export const MERCHANT_BATCH_TOP_FIELDS = Object.freeze([
  "ok", "product", "schemaVersion", "quote", "jobId", "jobStatus",
  "stopReason", "partial", "sources", "accounting", "costInputs", "charged", "boundary",
]);
export const MERCHANT_EXTRACT_FIELDS = Object.freeze([
  "ok", "url", "status", "contentType", "title", "description", "canonical", "lang",
  "openGraph", "twitter", "jsonLd", "headings", "links", "text", "aiReadiness", "fetchedAt",
]);

export const DEFAULT_LIMITS = Object.freeze({
  maxInputBytes: 1_048_576,
  maxOutputBytes: 1_048_576,
  maxMappingBytes: 65_536,
  maxSchemaBytes: 65_536,
  maxRows: 1_000,
  maxItemsPerRow: 256,
  maxFields: 32,
  maxPointerTokens: 16,
  maxSchemaDepth: 8,
  maxSchemaNodes: 256,
  maxStringBytes: 8_192,
  maxFailures: 50,
  maxUnmappedKeys: 64,
});

export const HARD_CAPS = Object.freeze({ ...DEFAULT_LIMITS });

export const FORBIDDEN_MAPPING_KEYS = Object.freeze([
  "command", "exec", "shell", "eval", "spawn", "fork", "import", "require",
  "fetch", "http", "https", "url", "network", "cwd", "env", "script", "inline",
  "module", "node", "python", "bash", "$ref", "jmespath", "jsonpath", "jsonata",
  "jq", "expr", "expression", "transform", "code",
]);

export const PROTOTYPE_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);

export const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export const ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export const SOURCE_STATEMENT_DISCLAIMER =
  "Source statements only. Not proof of legal existence, identity, or product truth.";
