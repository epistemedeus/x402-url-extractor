// Recheck or reuse a pinned compatibility result from saved machine entries.
// The comparison core stays executePageChangeComparison. This file only
// projects a pin, reads the existing report, and refuses a capture whose
// recorded sha256 does not match the saved bytes.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pageChangeRequestExample } from "../../page-change-input-contract.mjs";
import { executePageChangeComparison } from "../../page-change-http.mjs";
import { pageChangeMcpOutputSchema } from "../../page-change-mcp-output-schema.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const captureDir = path.join(here, "captures");
const indexPath = path.join(captureDir, "index.json");

export const RECIPE_ID = "source-change-alert";
export const RECIPE_VERSION = "samedaydesk.recurring-job-recipe-result.v1";
export const QUERY_KEY_PATH = "public/machine/query-key.json";
export const QUERY_KEY_11_PATH = "public/machine/query-key-1.1.0.json";
const ENTRY_SCHEMAS = new Set([
  "neomorphic.query-key-reuse.entry.v1",
  "neomorphic.query-key-1.1.0.entry.v1",
]);
const PIN_FIELDS = Object.freeze([
  "title",
  "description",
  "canonical",
  "lang",
  "text",
  "jsonLd",
  "openGraph",
  "twitter",
  "headings",
  "links",
  "aiReadiness",
]);
const COMPARE_ENV = Object.freeze({ PAGE_CHANGE_HTTP_ENABLED: "1" });

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobId(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readCaptureIndex() {
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  if (!Array.isArray(index.entries)) throw new Error("capture index has no entries");
  return index.entries;
}

export function loadCapture(record) {
  if (!record || record.present !== true) {
    return { ok: false, reason: "absent", record };
  }
  if (typeof record.file !== "string" || record.file.includes("/") || record.file.includes("\\")) {
    return { ok: false, reason: "capture-sha256-mismatch", refused: true, record };
  }
  const bytes = readFileSync(path.join(captureDir, record.file));
  const digest = sha256(bytes);
  const blob = gitBlobId(bytes);
  if (digest !== record.sha256 || blob !== record.blob || bytes.length !== record.bytes) {
    return { ok: false, reason: "capture-sha256-mismatch", refused: true, record };
  }
  let entry;
  try {
    entry = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed-json", refused: true, record };
  }
  return { ok: true, entry, record, sha256: digest, blob };
}

function pinText(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function pinProjection(entry) {
  if (!isObject(entry) || !ENTRY_SCHEMAS.has(entry.schema)) return null;
  const archive = pinText(entry.archive?.sha256);
  const corpus = pinText(entry.corpus?.sha256);
  const corpusSchema = pinText(entry.corpus?.schema);
  const upstreamBefore = pinText(entry.upstream?.before);
  const license = pinText(entry.license);
  const sourceCommit = pinText(entry.sourceCommit);
  const sourcePath = pinText(entry.sourcePath);
  const codec = pinText(entry.codec);
  if (!archive || !corpus || !corpusSchema || !upstreamBefore || !license || !sourceCommit || !sourcePath || !codec) {
    return null;
  }
  if (typeof entry.hostedAcquisitionVerified !== "boolean" || typeof entry.publicRouteClaimed !== "boolean") {
    return null;
  }
  return {
    title: entry.schema,
    description: sourceCommit,
    canonical: sourcePath,
    lang: codec,
    text: archive,
    jsonLd: corpus,
    openGraph: corpusSchema,
    twitter: upstreamBefore,
    headings: license,
    links: entry.hostedAcquisitionVerified ? "true" : "false",
    aiReadiness: entry.publicRouteClaimed ? "true" : "false",
  };
}

function observation(pin, role, observedAt) {
  const example = pageChangeRequestExample();
  const body = structuredClone(example.before);
  body.jobId = role === "before" ? "0".repeat(64) : "1".repeat(64);
  body.charged = false;
  body.sources = [structuredClone(example.before.sources[0])];
  body.sources[0].id = "machine-entry";
  body.sources[0].data = { ...pin };
  if (!observedAt) return body;
  return { mediaType: "application/json", body, observedAt };
}

function changedFields(report) {
  const names = [];
  for (const change of report?.changes || []) {
    if (change?.class !== "semantic" || typeof change.path !== "string") continue;
    const field = change.path.split("/").filter(Boolean)[0];
    if (field && !names.includes(field)) names.push(field);
  }
  return names;
}

function decisionShell(patch) {
  return {
    decision: "missing-input",
    case: "malformed",
    changedFields: [],
    sourceCommit: null,
    freshness: null,
    compared: false,
    outputSchemaValid: false,
    refused: false,
    reason: null,
    verdict: null,
    ...patch,
  };
}

function fromReport(output, sourceCommit, caseHint) {
  const parsed = pageChangeMcpOutputSchema.safeParse(output);
  if (!parsed.success || output?.ok !== true) {
    return decisionShell({
      sourceCommit,
      compared: true,
      reason: "output-schema-rejected",
      case: caseHint || "malformed",
    });
  }
  const report = parsed.data.report;
  const fields = changedFields(report);
  const freshness = report.freshness;
  const base = decisionShell({
    sourceCommit,
    freshness,
    compared: true,
    outputSchemaValid: true,
    verdict: report.verdict,
    changedFields: fields,
    fields: report.fields,
    reason: null,
  });
  if (freshness === "inverted") {
    return { ...base, decision: "recheck", case: "stale" };
  }
  if (report.verdict === "changed" || report.verdict === "reordered") {
    return { ...base, decision: "recheck", case: "changed" };
  }
  if (report.verdict === "unchanged") {
    return { ...base, decision: "reuse", case: "unchanged", changedFields: [] };
  }
  return { ...base, decision: "missing-input", case: "malformed", reason: report.verdict };
}

async function runCompare(before, after, sourceCommit, caseHint) {
  let output;
  try {
    output = await executePageChangeComparison({
      before,
      after,
      fields: [...PIN_FIELDS],
    }, COMPARE_ENV, { timeoutMs: 5000 });
  } catch {
    return decisionShell({
      sourceCommit,
      compared: false,
      reason: "admission-refused",
      case: caseHint || "malformed",
    });
  }
  return fromReport(output, sourceCommit, caseHint);
}

export async function decideEntries(beforeEntry, afterEntry, options = {}) {
  const sourceCommit = options.sourceCommit ?? null;
  const beforePin = pinProjection(beforeEntry);
  const afterPin = pinProjection(afterEntry);
  if (beforePin && afterPin) {
    return runCompare(
      observation(beforePin, "before", options.beforeObservedAt),
      observation(afterPin, "after", options.afterObservedAt),
      sourceCommit,
      options.caseHint || null,
    );
  }
  if (isObject(beforeEntry) && isObject(afterEntry)) {
    return runCompare(beforeEntry, afterEntry, sourceCommit, "malformed");
  }
  return decisionShell({ sourceCommit, reason: "malformed-entry" });
}

function pairs(entries, entryPath) {
  const rows = entries.filter((entry) => entry.path === entryPath);
  const found = [];
  for (let index = 0; index < rows.length; index += 1) {
    for (let later = index + 1; later < rows.length; later += 1) {
      found.push([rows[index], rows[later]]);
    }
  }
  return found;
}

function historyRow(beforeRecord, afterRecord, decision) {
  const gitChanged = beforeRecord.present === true
    && afterRecord.present === true
    && beforeRecord.blob !== afterRecord.blob;
  const absent = beforeRecord.present !== true || afterRecord.present !== true;
  const contentRecheck = decision.decision === "recheck" && decision.case !== "stale";
  return {
    path: afterRecord.path,
    beforeCommit: beforeRecord.commit,
    afterCommit: afterRecord.commit,
    beforeBlob: beforeRecord.blob,
    afterBlob: afterRecord.blob,
    gitChanged,
    contentDiff: absent ? "unknown" : gitChanged ? "changed" : "unchanged",
    scored: !absent && decision.compared === true && decision.outputSchemaValid === true,
    decision: decision.decision,
    changedFields: decision.changedFields,
    sourceCommit: decision.sourceCommit,
    freshness: decision.freshness,
    falseAlert: !absent && contentRecheck && !gitChanged,
    missedChange: !absent && decision.decision === "reuse" && gitChanged,
  };
}

export function toProducedDecision(decision, afterRecord) {
  if (decision.decision !== "reuse" || decision.freshness !== "unknown" || !afterRecord?.sha256) return null;
  return {
    recipeId: RECIPE_ID,
    schema: RECIPE_VERSION,
    outcome: "unchanged",
    decision: "reuse",
    sourceCommit: afterRecord.commit,
    priorCommit: decision.priorCommit,
    path: afterRecord.path,
    blob: afterRecord.blob,
    freshness: decision.freshness,
    changedFields: [],
    use: null,
    evidence: {
      kind: "field_diff",
      contentHash: `sha256:${afterRecord.sha256}`,
      changed: [],
      unchanged: decision.fields,
    },
    recovery: {
      action: "reuse",
      operatorNext: "Reuse the pinned compatibility result. Selected fields did not change. Freshness is unknown and is not a current or fresh claim. This first-party capture is not use.",
    },
  };
}

export async function evaluate(entries = readCaptureIndex()) {
  const history = [];
  for (const entryPath of [QUERY_KEY_PATH, QUERY_KEY_11_PATH]) {
    for (const [beforeRecord, afterRecord] of pairs(entries, entryPath)) {
      const before = loadCapture(beforeRecord);
      const after = loadCapture(afterRecord);
      let decision;
      if (!before.ok || !after.ok) {
        decision = decisionShell({
          sourceCommit: afterRecord.commit,
          reason: !before.ok ? before.reason : after.reason,
          refused: before.refused === true || after.refused === true,
        });
      } else {
        decision = await decideEntries(before.entry, after.entry, { sourceCommit: afterRecord.commit });
      }
      history.push(historyRow(beforeRecord, afterRecord, decision));
    }
  }

  const latestQuery = entries.filter((entry) => entry.path === QUERY_KEY_PATH && entry.present);
  const prior = latestQuery[latestQuery.length - 2];
  const current = latestQuery[latestQuery.length - 1];
  const priorLoad = loadCapture(prior);
  const currentLoad = loadCapture(current);
  if (!priorLoad.ok || !currentLoad.ok) {
    throw new Error("saved query-key captures failed sha256 verification");
  }
  const unchanged = await decideEntries(priorLoad.entry, currentLoad.entry, { sourceCommit: current.commit });
  unchanged.priorCommit = prior.commit;

  const siblingRecords = entries.filter((entry) => entry.commit === current.commit && entry.present);
  const siblingBefore = loadCapture(siblingRecords.find((entry) => entry.path === QUERY_KEY_PATH));
  const siblingAfter = loadCapture(siblingRecords.find((entry) => entry.path === QUERY_KEY_11_PATH));
  const changed = await decideEntries(siblingBefore.entry, siblingAfter.entry, {
    sourceCommit: current.commit,
    caseHint: "changed",
  });

  const stale = await decideEntries(priorLoad.entry, currentLoad.entry, {
    sourceCommit: current.commit,
    beforeObservedAt: "2026-11-04T00:00:02.000Z",
    afterObservedAt: "2026-11-04T00:00:01.000Z",
  });

  const malformed = await decideEntries({ schema: "not-a-machine-entry" }, { schema: "not-a-machine-entry" }, {
    sourceCommit: current.commit,
  });
  const badLoad = loadCapture({ ...current, sha256: "0".repeat(64) });
  const mismatched = decisionShell({
    sourceCommit: current.commit,
    reason: badLoad.ok ? "capture-sha256-mismatch" : badLoad.reason,
    refused: badLoad.refused === true,
  });

  const produced = toProducedDecision(unchanged, current);
  if (!produced) throw new Error("unchanged pin did not produce a reusable decision");
  const falseAlerts = history.filter((row) => row.falseAlert).length;
  const missedChanges = history.filter((row) => row.missedChange).length;
  const unknownPairs = history.filter((row) => row.contentDiff === "unknown").length;
  const comparablePairs = history.filter((row) => row.scored).length;
  return {
    cases: { unchanged, changed, stale, malformed, mismatched },
    history,
    score: {
      falseAlerts,
      missedChanges,
      unknownPairs,
      comparablePairs,
      unknownIsNotZero: true,
      firstPartyRunIsUse: false,
      use: null,
    },
    produced,
  };
}

export function publicScore(result) {
  const view = (name) => {
    const item = result.cases[name];
    return {
      case: item.case,
      decision: item.decision,
      changedFields: item.changedFields,
      sourceCommit: item.sourceCommit,
      freshness: item.freshness,
      verdict: item.verdict,
      compared: item.compared,
      refused: item.refused,
      reason: item.reason,
    };
  };
  return {
    ...result.score,
    cases: {
      unchanged: view("unchanged"),
      changed: view("changed"),
      stale: view("stale"),
      malformed: view("malformed"),
    },
    history: result.history,
    produced: result.produced,
  };
}
