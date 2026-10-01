import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import {
  DELIVERY,
  SETTLEMENT_CLASS,
  USEFULNESS_UNKNOWN,
  VALIDATOR_AUTHORITY,
  VALIDATOR_SOURCE,
  VERDICT,
  evaluateResponseBytes,
} from "./http-delivery-evidence/index.mjs";

export const FORWARD_SCHEMA_V1 = "samedaydesk.outcome-binding.forward.v1";
export const FORWARD_SCHEMA_V2 = "samedaydesk.outcome-binding.forward.v2";
export const FORWARD_PRODUCER_BASE_COMMIT = "ebd6834f3501ace0948b2ad5b7a3df9ab5c6b048";
export const FORWARD_WRITER_ID = "x402-url-extractor.createCommerceTelemetry.forward-v2";
export const FORWARD_SOURCE_PLANE = "forward_instrumenter";
export const FORWARD_BINDING_FILENAME = "commerce-outcome-binding.ndjson";
export const FORWARD_BINDING_ROTATED_FILENAME = "commerce-outcome-binding.1.ndjson";
export const TASK_REF_SCHEMA = "samedaydesk.outcome-task-ref.v1";
export const TASK_REF_FILENAME = "commerce-outcome-task-ref.ndjson";
export const TASK_REF_ROTATED_FILENAME = "commerce-outcome-task-ref.1.ndjson";
// Current file plus one rotation. A third rotation deletes the oldest file.
// Duplicate admission is only for event ids still in those two files.
export const TASK_REF_RETAINED_GENERATIONS = 2;
const TASK_REF_EPOCH = "samedaydesk.outcome-task-ref.epoch.v1";
const OPAQUE_TASK_REF = /^t[a-f0-9]{62}$/;
export const RECONCILIATION_SCHEMA = "samedaydesk.commerce-settlement-reconciliation.v1";
export const REUSE_AUTHORITY = "authenticated_producer_observation";
export const SETTLEMENT_AUTHORITY_READBACK = "runtime_readback";
export const SETTLEMENT_AUTHORITY_MOCKED = "mocked_settlement_boundary";
export const HISTORICAL_VALIDATOR_VERDICT = "not_checked";
export const HISTORICAL_VALIDATOR_AUTHORITY = "none";
export const HISTORICAL_VALIDATOR_SOURCE = "http_runtime_not_checked";

const OPERATION_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TX = /^0x[0-9a-f]{64}$/;
const ATOMIC = /^(0|[1-9][0-9]{0,77})$/;
const COHORTS = new Set(["controlled_test", "external_unknown", "owner_qa", "sponsored_trial"]);
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const STAGES = new Set(["discovery", "call", "transport", "delivery", "settlement", "retained_use"]);
const PLANES = new Set([
  "journey_marker",
  "transport_observation",
  "schema_delivery",
  "economic_settlement",
  "retained_use",
]);
const DELIVERY_CLASSES = new Set(Object.values(DELIVERY));
const VERDICTS = new Set([VERDICT.PASS, VERDICT.INVALID, VERDICT.UNKNOWN, HISTORICAL_VALIDATOR_VERDICT]);
const SETTLEMENT_CLASSES = new Set([
  SETTLEMENT_CLASS.SIMULATED,
  SETTLEMENT_CLASS.UNPAID,
  SETTLEMENT_CLASS.REAL_UNVERIFIED,
  "reconciled",
]);
const MOCKED_BOUNDARY = new Set([SETTLEMENT_CLASS.SIMULATED, SETTLEMENT_CLASS.UNPAID]);
const CALL_RESULTS = new Set([
  "challenge",
  "validation_failure",
  "paid_route_response",
  "request",
  "service_failure",
  "paid_success",
  "replay_success",
]);

