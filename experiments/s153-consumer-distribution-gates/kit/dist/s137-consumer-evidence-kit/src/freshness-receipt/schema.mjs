/**
 * Dataset freshness receipt schema (R2-CONSUMER-JOBS-06 / S137 c26).
 *
 * Download/retrieval time and source-update time are distinct slots.
 * Neither is a fallback for the other. Operator clock is not an observation.
 * Deterministic validation only; no fetch, no invented timestamps.
 */

import { CLOCK_ISO as ISO_INSTANT } from "../common/clock.mjs";
import { sha256Text } from "../common/hash.mjs";
import {
  PACKET_SCHEMA,
  EVIDENCE_CLASSES,
  DECISIONS,
  createEnvelope,
  requireCitedFinding,
} from "../packet.mjs";

export { PACKET_SCHEMA, EVIDENCE_CLASSES, DECISIONS, requireCitedFinding };

export const JOB_ID = "R2-CONSUMER-JOBS-06";
export const ARTIFACT_KIND = "dataset-freshness-receipt";
export const INPUT_SCHEMA_ID = "s137.freshness-receipt.input.v1";
export const RECEIPT_SCHEMA_ID = "s137.freshness-receipt.v1";

export const TIME_KINDS = Object.freeze([
  "download",
  "source-update",
  "source-created",
  "http-date",
  "filesystem-mtime",
  "operator-clock",
  "unknown",
]);

export const COVERAGE_STATES = Object.freeze(["full", "partial", "none"]);
export const TIME_PRESENCE = Object.freeze(["present", "absent"]);
export const DISPOSITIONS = Object.freeze(["current", "stale", "unknown"]);
export const POLARITIES = Object.freeze([
  "positive",
  "negative",
  "partial",
  "conflict",
  "unknown",
]);

/** Worst-first. conflict beats fail beats unknown beats partial beats pass. */
export const DECISION_PRECEDENCE = Object.freeze([
  "conflict",
  "fail",
  "unknown",
  "partial",
  "pass",
]);

