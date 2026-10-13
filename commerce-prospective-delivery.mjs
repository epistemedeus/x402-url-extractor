// Compact prospective settlement-to-technical-delivery journal.
// The parent admission helper remains the only count and amount authority.
// This file stores no raw bodies, URLs, query strings, credentials, addresses,
// settlement references, or event ids. A hash is the idempotency key.
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";

import { admitCommerceJournal, noteJournalWrite } from "./commerce-journal-admission.mjs";
import { readCommerceSettlementAdmission } from "./commerce-settlement-reconciler.mjs";
import { joinOrdinaryDeliveries, readOrdinaryDeliveryStores } from "./ordinary-delivery-join.mjs";

export const PROSPECTIVE_CAPTURE_VERSION = "prospective_delivery_v1";
export const PROSPECTIVE_HEADER_SCHEMA = "samedaydesk.commerce-prospective-delivery-header.v1";
export const PROSPECTIVE_RECORD_SCHEMA = "samedaydesk.commerce-prospective-delivery-record.v1";
export const PROSPECTIVE_PUBLIC_SCHEMA = "samedaydesk.commerce-prospective-delivery.v1";
export const PROSPECTIVE_FILENAME = "commerce-prospective-delivery.ndjson";
export const PROSPECTIVE_MAX_RECORDS = 1024;
// Missing capture stays unknown until this long after the settlement source
// event. Ten minutes is several reconciler cycles (15s minimum, 60s default)
// and is not the 7-day caller-feedback capability. After the boundary, still
// missing capture is no_response. A later ordinary-join capture may advance
// unknown or no_response. The first observedAt stays. A different terminal
// class conflicts and the first one wins.
export const PROSPECTIVE_RESPONSE_BOUNDARY_MS = 10 * 60 * 1000;
const OPEN_TECHNICAL = new Set(["unknown", "no_response"]);
const TERMINAL_TECHNICAL = new Set([
  "validated_response",
  "schema_invalid",
  "partial",
  "dropped_connection",
  "failure_after_settlement",
  "channel_conflict",
]);
const ORDINARY_JOIN = Symbol("ordinary-join");
const STORED_STATEMENT = Symbol("stored-statement");
const PENDING_CLOCKS = Symbol("pending-capture-clocks");
export const PROSPECTIVE_PENDING_FILENAME = "commerce-prospective-capture-pending.json";
export const PROSPECTIVE_PENDING_MAX_CANDIDATES = 1024;
export const PROSPECTIVE_PENDING_MAX_BYTES = 512 * 1024;
const PENDING_SCHEMA = "samedaydesk.commerce-prospective-capture-pending.v1";

const TECHNICAL = Object.freeze([
  "validated_response",
  "schema_invalid",
  "partial",
  "no_response",
  "dropped_connection",
  "failure_after_settlement",
  "channel_conflict",
  "unknown",
]);
const FEEDBACK = Object.freeze(["absent", "declared_useful", "declared_not_useful", "rejected"]);
const SEALS = Object.freeze(["none", "binds_declaration"]);
const CHANNELS = Object.freeze(["http", "mcp", "none", "conflict"]);
const TASKS = Object.freeze(["absent", "controlled_test", "external_unknown", "owner_qa", "sponsored_trial"]);
const COMPLETE_DELIVERY = new Set(["full_bounded_capture", "complete_useful", "useful_negative", "source_refusal"]);
const TX = /^0x[0-9a-fA-F]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const packageVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function prospectiveEvidenceKey(reference) {
  const text = String(reference || "").toLowerCase();
  if (!TX.test(text)) return null;
  return sha256(text);
}

function emptyTechnical() {
  return Object.fromEntries(TECHNICAL.map((key) => [key, 0]));
}

function emptyFeedback() {
  return Object.fromEntries(FEEDBACK.map((key) => [key, 0]));
}

