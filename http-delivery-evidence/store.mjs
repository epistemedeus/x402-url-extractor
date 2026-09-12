import { randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { digestResponseBytes } from "./digest.mjs";
import {
  SCHEMA,
  SETTLEMENT_CLASS,
  USEFULNESS_UNKNOWN,
  VALIDATOR_AUTHORITY,
  VALIDATOR_SOURCE,
  evaluateResponseBytes,
  PROHIBITED_INFERENCES,
} from "./classify.mjs";
import {
  HISTORICAL_VALIDATOR_VERDICT,
  PAID_EVIDENCE_FILENAME,
  isHistoricalV1PaidSuccess,
  joinKey,
  parseNdjson,
} from "./historical.mjs";
import { MAX_RESPONSE_BYTES, contractNameForResource } from "./contract.mjs";

export const VALIDATION_FILENAME = "http-response-validation.v1.ndjson";

export const VALIDATION_KEYS = Object.freeze([
  "capturedAt",
  "contractName",
  "counters",
  "deliveryClass",
  "merchantHttpStatus",
  "method",
  "payerClass",
  "prohibitedInferences",
  "recordId",
  "resource",
  "responseByteLength",
  "responseDigest",
  "schemaVersion",
  "settlementClass",
  "settlementReference",
  "usefulness",
  "validatorAuthority",
  "validatorSource",
  "validatorVerdict",
]);

const RECORD_ID_RE = /^hrv_[0-9a-f]{32}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const METHOD_RE = /^(GET|POST)$/;
const RESOURCE_RE = /^\/(extract|read|extract\/batch|lockfile-pin-delta)$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const VERDICTS = new Set(["pass", "invalid", "unknown"]);
const SETTLEMENTS = new Set(Object.values(SETTLEMENT_CLASS));
const FORBIDDEN_SUBSTRINGS = [
  "payment-signature",
  "PAYMENT-SIGNATURE",
  "wallet_private",
  "BEGIN PRIVATE KEY",
  "?url=",
  "raw-query",
];

export function openStore(dir) {
  if (typeof dir !== "string" || dir.length === 0) {
    throw new Error("store directory is required");
  }
  const validationPath = path.join(dir, VALIDATION_FILENAME);
  const historicalPath = path.join(dir, PAID_EVIDENCE_FILENAME);
  return {
    dir,
    validationPath,
    historicalPath,
    async appendValidation(record) {
      const canonical = canonicalizeValidationRecord(record);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700).catch(() => {});
      await appendFile(validationPath, `${JSON.stringify(canonical)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(validationPath, 0o600).catch(() => {});
      return canonical;
    },
    async readHistorical({ currentValidatorVerdict } = {}) {
      const text = await readFile(historicalPath, "utf8").catch((error) => (
        error?.code === "ENOENT" ? "" : Promise.reject(error)
      ));
      const rows = parseNdjson(text);
      return rows.map((row) => {
        if (row?._unparseable) {
          return { kind: "unparseable", retained: true, row: null };
        }
        if (isHistoricalV1PaidSuccess(row, { currentValidatorVerdict })) {
          return { kind: "historical_v1_not_checked", retained: true, row };
        }
        return { kind: "non_historical", retained: true, row };
      });
    },
    async readValidations() {
      const text = await readFile(validationPath, "utf8").catch((error) => (
        error?.code === "ENOENT" ? "" : Promise.reject(error)
      ));
      return parseNdjson(text)
        .filter((row) => !row?._unparseable)
        .map((row) => canonicalizeValidationRecord(row));
    },
    async join({ currentValidatorVerdict } = {}) {
      const historical = await this.readHistorical({ currentValidatorVerdict });
      const validations = await this.readValidations();
      const byKey = new Map();
      for (const item of historical) {
        if (item.kind !== "historical_v1_not_checked") continue;
        byKey.set(joinKey(item.row), { historical: item.row, validations: [] });
      }
      for (const validation of validations) {
        const key = joinKey({
          method: validation.method,
          resource: validation.resource,
          responseDigest: validation.responseDigest,
        });
        const existing = byKey.get(key) || { historical: null, validations: [] };
        existing.validations.push(validation);
        byKey.set(key, existing);
      }
      return [...byKey.values()];
    },
  };
}

export function recordFromObservedResponse({
  method,
  resource,
  responseBytes,
  merchantHttpStatus,
  settlementClass,
  settlementReference = null,
  payerClass = "unclassified",
  capturedAt,
  recordId,
} = {}) {
  const bytes = Buffer.from(responseBytes || []);
  const digest = digestResponseBytes(bytes);
  const evaluated = evaluateResponseBytes({
    method,
    resource,
    responseBytes: bytes,
    merchantHttpStatus,
    settlementClass,
    settlementReference,
    payerClass,
    capturedAt,
    recordId,
  });
  return canonicalizeValidationRecord({
    schemaVersion: SCHEMA,
    recordId: recordId || makeRecordId(),
    capturedAt: capturedAt || new Date().toISOString(),
    method,
    resource,
    contractName: evaluated.contractName || contractNameForResource(resource),
    responseDigest: digest,
    responseByteLength: Math.min(bytes.length, MAX_RESPONSE_BYTES),
    merchantHttpStatus: evaluated.merchantHttpStatus,
    settlementClass,
    settlementReference,
    payerClass,
    validatorVerdict: evaluated.validatorVerdict,
    validatorAuthority: VALIDATOR_AUTHORITY,
    validatorSource: VALIDATOR_SOURCE,
    deliveryClass: evaluated.deliveryClass,
    usefulness: USEFULNESS_UNKNOWN,
    counters: evaluated.counters,
    prohibitedInferences: [...PROHIBITED_INFERENCES],
  });
}

export function canonicalizeValidationRecord(value) {
  if (!isPlainObject(value)) throw new Error("validation record must be a plain object");
  const canonical = {
    schemaVersion: value.schemaVersion,
    recordId: value.recordId,
    capturedAt: value.capturedAt,
    method: value.method,
    resource: value.resource,
    contractName: value.contractName,
    responseDigest: value.responseDigest,
    responseByteLength: value.responseByteLength,
    merchantHttpStatus: value.merchantHttpStatus,
    settlementClass: value.settlementClass,
    settlementReference: value.settlementReference ?? null,
    payerClass: value.payerClass,
    validatorVerdict: value.validatorVerdict,
    validatorAuthority: value.validatorAuthority,
    validatorSource: value.validatorSource,
    deliveryClass: value.deliveryClass,
    usefulness: value.usefulness,
    counters: {
      schemaErrors: counterOrDefault(value.counters?.schemaErrors),
      requiredPresent: counterOrDefault(value.counters?.requiredPresent),
      truncateMarks: counterOrDefault(value.counters?.truncateMarks),
      sourceRefusalMarks: counterOrDefault(value.counters?.sourceRefusalMarks),
    },
    prohibitedInferences: Array.isArray(value.prohibitedInferences)
      ? [...value.prohibitedInferences]
      : [...PROHIBITED_INFERENCES],
  };
  assertValidationRecord(canonical);
  return canonical;
}

export function assertValidationRecord(value) {
  const keys = Object.keys(value).sort();
  if (keys.length !== VALIDATION_KEYS.length || keys.some((key, i) => key !== VALIDATION_KEYS[i])) {
    throw new Error("validation record has unexpected keys");
  }
  if (value.schemaVersion !== SCHEMA) throw new Error("unsupported validation schema");
  if (!RECORD_ID_RE.test(value.recordId)) throw new Error("invalid recordId");
  if (!ISO_RE.test(value.capturedAt)) throw new Error("invalid capturedAt");
  if (!METHOD_RE.test(value.method)) throw new Error("invalid method");
  if (!RESOURCE_RE.test(value.resource)) throw new Error("invalid resource");
  if (typeof value.contractName !== "string" || value.contractName.length < 8) {
    throw new Error("invalid contractName");
  }
  if (!DIGEST_RE.test(value.responseDigest)) throw new Error("invalid responseDigest");
  requireFiniteInteger(value.responseByteLength, "responseByteLength", 0, MAX_RESPONSE_BYTES);
  if (value.merchantHttpStatus !== null) {
    requireFiniteInteger(value.merchantHttpStatus, "merchantHttpStatus", 100, 599);
  }
  if (!SETTLEMENTS.has(value.settlementClass)) throw new Error("invalid settlementClass");
  if (value.settlementReference !== null && !TX_RE.test(value.settlementReference)) {
    throw new Error("invalid settlementReference");
  }
  if (typeof value.payerClass !== "string") throw new Error("invalid payerClass");
  if (!VERDICTS.has(value.validatorVerdict)) throw new Error("invalid validatorVerdict");
  if (value.validatorAuthority !== VALIDATOR_AUTHORITY) throw new Error("invalid validatorAuthority");
  if (value.validatorSource !== VALIDATOR_SOURCE) throw new Error("invalid validatorSource");
  if (typeof value.deliveryClass !== "string") throw new Error("invalid deliveryClass");
  if (value.usefulness !== USEFULNESS_UNKNOWN) throw new Error("usefulness must remain unknown");
  const counterKeys = Object.keys(value.counters).sort();
  const expectedCounters = ["requiredPresent", "schemaErrors", "sourceRefusalMarks", "truncateMarks"];
  if (counterKeys.length !== expectedCounters.length || counterKeys.some((key, i) => key !== expectedCounters[i])) {
    throw new Error("validation counters have unexpected keys");
  }
  for (const name of expectedCounters) {
    requireFiniteInteger(value.counters[name], `counter ${name}`, 0, 99);
  }
  if (!Array.isArray(value.prohibitedInferences) || value.prohibitedInferences.length < 4) {
    throw new Error("prohibitedInferences required");
  }
  const serialized = JSON.stringify(value);
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    if (serialized.includes(needle)) throw new Error("validation record retained a forbidden secret class");
  }
  if (value.validatorVerdict === HISTORICAL_VALIDATOR_VERDICT) {
    throw new Error("new records must not reuse historical not_checked");
  }
}

function makeRecordId() {
  return `hrv_${randomUUID().replaceAll("-", "")}`;
}

function counterOrDefault(value) {
  if (value === undefined) return 0;
  requireFiniteInteger(value, "counter", 0, 99);
  return value;
}

function requireFiniteInteger(value, label, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`invalid ${label}`);
  }
  if (value < min || value > max) throw new Error(`invalid ${label}`);
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