const SHA256_HEX = /^[0-9a-f]{64}$/;
const NPM_TIME_VERSION = /^time\.(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * Field → time kind. Keys are lowercase. Cited from local packet contract,
 * discovery-drift observation names, S122 capturedAt/published_at, and
 * S127 provenance.retrievedAt vs npm `time.modified` / `time.<version>`.
 * Ambiguous names stay `unknown` (not guessed into a slot).
 */
const FIELD_KIND_TABLE = Object.freeze({
  retrievedat: "download",
  downloadedat: "download",
  capturedat: "download",
  capturedatutc: "download",
  captured_at: "download",
  catalogobservedat: "download",
  liveobservedat: "download",

  sourceupdatedat: "source-update",
  published_at: "source-update",
  publishedat: "source-update",
  lastupdated: "source-update",
  cataloglastupdated: "source-update",
  "time.modified": "source-update",
  "last-modified": "source-update",
  lastmodified: "source-update",

  "time.created": "source-created",

  date: "http-date",
  httpdate: "http-date",
  "http-date": "http-date",

  mtime: "filesystem-mtime",
  filesystemmtime: "filesystem-mtime",
  birthtime: "filesystem-mtime",

  clock: "operator-clock",
  now: "operator-clock",
  operatorclock: "operator-clock",
});

export const FIELD_VOCABULARY = Object.freeze({
  download: Object.freeze([
    "retrievedAt",
    "downloadedAt",
    "capturedAt",
    "capturedAtUtc",
    "captured_at",
    "catalogObservedAt",
    "liveObservedAt",
  ]),
  "source-update": Object.freeze([
    "sourceUpdatedAt",
    "published_at",
    "publishedAt",
    "lastUpdated",
    "catalogLastUpdated",
    "time.modified",
    "Last-Modified",
    "lastModified",
    "time.<version>",
  ]),
  "source-created": Object.freeze(["time.created"]),
  "http-date": Object.freeze(["Date", "httpDate", "HTTP-Date"]),
  "filesystem-mtime": Object.freeze(["mtime", "filesystemMtime", "birthtime"]),
  "operator-clock": Object.freeze(["clock", "now", "operatorClock"]),
});

export const SCHEMA_FIELD_CITATIONS = Object.freeze([
  {
    id: "packet-envelope",
    path: "experiments/s137-consumer-evidence-jobs/src/packet.mjs",
    note: "clock is operator-supplied; evidenceClass; findings require citationIds",
  },
  {
    id: "discovery-drift-freshness",
    path: "discovery-drift.mjs",
    note: "catalogLastUpdated vs catalogObservedAt/liveObservedAt; missing/future → unknown; no clock substitution",
  },
  {
    id: "discovery-drift-doc",
    path: "docs/discovery-drift.md",
    note: "Missing capture times are not replaced with the current time; lastUpdated lag is unknown without a horizon",
  },
  {
    id: "s127-packet-contract",
    path: "/tmp/s127/x402-url-extractor/experiments/s127-upgrade-impact/docs/PACKET-CONTRACT.md",
    note: "provenance.retrievedAt is retrieval time, not dependency published time",
  },
  {
    id: "s127-packument-slim",
    path: "/tmp/s127/x402-url-extractor/experiments/s127-upgrade-impact/fixtures/real-a/registry/packument.slim.json",
    note: "npm time.modified 2026-04-01T21:17:05.330Z ≠ time.8.4.2 2026-04-01T21:17:05.201Z ≠ time.created",
  },
  {
    id: "s127-c11-retrievedAt",
    path: "/tmp/s127/x402-url-extractor/experiments/s127-upgrade-impact/cells/c11-real-a/packet.json",
    note: "provenance.packumentSlim.retrievedAt 2026-09-10T10:46:44Z; clock 2026-09-10T10:48:00Z",
  },
  {
    id: "s122-provenance",
    path: "/tmp/s127/x402-url-extractor/experiments/s122-application-jobs/fixtures/PROVENANCE.json",
    note: "capturedAtUtc 2026-09-10T09:54:59Z vs vercel published_at 2026-09-10T01:12:17.696Z; version-doc without published_at is partial",
  },
]);

export const LIMITATIONS = Object.freeze([
  "Schema/validation only; does not fetch, download, or observe live datasets.",
  "Does not substitute download/retrieval time for source-update time, or the reverse.",
  "Does not treat operator clock, HTTP Date, filesystem mtime, or npm time.created as source-update.",
  "Ambiguous fields (createdAt, updatedAt, Age) stay unknown; they are not guessed into a slot.",
  "Without an operator horizonMs, numeric ages do not yield current/stale disposition.",
  "Future timestamps versus clock yield unknown ages, not a current claim.",
  "No legal attestation of freshness, no paid endpoints, no customer-demand claims.",
  "Transform that emits findings from evidence is c27; pack fixtures are c28/c29; pack tests are c30.",
]);

export const PROVENANCE_REQUIRED = Object.freeze([
  "retrievedAt",
  "url",
  "sha256",
  "licenseNote",
]);

const SLOT_KIND = Object.freeze({
  downloadedAt: "download",
  sourceUpdatedAt: "source-update",
});

export { sha256Text };

export function makeIssue({
  kind,
  code,
  instancePath,
  message,
  params = {},
}) {
  return { kind, code, instancePath, message, params };
}

export function classifyTimeField(field) {
  if (typeof field !== "string") return "unknown";
  const trimmed = field.trim();
  if (!trimmed) return "unknown";
  const key = trimmed.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(FIELD_KIND_TABLE, key)) {
    return FIELD_KIND_TABLE[key];
  }
  if (NPM_TIME_VERSION.test(key)) return "source-update";
  return "unknown";
}

export function parseIsoInstant(value) {
  if (value == null || value === "") {
    return { ok: false, code: "missing_iso", value: value ?? null };
  }
  if (typeof value !== "string") {
    return { ok: false, code: "type", value };
  }
  const text = value.trim();
  if (text.toLowerCase() === "now") {
    return { ok: false, code: "now_refused", value: text };
  }
  if (!ISO_INSTANT.test(text)) {
    return { ok: false, code: "invalid_iso", value: text };
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) {
    return { ok: false, code: "unparseable_iso", value: text };
  }
  return { ok: true, value: text, ms };
}

/**
 * Age of an instant versus operator clock.
 * Returns null when either side is missing or the instant is after the clock.
 * Callers must pass the matching slot's ms; this function has no field fallback.
 */
export function ageMs(clockMs, instantMs) {
  if (!Number.isFinite(clockMs) || !Number.isFinite(instantMs)) return null;
  if (instantMs > clockMs) return null;
  return clockMs - instantMs;
}