function emptyTasks() {
  return Object.fromEntries(TASKS.map((key) => [key, 0]));
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function headerRecord(now, sourceVersion) {
  return {
    schemaVersion: PROSPECTIVE_HEADER_SCHEMA,
    captureVersion: PROSPECTIVE_CAPTURE_VERSION,
    prospectiveSince: new Date(now).toISOString(),
    sourceVersion,
  };
}

function isHeader(value) {
  return exactKeys(value, ["captureVersion", "prospectiveSince", "schemaVersion", "sourceVersion"])
    && value.schemaVersion === PROSPECTIVE_HEADER_SCHEMA
    && value.captureVersion === PROSPECTIVE_CAPTURE_VERSION
    && typeof value.sourceVersion === "string"
    && value.sourceVersion.length > 0
    && value.sourceVersion.length <= 40
    && ISO.test(value.prospectiveSince || "");
}

function isObservation(value) {
  return exactKeys(value, [
    "channel",
    "evidenceKey",
    "feedback",
    "feedbackSeal",
    "observedAt",
    "schemaVersion",
    "taskClass",
    "technical",
  ])
    && value.schemaVersion === PROSPECTIVE_RECORD_SCHEMA
    && HEX64.test(value.evidenceKey || "")
    && TECHNICAL.includes(value.technical)
    && CHANNELS.includes(value.channel)
    && TASKS.includes(value.taskClass)
    && FEEDBACK.includes(value.feedback)
    && SEALS.includes(value.feedbackSeal)
    && ISO.test(value.observedAt || "");
}

export function classifyProspectiveObservation(row, context = {}) {
  const reasons = new Set(row?.reasons || []);
  const delivery = context.deliveryClass || row?.deliveryClass || null;
  const typedResult = context.typedResult || null;
  if (!row || typeof row !== "object") return "unknown";
  if (reasons.has("duplicate_settlement_reference")) return "duplicate_ignored";
  if (reasons.has("duplicate_paid_evidence") || reasons.has("duplicate_typed_event")) return "unknown";
  if (reasons.has("capture_channel_conflict") || reasons.has("multiple_event_canons") || context.channel === "conflict") {
    return "channel_conflict";
  }
  if (delivery === "transport_failure" || reasons.has("dropped_connection")) return "dropped_connection";
  if (
    typedResult === "application_failure"
    || delivery === "upstream_failed"
    || delivery === "engine_failure"
    || delivery === "merchant_http_failure"
  ) return "failure_after_settlement";
  if (row.disposition === "rejected_schema" || delivery === "malformed_body" || row.validatorVerdict === "invalid") {
    return "schema_invalid";
  }
  if (
    row.disposition === "missing_capture"
    || delivery === "missing_body"
    || reasons.has("capture_absent")
    || reasons.has("paid_evidence_absent")
  ) return context.responsePending === true ? "unknown" : "no_response";
  if (
    row.disposition === "incomplete_capture"
    || delivery === "truncated_partial"
    || delivery === "incomplete_report"
  ) return "partial";
  if (row.disposition === "exact_join" && row.validatorVerdict === "pass") return "validated_response";
  if (reasons.has("typed_replay") && row.validatorVerdict === "pass" && COMPLETE_DELIVERY.has(delivery)) {
    return "validated_response";
  }
  return "unknown";
}

function feedbackOf(row, context) {
  if (context.feedbackRejected === true || row?.reasons?.includes("task_ref_conflict")) {
    return { feedback: "rejected", feedbackSeal: "none" };
  }
  const acceptance = context.callerAcceptance || row?.callerAcceptance || "absent";
  const disposition = context.callerDisposition || row?.callerDisposition || null;
  if (acceptance === "foreign" || acceptance === "unbound") {
    return { feedback: "rejected", feedbackSeal: "none" };
  }
  if (acceptance === "bound" && disposition === "useful") {
    return { feedback: "declared_useful", feedbackSeal: "binds_declaration" };
  }
  if (acceptance === "bound" && disposition === "not_useful") {
    return { feedback: "declared_not_useful", feedbackSeal: "binds_declaration" };
  }
  return { feedback: "absent", feedbackSeal: "none" };
}

function taskOf(context) {
  if (context.taskConflict === true) return "absent";
  if (TASKS.includes(context.taskClass) && context.taskClass !== "absent") return context.taskClass;
  return "absent";
}

function channelOf(row, context) {
  if (context.channel && CHANNELS.includes(context.channel)) return context.channel;
  const http = Number(row?.httpAttached || 0);
  const mcp = Number(row?.mcpAttached || 0);
  if (http > 0 && mcp > 0) return "conflict";
  if (http > 0) return "http";
  if (mcp > 0) return "mcp";
  return "none";
}

export function observationFromJoin(row, context, observedAt) {
  const technical = context.technical && TECHNICAL.includes(context.technical)
    ? context.technical
    : classifyProspectiveObservation(row, context);
  if (technical === "duplicate_ignored") return { duplicateIgnored: true };
  const stated = feedbackOf(row, context);
  return {
    schemaVersion: PROSPECTIVE_RECORD_SCHEMA,
    evidenceKey: context.evidenceKey,
    technical,
    channel: technical === "channel_conflict" ? "conflict" : channelOf(row, context),
    taskClass: taskOf(context),
    feedback: stated.feedback,
    feedbackSeal: stated.feedback === "absent" || stated.feedback === "rejected" ? "none" : stated.feedbackSeal,
    observedAt,
  };
}

export function parseProspectiveJournal(text) {
  const raw = typeof text === "string" ? text : "";
  const result = {
    decision: "not_started",
    header: null,
    records: [],
    duplicateIgnored: 0,
    conflictRestatements: 0,
    technicalRevisions: 0,
    revisedKeys: [],
    corruptLines: 0,
    saturated: false,
  };
  if (raw.length === 0) return result;
  let body = raw;
  if (!body.endsWith("\n")) {
    result.corruptLines += 1;
    body = body.slice(0, body.lastIndexOf("\n") + 1);
  }
  const lines = body.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return result;
  let header;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    result.decision = "unreadable";
    result.corruptLines += lines.length;
    return result;
  }
  if (!isHeader(header)) {
    result.decision = "version_mismatch";
    result.corruptLines += 1;
    return result;
  }
  result.header = header;
  result.decision = "prospective";
  const seen = new Map();
  for (const line of lines.slice(1)) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      result.corruptLines += 1;
      continue;
    }
    if (parsed?.kind === "saturated" && parsed?.schemaVersion === PROSPECTIVE_HEADER_SCHEMA) {
      result.saturated = true;
      continue;
    }
    if (!isObservation(parsed)) {
      result.corruptLines += 1;
      continue;
    }
    const prior = seen.get(parsed.evidenceKey);
    if (!prior) {
      seen.set(parsed.evidenceKey, parsed);
      result.records.push(parsed);
      continue;
    }
    if (sameObservation(prior, parsed)) {
      result.duplicateIgnored += 1;
      continue;
    }
    if (feedbackFill(prior, parsed)) {
      const updated = { ...prior, feedback: parsed.feedback, feedbackSeal: parsed.feedbackSeal };
      const index = result.records.indexOf(prior);
      result.records[index] = updated;
      seen.set(parsed.evidenceKey, updated);
      continue;
    }
    if (authorizedTechnicalRevision(prior, parsed)) {
      const updated = {
        ...prior,
        technical: parsed.technical,
        channel: parsed.channel,
        taskClass: parsed.taskClass,
      };
      const index = result.records.indexOf(prior);
      result.records[index] = updated;
      seen.set(parsed.evidenceKey, updated);
      result.technicalRevisions += 1;
      result.revisedKeys.push(parsed.evidenceKey);
      continue;
    }
    result.conflictRestatements += 1;
  }
  return result;
}

function storePath(dataDir) {
  return path.join(dataDir, PROSPECTIVE_FILENAME);
}

async function readJournal(dataDir) {
  return (await readRegular(storePath(dataDir)))?.bytes.toString("utf8") || "";
}

function captureError(reason) {
  return Object.assign(new Error(`prospective capture: ${reason}`), { captureReason: reason });
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

// Inspect before opening so a FIFO/device is never activated. NOFOLLOW and
// descriptor identity checks prevent final-target substitution. Pending is a
// private single-link file; ordinary observation reads keep their old modes.
async function readRegular(file, { pending = false } = {}) {
  let info;
  try { info = await lstat(file); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile() || info.nlink !== 1) throw captureError("nonregular");
  if (pending && ((info.mode & 0o777) !== 0o600
    || (typeof process.geteuid === "function" && info.uid !== process.geteuid()))) {
    throw captureError("unreadable");
  }
  if (pending && info.size > PROSPECTIVE_PENDING_MAX_BYTES) throw captureError("saturated");
  const handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  try {
    const pinned = await handle.stat();
    if (!pinned.isFile() || !sameFile(info, pinned)) throw captureError("nonregular");
    const bytes = pending ? Buffer.alloc(info.size) : await handle.readFile();
    if (pending) {
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw captureError("torn");
        offset += bytesRead;
      }
    }
    const after = await handle.stat();
    if (after.size !== bytes.length || !sameFile(info, await lstat(file))) throw captureError("torn");
    return { bytes, info };
  } finally { await handle.close(); }
}