export const FORWARD_V2_KEYS = Object.freeze([
  "brand",
  "cohort",
  "commerceEventId",
  "correctionOf",
  "deliveryClass",
  "eventId",
  "evidencePlane",
  "method",
  "operationId",
  "producerBaseCommit",
  "receiptDigest",
  "reuseAuthority",
  "route",
  "schemaVersion",
  "settlementAuthority",
  "settlementClass",
  "settlementReference",
  "sourcePlane",
  "stage",
  "usefulness",
  "validatorAuthority",
  "validatorSource",
  "validatorVerdict",
  "valueAtomic",
  "writerId",
]);

function headerValue(headers, name) {
  try {
    const value = headers?.[name];
    return Array.isArray(value) ? value.join(",") : String(value ?? "");
  } catch {
    return "";
  }
}

function tokenAuthorized(supplied, internalToken) {
  if (typeof internalToken !== "string" || Buffer.byteLength(internalToken, "utf8") < 32) return false;
  if (typeof supplied !== "string" || supplied.length === 0) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(internalToken);
  return left.length === right.length && timingSafeEqual(left, right);
}

const TASK_REF_KEYS = Object.freeze([
  "cohort",
  "commerceEventId",
  "eventId",
  "operationId",
  "schemaVersion",
  "taskRef",
  "writerId",
]);

function foldIdentity(value) {
  return String(value).toLowerCase();
}

function obviousIdentity(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return true;
  const folded = foldIdentity(value);
  if (folded.includes("@") || folded.includes("://")) return true;
  if (folded.startsWith("mailto:") || folded.startsWith("http:") || folded.startsWith("https:")) return true;
  if (folded.startsWith("0x") || folded.startsWith("bc1") || folded.startsWith("tb1") || folded.startsWith("ltc1")) return true;
  if (/(^|[^a-z0-9])(bearer|sk-|pk_live|pk_test)/.test(folded)) return true;
  if (folded.startsWith("eyj") && folded.includes(".")) return true;
  if (/^[1-9a-hj-np-z]{32,44}$/.test(folded)) return true;
  return false;
}

function acceptedTaskLabel(value, internalToken) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (obviousIdentity(value) || obviousIdentity(foldIdentity(value))) return null;
  if (!OPERATION_ID_RE.test(value)) return null;
  if (typeof internalToken === "string" && foldIdentity(value) === foldIdentity(internalToken)) return null;
  return value;
}

export function taskRefCapabilityEpoch(internalToken) {
  if (typeof internalToken !== "string" || Buffer.byteLength(internalToken, "utf8") < 32) return null;
  return createHash("sha256").update(`${TASK_REF_EPOCH}\0${internalToken}`).digest("hex").slice(0, 16);
}

function opaqueTaskRef(internalToken, label) {
  const epoch = taskRefCapabilityEpoch(internalToken);
  if (!epoch) return null;
  const mac = createHmac("sha256", internalToken)
    .update(`${TASK_REF_EPOCH}\0${epoch}\0${label}`)
    .digest("hex");
  let body = mac.slice(0, 62);
  if (body.startsWith("0x") || body.startsWith("bc1")) body = `a${body.slice(1)}`;
  const link = `t${body}`;
  return OPAQUE_TASK_REF.test(link) ? link : null;
}

export function authorizeOutcomeBinding(headers, internalToken) {
  const supplied = headerValue(headers, "x-samedaydesk-internal");
  if (!tokenAuthorized(supplied, internalToken)) return null;
  const operationId = headerValue(headers, "x-samedaydesk-outcome-operation");
  const cohort = headerValue(headers, "x-samedaydesk-outcome-cohort");
  if (!OPERATION_ID_RE.test(operationId) || !COHORTS.has(cohort)) return null;
  const suppliedTask = headerValue(headers, "x-samedaydesk-outcome-task");
  const label = suppliedTask ? acceptedTaskLabel(suppliedTask, internalToken) : null;
  return Object.freeze({
    brand: "samedaydesk",
    operationId,
    cohort,
    taskRef: label ? opaqueTaskRef(internalToken, label) : null,
  });
}