/**
 * How old the source-update claim was at download time.
 * Null if either slot is missing. Negative means source-update after download.
 */
export function lagAtDownloadMs(downloadedMs, sourceUpdatedMs) {
  if (!Number.isFinite(downloadedMs) || !Number.isFinite(sourceUpdatedMs)) {
    return null;
  }
  return downloadedMs - sourceUpdatedMs;
}

export function pickDecision(decisions) {
  const set = new Set(decisions.filter((d) => DECISIONS.includes(d)));
  for (const rank of DECISION_PRECEDENCE) {
    if (set.has(rank)) return rank;
  }
  return "unknown";
}

export function timeCoverage(downloadPresent, sourceUpdatePresent) {
  if (downloadPresent && sourceUpdatePresent) return "full";
  if (downloadPresent || sourceUpdatePresent) return "partial";
  return "none";
}

export function dispositionFor({ sourceAgeMs, horizonMs, futureOrMissing }) {
  if (futureOrMissing) return "unknown";
  if (!Number.isInteger(horizonMs) || horizonMs < 0) return "unknown";
  if (sourceAgeMs == null) return "unknown";
  return sourceAgeMs > horizonMs ? "stale" : "current";
}

function lookupCitationIds(citations) {
  const ids = new Set();
  for (const c of citations || []) {
    if (c && typeof c.id === "string" && c.id) ids.add(c.id);
  }
  return ids;
}

export function validateCitation(citation, instancePath = "/citations/0") {
  const issues = [];
  if (!citation || typeof citation !== "object" || Array.isArray(citation)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        instancePath,
        message: "citation must be an object",
      }),
    );
    return { ok: false, issues };
  }
  if (typeof citation.id !== "string" || !citation.id.trim()) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "minLength",
        instancePath: `${instancePath}/id`,
        message: "citation.id is required",
      }),
    );
  }
  const hasPath = typeof citation.path === "string" && citation.path.trim();
  const hasUrl = typeof citation.url === "string" && citation.url.trim();
  if (!hasPath && !hasUrl) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "source_locator",
        instancePath,
        message: "citation requires path or url",
      }),
    );
  }
  if (
    citation.contentSha256 != null &&
    (typeof citation.contentSha256 !== "string" ||
      !SHA256_HEX.test(citation.contentSha256))
  ) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "sha256",
        instancePath: `${instancePath}/contentSha256`,
        message: "contentSha256 must be 64 lowercase hex chars when present",
      }),
    );
  }
  return { ok: issues.length === 0, issues };
}

export function validateFinding(finding, citationIds, instancePath = "/findings/0") {
  const issues = [];
  try {
    requireCitedFinding(finding);
  } catch (err) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "citationIds",
        instancePath: `${instancePath}/citationIds`,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false, issues };
  }
  if (finding.polarity != null && !POLARITIES.includes(finding.polarity)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: `${instancePath}/polarity`,
        message: `polarity must be one of ${POLARITIES.join("|")}`,
        params: { allowed: POLARITIES },
      }),
    );
  }
  for (const [i, cid] of finding.citationIds.entries()) {
    if (!citationIds.has(cid)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "citation_unresolved",
          instancePath: `${instancePath}/citationIds/${i}`,
          message: `citationId ${cid} is not in citations[]`,
          params: { citationId: cid },
        }),
      );
    }
  }
  return { ok: issues.length === 0, issues };
}

export function instantSlot(observation, expectedKind = null) {
  const issues = [];
  if (!observation || typeof observation !== "object") {
    return {
      ok: false,
      slot: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "type",
          instancePath: "/times",
          message: "time observation must be an object",
        }),
      ],
    };
  }
  const field = observation.field;
  const kind = classifyTimeField(field);
  if (expectedKind && kind !== expectedKind) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "time_kind_conflation",
        instancePath: "/times/field",
        message: `field ${field} classifies as ${kind}, not ${expectedKind}; download time is not source-update time`,
        params: { field, kind, expectedKind },
      }),
    );
  }
  const parsed = parseIsoInstant(observation.value);
  if (!parsed.ok) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: parsed.code,
        instancePath: "/times/value",
        message: `invalid instant for field ${field}`,
        params: { field, value: observation.value },
      }),
    );
  }
  if (typeof observation.citationId !== "string" || !observation.citationId) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "citationIds",
        instancePath: "/times/citationId",
        message: "time observation requires citationId",
        params: { field },
      }),
    );
  }
  if (issues.length) return { ok: false, slot: null, issues, kind };
  return {
    ok: true,
    kind,
    slot: {
      value: parsed.value,
      field,
      kind,
      citationId: observation.citationId,
      ms: parsed.ms,
    },
    issues: [],
  };
}