async function syncDirectory(dir) {
  const handle = await open(dir, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function appendLines(dataDir, lines) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const payload = Buffer.from(lines.join(""), "utf8");
  const file = storePath(dataDir);
  const before = await lstat(file);
  if (!before.isFile() || before.nlink !== 1) throw captureError("nonregular");
  const handle = await open(file, fsConstants.O_APPEND | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  try {
    if (!sameFile(before, await handle.stat())) throw captureError("nonregular");
    let offset = 0;
    while (offset < payload.length) {
      const { bytesWritten } = await handle.write(payload.subarray(offset));
      if (bytesWritten <= 0) throw new Error("prospective journal write failed");
      offset += bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dataDir);
}

function countsFor(records) {
  const technical = emptyTechnical();
  const declaredFeedback = emptyFeedback();
  const declaredTaskClass = emptyTasks();
  for (const record of records) {
    technical[record.technical] += 1;
    declaredFeedback[record.feedback] += 1;
    declaredTaskClass[record.taskClass] += 1;
  }
  return { technical, declaredFeedback, declaredTaskClass };
}

function sameSummary(supplied, summary) {
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied) || !summary) return false;
  return supplied.schemaVersion === summary.schemaVersion
    && supplied.reconciledSettlements === summary.reconciledSettlements
    && supplied.distinctSettlementReferences === summary.distinctSettlementReferences
    && supplied.amountAtomic === summary.amountAtomic
    && supplied.invalidLines === summary.invalidLines;
}

export function projectProspectiveDelivery({
  journalText = "",
  admission,
  suppliedSummary = null,
  suppliedCutId = null,
  generatedAt = null,
} = {}) {
  const parsed = parseProspectiveJournal(journalText);
  const summary = admission?.summary || null;
  const cutId = admission?.admissionCutId || null;
  const admitted = Array.isArray(admission?.admitted) ? admission.admitted : [];
  const admittedKeys = new Set();
  for (const record of admitted) {
    const key = prospectiveEvidenceKey(record?.settlementReference);
    if (key) admittedKeys.add(key);
  }
  const boundRecords = [];
  let unadmittedRecords = 0;
  for (const record of parsed.records) {
    if (admittedKeys.has(record.evidenceKey)) boundRecords.push(record);
    else unadmittedRecords += 1;
  }
  const journalKeys = new Set(parsed.records.map((record) => record.evidenceKey));
  let admittedWithoutProspectiveObservation = 0;
  for (const record of admitted) {
    const key = prospectiveEvidenceKey(record?.settlementReference);
    if (!key || !journalKeys.has(key)) admittedWithoutProspectiveObservation += 1;
  }
  const bound = Boolean(summary)
    && (suppliedSummary == null || sameSummary(suppliedSummary, summary))
    && (suppliedCutId == null || suppliedCutId === cutId);
  let decision = parsed.decision;
  if (decision === "prospective" && !bound && (suppliedSummary != null || suppliedCutId != null)) decision = "stale_cut";
  if (decision === "prospective" && parsed.saturated) decision = "saturated";
  const { technical, declaredFeedback, declaredTaskClass } = countsFor(boundRecords);
  const technicalRevisions = (parsed.revisedKeys || []).filter((key) => admittedKeys.has(key)).length;
  const comparable = decision === "prospective"
    && bound
    && parsed.corruptLines === 0
    && unadmittedRecords === 0;
  return {
    schemaVersion: PROSPECTIVE_PUBLIC_SCHEMA,
    decision,
    comparable,
    prospectiveSince: parsed.header?.prospectiveSince || null,
    sourceVersion: parsed.header?.sourceVersion || null,
    captureVersion: parsed.header?.captureVersion || null,
    generatedAt: generatedAt || parsed.header?.prospectiveSince || null,
    bindsToParent: summary ? {
      summarySchema: summary.schemaVersion,
      reconciledSettlements: summary.reconciledSettlements,
      distinctSettlementReferences: summary.distinctSettlementReferences,
      amountAtomic: summary.amountAtomic,
      admissionCutId: cutId,
      matchesSuppliedSummary: suppliedSummary == null && suppliedCutId == null ? null : bound,
    } : null,
    technical,
    declaredFeedback,
    declaredTaskClass,
    duplicateIgnored: parsed.duplicateIgnored,
    conflictRestatements: parsed.conflictRestatements,
    technicalRevisions,
    coverage: {
      historicalBackfill: false,
      historicalComplete: false,
      requestedWindowComplete: false,
      zeroProspectiveIsNotHistoricalZero: true,
      prospectiveSince: parsed.header?.prospectiveSince || null,
      admittedWithoutProspectiveObservation,
      unadmittedRecords,
      corruptLines: parsed.corruptLines,
      projectionSaturated: parsed.saturated,
      retainedEventFilesRequired: false,
      evidenceUnavailable: false,
      responseBoundaryMs: PROSPECTIVE_RESPONSE_BOUNDARY_MS,
    },
    boundaries: {
      technicalValidationIsNotUsefulness: true,
      schemaPassIsNotAcceptance: true,
      paymentIsNotACustomer: true,
      declaredFeedbackIsNotVerifiedUsefulness: true,
      sealBindsDeclarationOnly: true,
      parentAdmissionRemainsMoneyAuthority: true,
      noHistoricalBackfill: true,
      ownerQaIsNotACustomer: true,
      callerTechnicalClaimIsNotAuthority: true,
      technicalRevisionAuthority: "ordinary_delivery_join",
      technicalRevisionClock: "first_observed_at",
      lateTechnicalRevisionIsNotLastWriteWins: true,
      noResponseRequiresResponseBoundary: true,
    },
    recognizedIncomeAtomic: null,
    customerAttribution: null,
    independentRepeat: null,
    usefulness: "unknown",
  };
}

async function ensureHeader(dataDir, now, sourceVersion) {
  const existing = await readRegular(storePath(dataDir));
  if (existing) {
    if (existing.bytes.length === 0) throw captureError("torn");
    return parseProspectiveJournal(existing.bytes.toString("utf8"));
  }
  const header = headerRecord(now, sourceVersion);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const handle = await open(storePath(dataDir), fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try {
    const payload = Buffer.from(`${JSON.stringify(header)}\n`, "utf8");
    let offset = 0;
    while (offset < payload.length) {
      const { bytesWritten } = await handle.write(payload.subarray(offset));
      if (bytesWritten <= 0) throw new Error("prospective header write failed");
      offset += bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dataDir);
  return parseProspectiveJournal(`${JSON.stringify(header)}\n`);
}

function sameObservation(left, right) {
  return left.technical === right.technical
    && left.channel === right.channel
    && left.taskClass === right.taskClass
    && left.feedback === right.feedback
    && left.feedbackSeal === right.feedbackSeal
    && left.evidenceKey === right.evidenceKey;
}

function feedbackFill(prior, next) {
  return prior.technical === next.technical
    && prior.channel === next.channel
    && prior.taskClass === next.taskClass
    && prior.evidenceKey === next.evidenceKey
    && prior.feedback === "absent"
    && prior.feedbackSeal === "none"
    && (next.feedback === "declared_useful" || next.feedback === "declared_not_useful")
    && next.feedbackSeal === "binds_declaration";
}

function authorizedTechnicalRevision(prior, next) {
  if (prior.evidenceKey !== next.evidenceKey || prior.observedAt !== next.observedAt) return false;
  if (prior.feedback !== next.feedback || prior.feedbackSeal !== next.feedbackSeal) return false;
  if (!OPEN_TECHNICAL.has(prior.technical) || next.technical === prior.technical) return false;
  if (next.technical === "unknown") return false;
  if (next.technical === "no_response") return prior.technical === "unknown";
  if (!TERMINAL_TECHNICAL.has(next.technical)) return false;
  if (next.technical === "channel_conflict") {
    if (next.channel !== "conflict") return false;
  } else if (prior.channel !== "none" && next.channel !== prior.channel) return false;
  if (prior.taskClass !== "absent" && next.taskClass !== prior.taskClass) return false;
  return true;
}

function lineFor(observation) {
  if (!isObservation(observation)) return null;
  return `${JSON.stringify(observation)}\n`;
}

export async function appendProspectiveObservations(dataDir, observations, {
  now = Date.now(),
  sourceVersion = packageVersion,
  maxRecords = PROSPECTIVE_MAX_RECORDS,
  [ORDINARY_JOIN]: ordinaryJoin = false,
  [STORED_STATEMENT]: storedStatement = false,
} = {}) {
  return admitCommerceJournal(dataDir, async () => {
    let parsed = await ensureHeader(dataDir, now, sourceVersion);
    if (parsed.decision === "version_mismatch" || parsed.decision === "unreadable") return parsed;
    const lines = [];
    let blocked = false;
    for (const supplied of observations) {
      if (!supplied || supplied.duplicateIgnored === true || !isObservation(supplied)) continue;
      const observation = ordinaryJoin === true || storedStatement === true
        ? supplied
        : { ...supplied, feedback: "absent", feedbackSeal: "none" };
      const prior = parsed.records.find((record) => record.evidenceKey === observation.evidenceKey);
      if (prior) {
        if (sameObservation(prior, observation)) continue;
        if (feedbackFill(prior, observation)) {
          const line = lineFor(observation);
          if (!line) continue;
          lines.push(line);
          prior.feedback = observation.feedback;
          prior.feedbackSeal = observation.feedbackSeal;
          continue;
        }
        if (ordinaryJoin === true && authorizedTechnicalRevision(prior, observation)) {
          const line = lineFor(observation);
          if (!line) continue;
          lines.push(line);
          prior.technical = observation.technical;
          prior.channel = observation.channel;
          prior.taskClass = observation.taskClass;
        }
        continue;
      }
      if (parsed.records.length >= maxRecords || parsed.saturated) {
        blocked = true;
        continue;
      }
      const line = lineFor(observation);
      if (!line) continue;
      lines.push(line);
      parsed.records.push(observation);
    }
    if (blocked && !parsed.saturated) {
      lines.push(`${JSON.stringify({ schemaVersion: PROSPECTIVE_HEADER_SCHEMA, kind: "saturated", at: new Date(now).toISOString() })}\n`);
    }
    if (lines.length > 0) {
      await appendLines(dataDir, lines);
      noteJournalWrite(dataDir, "prospective-delivery", { appended: lines.length });
    }
    return parseProspectiveJournal(await readJournal(dataDir));
  });
}

export function applyDeclaredFeedback(record, feedback) {
  void feedback;
  return {
    ok: false,
    reason: "caller_claim_refused",
    record: record && isObservation(record) ? { ...record } : record ?? null,
  };
}

export async function recordProspectiveFeedback(dataDir, feedback) {
  if (feedback && typeof feedback === "object") {
    return { ok: false, reason: "caller_claim_refused", record: null, bound: 0 };
  }
  return bindStoredCallerResultFeedback(dataDir);
}

export async function bindStoredCallerResultFeedback(dataDir, {
  now = Date.now(),
  sourceVersion = packageVersion,
} = {}) {
  return admitCommerceJournal(dataDir, async () => {
    const parsed = parseProspectiveJournal(await readJournal(dataDir));
    if (parsed.decision === "version_mismatch" || parsed.decision === "unreadable") {
      return { ok: false, reason: parsed.decision, record: null, bound: 0, rejections: [] };
    }
    if (parsed.records.length === 0) {
      return { ok: false, reason: "record_absent", record: null, bound: 0, rejections: [] };
    }
    const stores = await readOrdinaryDeliveryStores(dataDir);
    const wanted = new Set(parsed.records.map((record) => record.evidenceKey));
    const selected = stores.settlements.filter((settlement) => wanted.has(prospectiveEvidenceKey(settlement.settlementReference)));
    const stamps = selected.map((settlement) => Date.parse(settlement.sourceEventTimestamp)).filter(Number.isFinite);
    const report = stamps.length === 0 ? null : joinOrdinaryDeliveries({
      ...stores,
      windowStart: new Date(Math.min(...stamps)).toISOString(),
      windowEnd: new Date(Math.max(...stamps)).toISOString(),
      coverage: "unknown_for_full_window",
      includeLocalIds: true,
    });
    const observations = [];
    const rejections = [];
    for (const record of parsed.records) {
      const settlement = selected.find((item) => prospectiveEvidenceKey(item.settlementReference) === record.evidenceKey);
      if (!settlement) continue;
      const row = report?.rows.find((item) => item.local?.settlementReference === settlement.settlementReference
        && item.local?.sourceEventId === settlement.sourceEventId) || null;
      const task = taskClassFor(stores, settlement.sourceEventId);
      if (record.taskClass !== "absent" && (task.taskConflict || task.taskClass !== record.taskClass)) {
        rejections.push({ evidenceKey: record.evidenceKey, reason: "cross_task" });
        continue;
      }
      if (row?.callerAcceptance === "foreign") {
        rejections.push({ evidenceKey: record.evidenceKey, reason: "foreign" });
        continue;
      }
      const captured = Number(row?.httpAttached || 0) + Number(row?.mcpAttached || 0) > 0;
      const declared = row?.callerAcceptance === "bound"
        ? row.callerDisposition
        : captured
          ? row?.callerSuppliedDisposition
          : null;
      const stated = declared === "useful"
        ? "declared_useful"
        : declared === "not_useful"
          ? "declared_not_useful"
          : null;
      if (!stated) continue;
      if (record.feedback === stated && record.feedbackSeal === "binds_declaration") continue;
      if (record.feedback !== "absent") {
        rejections.push({ evidenceKey: record.evidenceKey, reason: "conflicting_declaration" });
        continue;
      }
      observations.push({ ...record, feedback: stated, feedbackSeal: "binds_declaration" });
    }
    if (observations.length === 0) {
      return {
        ok: false,
        reason: rejections[0]?.reason || "declaration_absent",
        record: null,
        bound: 0,
        rejections,
      };
    }
    await appendProspectiveObservations(dataDir, observations, {
      now,
      sourceVersion,
      [STORED_STATEMENT]: true,
    });
    const next = parseProspectiveJournal(await readJournal(dataDir));
    return {
      ok: true,
      reason: null,
      bound: observations.length,
      rejections,
      record: next.records.find((item) => item.evidenceKey === observations[0].evidenceKey) || observations[0],
    };
  });
}

function typedResultFor(stores, sourceEventId) {
  const typed = stores.typedEvents.find((event) => event.id === sourceEventId);
  return typed?.result || null;
}

function taskClassFor(stores, sourceEventId) {
  const matches = stores.taskRefs.filter((record) => record.commerceEventId === sourceEventId);
  if (matches.length !== 1) return { taskClass: "absent", taskConflict: matches.length > 1 };
  return { taskClass: TASKS.includes(matches[0].cohort) ? matches[0].cohort : "absent", taskConflict: false };
}

function responsePending(settlement, now) {
  const eventMs = Date.parse(settlement?.sourceEventTimestamp || "");
  if (!Number.isFinite(eventMs) || !Number.isFinite(now)) return true;
  return now - eventMs < PROSPECTIVE_RESPONSE_BOUNDARY_MS;
}

export async function retainProspectiveDeliveries({
  dataDir,
  settlementReferences = [],
  now = Date.now(),
  sourceVersion = packageVersion,
  maxRecords = PROSPECTIVE_MAX_RECORDS,
  [PENDING_CLOCKS]: pendingClocks = new Map(),
} = {}) {
  const explicit = [...new Set(
    settlementReferences.map((reference) => String(reference || "").toLowerCase()).filter((reference) => TX.test(reference)),
  )];
  const existing = parseProspectiveJournal(await readJournal(dataDir));
  const openKeys = new Set(
    existing.records.filter((record) => OPEN_TECHNICAL.has(record.technical)).map((record) => record.evidenceKey),
  );
  if (explicit.length === 0 && openKeys.size === 0) return existing;
  const stores = await readOrdinaryDeliveryStores(dataDir);
  const wanted = new Set(explicit);
  if (openKeys.size > 0) {
    for (const settlement of stores.settlements) {
      const key = prospectiveEvidenceKey(settlement.settlementReference);
      if (key && openKeys.has(key)) wanted.add(settlement.settlementReference);
    }
  }
  const selected = [];
  const seen = new Set();
  for (const settlement of stores.settlements) {
    if (!wanted.has(settlement.settlementReference) || seen.has(settlement.settlementReference)) continue;
    seen.add(settlement.settlementReference);
    selected.push(settlement);
  }
  const observations = [];
  if (selected.length > 0) {
    const stamps = selected.map((settlement) => Date.parse(settlement.sourceEventTimestamp)).filter(Number.isFinite);
    const report = stamps.length === 0 ? null : joinOrdinaryDeliveries({
      ...stores,
      windowStart: new Date(Math.min(...stamps)).toISOString(),
      windowEnd: new Date(Math.max(...stamps)).toISOString(),
      coverage: "unknown_for_full_window",
      includeLocalIds: true,
    });
    for (const settlement of selected) {
      const evidenceKey = prospectiveEvidenceKey(settlement.settlementReference);
      if (!evidenceKey) continue;
      const prior = existing.records.find((record) => record.evidenceKey === evidenceKey) || null;
      const row = report?.rows.find((item) => item.local?.settlementReference === settlement.settlementReference
        && item.local?.sourceEventId === settlement.sourceEventId) || null;
      const task = taskClassFor(stores, settlement.sourceEventId);
      let observation = observationFromJoin(row, {
        evidenceKey,
        responsePending: responsePending(settlement, now),
        typedResult: typedResultFor(stores, settlement.sourceEventId),
        taskClass: task.taskClass,
        taskConflict: task.taskConflict,
        callerAcceptance: row?.callerAcceptance,
        callerDisposition: row?.callerDisposition,
      }, prior?.observedAt || pendingClocks.get(evidenceKey) || new Date(now).toISOString());
      if (prior && prior.feedback !== "absent") {
        observation = { ...observation, feedback: prior.feedback, feedbackSeal: prior.feedbackSeal };
      }
      observations.push(observation);
    }
  }
  if (observations.length > 0) {
    await appendProspectiveObservations(dataDir, observations, {
      now,
      sourceVersion,
      maxRecords,
      [ORDINARY_JOIN]: true,
    });
  }
  if (observations.length > 0 || existing.records.length > 0) {
    await bindStoredCallerResultFeedback(dataDir, { now, sourceVersion });
  }
  return parseProspectiveJournal(await readJournal(dataDir));
}

// A bounded retry input, never money authority. Each batch names the exact
// pre-append cut and only producer-returned new identities (hashes, not raw
// references). A restart must independently find their exact admitted parent.
async function pendingNamespace(dataDir, pinned) {
  if (!pinned?.trusted || pinned.procPrefix !== `/proc/self/fd/${pinned.handle?.fd}/`) {
    throw captureError("namespace_unavailable");
  }
  const info = await pinned.handle.stat();
  const current = await lstat(dataDir);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700
    || (typeof process.geteuid === "function" && info.uid !== process.geteuid())
    || !current.isDirectory() || !sameFile(info, current)
    || String(info.dev) !== pinned.dev || String(info.ino) !== pinned.ino) {
    throw captureError("namespace_mismatch");
  }
  return sha256(`${pinned.dev}:${pinned.ino}`);
}

function pendingCount(state) {
  return state.batches.reduce((count, batch) => count + batch.candidates.length, 0);
}

function parsePending(bytes, namespaceId) {
  if (!bytes.length || bytes.at(-1) !== 10) throw captureError("torn");
  let state;
  try { state = JSON.parse(bytes.toString("utf8")); } catch { throw captureError("corrupt"); }
  if (state?.schemaVersion !== PENDING_SCHEMA) throw captureError("version_mismatch");
  if (!exactKeys(state, ["schemaVersion", "namespaceId", "batches"])
    || state.namespaceId !== namespaceId || !Array.isArray(state.batches)) throw captureError("corrupt");
  if (state.batches.length > PROSPECTIVE_PENDING_MAX_CANDIDATES) throw captureError("saturated");
  const seen = new Set();
  for (const batch of state.batches) {
    if (!exactKeys(batch, ["baseByteCount", "baseByteDigest", "baseAdmissionCutId", "candidates"])
      || !Number.isSafeInteger(batch.baseByteCount) || batch.baseByteCount < 0
      || !HEX64.test(batch.baseByteDigest || "") || !HEX64.test(batch.baseAdmissionCutId || "")
      || !Array.isArray(batch.candidates) || !batch.candidates.length) throw captureError("corrupt");
    for (const candidate of batch.candidates) {
      if (!exactKeys(candidate, ["evidenceKey", "parentDigest", "observedAt"])
        || !HEX64.test(candidate.evidenceKey || "") || !HEX64.test(candidate.parentDigest || "")
        || !ISO.test(candidate.observedAt || "") || !Number.isFinite(Date.parse(candidate.observedAt))
        || seen.has(candidate.evidenceKey)) throw captureError("corrupt");
      seen.add(candidate.evidenceKey);
      if (seen.size > PROSPECTIVE_PENDING_MAX_CANDIDATES) throw captureError("saturated");
    }
  }
  if (!Buffer.from(`${JSON.stringify(state)}\n`).equals(bytes)) throw captureError("corrupt");
  return state;
}

async function loadPending(dataDir, pinned) {
  const namespaceId = await pendingNamespace(dataDir, pinned);
  const file = await readRegular(`${pinned.procPrefix}${PROSPECTIVE_PENDING_FILENAME}`, { pending: true });
  const state = file ? parsePending(file.bytes, namespaceId) : { schemaVersion: PENDING_SCHEMA, namespaceId, batches: [] };
  let temp;
  try {
    temp = await readRegular(`${pinned.procPrefix}${PROSPECTIVE_PENDING_FILENAME}.tmp`, { pending: true });
    if (temp) parsePending(temp.bytes, namespaceId);
  } catch (error) { throw captureError(error.captureReason === "saturated" ? "saturated" : "pending_temp_conflict"); }
  return { file, state, temp };
}

function pendingStatus(state, decision = null) {
  const count = pendingCount(state);
  return { decision: decision || (count >= PROSPECTIVE_PENDING_MAX_CANDIDATES ? "saturated" : count ? "pending" : "empty"),
    pendingCandidates: count, recoveredThisRun: 0 };
}

function pendingFailure(error) {
  return { decision: error.captureReason || "unreadable", pendingCandidates: null, recoveredThisRun: 0 };
}

export async function readProspectiveCapturePending({ dataDir, pinned } = {}) {
  try {
    const { state, file, temp } = await loadPending(dataDir, pinned);
    return pendingStatus(state, temp ? "pending_temp_present" : file ? null : "absent");
  } catch (error) { return pendingFailure(error); }
}

// One fixed temp bounds disk state across interruptions. A restart can finish
// only an exact, private next-state snapshot independently derived again from
// parent/observation authority; every other temp is preserved as a conflict.
async function savePending(dataDir, pinned, loaded, state) {
  const bytes = Buffer.from(`${JSON.stringify(state)}\n`);
  if (bytes.length > PROSPECTIVE_PENDING_MAX_BYTES) throw captureError("saturated");
  await pendingNamespace(dataDir, pinned);
  const target = `${pinned.procPrefix}${PROSPECTIVE_PENDING_FILENAME}`;
  const temp = `${target}.tmp`;
  let handle;
  let created = false;
  try {
    handle = await open(temp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
    created = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const prior = await readRegular(temp, { pending: true });
    if (!prior || !prior.bytes.equals(bytes)) throw captureError("pending_temp_conflict");
    handle = await open(temp, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    if (!sameFile(prior.info, await handle.stat())) {
      await handle.close();
      throw captureError("torn");
    }
  }
  try {
    if (created) {
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await handle.write(bytes.subarray(offset));
        if (!bytesWritten) throw captureError("torn");
        offset += bytesWritten;
      }
    }
    await handle.sync();
    await pendingNamespace(dataDir, pinned);
    const current = await readRegular(target, { pending: true });
    if (loaded.file ? !current || !sameFile(loaded.file.info, current.info)
      || !loaded.file.bytes.equals(current.bytes) : current !== null) throw captureError("torn");
    if (!sameFile(await handle.stat(), await lstat(temp))) throw captureError("torn");
    await rename(temp, target);
    await pinned.handle.sync();
  } finally {
    // Only a temp created by this operation can be cleaned up on failure.
    const owned = await handle.stat();
    await handle.close();
    try { if (created && sameFile(owned, await lstat(temp))) await rm(temp); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export async function prepareProspectiveCapture({ dataDir, pinned, parentBytes, newRecords, now = Date.now() } = {}) {
  try {
    const loaded = await loadPending(dataDir, pinned);
    const parent = await readRegular(`${pinned.procPrefix}commerce-settlements.ndjson`);
    if (!Buffer.isBuffer(parentBytes) || !(parent?.bytes || Buffer.alloc(0)).equals(parentBytes)
      || (parentBytes.length && parentBytes.at(-1) !== 10)) throw captureError("unbound");
    const base = readCommerceSettlementAdmission(parentBytes.toString("utf8"));
    const old = new Set(base.admitted.map((record) => prospectiveEvidenceKey(record.settlementReference)));
    const existing = new Map(loaded.state.batches.flatMap((batch) => batch.candidates.map((candidate) => [candidate.evidenceKey, candidate])));
    const candidates = [];
    for (const record of newRecords) {
      const evidenceKey = prospectiveEvidenceKey(record.settlementReference);
      const parentDigest = sha256(JSON.stringify(record));
      if (!evidenceKey || old.has(evidenceKey)) throw captureError("unbound");
      if (existing.has(evidenceKey)) {
        if (existing.get(evidenceKey).parentDigest !== parentDigest) throw captureError("unbound");
        continue;
      }
      existing.set(evidenceKey, { parentDigest });
      candidates.push({ evidenceKey, parentDigest, observedAt: new Date(now).toISOString() });
    }
    if (existing.size > PROSPECTIVE_PENDING_MAX_CANDIDATES) throw captureError("saturated");
    if (candidates.length) {
      loaded.state.batches.push({ baseByteCount: parentBytes.length, baseByteDigest: sha256(parentBytes),
        baseAdmissionCutId: base.admissionCutId, candidates });
      await savePending(dataDir, pinned, loaded, loaded.state);
    }
    return pendingStatus(loaded.state);
  } catch (error) { return pendingFailure(error); }
}

export async function recoverProspectiveCapture({ dataDir, pinned } = {}) {
  try {
    const loaded = await loadPending(dataDir, pinned);
    if (!pendingCount(loaded.state)) return pendingStatus(loaded.state,
      loaded.temp ? "pending_temp_present" : loaded.file ? "empty" : "absent");
    const parentBytes = (await readRegular(`${pinned.procPrefix}commerce-settlements.ndjson`))?.bytes || Buffer.alloc(0);
    const admission = readCommerceSettlementAdmission(parentBytes.toString("utf8"));
    const parents = new Map(admission.admitted.map((record) => [prospectiveEvidenceKey(record.settlementReference), record]));
    const eligible = [];
    let decision = "pending";
    for (const batch of loaded.state.batches) {
      const prefix = parentBytes.subarray(0, batch.baseByteCount);
      const base = readCommerceSettlementAdmission(prefix.toString("utf8"));
      if (prefix.length !== batch.baseByteCount || sha256(prefix) !== batch.baseByteDigest
        || base.admissionCutId !== batch.baseAdmissionCutId) { decision = "unbound"; continue; }
      const old = new Set(base.admitted.map((record) => prospectiveEvidenceKey(record.settlementReference)));
      for (const candidate of batch.candidates) {
        const parent = parents.get(candidate.evidenceKey);
        if (!parent) { if (decision !== "unbound") decision = "awaiting_parent"; continue; }
        if (old.has(candidate.evidenceKey) || sha256(JSON.stringify(parent)) !== candidate.parentDigest) {
          decision = "unbound"; continue;
        }
        eligible.push({ candidate, parent });
      }
    }
    if (eligible.length) {
      await pendingNamespace(dataDir, pinned);
      await retainProspectiveDeliveries({ dataDir: pinned.procPrefix,
        settlementReferences: eligible.map(({ parent }) => parent.settlementReference),
        [PENDING_CLOCKS]: new Map(eligible.map(({ candidate }) => [candidate.evidenceKey, candidate.observedAt])) });
      // An append/return value is insufficient: sync and independently parse
      // the exact regular observation file before acknowledging any intent.
      await pendingNamespace(dataDir, pinned);
      const file = await readRegular(storePath(pinned.procPrefix));
      if (!file) throw captureError("observation_missing");
      const handle = await open(storePath(pinned.procPrefix), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      try {
        if (!sameFile(file.info, await handle.stat())) throw captureError("torn");
        await handle.sync();
      } finally { await handle.close(); }
      await pinned.handle.sync();
      const parsed = parseProspectiveJournal(await readJournal(pinned.procPrefix));
      if (parsed.decision !== "prospective" || parsed.corruptLines) throw captureError("observation_invalid");
      const observed = new Set(parsed.records.map((record) => record.evidenceKey));
      const completed = new Set(eligible.filter(({ candidate }) => observed.has(candidate.evidenceKey)).map(({ candidate }) => candidate.evidenceKey));
      const next = { ...loaded.state, batches: loaded.state.batches.map((batch) => ({ ...batch,
        candidates: batch.candidates.filter((candidate) => !completed.has(candidate.evidenceKey)) })).filter((batch) => batch.candidates.length) };
      if (completed.size) await savePending(dataDir, pinned, loaded, next);
      if (parsed.saturated) decision = "saturated";
      return { ...pendingStatus(next, pendingCount(next) ? decision : parsed.saturated ? "saturated" : "empty"), recoveredThisRun: completed.size };
    }
    return pendingStatus(loaded.state, decision);
  } catch (error) { return pendingFailure(error); }
}

export async function readProspectiveDelivery({
  dataDir,
  ledger,
  admission = null,
  suppliedSummary = null,
  suppliedCutId = null,
  generatedAt = null,
  paymentClassBySourceEventId,
} = {}) {
  const journalText = dataDir ? await readJournal(dataDir) : "";
  const resolvedAdmission = admission || (typeof ledger === "string"
    ? readCommerceSettlementAdmission(ledger, { paymentClassBySourceEventId })
    : null);
  return projectProspectiveDelivery({
    journalText,
    admission: resolvedAdmission,
    suppliedSummary,
    suppliedCutId,
    generatedAt,
  });
}

export function absentProspectiveDelivery(generatedAt = null) {
  return projectProspectiveDelivery({ journalText: "", admission: null, generatedAt });
}

export function unavailableProspectiveDelivery(admission = null, generatedAt = null) {
  const packet = projectProspectiveDelivery({ journalText: "", admission, generatedAt });
  return {
    ...packet,
    decision: "unreadable",
    comparable: false,
    technicalRevisions: 0,
    coverage: {
      ...packet.coverage,
      historicalComplete: false,
      admittedWithoutProspectiveObservation: 0,
      unadmittedRecords: 0,
      corruptLines: 0,
      projectionSaturated: false,
      evidenceUnavailable: true,
    },
  };
}

function nullable(schema) {
  return { anyOf: [schema, { type: "null" }] };
}

function countSchema(keys) {
  const properties = Object.fromEntries(keys.map((key) => [key, { type: "integer", minimum: 0 }]));
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: [...keys],
  };
}

export function commerceProspectiveDeliveryOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { type: "string", const: PROSPECTIVE_PUBLIC_SCHEMA },
      decision: {
        type: "string",
        enum: ["not_started", "prospective", "stale_cut", "version_mismatch", "unreadable", "saturated"],
      },
      comparable: { type: "boolean" },
      prospectiveSince: nullable({ type: "string" }),
      sourceVersion: nullable({ type: "string" }),
      captureVersion: nullable({ type: "string" }),
      generatedAt: nullable({ type: "string" }),
      bindsToParent: nullable({
        type: "object",
        additionalProperties: false,
        properties: {
          summarySchema: { type: "string" },
          reconciledSettlements: { type: "integer", minimum: 0 },
          distinctSettlementReferences: { type: "integer", minimum: 0 },
          amountAtomic: { type: "string", pattern: "^\\d+$" },
          admissionCutId: { type: "string", pattern: "^[0-9a-f]{64}$" },
          matchesSuppliedSummary: nullable({ type: "boolean" }),
        },
        required: [
          "summarySchema",
          "reconciledSettlements",
          "distinctSettlementReferences",
          "amountAtomic",
          "admissionCutId",
          "matchesSuppliedSummary",
        ],
      }),
      technical: countSchema(TECHNICAL),
      declaredFeedback: countSchema(FEEDBACK),
      declaredTaskClass: countSchema(TASKS),
      duplicateIgnored: { type: "integer", minimum: 0 },
      conflictRestatements: { type: "integer", minimum: 0 },
      technicalRevisions: { type: "integer", minimum: 0 },
      coverage: {
        type: "object",
        additionalProperties: false,
        properties: {
          historicalBackfill: { type: "boolean", const: false },
          historicalComplete: { type: "boolean", const: false },
          requestedWindowComplete: { type: "boolean", const: false },
          zeroProspectiveIsNotHistoricalZero: { type: "boolean", const: true },
          prospectiveSince: nullable({ type: "string" }),
          admittedWithoutProspectiveObservation: { type: "integer", minimum: 0 },
          unadmittedRecords: { type: "integer", minimum: 0 },
          corruptLines: { type: "integer", minimum: 0 },
          projectionSaturated: { type: "boolean" },
          retainedEventFilesRequired: { type: "boolean", const: false },
          evidenceUnavailable: { type: "boolean" },
          responseBoundaryMs: { type: "integer", const: PROSPECTIVE_RESPONSE_BOUNDARY_MS },
        },
        required: [
          "historicalBackfill",
          "historicalComplete",
          "requestedWindowComplete",
          "zeroProspectiveIsNotHistoricalZero",
          "prospectiveSince",
          "admittedWithoutProspectiveObservation",
          "unadmittedRecords",
          "corruptLines",
          "projectionSaturated",
          "retainedEventFilesRequired",
          "evidenceUnavailable",
          "responseBoundaryMs",
        ],
      },
      boundaries: {
        type: "object",
        additionalProperties: false,
        properties: {
          technicalValidationIsNotUsefulness: { type: "boolean", const: true },
          schemaPassIsNotAcceptance: { type: "boolean", const: true },
          paymentIsNotACustomer: { type: "boolean", const: true },
          declaredFeedbackIsNotVerifiedUsefulness: { type: "boolean", const: true },
          sealBindsDeclarationOnly: { type: "boolean", const: true },
          parentAdmissionRemainsMoneyAuthority: { type: "boolean", const: true },
          noHistoricalBackfill: { type: "boolean", const: true },
          ownerQaIsNotACustomer: { type: "boolean", const: true },
          callerTechnicalClaimIsNotAuthority: { type: "boolean", const: true },
          technicalRevisionAuthority: { type: "string", const: "ordinary_delivery_join" },
          technicalRevisionClock: { type: "string", const: "first_observed_at" },
          lateTechnicalRevisionIsNotLastWriteWins: { type: "boolean", const: true },
          noResponseRequiresResponseBoundary: { type: "boolean", const: true },
        },
        required: [
          "technicalValidationIsNotUsefulness",
          "schemaPassIsNotAcceptance",
          "paymentIsNotACustomer",
          "declaredFeedbackIsNotVerifiedUsefulness",
          "sealBindsDeclarationOnly",
          "parentAdmissionRemainsMoneyAuthority",
          "noHistoricalBackfill",
          "ownerQaIsNotACustomer",
          "callerTechnicalClaimIsNotAuthority",
          "technicalRevisionAuthority",
          "technicalRevisionClock",
          "lateTechnicalRevisionIsNotLastWriteWins",
          "noResponseRequiresResponseBoundary",
        ],
      },
      recognizedIncomeAtomic: { type: "null" },
      customerAttribution: { type: "null" },
      independentRepeat: { type: "null" },
      usefulness: { type: "string", const: "unknown" },
    },
    required: [
      "schemaVersion",
      "decision",
      "comparable",
      "prospectiveSince",
      "sourceVersion",
      "captureVersion",
      "generatedAt",
      "bindsToParent",
      "technical",
      "declaredFeedback",
      "declaredTaskClass",
      "duplicateIgnored",
      "conflictRestatements",
      "technicalRevisions",
      "coverage",
      "boundaries",
      "recognizedIncomeAtomic",
      "customerAttribution",
      "independentRepeat",
      "usefulness",
    ],
  };
}

export { packageVersion as PROSPECTIVE_SOURCE_VERSION };