export function isTaskRefRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  const keys = Object.keys(record).sort();
  if (keys.length !== TASK_REF_KEYS.length || keys.some((key, index) => key !== TASK_REF_KEYS[index])) return false;
  if (record.schemaVersion !== TASK_REF_SCHEMA || record.writerId !== FORWARD_WRITER_ID) return false;
  if (!OPERATION_ID_RE.test(record.operationId) || !OPAQUE_TASK_REF.test(record.taskRef || "")) return false;
  if (obviousIdentity(record.taskRef)) return false;
  if (!COHORTS.has(record.cohort)) return false;
  return UUID_V4.test(record.commerceEventId || "") && UUID_V4.test(record.eventId || "");
}

export function buildTaskRefRecord({ claim, commerceEventId } = {}) {
  if (!claim || typeof claim.taskRef !== "string" || !OPAQUE_TASK_REF.test(claim.taskRef)) return null;
  if (!OPERATION_ID_RE.test(claim.operationId || "") || !COHORTS.has(claim.cohort)) return null;
  if (!UUID_V4.test(commerceEventId || "")) return null;
  const record = {
    cohort: claim.cohort,
    commerceEventId,
    eventId: stableForwardEventId(`${claim.operationId}\0task-ref\0${claim.taskRef}\0${commerceEventId}`),
    operationId: claim.operationId,
    schemaVersion: TASK_REF_SCHEMA,
    taskRef: claim.taskRef,
    writerId: FORWARD_WRITER_ID,
  };
  return isTaskRefRecord(record) ? Object.freeze(record) : null;
}

export function stableForwardEventId(material) {
  const digest = createHash("sha256")
    .update(`samedaydesk.outcome-binding.forward.v2\0${material}`)
    .digest("hex");
  const chars = digest.slice(0, 32).split("");
  chars[12] = "4";
  const variant = "89ab"[Number.parseInt(chars[16], 16) % 4];
  chars[16] = variant;
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function nullableHex(value) {
  return value === null || HEX64.test(value);
}

function nullableTx(value) {
  return value === null || TX.test(value);
}

function routeOk(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value.startsWith("/") && !/\s/.test(value);
}

export function isSchemaValidDeliveryEvidence(record) {
  return Boolean(record)
    && record.schemaVersion === FORWARD_SCHEMA_V2
    && record.stage === "delivery"
    && record.evidencePlane === "schema_delivery"
    && record.validatorVerdict === VERDICT.PASS
    && record.validatorAuthority === VALIDATOR_AUTHORITY
    && record.validatorSource === VALIDATOR_SOURCE
    && record.deliveryClass === DELIVERY.FULL_BOUNDED_CAPTURE
    && record.usefulness === USEFULNESS_UNKNOWN
    && record.settlementAuthority === null
    && record.settlementReference === null
    && record.reuseAuthority === null
    && HEX64.test(record.receiptDigest || "");
}

export function isForwardV2Record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== FORWARD_V2_KEYS.length || keys.some((key, index) => key !== FORWARD_V2_KEYS[index])) return false;
  if (value.schemaVersion !== FORWARD_SCHEMA_V2 || value.sourcePlane !== FORWARD_SOURCE_PLANE) return false;
  if (value.producerBaseCommit !== FORWARD_PRODUCER_BASE_COMMIT || value.writerId !== FORWARD_WRITER_ID) return false;
  if (value.brand !== "samedaydesk" && value.brand !== "ein-llc" && value.brand !== "neomorphic") return false;
  if (!COHORTS.has(value.cohort) || !OPERATION_ID_RE.test(value.operationId)) return false;
  if (!UUID_V4.test(value.eventId) || !UUID_V4.test(value.commerceEventId)) return false;
  if (!STAGES.has(value.stage) || !PLANES.has(value.evidencePlane)) return false;
  if (!routeOk(value.route) || !METHODS.has(value.method)) return false;
  if (!nullableHex(value.receiptDigest)) return false;
  if (value.correctionOf !== null && !OPERATION_ID_RE.test(value.correctionOf)) return false;
  if (value.deliveryClass !== null && !DELIVERY_CLASSES.has(value.deliveryClass)) return false;
  if (value.validatorVerdict !== null && !VERDICTS.has(value.validatorVerdict)) return false;
  if (value.validatorAuthority !== null && value.validatorAuthority !== VALIDATOR_AUTHORITY && value.validatorAuthority !== HISTORICAL_VALIDATOR_AUTHORITY) {
    return false;
  }
  if (value.validatorSource !== null && value.validatorSource !== VALIDATOR_SOURCE && value.validatorSource !== HISTORICAL_VALIDATOR_SOURCE) {
    return false;
  }
  if (value.usefulness !== null && value.usefulness !== USEFULNESS_UNKNOWN) return false;
  if (value.reuseAuthority !== null && value.reuseAuthority !== REUSE_AUTHORITY) return false;
  if (value.settlementAuthority !== null && value.settlementAuthority !== SETTLEMENT_AUTHORITY_READBACK && value.settlementAuthority !== SETTLEMENT_AUTHORITY_MOCKED) {
    return false;
  }
  if (value.settlementClass !== null && !SETTLEMENT_CLASSES.has(value.settlementClass)) return false;
  if (!nullableTx(value.settlementReference)) return false;
  if (value.valueAtomic !== null && !ATOMIC.test(value.valueAtomic)) return false;
  if (value.validatorVerdict === HISTORICAL_VALIDATOR_VERDICT && value.stage === "delivery") return false;
  if (value.stage === "delivery" && value.evidencePlane !== "schema_delivery") return false;
  if (value.stage === "transport" && value.evidencePlane !== "transport_observation") return false;
  if ((value.stage === "discovery" || value.stage === "call") && value.evidencePlane !== "journey_marker") return false;
  if (value.stage === "settlement" && value.evidencePlane !== "economic_settlement") return false;
  if (value.stage === "retained_use" && value.evidencePlane !== "retained_use") return false;
  if ((value.stage === "delivery" || value.stage === "transport" || value.stage === "retained_use") && value.receiptDigest === null) {
    return false;
  }
  if (value.stage === "settlement" && value.receiptDigest === null) return false;
  return true;
}