function groupTimes(times, instancePath, citationIds) {
  const issues = [];
  const byKind = new Map();
  const others = [];

  if (!Array.isArray(times)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        instancePath,
        message: "times must be an array of observations",
      }),
    );
    return { issues, byKind, others };
  }

  times.forEach((obs, i) => {
    const path = `${instancePath}/${i}`;
    const built = instantSlot(obs, null);
    if (!built.ok) {
      for (const issue of built.issues) {
        issues.push({ ...issue, instancePath: `${path}${issue.instancePath.replace("/times", "")}` });
      }
      return;
    }
    if (citationIds && !citationIds.has(obs.citationId)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "citation_unresolved",
          instancePath: `${path}/citationId`,
          message: `citationId ${obs.citationId} is not in citations[]`,
          params: { citationId: obs.citationId },
        }),
      );
    }
    if (built.kind === "download" || built.kind === "source-update") {
      const list = byKind.get(built.kind) || [];
      list.push(built.slot);
      byKind.set(built.kind, list);
    } else {
      others.push(built.slot);
    }
  });

  return { issues, byKind, others };
}

function collapseKind(slots, kind, instancePath) {
  if (!slots || slots.length === 0) {
    return { present: false, slot: null, issues: [], decision: null };
  }
  const values = new Set(slots.map((s) => s.ms));
  if (values.size > 1) {
    return {
      present: true,
      slot: null,
      decision: "conflict",
      issues: [
        makeIssue({
          kind: "conflict",
          code: "conflicting_timestamps",
          instancePath,
          message: `multiple ${kind} observations disagree`,
          params: {
            kind,
            values: slots.map((s) => ({ field: s.field, value: s.value, citationId: s.citationId })),
          },
        }),
      ],
    };
  }
  return { present: true, slot: slots[0], issues: [], decision: null };
}

export function normalizeDatasetTimes(times, { citationIds, instancePath = "/times", clockMs = null } = {}) {
  const grouped = groupTimes(times, instancePath, citationIds);
  const issues = [...grouped.issues];
  const download = collapseKind(grouped.byKind.get("download"), "download", instancePath);
  const sourceUpdate = collapseKind(
    grouped.byKind.get("source-update"),
    "source-update",
    instancePath,
  );
  issues.push(...download.issues, ...sourceUpdate.issues);

  const downloadPresent = Boolean(download.slot);
  const sourcePresent = Boolean(sourceUpdate.slot);
  const coverage = timeCoverage(downloadPresent, sourcePresent);

  const downloadAge = downloadPresent ? ageMs(clockMs, download.slot.ms) : null;
  const sourceAge = sourcePresent ? ageMs(clockMs, sourceUpdate.slot.ms) : null;
  const lag = lagAtDownloadMs(download.slot?.ms, sourceUpdate.slot?.ms);

  const futureDownload = downloadPresent && Number.isFinite(clockMs) && download.slot.ms > clockMs;
  const futureSource = sourcePresent && Number.isFinite(clockMs) && sourceUpdate.slot.ms > clockMs;
  if (futureDownload || futureSource) {
    issues.push(
      makeIssue({
        kind: "unknown",
        code: "future_timestamp",
        instancePath,
        message: "timestamp is after operator clock; age is unknown, not current",
        params: { futureDownload, futureSource },
      }),
    );
  }

  if (lag != null && lag < 0 && !futureDownload && !futureSource) {
    issues.push(
      makeIssue({
        kind: "conflict",
        code: "source_update_after_download",
        instancePath,
        message: "source-update instant is after download instant; chronology disagrees",
        params: { lagAtDownloadMs: lag },
      }),
    );
  }

  const decisions = [];
  if (download.decision) decisions.push(download.decision);
  if (sourceUpdate.decision) decisions.push(sourceUpdate.decision);
  if (issues.some((x) => x.code === "source_update_after_download")) decisions.push("conflict");
  if (issues.some((x) => x.kind === "invalid")) decisions.push("fail");
  if (futureDownload || futureSource) decisions.push("unknown");
  if (coverage === "partial") decisions.push("partial");
  if (coverage === "none") decisions.push("unknown");
  if (coverage === "full" && !futureDownload && !futureSource && decisions.length === 0) {
    decisions.push("pass");
  }

  return {
    downloadedAt: download.slot,
    sourceUpdatedAt: sourceUpdate.slot,
    others: grouped.others,
    downloadAgeMs: downloadAge,
    sourceAgeMs: sourceAge,
    lagAtDownloadMs: lag,
    timesDistinct: downloadPresent && sourcePresent,
    coverage: {
      downloadTime: downloadPresent ? "present" : "absent",
      sourceUpdateTime: sourcePresent ? "present" : "absent",
      time: coverage,
    },
    issues,
    decision: pickDecision(decisions),
  };
}

