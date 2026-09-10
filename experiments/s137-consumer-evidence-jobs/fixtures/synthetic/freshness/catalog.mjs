/**
 * Synthetic freshness fixture catalog (S137 c28).
 * Input cases for R2-CONSUMER-JOBS-06. Download time and source update time
 * stay separate fields. No live fetch. No payment.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SCHEMA = "s137.freshness-receipt.input.v1";
export const JOB_ID = "R2-CONSUMER-JOBS-06";
export const EVIDENCE_CLASS = "synthetic";
export const ARTIFACT_KIND = "dataset-freshness-receipt";
export const REQUIRED_CASE_KINDS = Object.freeze(["positive", "negative", "partial", "conflict"]);
export const DECISIONS = Object.freeze(["pass", "fail", "partial", "conflict", "unknown"]);
export const TIME_FIELDS = Object.freeze(["retrievedAt", "sourceUpdatedAt"]);
export const COLLAPSED_TIME_KEYS = Object.freeze([
  "timestamp",
  "time",
  "asOf",
  "captured_at_alias_of_published",
]);

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const PACK_REL = "experiments/s137-consumer-evidence-jobs/fixtures/synthetic/freshness";

export function readClock() {
  return readFileSync(join(ROOT, "CLOCK.txt"), "utf8").trim();
}

export function sha256Bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256File(absPath) {
  return sha256Bytes(readFileSync(absPath));
}

export function packPath(rel) {
  return `${PACK_REL}/${rel.replace(/^\.\//, "")}`;
}

const DOWNLOAD_FIELDS = new Set([
  "retrievedat",
  "downloadedat",
  "capturedat",
  "capturedatutc",
  "captured_at",
  "catalogobservedat",
  "liveobservedat",
]);
const SOURCE_UPDATE_FIELDS = new Set([
  "sourceupdatedat",
  "published_at",
  "publishedat",
  "lastupdated",
  "cataloglastupdated",
  "time.modified",
  "last-modified",
  "lastmodified",
]);

export function classifyField(field) {
  if (typeof field !== "string") return "unknown";
  const key = field.trim().toLowerCase();
  if (DOWNLOAD_FIELDS.has(key)) return "download";
  if (SOURCE_UPDATE_FIELDS.has(key)) return "source-update";
  if (/^time\.(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.test(key)) return "source-update";
  if (key === "clock" || key === "now") return "operator-clock";
  return "unknown";
}

/** Age versus clock. Future instants are unknown (null), not negative. Matches c26 schema.mjs. */
export function ageMs(clockIso, eventIso) {
  if (clockIso == null || eventIso == null) return null;
  const clock = Date.parse(clockIso);
  const event = Date.parse(eventIso);
  if (!Number.isFinite(clock) || !Number.isFinite(event)) return null;
  if (event > clock) return null;
  return clock - event;
}

export function loadJson(rel) {
  const abs = join(ROOT, rel);
  return { abs, rel, sha256: sha256File(abs), value: JSON.parse(readFileSync(abs, "utf8")) };
}

export function loadManifest() {
  return loadJson("MANIFEST.json").value;
}

export function listCaseFiles() {
  const dir = join(ROOT, "cases");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => `cases/${name}`);
}

export function loadCases() {
  return listCaseFiles().map((rel) => {
    const loaded = loadJson(rel);
    return { ...loaded.value, _file: rel, _sha256: loaded.sha256 };
  });
}

function firstTimeValue(dataset, kind) {
  if (Array.isArray(dataset?.times)) {
    const hit = dataset.times.find((obs) => classifyField(obs?.field) === kind);
    if (hit && hit.value != null) return hit.value;
  }
  if (kind === "download") return dataset?.retrievedAt ?? null;
  if (kind === "source-update") return dataset?.sourceUpdatedAt ?? null;
  return null;
}

export function datasetTimes(dataset) {
  return {
    retrievedAt: firstTimeValue(dataset, "download"),
    sourceUpdatedAt: firstTimeValue(dataset, "source-update"),
  };
}

export function timesAreCollapsed(dataset) {
  if (!dataset || typeof dataset !== "object") return true;
  for (const key of COLLAPSED_TIME_KEYS) {
    if (Object.prototype.hasOwnProperty.call(dataset, key)) return true;
  }
  if (Array.isArray(dataset.times)) {
    const fields = dataset.times.map((obs) => obs?.field);
    const kinds = new Set(fields.map((f) => classifyField(f)));
    if (kinds.has("download") && kinds.has("source-update")) {
      const downloadFields = new Set(
        fields.filter((f) => classifyField(f) === "download"),
      );
      const sourceFields = new Set(
        fields.filter((f) => classifyField(f) === "source-update"),
      );
      for (const f of downloadFields) {
        if (sourceFields.has(f)) return true;
      }
    }
    return false;
  }
  const hasRetrieved = Object.prototype.hasOwnProperty.call(dataset, "retrievedAt");
  const hasSource = Object.prototype.hasOwnProperty.call(dataset, "sourceUpdatedAt");
  return !hasRetrieved || !hasSource;
}

export function timesAreDistinct(dataset) {
  const { retrievedAt, sourceUpdatedAt } = datasetTimes(dataset);
  if (retrievedAt == null || sourceUpdatedAt == null) return false;
  return retrievedAt !== sourceUpdatedAt;
}

export function hashedRelFiles({ exclude = ["PROVENANCE.json"] } = {}) {
  const skip = new Set(exclude);
  const out = {};
  const walk = (dir, prefix = "") => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${name.name}` : name.name;
      if (skip.has(rel)) continue;
      const abs = join(dir, name.name);
      if (name.isDirectory()) walk(abs, rel);
      else if (name.isFile()) out[rel] = { sha256: sha256File(abs), bytes: readFileSync(abs).byteLength };
    }
  };
  walk(ROOT);
  return out;
}

export function buildProvenance() {
  const clock = readClock();
  const files = hashedRelFiles();
  const cases = loadCases();
  return {
    label: "synthetic",
    evidenceClassDefault: EVIDENCE_CLASS,
    liveCapture: false,
    paidDemand: false,
    payment: { attempted: false },
    cost: { assignmentSpendUsd: 0, note: "offline authored fixtures; no purchase" },
    sourceCaptureClock: clock,
    sourceCaptureClockNote:
      "Clock copied from S122 CAPTURED_AT_UTC.txt. Not a live retrieval of these synthetic files.",
    notes:
      "Authored synthetic freshness cases. Timestamps copied from S122 fixture fields and one in-repo future-date control. Download time (retrievedAt) is not source update time (sourceUpdatedAt).",
    files,
    cases: cases.map((c) => ({
      id: c.caseId,
      caseKind: c.caseKind,
      decision: c.expect?.decision,
      path: c._file,
      sha256: c._sha256,
    })),
  };
}

export function writeProvenance() {
  const provenance = buildProvenance();
  const abs = join(ROOT, "PROVENANCE.json");
  writeFileSync(abs, `${JSON.stringify(provenance, null, 2)}\n`);
  return { abs, sha256: sha256File(abs), provenance };
}

const isMain =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain && process.argv.includes("--write-provenance")) {
  const { abs, sha256 } = writeProvenance();
  process.stdout.write(`${relative(process.cwd(), abs)} ${sha256}\n`);
}
