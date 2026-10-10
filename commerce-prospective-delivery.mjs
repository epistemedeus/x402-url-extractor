// Compact prospective settlement-to-technical-delivery journal.
// The parent admission helper remains the only count and amount authority.
// This file stores no raw bodies, URLs, query strings, credentials, addresses,
// settlement references, or event ids. A hash is the idempotency key.
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
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
  ) return "no_response";
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
    result.conflictRestatements += 1;
  }
  return result;
}

function storePath(dataDir) {
  return path.join(dataDir, PROSPECTIVE_FILENAME);
}

async function readJournal(dataDir) {
  try {
    const info = await stat(storePath(dataDir));
    if (!info.isFile()) return "";
    return await readFile(storePath(dataDir), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
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
  const handle = await open(storePath(dataDir), fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_WRONLY, 0o600);
  try {
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

function countsFor(parsed) {
  const technical = emptyTechnical();
  const declaredFeedback = emptyFeedback();
  const declaredTaskClass = emptyTasks();
  for (const record of parsed.records) {
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
  generatedAt = new Date().toISOString(),
} = {}) {
  const parsed = parseProspectiveJournal(journalText);
  const summary = admission?.summary || null;
  const cutId = admission?.admissionCutId || null;
  const admitted = Array.isArray(admission?.admitted) ? admission.admitted : [];
  const keys = new Set(parsed.records.map((record) => record.evidenceKey));
  let admittedWithoutProspectiveObservation = 0;
  for (const record of admitted) {
    const key = prospectiveEvidenceKey(record?.settlementReference);
    if (!key || !keys.has(key)) admittedWithoutProspectiveObservation += 1;
  }
  const bound = Boolean(summary)
    && (suppliedSummary == null || sameSummary(suppliedSummary, summary))
    && (suppliedCutId == null || suppliedCutId === cutId);
  let decision = parsed.decision;
  if (decision === "prospective" && !bound && (suppliedSummary != null || suppliedCutId != null)) decision = "stale_cut";
  if (decision === "prospective" && parsed.saturated) decision = "saturated";
  const { technical, declaredFeedback, declaredTaskClass } = countsFor(parsed);
  const comparable = decision === "prospective" && bound && parsed.corruptLines === 0;
  return {
    schemaVersion: PROSPECTIVE_PUBLIC_SCHEMA,
    decision,
    comparable,
    prospectiveSince: parsed.header?.prospectiveSince || null,
    sourceVersion: parsed.header?.sourceVersion || null,
    captureVersion: parsed.header?.captureVersion || null,
    generatedAt,
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
    coverage: {
      historicalBackfill: false,
      historicalComplete: false,
      requestedWindowComplete: false,
      zeroProspectiveIsNotHistoricalZero: true,
      prospectiveSince: parsed.header?.prospectiveSince || null,
      admittedWithoutProspectiveObservation,
      corruptLines: parsed.corruptLines,
      projectionSaturated: parsed.saturated,
      retainedEventFilesRequired: false,
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
    },
    recognizedIncomeAtomic: null,
    customerAttribution: null,
    independentRepeat: null,
    usefulness: "unknown",
  };
}

async function ensureHeader(dataDir, now, sourceVersion) {
  const existing = await readJournal(dataDir);
  if (existing.length > 0) return parseProspectiveJournal(existing);
  const header = headerRecord(now, sourceVersion);
  const temp = path.join(dataDir, `.${PROSPECTIVE_FILENAME}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const handle = await open(temp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
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
  try {
    await rename(temp, storePath(dataDir));
  } catch (error) {
    await rm(temp, { force: true });
    const raced = await readJournal(dataDir);
    if (raced.length > 0) return parseProspectiveJournal(raced);
    throw error;
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

function lineFor(observation) {
  if (!isObservation(observation)) return null;
  return `${JSON.stringify(observation)}\n`;
}

export async function appendProspectiveObservations(dataDir, observations, {
  now = Date.now(),
  sourceVersion = packageVersion,
  maxRecords = PROSPECTIVE_MAX_RECORDS,
} = {}) {
  return admitCommerceJournal(dataDir, async () => {
    let parsed = await ensureHeader(dataDir, now, sourceVersion);
    if (parsed.decision === "version_mismatch" || parsed.decision === "unreadable") return parsed;
    const lines = [];
    let blocked = false;
    for (const observation of observations) {
      if (!observation || observation.duplicateIgnored === true || !isObservation(observation)) continue;
      const prior = parsed.records.find((record) => record.evidenceKey === observation.evidenceKey);
      if (prior) {
        if (sameObservation(prior, observation)) continue;
        if (feedbackFill(prior, observation)) {
          const line = lineFor(observation);
          if (!line) continue;
          lines.push(line);
          prior.feedback = observation.feedback;
          prior.feedbackSeal = observation.feedbackSeal;
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

export async function recordProspectiveFeedback(dataDir, feedback, options = {}) {
  return admitCommerceJournal(dataDir, async () => {
    const parsed = parseProspectiveJournal(await readJournal(dataDir));
    if (parsed.decision === "version_mismatch" || parsed.decision === "unreadable") {
      return { ok: false, reason: parsed.decision, record: null };
    }
    const record = parsed.records.find((item) => item.evidenceKey === feedback?.evidenceKey);
    const applied = applyDeclaredFeedback(record, feedback);
    if (!applied.ok || applied.idempotentReplay) return applied;
    await appendProspectiveObservations(dataDir, [applied.record], options);
    const next = parseProspectiveJournal(await readJournal(dataDir));
    const updated = next.records.find((item) => item.evidenceKey === applied.record.evidenceKey) || applied.record;
    return { ...applied, record: updated };
  });
}

export function applyDeclaredFeedback(record, feedback) {
  if (!record || !isObservation(record)) return { ok: false, reason: "record_absent", record };
  const next = { ...record };
  if (!feedback || typeof feedback !== "object") return { ok: false, reason: "feedback_absent", record: next };
  if (feedback.evidenceKey !== record.evidenceKey) return { ok: false, reason: "foreign", record: next };
  if (feedback.late === true) return { ok: false, reason: "late", record: next };
  if (feedback.expired === true) return { ok: false, reason: "expired", record: next };
  if (typeof feedback.expiresAt === "string" && ISO.test(feedback.expiresAt) && feedback.receivedAt > feedback.expiresAt) {
    return { ok: false, reason: "expired", record: next };
  }
  if (feedback.taskClass && record.taskClass !== "absent" && feedback.taskClass !== record.taskClass) {
    return { ok: false, reason: "cross_task", record: next };
  }
  if (feedback.seal !== "binds_declaration") return { ok: false, reason: "unsealed", record: next };
  if (feedback.disposition !== "useful" && feedback.disposition !== "not_useful") {
    return { ok: false, reason: "disposition_rejected", record: next };
  }
  const stated = feedback.disposition === "useful" ? "declared_useful" : "declared_not_useful";
  if (record.feedback === stated) return { ok: true, idempotentReplay: true, record: next };
  if (record.feedback !== "absent") return { ok: false, reason: "conflicting_declaration", record: next };
  next.feedback = stated;
  next.feedbackSeal = "binds_declaration";
  return { ok: true, idempotentReplay: false, record: next, technicalUnchanged: next.technical === record.technical };
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

export async function retainProspectiveDeliveries({
  dataDir,
  settlementReferences = [],
  now = Date.now(),
  sourceVersion = packageVersion,
  maxRecords = PROSPECTIVE_MAX_RECORDS,
} = {}) {
  const wanted = [...new Set(settlementReferences.map((reference) => String(reference || "").toLowerCase()).filter((reference) => TX.test(reference)))];
  if (wanted.length === 0) {
    const text = await readJournal(dataDir);
    return parseProspectiveJournal(text);
  }
  const stores = await readOrdinaryDeliveryStores(dataDir);
  const selected = stores.settlements.filter((settlement) => wanted.includes(settlement.settlementReference));
  const observations = [];
  if (selected.length > 0) {
    const observedAt = new Date(now).toISOString();
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
      const row = report?.rows.find((item) => item.local?.settlementReference === settlement.settlementReference
        && item.local?.sourceEventId === settlement.sourceEventId) || null;
      const task = taskClassFor(stores, settlement.sourceEventId);
      observations.push(observationFromJoin(row, {
        evidenceKey,
        technical: report ? undefined : "unknown",
        typedResult: typedResultFor(stores, settlement.sourceEventId),
        taskClass: task.taskClass,
        taskConflict: task.taskConflict,
        callerAcceptance: row?.callerAcceptance,
        callerDisposition: row?.callerDisposition,
      }, observedAt));
    }
  }
  return appendProspectiveObservations(dataDir, observations, { now, sourceVersion, maxRecords });
}

export async function readProspectiveDelivery({
  dataDir,
  ledger,
  admission = null,
  suppliedSummary = null,
  suppliedCutId = null,
  generatedAt = new Date().toISOString(),
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

export function absentProspectiveDelivery(generatedAt = new Date().toISOString()) {
  return projectProspectiveDelivery({ journalText: "", admission: null, generatedAt });
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
      generatedAt: { type: "string" },
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
          corruptLines: { type: "integer", minimum: 0 },
          projectionSaturated: { type: "boolean" },
          retainedEventFilesRequired: { type: "boolean", const: false },
        },
        required: [
          "historicalBackfill",
          "historicalComplete",
          "requestedWindowComplete",
          "zeroProspectiveIsNotHistoricalZero",
          "prospectiveSince",
          "admittedWithoutProspectiveObservation",
          "corruptLines",
          "projectionSaturated",
          "retainedEventFilesRequired",
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