export function agesFor({ clock, downloadedAt, sourceUpdatedAt }) {
  const clockParsed = parseIsoInstant(clock);
  const clockMs = clockParsed.ok ? clockParsed.ms : NaN;
  const downMs = downloadedAt && Number.isFinite(downloadedAt.ms) ? downloadedAt.ms : NaN;
  const srcMs = sourceUpdatedAt && Number.isFinite(sourceUpdatedAt.ms) ? sourceUpdatedAt.ms : NaN;
  return {
    downloadAgeMs: ageMs(clockMs, downMs),
    sourceAgeMs: ageMs(clockMs, srcMs),
    lagAtDownloadMs: lagAtDownloadMs(downMs, srcMs),
  };
}

function validateClock(clock, instancePath = "/clock") {
  if (clock == null || clock === "") {
    return {
      ok: false,
      parsed: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "required",
          instancePath,
          message: "clock required (operator-supplied; do not invent)",
        }),
      ],
    };
  }
  const parsed = parseIsoInstant(clock);
  if (!parsed.ok) {
    return {
      ok: false,
      parsed: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: parsed.code,
          instancePath,
          message: "clock must be ISO-8601 with Z or numeric offset; 'now' is refused",
          params: { value: clock },
        }),
      ],
    };
  }
  return { ok: true, parsed, issues: [] };
}

function validateEvidenceClass(evidenceClass, instancePath = "/evidenceClass") {
  if (!EVIDENCE_CLASSES.includes(evidenceClass)) {
    return {
      ok: false,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "enum",
          instancePath,
          message: `evidenceClass must be one of ${EVIDENCE_CLASSES.join("|")}`,
          params: { allowed: EVIDENCE_CLASSES, value: evidenceClass },
        }),
      ],
    };
  }
  return { ok: true, issues: [] };
}

function validateCitationList(citations, instancePath = "/citations") {
  const issues = [];
  if (!Array.isArray(citations) || citations.length === 0) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "minItems",
        instancePath,
        message: "citations[] is required and must be non-empty",
      }),
    );
    return { ok: false, issues, ids: new Set() };
  }
  const ids = new Set();
  citations.forEach((c, i) => {
    const r = validateCitation(c, `${instancePath}/${i}`);
    issues.push(...r.issues);
    if (c && typeof c.id === "string") {
      if (ids.has(c.id)) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "duplicate_id",
            instancePath: `${instancePath}/${i}/id`,
            message: `duplicate citation id ${c.id}`,
          }),
        );
      }
      ids.add(c.id);
    }
  });
  return { ok: issues.length === 0, issues, ids };
}