function blankRecord(fields) {
  const record = {
    brand: fields.brand,
    cohort: fields.cohort,
    commerceEventId: fields.commerceEventId,
    correctionOf: fields.correctionOf ?? null,
    deliveryClass: fields.deliveryClass ?? null,
    eventId: fields.eventId,
    evidencePlane: fields.evidencePlane,
    method: fields.method,
    operationId: fields.operationId,
    producerBaseCommit: FORWARD_PRODUCER_BASE_COMMIT,
    receiptDigest: fields.receiptDigest ?? null,
    reuseAuthority: fields.reuseAuthority ?? null,
    route: fields.route,
    schemaVersion: FORWARD_SCHEMA_V2,
    settlementAuthority: fields.settlementAuthority ?? null,
    settlementClass: fields.settlementClass ?? null,
    settlementReference: fields.settlementReference ?? null,
    sourcePlane: FORWARD_SOURCE_PLANE,
    stage: fields.stage,
    usefulness: fields.usefulness ?? null,
    validatorAuthority: fields.validatorAuthority ?? null,
    validatorSource: fields.validatorSource ?? null,
    validatorVerdict: fields.validatorVerdict ?? null,
    valueAtomic: fields.valueAtomic ?? null,
    writerId: FORWARD_WRITER_ID,
  };
  return isForwardV2Record(record) ? record : null;
}