export function validateInput(input) {
  const issues = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      decision: "fail",
      issues: [
        makeIssue({
          kind: "invalid",
          code: "type",
          instancePath: "",
          message: "input must be an object",
        }),
      ],
      datasets: [],
    };
  }
  if (input.schema != null && input.schema !== INPUT_SCHEMA_ID) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "schema",
        instancePath: "/schema",
        message: `schema must be ${INPUT_SCHEMA_ID}`,
        params: { value: input.schema },
      }),
    );
  }
  const clock = validateClock(input.clock);
  issues.push(...clock.issues);
  const evidence = validateEvidenceClass(input.evidenceClass ?? "synthetic");
  issues.push(...evidence.issues);

  let horizonMs = null;
  if (Object.prototype.hasOwnProperty.call(input, "horizonMs") && input.horizonMs != null) {
    if (!Number.isInteger(input.horizonMs) || input.horizonMs < 0) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "horizonMs",
          instancePath: "/horizonMs",
          message: "horizonMs must be a non-negative integer when present",
        }),
      );
    } else {
      horizonMs = input.horizonMs;
    }
  }

  const cites = validateCitationList(input.citations);
  issues.push(...cites.issues);

  if (!Array.isArray(input.datasets) || input.datasets.length === 0) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "minItems",
        instancePath: "/datasets",
        message: "datasets[] is required",
      }),
    );
  }

  const datasets = [];
  const datasetDecisions = [];
  (input.datasets || []).forEach((ds, i) => {
    const path = `/datasets/${i}`;
    if (!ds || typeof ds !== "object") {
      issues.push(makeIssue({ kind: "invalid", code: "type", instancePath: path, message: "dataset must be an object" }));
      datasetDecisions.push("fail");
      return;
    }
    if (typeof ds.id !== "string" || !ds.id) {
      issues.push(makeIssue({ kind: "invalid", code: "required", instancePath: `${path}/id`, message: "dataset.id is required" }));
    }
    const locator = ds.locator || {};
    const hasLocator =
      (typeof locator.path === "string" && locator.path) ||
      (typeof locator.url === "string" && locator.url);
    if (!hasLocator) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "source_locator",
          instancePath: `${path}/locator`,
          message: "dataset locator requires path or url",
        }),
      );
    }
    const norm = normalizeDatasetTimes(ds.times, {
      citationIds: cites.ids,
      instancePath: `${path}/times`,
      clockMs: clock.parsed?.ms,
    });
    issues.push(...norm.issues);
    const disposition = dispositionFor({
      sourceAgeMs: norm.sourceAgeMs,
      horizonMs,
      futureOrMissing: Boolean(
        (norm.sourceUpdatedAt && clock.parsed && norm.sourceUpdatedAt.ms > clock.parsed.ms) ||
          norm.sourceAgeMs == null,
      ),
    });
    datasets.push({
      id: ds.id ?? null,
      locator,
      contentSha256: ds.contentSha256 ?? null,
      ...norm,
      disposition,
    });
    datasetDecisions.push(norm.decision);
  });

  if (issues.some((x) => x.kind === "invalid")) datasetDecisions.push("fail");
  const decision = pickDecision(datasetDecisions);

  return {
    ok: !issues.some((x) => x.kind === "invalid"),
    decision,
    issues,
    datasets,
    clock: clock.parsed,
    horizonMs,
    citations: input.citations || [],
  };
}

export function validateReceipt(receipt) {
  const issues = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return {
      ok: false,
      decision: "fail",
      issues: [
        makeIssue({
          kind: "invalid",
          code: "type",
          instancePath: "",
          message: "receipt must be an object",
        }),
      ],
    };
  }
  if (receipt.schema !== RECEIPT_SCHEMA_ID) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "schema",
        instancePath: "/schema",
        message: `schema must be ${RECEIPT_SCHEMA_ID}`,
      }),
    );
  }
  if (receipt.jobId != null && receipt.jobId !== JOB_ID) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "jobId",
        instancePath: "/jobId",
        message: `jobId must be ${JOB_ID}`,
      }),
    );
  }
  const clock = validateClock(receipt.clock);
  issues.push(...clock.issues);
  const evidence = validateEvidenceClass(receipt.evidenceClass);
  issues.push(...evidence.issues);
  if (!DECISIONS.includes(receipt.decision)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: "/decision",
        message: `decision must be one of ${DECISIONS.join("|")}`,
      }),
    );
  }
  const cites = validateCitationList(receipt.citations);
  issues.push(...cites.issues);

  if (receipt.payment && receipt.payment.attempted !== false) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "payment",
        instancePath: "/payment/attempted",
        message: "payment.attempted must be false",
      }),
    );
  }
  if (receipt.claims && receipt.claims.inventsFacts !== false) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "claims",
        instancePath: "/claims/inventsFacts",
        message: "claims.inventsFacts must be false",
      }),
    );
  }

  (receipt.findings || []).forEach((f, i) => {
    const r = validateFinding(f, cites.ids, `/findings/${i}`);
    issues.push(...r.issues);
  });
  if (!Array.isArray(receipt.findings) || receipt.findings.length === 0) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "minItems",
        instancePath: "/findings",
        message: "findings[] is required so polarities are explicit",
      }),
    );
  }

  (receipt.datasets || []).forEach((ds, i) => {
    const path = `/datasets/${i}`;
    for (const [slotName, expectedKind] of Object.entries(SLOT_KIND)) {
      const slot = ds?.[slotName];
      if (slot == null) continue;
      if (slot.kind !== expectedKind) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "time_kind_conflation",
            instancePath: `${path}/${slotName}/kind`,
            message: `${slotName} kind must be ${expectedKind}, not ${slot.kind}`,
            params: { slotName, kind: slot.kind, expectedKind },
          }),
        );
      }
      const classified = classifyTimeField(slot.field);
      if (classified !== expectedKind) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "time_kind_conflation",
            instancePath: `${path}/${slotName}/field`,
            message: `${slotName} field ${slot.field} classifies as ${classified}, not ${expectedKind}; download time ≠ source update time`,
            params: { field: slot.field, classified, expectedKind },
          }),
        );
      }
    }
    if (ds?.downloadedAt && ds?.sourceUpdatedAt && ds.downloadedAt.field === ds.sourceUpdatedAt.field) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "time_kind_conflation",
          instancePath: path,
          message: "the same source field cannot fill both download and source-update slots",
          params: { field: ds.downloadedAt.field },
        }),
      );
    }
    const expected = agesFor({
      clock: receipt.clock,
      downloadedAt: ds?.downloadedAt,
      sourceUpdatedAt: ds?.sourceUpdatedAt,
    });
    if (ds && ds.downloadAgeMs !== expected.downloadAgeMs) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "age_mismatch",
          instancePath: `${path}/downloadAgeMs`,
          message: "downloadAgeMs must be clock - downloadedAt (not source-update)",
          params: { expected: expected.downloadAgeMs, actual: ds.downloadAgeMs },
        }),
      );
    }
    if (ds && ds.sourceAgeMs !== expected.sourceAgeMs) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "age_mismatch",
          instancePath: `${path}/sourceAgeMs`,
          message: "sourceAgeMs must be clock - sourceUpdatedAt (not download)",
          params: { expected: expected.sourceAgeMs, actual: ds.sourceAgeMs },
        }),
      );
    }
    if (ds && ds.lagAtDownloadMs !== expected.lagAtDownloadMs) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "lag_mismatch",
          instancePath: `${path}/lagAtDownloadMs`,
          message: "lagAtDownloadMs must be downloadedAt - sourceUpdatedAt",
          params: { expected: expected.lagAtDownloadMs, actual: ds.lagAtDownloadMs },
        }),
      );
    }
    const timesDistinct = Boolean(ds?.downloadedAt && ds?.sourceUpdatedAt);
    if (ds && ds.timesDistinct !== timesDistinct) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "timesDistinct",
          instancePath: `${path}/timesDistinct`,
          message: "timesDistinct is true only when both slots are present",
        }),
      );
    }
  });

  return {
    ok: !issues.some((x) => x.kind === "invalid" || x.kind === "conflict"),
    issues,
    decision: receipt.decision ?? "unknown",
  };
}

export function validateProvenance(doc) {
  const issues = [];
  if (!doc || typeof doc !== "object") {
    return {
      ok: false,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "type",
          instancePath: "",
          message: "PROVENANCE must be an object",
        }),
      ],
    };
  }
  for (const key of PROVENANCE_REQUIRED) {
    if (typeof doc[key] !== "string" || !doc[key].trim()) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "required",
          instancePath: `/${key}`,
          message: `PROVENANCE.${key} is required`,
        }),
      );
    }
  }
  if (doc.retrievedAt) {
    const parsed = parseIsoInstant(doc.retrievedAt);
    if (!parsed.ok) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: parsed.code,
          instancePath: "/retrievedAt",
          message: "PROVENANCE.retrievedAt must be ISO-8601 download time",
        }),
      );
    }
  }
  if (doc.sha256 && !SHA256_HEX.test(doc.sha256)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "sha256",
        instancePath: "/sha256",
        message: "PROVENANCE.sha256 must be 64 lowercase hex chars",
      }),
    );
  }
  if (doc.sourceUpdatedAt != null) {
    if (typeof doc.sourceUpdatedAt === "string" && doc.sourceUpdatedAt === doc.retrievedAt) {
      const field = doc.sourceUpdatedAtField || doc.sourceUpdateField;
      const kind = field ? classifyTimeField(field) : "unknown";
      if (!field || kind !== "source-update") {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "time_kind_conflation",
            instancePath: "/sourceUpdatedAt",
            message: "do not copy retrievedAt into sourceUpdatedAt; equal values need an independent source-update field",
          }),
        );
      }
    } else if (typeof doc.sourceUpdatedAt === "string") {
      const parsed = parseIsoInstant(doc.sourceUpdatedAt);
      if (!parsed.ok) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: parsed.code,
            instancePath: "/sourceUpdatedAt",
            message: "PROVENANCE.sourceUpdatedAt must be ISO-8601 when present",
          }),
        );
      }
    }
  }
  if (doc.evidenceClass && !EVIDENCE_CLASSES.includes(doc.evidenceClass)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: "/evidenceClass",
        message: `evidenceClass must be one of ${EVIDENCE_CLASSES.join("|")}`,
      }),
    );
  }
  return { ok: issues.length === 0, issues };
}