function copySchemaEvidence(record, digest) {
  if (!record || typeof record !== "object") return null;
  if (record.responseDigest && record.responseDigest !== digest) return null;
  if (record.validatorVerdict === HISTORICAL_VALIDATOR_VERDICT || record.validatorAuthority === HISTORICAL_VALIDATOR_AUTHORITY) {
    return null;
  }
  if (record.validatorAuthority !== VALIDATOR_AUTHORITY || record.validatorSource !== VALIDATOR_SOURCE) return null;
  if (record.usefulness !== USEFULNESS_UNKNOWN) return null;
  if (![VERDICT.PASS, VERDICT.INVALID, VERDICT.UNKNOWN].includes(record.validatorVerdict)) return null;
  if (!DELIVERY_CLASSES.has(record.deliveryClass)) return null;
  const settlementClass = MOCKED_BOUNDARY.has(record.settlementClass) || record.settlementClass === SETTLEMENT_CLASS.REAL_UNVERIFIED
    ? record.settlementClass
    : null;
  return {
    validatorVerdict: record.validatorVerdict,
    validatorAuthority: record.validatorAuthority,
    validatorSource: record.validatorSource,
    deliveryClass: record.deliveryClass,
    usefulness: USEFULNESS_UNKNOWN,
    settlementClass,
  };
}

function evidenceForUnsupported(event, captured) {
  if (!captured?.bytes) return null;
  try {
    const evaluated = evaluateResponseBytes({
      method: event.method,
      resource: event.route,
      responseBytes: captured.bytes,
      responseByteLength: captured.byteLength,
      merchantHttpStatus: event.status,
      settlementClass: SETTLEMENT_CLASS.UNPAID,
    });
    if (evaluated.validatorVerdict === HISTORICAL_VALIDATOR_VERDICT) return null;
    if (evaluated.usefulness !== USEFULNESS_UNKNOWN) return null;
    if (!DELIVERY_CLASSES.has(evaluated.deliveryClass)) return null;
    return {
      validatorVerdict: evaluated.validatorVerdict,
      validatorAuthority: evaluated.validatorAuthority,
      validatorSource: evaluated.validatorSource,
      deliveryClass: evaluated.deliveryClass,
      usefulness: USEFULNESS_UNKNOWN,
      settlementClass: null,
    };
  } catch {
    return null;
  }
}

export function buildHttpFinishForwardRecords({ claim, event, paidEvidence = null, httpDeliveryRecord = null, captured = null } = {}) {
  if (!claim || !event || !UUID_V4.test(event.id || "")) return [];
  const shared = {
    brand: claim.brand,
    cohort: claim.cohort,
    operationId: claim.operationId,
    commerceEventId: event.id,
    method: event.method,
    route: event.route,
  };
  if (event.result === "discovery" || event.result === "protocol_discovery") {
    const discovery = blankRecord({
      ...shared,
      stage: "discovery",
      evidencePlane: "journey_marker",
      eventId: event.id,
    });
    return discovery ? [discovery] : [];
  }
  if (!CALL_RESULTS.has(event.result)) return [];
  const records = [];
  const call = blankRecord({
    ...shared,
    stage: "call",
    evidencePlane: "journey_marker",
    eventId: event.id,
  });
  if (call) records.push(call);
  if (event.replayed === true || event.result !== "paid_success") return records;
  const digest = typeof paidEvidence?.responseDigest === "string" ? paidEvidence.responseDigest : null;
  if (!HEX64.test(digest || "")) return records;
  const transport = blankRecord({
    ...shared,
    stage: "transport",
    evidencePlane: "transport_observation",
    eventId: stableForwardEventId(`${event.id}\0transport`),
    receiptDigest: digest,
    validatorVerdict: HISTORICAL_VALIDATOR_VERDICT,
    validatorAuthority: HISTORICAL_VALIDATOR_AUTHORITY,
    validatorSource: HISTORICAL_VALIDATOR_SOURCE,
    usefulness: USEFULNESS_UNKNOWN,
  });
  if (transport) records.push(transport);
  const evidence = copySchemaEvidence(httpDeliveryRecord, digest)
    || (httpDeliveryRecord ? null : evidenceForUnsupported(event, captured));
  if (!evidence) return records;
  const delivery = blankRecord({
    ...shared,
    stage: "delivery",
    evidencePlane: "schema_delivery",
    eventId: stableForwardEventId(`${event.id}\0delivery`),
    receiptDigest: digest,
    ...evidence,
  });
  if (delivery) records.push(delivery);
  return records;
}

function emptyIndex() {
  return {
    eventIds: new Set(),
    operations: new Map(),
  };
}