export function createFreshnessEnvelope(opts = {}) {
  return createEnvelope({
    jobId: JOB_ID,
    artifactKind: ARTIFACT_KIND,
    evidenceClass: opts.evidenceClass ?? "synthetic",
    clock: opts.clock,
    sources: opts.sources,
    findings: opts.findings,
    decision: opts.decision ?? "unknown",
    limitations: opts.limitations ?? [...LIMITATIONS],
    citations: opts.citations,
  });
}

/** Source-informed example inputs. Values copied from cited S122/S127/local files. */
export const EXAMPLE_CASES = Object.freeze({
  positive: Object.freeze({
    schema: INPUT_SCHEMA_ID,
    clock: "2026-09-10T10:48:00Z",
    evidenceClass: "fixture",
    horizonMs: null,
    datasets: [
      {
        id: "path-to-regexp-packument-slim",
        locator: {
          path: "/tmp/s127/x402-url-extractor/experiments/s127-upgrade-impact/fixtures/real-a/registry/packument.slim.json",
          url: "https://registry.npmjs.org/path-to-regexp",
        },
        times: [
          {
            field: "retrievedAt",
            value: "2026-09-10T10:46:44Z",
            citationId: "s127-c11-retrievedAt",
          },
          {
            field: "time.modified",
            value: "2026-04-01T21:17:05.330Z",
            citationId: "s127-packument-slim",
          },
        ],
      },
    ],
    citations: SCHEMA_FIELD_CITATIONS,
  }),
  negative: Object.freeze({
    schema: INPUT_SCHEMA_ID,
    clock: "now",
    evidenceClass: "fixture",
    datasets: [
      {
        id: "conflated",
        locator: { path: "experiments/s137-consumer-evidence-jobs/src/packet.mjs" },
        times: [
          {
            field: "retrievedAt",
            value: "2026-09-10T10:46:44Z",
            citationId: "packet-envelope",
          },
        ],
      },
    ],
    citations: SCHEMA_FIELD_CITATIONS,
  }),
  partial: Object.freeze({
    schema: INPUT_SCHEMA_ID,
    clock: "2026-09-10T09:54:59Z",
    evidenceClass: "fixture",
    datasets: [
      {
        id: "npm-vercel-version-doc-no-published_at",
        locator: {
          path: "/tmp/s127/x402-url-extractor/experiments/s122-application-jobs/fixtures/PROVENANCE.json",
        },
        times: [
          {
            field: "capturedAtUtc",
            value: "2026-09-10T09:54:59Z",
            citationId: "s122-provenance",
          },
        ],
      },
    ],
    citations: SCHEMA_FIELD_CITATIONS,
  }),
  conflict: Object.freeze({
    schema: INPUT_SCHEMA_ID,
    clock: "2026-09-10T10:48:00Z",
    evidenceClass: "fixture",
    datasets: [
      {
        id: "path-to-regexp-modified-vs-version-publish",
        locator: {
          path: "/tmp/s127/x402-url-extractor/experiments/s127-upgrade-impact/fixtures/real-a/registry/packument.slim.json",
        },
        times: [
          {
            field: "time.modified",
            value: "2026-04-01T21:17:05.330Z",
            citationId: "s127-packument-slim",
          },
          {
            field: "time.8.4.2",
            value: "2026-04-01T21:17:05.201Z",
            citationId: "s127-packument-slim",
          },
          {
            field: "retrievedAt",
            value: "2026-09-10T10:46:44Z",
            citationId: "s127-c11-retrievedAt",
          },
        ],
      },
    ],
    citations: SCHEMA_FIELD_CITATIONS,
  }),
});