function operationBucket(index, record) {
  const existing = index.operations.get(record.operationId) || {
    cohort: record.cohort,
    cohorts: new Set(),
    calls: new Set(),
    deliveries: new Map(),
    settlements: new Map(),
  };
  existing.cohorts.add(record.cohort);
  index.operations.set(record.operationId, existing);
  return existing;
}

function rememberRecord(index, record) {
  if (!isForwardV2Record(record) || index.eventIds.has(record.eventId)) return false;
  index.eventIds.add(record.eventId);
  const bucket = operationBucket(index, record);
  if (record.stage === "call") bucket.calls.add(record.commerceEventId);
  if (isSchemaValidDeliveryEvidence(record)) {
    bucket.deliveries.set(record.receiptDigest, {
      commerceEventId: record.commerceEventId,
      settlementClass: record.settlementClass,
      route: record.route,
      method: record.method,
      eventId: record.eventId,
    });
  }
  if (record.stage === "settlement") {
    const identity = record.settlementAuthority === SETTLEMENT_AUTHORITY_MOCKED
      ? `mocked:${record.settlementClass}:${record.receiptDigest}`
      : `${record.settlementReference}:${record.valueAtomic}:${record.receiptDigest}`;
    bucket.settlements.set(identity, {
      valueAtomic: record.valueAtomic,
      receiptDigest: record.receiptDigest,
      reference: record.settlementReference,
    });
  }
  return true;
}

function parseForwardLines(text, index) {
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (isForwardV2Record(parsed)) rememberRecord(index, parsed);
    } catch {
      // A torn or poisoned line never becomes a bound claim.
    }
  }
}

function canonicalRuntimeReadback(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schemaVersion !== RECONCILIATION_SCHEMA || value.state !== "reconciled") return null;
  if (value.recognizedRevenue === true || value.isRevenue === true || value.organicAttribution === true) return null;
  if (!UUID_V4.test(value.sourceEventId || "")) return null;
  if (!TX.test(String(value.settlementReference || ""))) return null;
  if (!ATOMIC.test(String(value.amountAtomic || ""))) return null;
  return {
    sourceEventId: value.sourceEventId,
    settlementReference: String(value.settlementReference).toLowerCase(),
    amountAtomic: String(value.amountAtomic),
  };
}

export function createForwardOutcomeWriter({ dataDir, maxBytes, internalToken }) {
  const currentPath = path.join(dataDir, FORWARD_BINDING_FILENAME);
  const rotatedPath = path.join(dataDir, FORWARD_BINDING_ROTATED_FILENAME);
  const taskRefPath = path.join(dataDir, TASK_REF_FILENAME);
  const taskRefRotatedPath = path.join(dataDir, TASK_REF_ROTATED_FILENAME);
  const boundedMax = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : 5 * 1024 * 1024;
  let index = emptyIndex();
  let loaded = false;
  let taskRefIds = null;
  let taskAdmission = Promise.resolve();

  function admitTask(work) {
    const run = taskAdmission.then(work, work);
    taskAdmission = run.then(() => undefined, () => undefined);
    return run;
  }

  async function scanTaskRefFile(file, ids) {
    const raw = await readFile(file).catch((error) => (error?.code === "ENOENT" ? null : Promise.reject(error)));
    if (!raw || raw.length === 0) return;
    // One retained file is rotated at maxBytes, then one more record is appended,
    // so a legal file is larger than maxBytes. The tail cap keeps a hostile
    // pre-seeded file from becoming an unbounded index.
    const cap = boundedMax + 4096;
    const slice = raw.length > cap ? raw.subarray(raw.length - cap) : raw;
    let text = slice.toString("utf8");
    if (raw.length > cap) {
      const newline = text.indexOf("\n");
      text = newline === -1 ? "" : text.slice(newline + 1);
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (isTaskRefRecord(parsed)) ids.add(parsed.eventId);
      } catch {
        // A torn line is not a duplicate and is not rewritten.
      }
    }
  }

  async function ensureTaskRefIndex() {
    if (taskRefIds) return;
    const ids = new Set();
    await scanTaskRefFile(taskRefRotatedPath, ids);
    await scanTaskRefFile(taskRefPath, ids);
    taskRefIds = ids;
  }

  async function appendTaskLine(record) {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await chmod(dataDir, 0o700).catch(() => {});
    const size = await stat(taskRefPath).then((entry) => entry.size).catch((error) => (
      error?.code === "ENOENT" ? 0 : Promise.reject(error)
    ));
    if (size >= boundedMax) {
      await unlink(taskRefRotatedPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      await rename(taskRefPath, taskRefRotatedPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      const kept = new Set();
      await scanTaskRefFile(taskRefRotatedPath, kept);
      taskRefIds = kept;
    }
    await appendFile(taskRefPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(taskRefPath, 0o600).catch(() => {});
  }

  async function appendTaskRef(record) {
    return admitTask(async () => {
      if (!isTaskRefRecord(record)) return { accepted: false, reason: "invalid_record", eventId: null };
      try {
        await ensureTaskRefIndex();
      } catch {
        return { accepted: false, reason: "write_outcome_unknown", eventId: record.eventId };
      }
      if (taskRefIds.has(record.eventId)) return { accepted: false, reason: "duplicate", eventId: record.eventId };
      try {
        await appendTaskLine(record);
      } catch {
        taskRefIds = null;
        try {
          await ensureTaskRefIndex();
        } catch {
          taskRefIds = null;
          return { accepted: false, reason: "write_outcome_unknown", eventId: record.eventId };
        }
        if (taskRefIds.has(record.eventId)) {
          return { accepted: false, reason: "duplicate", eventId: record.eventId };
        }
        return { accepted: false, reason: "write_outcome_unknown", eventId: record.eventId };
      }
      taskRefIds.add(record.eventId);
      return { accepted: true, reason: null, eventId: record.eventId };
    });
  }

  async function ensureIndex() {
    if (loaded) return;
    const rotated = await readFile(rotatedPath, "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
    const current = await readFile(currentPath, "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
    const next = emptyIndex();
    parseForwardLines(rotated, next);
    parseForwardLines(current, next);
    index = next;
    loaded = true;
  }

  async function appendLine(record) {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await chmod(dataDir, 0o700).catch(() => {});
    const size = await stat(currentPath).then((entry) => entry.size).catch(() => 0);
    if (size >= boundedMax) {
      await unlink(rotatedPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      await rename(currentPath, rotatedPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
    await appendFile(currentPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(currentPath, 0o600).catch(() => {});
  }

  async function appendRecords(records) {
    await ensureIndex();
    const written = [];
    for (const record of records || []) {
      if (!isForwardV2Record(record) || index.eventIds.has(record.eventId)) continue;
      await appendLine(record);
      rememberRecord(index, record);
      written.push(record);
    }
    return written;
  }

  function refuse(reason) {
    return { accepted: false, reason, eventId: null };
  }

  function deliveryFor(operationId, receiptDigest) {
    const bucket = index.operations.get(operationId);
    if (!bucket || !HEX64.test(receiptDigest || "")) return null;
    if (bucket.cohorts.size !== 1) return null;
    return bucket.deliveries.get(receiptDigest) || null;
  }

  async function observeMockedSettlementBoundary({ internalToken: supplied, operationId, receiptDigest } = {}) {
    if (!tokenAuthorized(supplied, internalToken)) return refuse("unauthorized");
    await ensureIndex();
    const delivery = deliveryFor(operationId, receiptDigest);
    if (!delivery) return refuse("unbound_artifact");
    if (!MOCKED_BOUNDARY.has(delivery.settlementClass)) return refuse("not_mocked_boundary");
    const bucket = index.operations.get(operationId);
    if (bucket.settlements.size > 0) return refuse("duplicate_settlement");
    const record = blankRecord({
      brand: "samedaydesk",
      cohort: [...bucket.cohorts][0],
      operationId,
      commerceEventId: delivery.commerceEventId,
      stage: "settlement",
      evidencePlane: "economic_settlement",
      eventId: stableForwardEventId(`${operationId}\0settlement\0mocked\0${delivery.settlementClass}\0${receiptDigest}`),
      method: delivery.method,
      route: delivery.route,
      receiptDigest,
      settlementAuthority: SETTLEMENT_AUTHORITY_MOCKED,
      settlementClass: delivery.settlementClass,
      usefulness: USEFULNESS_UNKNOWN,
    });
    if (!record) return refuse("invalid_record");
    const written = await appendRecords([record]);
    if (written.length !== 1) return refuse("duplicate");
    return { accepted: true, reason: null, eventId: record.eventId };
  }

  async function observeRuntimeSettlementReadback({
    internalToken: supplied,
    operationId,
    receiptDigest,
    readback,
  } = {}) {
    if (!tokenAuthorized(supplied, internalToken)) return refuse("unauthorized");
    const canonical = canonicalRuntimeReadback(readback);
    if (!canonical) return refuse("not_runtime_readback");
    await ensureIndex();
    const delivery = deliveryFor(operationId, receiptDigest);
    if (!delivery || delivery.commerceEventId !== canonical.sourceEventId) return refuse("unbound_artifact");
    const bucket = index.operations.get(operationId);
    if (bucket.settlements.size > 0) return refuse("duplicate_settlement");
    const record = blankRecord({
      brand: "samedaydesk",
      cohort: [...bucket.cohorts][0],
      operationId,
      commerceEventId: delivery.commerceEventId,
      stage: "settlement",
      evidencePlane: "economic_settlement",
      eventId: stableForwardEventId(`${operationId}\0settlement\0readback\0${canonical.settlementReference}\0${canonical.amountAtomic}\0${receiptDigest}`),
      method: delivery.method,
      route: delivery.route,
      receiptDigest,
      settlementAuthority: SETTLEMENT_AUTHORITY_READBACK,
      settlementClass: "reconciled",
      settlementReference: canonical.settlementReference,
      valueAtomic: canonical.amountAtomic,
      usefulness: USEFULNESS_UNKNOWN,
    });
    if (!record) return refuse("invalid_record");
    const written = await appendRecords([record]);
    if (written.length !== 1) return refuse("duplicate");
    return { accepted: true, reason: null, eventId: record.eventId };
  }

  async function observeRetainedUse({
    internalToken: supplied,
    operationId,
    receiptDigest,
    correctionOf = null,
  } = {}) {
    if (!tokenAuthorized(supplied, internalToken)) return refuse("unauthorized");
    if (correctionOf !== null && correctionOf !== operationId) return refuse("wrong_operation");
    await ensureIndex();
    const delivery = deliveryFor(operationId, receiptDigest);
    if (!delivery) return refuse("unbound_artifact");
    const bucket = index.operations.get(operationId);
    const eventId = stableForwardEventId(`${operationId}\0retained\0${receiptDigest}\0${correctionOf || ""}`);
    if (index.eventIds.has(eventId)) return refuse("duplicate");
    const record = blankRecord({
      brand: "samedaydesk",
      cohort: [...bucket.cohorts][0],
      operationId,
      commerceEventId: delivery.commerceEventId,
      stage: "retained_use",
      evidencePlane: "retained_use",
      eventId,
      method: delivery.method,
      route: delivery.route,
      receiptDigest,
      correctionOf,
      reuseAuthority: REUSE_AUTHORITY,
      usefulness: USEFULNESS_UNKNOWN,
    });
    if (!record) return refuse("invalid_record");
    const written = await appendRecords([record]);
    if (written.length !== 1) return refuse("duplicate");
    return { accepted: true, reason: null, eventId: record.eventId };
  }

  return {
    currentPath,
    rotatedPath,
    taskRefPath,
    taskRefRotatedPath,
    appendRecords,
    appendTaskRef,
    observeMockedSettlementBoundary,
    observeRuntimeSettlementReadback,
    observeRetainedUse,
  };
}
