/**
 * R2-CONSUMER-JOBS-01 migration-checklist input/output schema (S137 c01).
 *
 * Contract only: no doc parse, no fixture IO, no network, no clock invention.
 * Field names are cited from pack contracts and in-repo parsers (see CITATIONS).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PACKET_SCHEMA,
  EVIDENCE_CLASSES,
  DECISIONS,
  createEnvelope,
  requireCitedFinding,
} from "../packet.mjs";

export {
  PACKET_SCHEMA,
  EVIDENCE_CLASSES,
  DECISIONS,
  createEnvelope,
  requireCitedFinding,
};

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK_ROOT = join(HERE, "..", "..");
const REPO_ROOT = join(PACK_ROOT, "..", "..");

export const JOB_ID = "R2-CONSUMER-JOBS-01";
export const ARTIFACT_KIND = "docs-migration-checklist";
export const INPUT_SCHEMA = "s137.migration-checklist.input.v1";
export const OUTPUT_SCHEMA = "s137.migration-checklist.output.v1";

/** ISO-8601 with Z or numeric offset. Cited from S127 normalize.mjs CLOCK_ISO. */
export const CLOCK_ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** OpenAPI methods from openapi-operation-contract.mjs METHODS, stored uppercase. */
export const HTTP_METHODS = Object.freeze([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

export const DOC_SIDES = Object.freeze(["old", "new"]);

/** Discriminators for checklist rows. Cited from S127 exportDiff + S122 field-diff + packet DECISIONS. */
export const CHECKLIST_KINDS = Object.freeze([
  "added",
  "removed",
  "renamed",
  "changed",
  "unchanged",
  "missing",
  "conflict",
  "unknown",
  "partial",
]);

/** Artifact-level coverage. Cited from S127 packet exportDiff.coverage + unknown taxonomy. */
export const COVERAGE_STATES = Object.freeze([
  "complete",
  "partial",
  "missing",
  "conflict",
]);

export const ISSUE_KINDS = Object.freeze(["invalid", "unknown"]);

/**
 * Reason codes. S127 unknown.mjs names reused for docs (not lockfiles).
 * `conflicting_source` is the docs analog of S127 `lockfile_conflict`.
 * `missing_citation` is packet.mjs requireCitedFinding.
 * `invented_clock` is S127 normalizeClock refusing `"now"`.
 */
export const REASON_CODES = Object.freeze([
  "missing_source",
  "partial_coverage",
  "conflicting_source",
  "missing_citation",
  "invented_clock",
  "paid_endpoint",
  "hostile_input",
]);

export const MAX_PATH_CHARS = 4096;
export const MAX_STRING = 4096;
export const MAX_LIST = 128;
export const MAX_SHA256_HEX = 64;

const HOSTILE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const HTTP_METHOD_SET = new Set(HTTP_METHODS);
const EVIDENCE_SET = new Set(EVIDENCE_CLASSES);
const DECISION_SET = new Set(DECISIONS);
const KIND_SET = new Set(CHECKLIST_KINDS);
const COVERAGE_SET = new Set(COVERAGE_STATES);
const REASON_SET = new Set(REASON_CODES);

const SHA256_HEX = /^[0-9a-f]{64}$/;

export const BASELINE_LIMITATIONS = Object.freeze([
  "Schema cell does not parse old/new documentation bodies (c02 transform).",
  "Schema cell does not load fixtures/synthetic/migration or fixtures/real/migration.",
  "Omitted STATE inventory is not invented; coverage is partial or missing.",
  "Operator clock is required; magic value \"now\" is refused.",
  "No network, no paid endpoint, no legal attestation, no customer-demand claim.",
  "Complete coverage here means required collections are present, not that every operation has a parsed doc hit.",
]);

export const PINNED_SOURCE_HASHES = Object.freeze({
  "experiments/s137-consumer-evidence-jobs/src/packet.mjs":
    "6f6f4116ba2b91adb43a19108d6e2f1609bae8f722594158ccac0abf16abe012",
  "experiments/s137-consumer-evidence-jobs/docs/OWNED-JOBS-01-06.json":
    "240c9640f12d8212b5f6574cf2c5c5f0de6272fe675e7d916f0cf99e404a7bc3",
  "experiments/s137-consumer-evidence-jobs/CONCURRENCY-GRAPH.md":
    "08fca1bb9c26e4867f10a484f404cac20d3b89b618aae26bbf70efa35db96a5f",
  "openapi-operation-contract.mjs":
    "f42a4cdb3fdf4a2cce30f623b5c7708f551071d155ca1da4b37cae6c300b3c9f",
  "discovery-contract.mjs":
    "d497599c88e67095689d7775d50d498a4a9092b76bf1e919ff94aac42d72fe21",
  "paid-action-effect-profile.mjs":
    "f61773cf72dd7ee9b9c8df44ce8bfbe8dbfd24341308386d448b72e533b18555",
});

const S127_PACKET =
  "/tmp/s127/x402-url-extractor/experiments/s127-upgrade-impact/docs/PACKET-CONTRACT.md";
const S127_UNKNOWN =
  "/tmp/s127/x402-url-extractor/experiments/s127-upgrade-impact/src/unknown.mjs";
const S127_NORMALIZE =
  "/tmp/s127/x402-url-extractor/experiments/s127-upgrade-impact/src/normalize.mjs";
const S122_RESULT =
  "/tmp/s127/x402-url-extractor/experiments/s122-application-jobs/recipes/lib/result.mjs";
const S122_DIFF =
  "/tmp/s127/x402-url-extractor/experiments/s122-application-jobs/recipes/lib/field-diff.mjs";
const S122_RECIPE =
  "/tmp/s127/x402-url-extractor/experiments/s122-application-jobs/recipes/specs/npm-cli-release-followup.recipe.json";

export function sha256Hex(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash("sha256").update(buffer).digest("hex");
}

function digestPath(absPath) {
  try {
    const bytes = readFileSync(absPath);
    return { sha256: sha256Hex(bytes), bytes: bytes.length, missing: false };
  } catch {
    return { sha256: null, bytes: null, missing: true };
  }
}

function citeFile(id, { path, url = null, note, license = "MIT License (in-repo LICENSE)" }) {
  const abs = path.startsWith("/") ? path : join(REPO_ROOT, path);
  const digest = digestPath(abs);
  return Object.freeze({
    id,
    source: path,
    path,
    url,
    sha256: digest.sha256,
    bytes: digest.bytes,
    missing: digest.missing,
    license,
    note,
  });
}

export const CITATIONS = Object.freeze([
  citeFile("cit-packet", {
    path: "experiments/s137-consumer-evidence-jobs/src/packet.mjs",
    note: "Envelope fields, evidenceClass, decision, citations[], requireCitedFinding, claims, clock required.",
  }),
  citeFile("cit-owned-jobs", {
    path: "experiments/s137-consumer-evidence-jobs/docs/OWNED-JOBS-01-06.json",
    note: "Job R2-CONSUMER-JOBS-01: old/new docs, caller operation inventory, startingRef, STATE inventory, source pin.",
  }),
  citeFile("cit-concurrency", {
    path: "experiments/s137-consumer-evidence-jobs/CONCURRENCY-GRAPH.md",
    note: "Artifact docs migration checklist; evidence labels; PROVENANCE; pos/neg/partial/conflict; jobs 07/08 out of bounds.",
  }),
  citeFile("cit-openapi-ops", {
    path: "openapi-operation-contract.mjs",
    note: "Caller operation inventory shape: method, route, operationId.",
  }),
  citeFile("cit-discovery", {
    path: "discovery-contract.mjs",
    note: "routeKey GET|POST /path; duplicate route key is invalid.",
  }),
  citeFile("cit-paid-ops", {
    path: "paid-action-effect-profile.mjs",
    note: "Operation alias { method, path }; canonical key is method + path.",
  }),
  citeFile("cit-s127-packet", {
    path: S127_PACKET,
    license: "read-only reuse from S127 pack; MIT in that repo",
    note: "provenance url|path, retrievedAt, contentSha256, coverage, label fixture|live-capture|synthetic; missing/partial/conflict => unknown.",
  }),
  citeFile("cit-s127-unknown", {
    path: S127_UNKNOWN,
    license: "read-only reuse from S127 pack; MIT in that repo",
    note: "REASON_CODES missing_source, partial_coverage; conflicting_source analog of lockfile_conflict; hostile_input.",
  }),
  citeFile("cit-s127-normalize", {
    path: S127_NORMALIZE,
    license: "read-only reuse from S127 pack; MIT in that repo",
    note: "CLOCK_ISO, refuse clock \"now\", makeIssue shape, MAX_PATH_CHARS, no invented operator clock.",
  }),
  citeFile("cit-s122-result", {
    path: S122_RESULT,
    license: "read-only reuse from S122 pack; MIT in that repo",
    note: "execute:false payment.attempted; outcomes include partial.",
  }),
  citeFile("cit-s122-field-diff", {
    path: S122_DIFF,
    license: "read-only reuse from S122 pack; MIT in that repo",
    note: "changed, unchanged, missing field-diff kinds.",
  }),
  citeFile("cit-s122-recipe", {
    path: S122_RECIPE,
    license: "read-only reuse from S122 pack; MIT in that repo",
    note: "requiredFields include clock; operator supplies CLOCK.",
  }),
]);

const CITATION_BY_ID = new Map(CITATIONS.map((row) => [row.id, row]));

function field(name, type, required, citationIds, note) {
  return Object.freeze({ name, type, required, citationIds: Object.freeze([...citationIds]), note });
}

export const INPUT_FIELDS = Object.freeze([
  field("schema", "string", true, ["cit-packet", "cit-owned-jobs"], "Must equal INPUT_SCHEMA."),
  field("clock", "string", true, ["cit-packet", "cit-s127-normalize", "cit-s122-recipe"], "Operator-supplied ISO-8601; do not invent."),
  field("evidenceClass", "string", true, ["cit-packet", "cit-concurrency"], "synthetic | fixture | live-capture."),
  field("sourcePin", "object", false, ["cit-owned-jobs"], "Owning repository plus explicit source pin (startingRef)."),
  field("stateInventory", "object", false, ["cit-owned-jobs"], "Current STATE and accepted source inventory; omit rather than invent."),
  field("oldDocs", "array", true, ["cit-owned-jobs"], "Supplied actual old docs. Empty => missing_source / partial."),
  field("newDocs", "array", true, ["cit-owned-jobs"], "Supplied actual new docs. Empty => missing_source / partial."),
  field("operations", "array", true, ["cit-owned-jobs", "cit-openapi-ops", "cit-discovery", "cit-paid-ops"], "Caller operation inventory."),
  field("citations", "array", true, ["cit-packet", "cit-concurrency"], "Source path/url + content hash when possible."),
  field("claims", "object", false, ["cit-packet", "cit-s122-result"], "Must stay false; paidEndpoint true is invalid."),
]);

export const DOC_FIELDS = Object.freeze([
  field("id", "string", true, ["cit-owned-jobs"], "Stable doc id within a side."),
  field("side", "string", false, ["cit-owned-jobs"], "old | new; inferred from oldDocs/newDocs when omitted."),
  field("path", "string", false, ["cit-s127-packet"], "Filesystem path. Require path or url."),
  field("url", "string", false, ["cit-s127-packet"], "Source URL recorded from PROVENANCE; schema does not fetch."),
  field("retrievedAt", "string", false, ["cit-s127-packet", "cit-concurrency"], "Required when evidenceClass is live-capture."),
  field("sha256", "string", false, ["cit-s127-packet", "cit-concurrency"], "Content hash when possible; missing => partial."),
  field("license", "string", false, ["cit-concurrency"], "PROVENANCE license note."),
  field("mediaType", "string", false, ["cit-owned-jobs"], "Optional supplied label; not sniffed."),
  field("text", "string", false, ["cit-owned-jobs"], "Optional body. Parsing is c02, not this cell."),
]);

export const OPERATION_FIELDS = Object.freeze([
  field("id", "string", false, ["cit-openapi-ops"], "Defaults to operationId or method+route."),
  field("method", "string", true, ["cit-openapi-ops", "cit-paid-ops", "cit-discovery"], "HTTP method, uppercase."),
  field("route", "string", false, ["cit-openapi-ops", "cit-discovery"], "Canonical path. Alias of path."),
  field("path", "string", false, ["cit-paid-ops"], "Alias of route from paid-action-effect-profile."),
  field("operationId", "string", false, ["cit-openapi-ops"], "Stable OpenAPI operationId when supplied."),
]);

export const CITATION_FIELDS = Object.freeze([
  field("id", "string", true, ["cit-packet"], "citationId referenced by findings and checklist rows."),
  field("source", "string", true, ["cit-packet", "cit-concurrency"], "Human-stable source path or url."),
  field("path", "string", false, ["cit-s127-packet"], "Filesystem path when the source is local."),
  field("url", "string", false, ["cit-s127-packet"], "URL when the source is remote; not fetched here."),
  field("sha256", "string", false, ["cit-concurrency", "cit-s127-packet"], "Content hash when possible."),
  field("retrievedAt", "string", false, ["cit-concurrency"], "PROVENANCE retrievedAt."),
  field("license", "string", false, ["cit-concurrency"], "PROVENANCE license note."),
]);

export const FINDING_FIELDS = Object.freeze([
  field("id", "string", false, ["cit-packet"], "Optional finding id."),
  field("code", "string", false, ["cit-s127-unknown"], "REASON_CODES when known."),
  field("message", "string", true, ["cit-packet"], "Source-informed statement; not model-as-oracle."),
  field("citationIds", "array", true, ["cit-packet"], "Non-empty; every id must exist in citations[]."),
]);

export const CHECKLIST_ITEM_FIELDS = Object.freeze([
  field("id", "string", true, ["cit-owned-jobs"], "Stable checklist row id."),
  field("kind", "string", true, ["cit-s127-packet", "cit-s122-field-diff"], "CHECKLIST_KINDS."),
  field("subject", "string", true, ["cit-owned-jobs", "cit-openapi-ops"], "Operation key or heading/anchor."),
  field("operation", "object", false, ["cit-openapi-ops"], "method/route/operationId when the row is an op."),
  field("oldRef", "object", false, ["cit-owned-jobs"], "Pointer into oldDocs (docId, optional anchor)."),
  field("newRef", "object", false, ["cit-owned-jobs"], "Pointer into newDocs (docId, optional anchor)."),
  field("citationIds", "array", true, ["cit-packet"], "Non-empty cited sources."),
  field("coverage", "string", false, ["cit-s127-packet"], "complete|partial|missing|conflict for this row."),
  field("reasonCode", "string", false, ["cit-s127-unknown"], "REASON_CODES."),
]);

export const OUTPUT_FIELDS = Object.freeze([
  field("schema", "string", true, ["cit-packet", "cit-owned-jobs"], "Must equal OUTPUT_SCHEMA."),
  field("packetSchema", "string", true, ["cit-packet"], "Echo of PACKET_SCHEMA."),
  field("jobId", "string", true, ["cit-packet", "cit-owned-jobs"], "R2-CONSUMER-JOBS-01."),
  field("artifactKind", "string", true, ["cit-packet", "cit-concurrency"], "docs-migration-checklist."),
  field("clock", "string", true, ["cit-packet", "cit-s127-normalize"], "Same operator clock as input."),
  field("evidenceClass", "string", true, ["cit-packet"], "synthetic | fixture | live-capture."),
  field("offline", "boolean", true, ["cit-packet"], "Always true in this pack."),
  field("payment", "object", true, ["cit-packet", "cit-s122-result"], "attempted:false."),
  field("cost", "object", true, ["cit-packet"], "assignmentSpendUsd:0."),
  field("sources", "array", true, ["cit-packet"], "Envelope sources list."),
  field("findings", "array", true, ["cit-packet"], "Each finding has citationIds."),
  field("citations", "array", true, ["cit-packet"], "Union of cited sources."),
  field("decision", "string", true, ["cit-packet"], "pass|fail|partial|conflict|unknown."),
  field("limitations", "array", true, ["cit-packet", "cit-s127-packet"], "Explicit non-claims."),
  field("claims", "object", true, ["cit-packet"], "inventsFacts and siblings stay false."),
  field("checklist", "array", true, ["cit-owned-jobs", "cit-concurrency"], "Cited migration checklist rows."),
  field("coverage", "string", true, ["cit-s127-packet", "cit-s127-unknown"], "COVERAGE_STATES."),
  field("sourcePin", "object", false, ["cit-owned-jobs"], "Echo of input source pin."),
]);

export const SOURCE_PIN_FIELDS = Object.freeze([
  field("repository", "string", true, ["cit-owned-jobs"], "epistemedeus/x402-url-extractor in the owned-jobs slice."),
  field("ref", "string", true, ["cit-owned-jobs"], "startingRef pin; do not invent another commit."),
]);

export const STATE_INVENTORY_FIELDS = Object.freeze([
  field("path", "string", false, ["cit-owned-jobs"], "Path to supplied STATE / source inventory."),
  field("sha256", "string", false, ["cit-concurrency"], "Hash when the inventory bytes are supplied."),
]);

export function makeIssue({
  kind,
  code,
  keyword,
  instancePath,
  schemaPath,
  message,
  params = {},
}) {
  return {
    kind,
    code,
    keyword: keyword || code,
    instancePath,
    schemaPath: schemaPath || `#${instancePath}`,
    message,
    params,
  };
}

export function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hostileKeys(value) {
  if (!value || typeof value !== "object") return [];
  return Object.keys(value).filter((key) => HOSTILE_KEYS.has(key));
}

function asStatus(issues) {
  if (issues.some((row) => row.kind === "invalid")) return "invalid";
  if (issues.some((row) => row.kind === "unknown")) return "unknown";
  return "ok";
}

function checkString(value, { instancePath, schemaPath, max = MAX_STRING, required = true }) {
  const issues = [];
  if (value == null || value === "") {
    if (required) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "required",
          keyword: "required",
          instancePath,
          schemaPath,
          message: `${instancePath} is required`,
          params: { missingProperty: instancePath.split("/").pop() },
        }),
      );
    }
    return { ok: issues.length === 0, value: null, issues };
  }
  if (typeof value !== "string") {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        keyword: "type",
        instancePath,
        schemaPath,
        message: `${instancePath} must be a string`,
        params: { type: "string" },
      }),
    );
    return { ok: false, value: null, issues };
  }
  if (value.length > max) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "maxLength",
        keyword: "maxLength",
        instancePath,
        schemaPath,
        message: `${instancePath} exceeds ${max} characters`,
        params: { maxLength: max },
      }),
    );
    return { ok: false, value: null, issues };
  }
  return { ok: true, value, issues };
}

export function normalizeClock(value) {
  const issues = [];
  if (value == null || value === "") {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "required",
        keyword: "required",
        instancePath: "/clock",
        schemaPath: "#/properties/clock",
        message: "operator clock is required; the pack does not invent it",
        params: { missingProperty: "clock" },
      }),
    );
    return { clock: null, issues };
  }
  if (typeof value !== "string") {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        keyword: "type",
        instancePath: "/clock",
        schemaPath: "#/properties/clock/type",
        message: "clock must be a string",
        params: { type: "string" },
      }),
    );
    return { clock: null, issues };
  }
  const text = value.trim();
  if (text.toLowerCase() === "now") {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "invented_clock",
        keyword: "enum",
        instancePath: "/clock",
        schemaPath: "#/properties/clock",
        message: "clock magic value \"now\" is refused; the pack does not invent operator clock",
        params: { reasonCode: "invented_clock" },
      }),
    );
    return { clock: null, issues };
  }
  if (!CLOCK_ISO.test(text) || !Number.isFinite(Date.parse(text))) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "format",
        keyword: "format",
        instancePath: "/clock",
        schemaPath: "#/properties/clock/format",
        message: "clock must be an ISO-8601 timestamp with timezone offset or Z",
        params: { format: "date-time" },
      }),
    );
    return { clock: null, issues };
  }
  return { clock: text, issues };
}

function normalizeSha256(value, instancePath) {
  const issues = [];
  if (value == null || value === "") return { sha256: null, issues };
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "pattern",
        keyword: "pattern",
        instancePath,
        message: `${instancePath} must be 64 lowercase hex characters when present`,
        params: { pattern: "sha256-hex" },
      }),
    );
    return { sha256: null, issues };
  }
  return { sha256: value, issues };
}

function normalizePathOrUrl(value, instancePath, max = MAX_PATH_CHARS) {
  return checkString(value, { instancePath, max, required: false });
}

export function validateCitation(raw, instancePath = "/citations/0") {
  const issues = [];
  if (!isPlainObject(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        keyword: "type",
        instancePath,
        message: "citation must be a plain object",
        params: { type: "object" },
      }),
    );
    return { ok: false, status: "invalid", issues, citation: null };
  }
  for (const key of hostileKeys(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "hostile_input",
        keyword: "propertyNames",
        instancePath: `${instancePath}/${key}`,
        message: "prototype-pollution key is invalid",
        params: { reasonCode: "hostile_input", key },
      }),
    );
  }
  const id = checkString(raw.id, { instancePath: `${instancePath}/id` });
  issues.push(...id.issues);
  const source = checkString(raw.source, { instancePath: `${instancePath}/source`, max: MAX_PATH_CHARS });
  issues.push(...source.issues);
  const path = normalizePathOrUrl(raw.path, `${instancePath}/path`);
  issues.push(...path.issues);
  const url = normalizePathOrUrl(raw.url, `${instancePath}/url`);
  issues.push(...url.issues);
  const sha = normalizeSha256(raw.sha256, `${instancePath}/sha256`);
  issues.push(...sha.issues);
  if (!raw.path && !raw.url && source.ok) {
    // source itself may be the path or url
  }
  if (!source.ok && !path.value && !url.value) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "required",
        keyword: "anyOf",
        instancePath,
        message: "citation needs source plus path or url when possible",
        params: { missingProperty: "source" },
      }),
    );
  }
  const retrievedAt = raw.retrievedAt == null || raw.retrievedAt === ""
    ? { value: null, issues: [] }
    : normalizeClock(raw.retrievedAt);
  if (raw.retrievedAt) {
    for (const issue of retrievedAt.issues) {
      issues.push({ ...issue, instancePath: `${instancePath}/retrievedAt` });
    }
  }
  const status = asStatus(issues);
  return {
    ok: status === "ok",
    status,
    issues,
    citation: status === "invalid"
      ? null
      : {
          id: id.value,
          source: source.value,
          path: path.value,
          url: url.value,
          sha256: sha.sha256,
          retrievedAt: retrievedAt.clock ?? retrievedAt.value ?? null,
          license: typeof raw.license === "string" ? raw.license : null,
        },
  };
}

export function validateFinding(raw, citationIds, instancePath = "/findings/0") {
  const issues = [];
  if (!isPlainObject(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        instancePath,
        message: "finding must be a plain object",
      }),
    );
    return { ok: false, status: "invalid", issues, finding: null };
  }
  const message = checkString(raw.message, { instancePath: `${instancePath}/message` });
  issues.push(...message.issues);
  if (!Array.isArray(raw.citationIds) || raw.citationIds.length === 0) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "missing_citation",
        keyword: "minItems",
        instancePath: `${instancePath}/citationIds`,
        message: "every finding must cite at least one citationId",
        params: { reasonCode: "missing_citation" },
      }),
    );
  } else {
    for (const [i, cid] of raw.citationIds.entries()) {
      if (typeof cid !== "string" || !cid) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "type",
            instancePath: `${instancePath}/citationIds/${i}`,
            message: "citationId must be a non-empty string",
          }),
        );
      } else if (citationIds && !citationIds.has(cid)) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "missing_citation",
            instancePath: `${instancePath}/citationIds/${i}`,
            message: `citationId ${cid} is not in citations[]`,
            params: { reasonCode: "missing_citation", citationId: cid },
          }),
        );
      }
    }
  }
  if (raw.code != null && raw.code !== "" && !REASON_SET.has(raw.code)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: `${instancePath}/code`,
        message: `finding.code must be one of ${REASON_CODES.join("|")}`,
        params: { allowed: REASON_CODES },
      }),
    );
  }
  const status = asStatus(issues);
  return {
    ok: status === "ok",
    status,
    issues,
    finding: status === "invalid"
      ? null
      : {
          id: typeof raw.id === "string" ? raw.id : null,
          code: typeof raw.code === "string" ? raw.code : null,
          message: message.value,
          citationIds: Array.isArray(raw.citationIds) ? [...raw.citationIds] : [],
        },
  };
}

export function validateDoc(raw, { instancePath, side, evidenceClass }) {
  const issues = [];
  if (!isPlainObject(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        instancePath,
        message: "doc record must be a plain object",
      }),
    );
    return { ok: false, status: "invalid", issues, doc: null };
  }
  for (const key of hostileKeys(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "hostile_input",
        instancePath: `${instancePath}/${key}`,
        message: "prototype-pollution key is invalid",
        params: { reasonCode: "hostile_input", key },
      }),
    );
  }
  const id = checkString(raw.id, { instancePath: `${instancePath}/id` });
  issues.push(...id.issues);
  let resolvedSide = raw.side == null || raw.side === "" ? side : raw.side;
  if (resolvedSide != null && !DOC_SIDES.includes(resolvedSide)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: `${instancePath}/side`,
        message: "side must be old or new",
        params: { allowed: DOC_SIDES },
      }),
    );
    resolvedSide = side;
  }
  const path = normalizePathOrUrl(raw.path, `${instancePath}/path`);
  issues.push(...path.issues);
  const url = normalizePathOrUrl(raw.url, `${instancePath}/url`);
  issues.push(...url.issues);
  if (!path.value && !url.value) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "required",
        keyword: "anyOf",
        instancePath,
        message: "doc record requires path or url",
        params: { missingProperty: "path" },
      }),
    );
  }
  const sha = normalizeSha256(raw.sha256, `${instancePath}/sha256`);
  issues.push(...sha.issues);
  if (!sha.sha256) {
    issues.push(
      makeIssue({
        kind: "unknown",
        code: "partial_coverage",
        instancePath: `${instancePath}/sha256`,
        message: "content hash missing; coverage cannot be proven complete",
        params: { reasonCode: "partial_coverage" },
      }),
    );
  }
  if (evidenceClass === "live-capture" && (raw.retrievedAt == null || raw.retrievedAt === "")) {
    issues.push(
      makeIssue({
        kind: "unknown",
        code: "partial_coverage",
        instancePath: `${instancePath}/retrievedAt`,
        message: "live-capture docs require retrievedAt from PROVENANCE",
        params: { reasonCode: "partial_coverage" },
      }),
    );
  }
  if (raw.retrievedAt) {
    const retrieved = normalizeClock(raw.retrievedAt);
    for (const issue of retrieved.issues) {
      issues.push({ ...issue, instancePath: `${instancePath}/retrievedAt` });
    }
  }
  if (raw.evidenceClass != null && raw.evidenceClass !== "" && raw.evidenceClass !== evidenceClass) {
    issues.push(
      makeIssue({
        kind: "unknown",
        code: "conflicting_source",
        instancePath: `${instancePath}/evidenceClass`,
        message: "doc evidenceClass disagrees with input.evidenceClass",
        params: { reasonCode: "conflicting_source", doc: raw.evidenceClass, input: evidenceClass },
      }),
    );
  }
  const status = asStatus(issues);
  return {
    ok: status === "ok",
    status,
    issues,
    doc: status === "invalid"
      ? null
      : {
          id: id.value,
          side: resolvedSide,
          path: path.value,
          url: url.value,
          sha256: sha.sha256,
          retrievedAt: raw.retrievedAt || null,
          license: typeof raw.license === "string" ? raw.license : null,
          mediaType: typeof raw.mediaType === "string" ? raw.mediaType : null,
          text: typeof raw.text === "string" ? raw.text : null,
        },
  };
}

export function validateOperation(raw, instancePath = "/operations/0") {
  const issues = [];
  if (!isPlainObject(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        instancePath,
        message: "operation must be a plain object",
      }),
    );
    return { ok: false, status: "invalid", issues, operation: null };
  }
  const methodRaw = typeof raw.method === "string" ? raw.method.trim().toUpperCase() : raw.method;
  if (!HTTP_METHOD_SET.has(methodRaw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: `${instancePath}/method`,
        message: `method must be one of ${HTTP_METHODS.join("|")}`,
        params: { allowed: HTTP_METHODS },
      }),
    );
  }
  const routeField = raw.route;
  const pathField = raw.path;
  if (routeField != null && pathField != null && routeField !== pathField) {
    issues.push(
      makeIssue({
        kind: "unknown",
        code: "conflicting_source",
        instancePath: `${instancePath}/route`,
        message: "operation.route and operation.path disagree",
        params: { reasonCode: "conflicting_source", route: routeField, path: pathField },
      }),
    );
  }
  const route = typeof (routeField ?? pathField) === "string" ? (routeField ?? pathField) : null;
  if (!route || !route.startsWith("/") || route.startsWith("//") || route.includes("?") || route.includes("#")) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "pattern",
        instancePath: `${instancePath}/route`,
        message: "route must be a root-relative path without query or fragment",
        params: { pattern: "root-relative-path" },
      }),
    );
  }
  if (raw.operationId != null && raw.operationId !== "") {
    if (typeof raw.operationId !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(raw.operationId)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "pattern",
          instancePath: `${instancePath}/operationId`,
          message: "operationId must match OpenAPI stable token /^[A-Za-z][A-Za-z0-9]*$/",
        }),
      );
    }
  }
  const status = asStatus(issues);
  const key = methodRaw && route ? `${methodRaw} ${route}` : null;
  return {
    ok: status === "ok",
    status,
    issues,
    operation: status === "invalid"
      ? null
      : {
          id: typeof raw.id === "string" && raw.id ? raw.id : (raw.operationId || key),
          method: methodRaw,
          route,
          path: route,
          operationId: typeof raw.operationId === "string" && raw.operationId ? raw.operationId : null,
          key,
        },
  };
}

function validateSourcePin(raw, instancePath = "/sourcePin") {
  const issues = [];
  if (raw == null) return { ok: true, status: "ok", issues, sourcePin: null };
  if (!isPlainObject(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        instancePath,
        message: "sourcePin must be an object",
      }),
    );
    return { ok: false, status: "invalid", issues, sourcePin: null };
  }
  const repository = checkString(raw.repository, { instancePath: `${instancePath}/repository`, required: true });
  const ref = checkString(raw.ref, { instancePath: `${instancePath}/ref`, required: true });
  issues.push(...repository.issues, ...ref.issues);
  const status = asStatus(issues);
  return {
    ok: status === "ok",
    status,
    issues,
    sourcePin: status === "invalid" ? null : { repository: repository.value, ref: ref.value },
  };
}

function validateStateInventory(raw, instancePath = "/stateInventory") {
  const issues = [];
  if (raw == null) {
    issues.push(
      makeIssue({
        kind: "unknown",
        code: "missing_source",
        instancePath,
        message: "STATE inventory omitted; not invented",
        params: { reasonCode: "missing_source" },
      }),
    );
    return { ok: false, status: "unknown", issues, stateInventory: null };
  }
  if (!isPlainObject(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        instancePath,
        message: "stateInventory must be an object",
      }),
    );
    return { ok: false, status: "invalid", issues, stateInventory: null };
  }
  const path = normalizePathOrUrl(raw.path, `${instancePath}/path`);
  issues.push(...path.issues);
  const sha = normalizeSha256(raw.sha256, `${instancePath}/sha256`);
  issues.push(...sha.issues);
  if (!path.value && !sha.sha256) {
    issues.push(
      makeIssue({
        kind: "unknown",
        code: "missing_source",
        instancePath,
        message: "stateInventory present but path and sha256 are empty",
        params: { reasonCode: "missing_source" },
      }),
    );
  }
  const status = asStatus(issues);
  return {
    ok: status === "ok",
    status,
    issues,
    stateInventory: { path: path.value, sha256: sha.sha256 },
  };
}

function validateClaims(raw, instancePath = "/claims") {
  const issues = [];
  const defaults = {
    inventsFacts: false,
    paidEndpoint: false,
    legalAttestation: false,
    modelAsOracle: false,
    assertsCustomerDemand: false,
  };
  if (raw == null) return { ok: true, status: "ok", issues, claims: defaults };
  if (!isPlainObject(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        instancePath,
        message: "claims must be an object",
      }),
    );
    return { ok: false, status: "invalid", issues, claims: null };
  }
  const claims = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (raw[key] == null) continue;
    if (typeof raw[key] !== "boolean") {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "type",
          instancePath: `${instancePath}/${key}`,
          message: `claims.${key} must be boolean`,
        }),
      );
      continue;
    }
    claims[key] = raw[key];
    if (raw[key] === true) {
      const code = key === "paidEndpoint" ? "paid_endpoint" : "hostile_input";
      issues.push(
        makeIssue({
          kind: "invalid",
          code,
          instancePath: `${instancePath}/${key}`,
          message: `claims.${key} must remain false in this pack`,
          params: { reasonCode: code },
        }),
      );
    }
  }
  return { ok: issues.length === 0, status: asStatus(issues), issues, claims };
}

function validateList(raw, instancePath, max = MAX_LIST) {
  const issues = [];
  if (raw == null) return { ok: true, status: "ok", issues, list: [] };
  if (!Array.isArray(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        instancePath,
        message: `${instancePath} must be an array`,
        params: { type: "array" },
      }),
    );
    return { ok: false, status: "invalid", issues, list: null };
  }
  if (raw.length > max) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "maxItems",
        instancePath,
        message: `${instancePath} exceeds ${max} items`,
        params: { maxItems: max },
      }),
    );
    return { ok: false, status: "invalid", issues, list: null };
  }
  return { ok: true, status: "ok", issues, list: raw };
}

function docSidesFor(docs, locator, sha256) {
  const sides = new Set();
  for (const doc of docs) {
    if (!doc) continue;
    const docLocator = doc.path || doc.url;
    if (docLocator === locator && doc.sha256 === sha256 && doc.side) sides.add(doc.side);
  }
  return sides;
}

function collectConflicts(docs, citations) {
  const issues = [];
  const byLocator = new Map();
  for (const row of citations) {
    if (!row) continue;
    const locator = row.path || row.url || row.source;
    if (!locator || !row.sha256) continue;
    const hashes = byLocator.get(locator) || new Set();
    hashes.add(row.sha256);
    byLocator.set(locator, hashes);
  }
  for (const [locator, hashes] of byLocator.entries()) {
    if (hashes.size <= 1) continue;
    const sides = new Set();
    const unmatched = [];
    for (const sha of hashes) {
      const found = docSidesFor(docs, locator, sha);
      if (found.size === 0) unmatched.push(sha);
      for (const side of found) sides.add(side);
    }
    // Old vs new of the same path is the migration job, not a citation conflict.
    if (sides.has("old") && sides.has("new") && unmatched.length === 0 && hashes.size === 2) {
      continue;
    }
    // One bound side plus one leftover citation: partial inventory, not two bound observations.
    if (sides.size === 1 && unmatched.length === 1 && hashes.size === 2) {
      continue;
    }
    issues.push(
      makeIssue({
        kind: "unknown",
        code: "conflicting_source",
        instancePath: "/citations",
        message: `citations disagree on sha256 for ${locator}`,
        params: { reasonCode: "conflicting_source", locator, hashes: [...hashes], sides: [...sides] },
      }),
    );
  }
  const bySideId = new Map();
  for (const doc of docs) {
    if (!doc?.id) continue;
    const key = `${doc.side}:${doc.id}`;
    const prev = bySideId.get(key);
    if (prev) {
      issues.push(
        makeIssue({
          kind: "unknown",
          code: "conflicting_source",
          instancePath: `/${doc.side}Docs`,
          message: `duplicate doc id ${doc.id} on side ${doc.side}`,
          params: { reasonCode: "conflicting_source", id: doc.id, side: doc.side },
        }),
      );
    } else {
      bySideId.set(key, doc);
    }
  }
  return issues;
}

export function classifyInputCoverage({ oldDocs, newDocs, operations, citations, conflicts, stateInventory }) {
  if (conflicts) return "conflict";
  const oldN = oldDocs?.length || 0;
  const newN = newDocs?.length || 0;
  const opN = operations?.length || 0;
  const citN = citations?.length || 0;
  if (oldN === 0 && newN === 0) return "missing";
  if (oldN === 0 || newN === 0 || opN === 0 || citN === 0 || !stateInventory) return "partial";
  return "complete";
}

export function validateInput(raw) {
  const issues = [];
  if (!isPlainObject(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        instancePath: "",
        message: "input must be a plain object",
      }),
    );
    return { ok: false, status: "invalid", coverage: "missing", issues, input: null };
  }
  for (const key of hostileKeys(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "hostile_input",
        instancePath: `/${key}`,
        message: "prototype-pollution key is invalid",
        params: { reasonCode: "hostile_input", key },
      }),
    );
  }
  if (raw.schema != null && raw.schema !== INPUT_SCHEMA) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "const",
        instancePath: "/schema",
        message: `schema must be ${INPUT_SCHEMA}`,
        params: { allowed: INPUT_SCHEMA },
      }),
    );
  }
  const clock = normalizeClock(raw.clock);
  issues.push(...clock.issues);
  let evidenceClass = raw.evidenceClass;
  if (!EVIDENCE_SET.has(evidenceClass)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: "/evidenceClass",
        message: `evidenceClass must be one of ${EVIDENCE_CLASSES.join("|")}`,
        params: { allowed: EVIDENCE_CLASSES },
      }),
    );
    evidenceClass = null;
  }
  const pin = validateSourcePin(raw.sourcePin);
  issues.push(...pin.issues);
  const state = validateStateInventory(raw.stateInventory);
  issues.push(...state.issues);
  const claims = validateClaims(raw.claims);
  issues.push(...claims.issues);

  const oldList = validateList(raw.oldDocs, "/oldDocs");
  const newList = validateList(raw.newDocs, "/newDocs");
  const opList = validateList(raw.operations, "/operations");
  const citList = validateList(raw.citations, "/citations");
  issues.push(...oldList.issues, ...newList.issues, ...opList.issues, ...citList.issues);

  const citations = [];
  const citationIds = new Set();
  if (citList.list) {
    for (const [i, row] of citList.list.entries()) {
      const checked = validateCitation(row, `/citations/${i}`);
      issues.push(...checked.issues);
      if (checked.citation?.id) {
        if (citationIds.has(checked.citation.id)) {
          issues.push(
            makeIssue({
              kind: "unknown",
              code: "conflicting_source",
              instancePath: `/citations/${i}/id`,
              message: `duplicate citation id ${checked.citation.id}`,
              params: { reasonCode: "conflicting_source", id: checked.citation.id },
            }),
          );
        }
        citationIds.add(checked.citation.id);
        citations.push(checked.citation);
      }
    }
  }

  const oldDocs = [];
  const newDocs = [];
  if (oldList.list) {
    for (const [i, row] of oldList.list.entries()) {
      const checked = validateDoc(row, { instancePath: `/oldDocs/${i}`, side: "old", evidenceClass });
      issues.push(...checked.issues);
      if (checked.doc) oldDocs.push(checked.doc);
    }
  }
  if (newList.list) {
    for (const [i, row] of newList.list.entries()) {
      const checked = validateDoc(row, { instancePath: `/newDocs/${i}`, side: "new", evidenceClass });
      issues.push(...checked.issues);
      if (checked.doc) newDocs.push(checked.doc);
    }
  }
  if (oldDocs.length === 0 && newDocs.length === 0) {
    issues.push(
      makeIssue({
        kind: "unknown",
        code: "missing_source",
        instancePath: "/oldDocs",
        message: "old and new docs are empty; checklist cannot bind operations",
        params: { reasonCode: "missing_source" },
      }),
    );
  } else if (oldDocs.length === 0 || newDocs.length === 0) {
    issues.push(
      makeIssue({
        kind: "unknown",
        code: "partial_coverage",
        instancePath: oldDocs.length === 0 ? "/oldDocs" : "/newDocs",
        message: "only one doc side is present; coverage is partial",
        params: { reasonCode: "partial_coverage" },
      }),
    );
  }

  const operations = [];
  const opKeys = new Set();
  const opIds = new Set();
  if (opList.list) {
    for (const [i, row] of opList.list.entries()) {
      const checked = validateOperation(row, `/operations/${i}`);
      issues.push(...checked.issues);
      if (!checked.operation) continue;
      if (checked.operation.key && opKeys.has(checked.operation.key)) {
        issues.push(
          makeIssue({
            kind: "unknown",
            code: "conflicting_source",
            instancePath: `/operations/${i}`,
            message: `duplicate operation key ${checked.operation.key}`,
            params: { reasonCode: "conflicting_source", key: checked.operation.key },
          }),
        );
      }
      if (checked.operation.operationId && opIds.has(checked.operation.operationId)) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "uniqueItems",
            instancePath: `/operations/${i}/operationId`,
            message: `duplicate OpenAPI operationId: ${checked.operation.operationId}`,
            params: { operationId: checked.operation.operationId },
          }),
        );
      }
      if (checked.operation.key) opKeys.add(checked.operation.key);
      if (checked.operation.operationId) opIds.add(checked.operation.operationId);
      operations.push(checked.operation);
    }
  }
  if (operations.length === 0) {
    issues.push(
      makeIssue({
        kind: "unknown",
        code: "partial_coverage",
        instancePath: "/operations",
        message: "caller operation inventory is empty; checklist rows cannot be bound",
        params: { reasonCode: "partial_coverage" },
      }),
    );
  }

  issues.push(...collectConflicts([...oldDocs, ...newDocs], citations));

  const conflict = issues.some((row) => row.code === "conflicting_source");
  const coverage = classifyInputCoverage({
    oldDocs,
    newDocs,
    operations,
    citations,
    conflicts: conflict,
    stateInventory: state.stateInventory,
  });
  const status = asStatus(issues);
  const input = {
    schema: INPUT_SCHEMA,
    clock: clock.clock,
    evidenceClass,
    sourcePin: pin.sourcePin,
    stateInventory: state.stateInventory,
    oldDocs,
    newDocs,
    operations,
    citations,
    claims: claims.claims,
    coverage,
  };
  return {
    ok: status === "ok",
    status,
    coverage,
    issues,
    input: status === "invalid" ? null : input,
  };
}

export function validateChecklistItem(raw, citationIds, instancePath = "/checklist/0") {
  const issues = [];
  if (!isPlainObject(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        instancePath,
        message: "checklist item must be a plain object",
      }),
    );
    return { ok: false, status: "invalid", issues, item: null };
  }
  const id = checkString(raw.id, { instancePath: `${instancePath}/id` });
  issues.push(...id.issues);
  if (!KIND_SET.has(raw.kind)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: `${instancePath}/kind`,
        message: `kind must be one of ${CHECKLIST_KINDS.join("|")}`,
        params: { allowed: CHECKLIST_KINDS },
      }),
    );
  }
  const subject = checkString(raw.subject, { instancePath: `${instancePath}/subject` });
  issues.push(...subject.issues);
  if (!Array.isArray(raw.citationIds) || raw.citationIds.length === 0) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "missing_citation",
        instancePath: `${instancePath}/citationIds`,
        message: "every checklist item must cite at least one citationId",
        params: { reasonCode: "missing_citation" },
      }),
    );
  } else if (citationIds) {
    for (const [i, cid] of raw.citationIds.entries()) {
      if (!citationIds.has(cid)) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "missing_citation",
            instancePath: `${instancePath}/citationIds/${i}`,
            message: `citationId ${cid} is not in citations[]`,
            params: { reasonCode: "missing_citation", citationId: cid },
          }),
        );
      }
    }
  }
  if (raw.coverage != null && raw.coverage !== "" && !COVERAGE_SET.has(raw.coverage)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: `${instancePath}/coverage`,
        message: `coverage must be one of ${COVERAGE_STATES.join("|")}`,
      }),
    );
  }
  if (raw.reasonCode != null && raw.reasonCode !== "" && !REASON_SET.has(raw.reasonCode)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: `${instancePath}/reasonCode`,
        message: `reasonCode must be one of ${REASON_CODES.join("|")}`,
      }),
    );
  }
  let operation = null;
  if (raw.operation != null) {
    const checked = validateOperation(raw.operation, `${instancePath}/operation`);
    issues.push(...checked.issues);
    operation = checked.operation;
  }
  const status = asStatus(issues);
  return {
    ok: status === "ok",
    status,
    issues,
    item: status === "invalid"
      ? null
      : {
          id: id.value,
          kind: raw.kind,
          subject: subject.value,
          operation,
          oldRef: isPlainObject(raw.oldRef) ? raw.oldRef : null,
          newRef: isPlainObject(raw.newRef) ? raw.newRef : null,
          citationIds: Array.isArray(raw.citationIds) ? [...raw.citationIds] : [],
          coverage: raw.coverage || null,
          reasonCode: raw.reasonCode || null,
        },
  };
}

export function validateOutput(raw) {
  const issues = [];
  if (!isPlainObject(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        instancePath: "",
        message: "output must be a plain object",
      }),
    );
    return { ok: false, status: "invalid", issues, output: null };
  }
  if (raw.schema !== OUTPUT_SCHEMA) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "const",
        instancePath: "/schema",
        message: `schema must be ${OUTPUT_SCHEMA}`,
        params: { allowed: OUTPUT_SCHEMA },
      }),
    );
  }
  if (raw.packetSchema != null && raw.packetSchema !== PACKET_SCHEMA) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "const",
        instancePath: "/packetSchema",
        message: `packetSchema must be ${PACKET_SCHEMA}`,
      }),
    );
  }
  if (raw.jobId != null && raw.jobId !== JOB_ID) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "const",
        instancePath: "/jobId",
        message: `jobId must be ${JOB_ID}`,
      }),
    );
  }
  if (raw.artifactKind != null && raw.artifactKind !== ARTIFACT_KIND) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "const",
        instancePath: "/artifactKind",
        message: `artifactKind must be ${ARTIFACT_KIND}`,
      }),
    );
  }
  const clock = normalizeClock(raw.clock);
  issues.push(...clock.issues);
  if (!EVIDENCE_SET.has(raw.evidenceClass)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: "/evidenceClass",
        message: `evidenceClass must be one of ${EVIDENCE_CLASSES.join("|")}`,
      }),
    );
  }
  if (raw.offline !== true) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "const",
        instancePath: "/offline",
        message: "offline must be true",
      }),
    );
  }
  if (raw.payment?.attempted !== false) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "paid_endpoint",
        instancePath: "/payment/attempted",
        message: "payment.attempted must be false",
        params: { reasonCode: "paid_endpoint" },
      }),
    );
  }
  if (raw.cost?.assignmentSpendUsd !== 0) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "paid_endpoint",
        instancePath: "/cost/assignmentSpendUsd",
        message: "cost.assignmentSpendUsd must be 0",
        params: { reasonCode: "paid_endpoint" },
      }),
    );
  }
  if (!DECISION_SET.has(raw.decision)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: "/decision",
        message: `decision must be one of ${DECISIONS.join("|")}`,
      }),
    );
  }
  if (!COVERAGE_SET.has(raw.coverage)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: "/coverage",
        message: `coverage must be one of ${COVERAGE_STATES.join("|")}`,
      }),
    );
  }
  const claims = validateClaims(raw.claims);
  issues.push(...claims.issues);
  const citList = validateList(raw.citations, "/citations");
  const findingList = validateList(raw.findings, "/findings");
  const itemList = validateList(raw.checklist, "/checklist");
  const sourceList = validateList(raw.sources, "/sources");
  const limitList = validateList(raw.limitations, "/limitations");
  issues.push(...citList.issues, ...findingList.issues, ...itemList.issues, ...sourceList.issues, ...limitList.issues);

  const citations = [];
  const citationIds = new Set();
  if (citList.list) {
    for (const [i, row] of citList.list.entries()) {
      const checked = validateCitation(row, `/citations/${i}`);
      issues.push(...checked.issues);
      if (checked.citation?.id) {
        citationIds.add(checked.citation.id);
        citations.push(checked.citation);
      }
    }
  }
  const findings = [];
  if (findingList.list) {
    for (const [i, row] of findingList.list.entries()) {
      const checked = validateFinding(row, citationIds, `/findings/${i}`);
      issues.push(...checked.issues);
      if (checked.finding) findings.push(checked.finding);
    }
  }
  const checklist = [];
  if (itemList.list) {
    for (const [i, row] of itemList.list.entries()) {
      const checked = validateChecklistItem(row, citationIds, `/checklist/${i}`);
      issues.push(...checked.issues);
      if (checked.item) checklist.push(checked.item);
    }
  }
  if (raw.decision === "pass" && (raw.coverage === "conflict" || checklist.some((row) => row.kind === "conflict"))) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "conflicting_source",
        instancePath: "/decision",
        message: "decision pass is incompatible with conflict coverage or conflict checklist rows",
        params: { reasonCode: "conflicting_source" },
      }),
    );
  }
  if (raw.decision === "pass" && (raw.coverage === "missing" || raw.coverage === "partial")) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "partial_coverage",
        instancePath: "/decision",
        message: "decision pass is incompatible with missing or partial coverage",
        params: { reasonCode: "partial_coverage" },
      }),
    );
  }
  const status = asStatus(issues);
  return {
    ok: status === "ok",
    status,
    issues,
    output: status === "invalid"
      ? null
      : {
          schema: OUTPUT_SCHEMA,
          packetSchema: PACKET_SCHEMA,
          jobId: JOB_ID,
          artifactKind: ARTIFACT_KIND,
          clock: clock.clock,
          evidenceClass: raw.evidenceClass,
          offline: true,
          payment: { attempted: false },
          cost: {
            assignmentSpendUsd: 0,
            note: raw.cost?.note || "offline transform; no purchase; do not invent demand",
          },
          sources: sourceList.list ? [...sourceList.list] : [],
          findings,
          citations,
          decision: raw.decision,
          limitations: limitList.list ? [...limitList.list] : [...BASELINE_LIMITATIONS],
          claims: claims.claims,
          checklist,
          coverage: raw.coverage,
          sourcePin: raw.sourcePin ?? null,
        },
  };
}

export function outputShell({
  clock,
  evidenceClass = "synthetic",
  citations = [],
  limitations = [],
  sourcePin = null,
} = {}) {
  const envelope = createEnvelope({
    jobId: JOB_ID,
    artifactKind: ARTIFACT_KIND,
    clock,
    evidenceClass,
    decision: "unknown",
    limitations: [...BASELINE_LIMITATIONS, ...limitations],
    citations,
  });
  return {
    ...envelope,
    schema: OUTPUT_SCHEMA,
    packetSchema: PACKET_SCHEMA,
    checklist: [],
    coverage: "missing",
    sourcePin,
  };
}

export function assertPinnedSources() {
  const issues = [];
  for (const [rel, expected] of Object.entries(PINNED_SOURCE_HASHES)) {
    const digest = digestPath(join(REPO_ROOT, rel));
    if (digest.missing) {
      issues.push({ path: rel, expected, actual: null, code: "missing_source" });
    } else if (digest.sha256 !== expected) {
      issues.push({ path: rel, expected, actual: digest.sha256, code: "conflicting_source" });
    }
  }
  return issues;
}

export function assertFieldCatalogCited() {
  const missing = [];
  const groups = [
    INPUT_FIELDS,
    OUTPUT_FIELDS,
    DOC_FIELDS,
    OPERATION_FIELDS,
    CITATION_FIELDS,
    FINDING_FIELDS,
    CHECKLIST_ITEM_FIELDS,
    SOURCE_PIN_FIELDS,
    STATE_INVENTORY_FIELDS,
  ];
  for (const group of groups) {
    for (const row of group) {
      if (!row.citationIds?.length) missing.push(row.name);
      for (const id of row.citationIds || []) {
        if (!CITATION_BY_ID.has(id)) missing.push(`${row.name}:${id}`);
      }
    }
  }
  return missing;
}

function fixtureSha(label) {
  return sha256Hex(label);
}

export function casePositive() {
  const oldSha = fixtureSha("old-readme");
  const newSha = fixtureSha("new-readme");
  return {
    schema: INPUT_SCHEMA,
    clock: "2026-09-10T00:00:00Z",
    evidenceClass: "synthetic",
    sourcePin: {
      repository: "epistemedeus/x402-url-extractor",
      ref: "1a23b648e3c5f90bc009accb85972e2db6e22051",
    },
    stateInventory: {
      path: "experiments/s137-consumer-evidence-jobs/docs/OWNED-JOBS-01-06.json",
      sha256: PINNED_SOURCE_HASHES["experiments/s137-consumer-evidence-jobs/docs/OWNED-JOBS-01-06.json"],
    },
    oldDocs: [
      { id: "readme", side: "old", path: "README.md", sha256: oldSha, license: "MIT" },
    ],
    newDocs: [
      { id: "readme", side: "new", path: "README.md", sha256: newSha, license: "MIT" },
    ],
    operations: [
      { method: "GET", route: "/extract", operationId: "extractWebPage" },
    ],
    citations: [
      { id: "old-readme", source: "README.md", path: "README.md", sha256: oldSha, license: "MIT" },
      { id: "new-readme", source: "README.md", path: "README.md", sha256: newSha, license: "MIT" },
    ],
    claims: {
      inventsFacts: false,
      paidEndpoint: false,
      legalAttestation: false,
      modelAsOracle: false,
      assertsCustomerDemand: false,
    },
  };
}

export function caseNegativeMissingClock() {
  const base = casePositive();
  delete base.clock;
  return base;
}

export function caseNegativeInventedClock() {
  return { ...casePositive(), clock: "now" };
}

export function caseNegativePaidClaim() {
  return {
    ...casePositive(),
    claims: {
      inventsFacts: false,
      paidEndpoint: true,
      legalAttestation: false,
      modelAsOracle: false,
      assertsCustomerDemand: false,
    },
  };
}

export function casePartialOneSide() {
  const base = casePositive();
  return { ...base, newDocs: [] };
}

export function caseConflictDuplicateDoc() {
  const base = casePositive();
  return {
    ...base,
    oldDocs: [base.oldDocs[0], { ...base.oldDocs[0], sha256: fixtureSha("other") }],
  };
}

export function caseConflictRoutePath() {
  const base = casePositive();
  return {
    ...base,
    operations: [{ method: "GET", route: "/extract", path: "/read", operationId: "extractWebPage" }],
  };
}

export function selfCheck() {
  const pinIssues = assertPinnedSources();
  const uncited = assertFieldCatalogCited();
  const positive = validateInput(casePositive());
  const missingClock = validateInput(caseNegativeMissingClock());
  const inventedClock = validateInput(caseNegativeInventedClock());
  const paid = validateInput(caseNegativePaidClaim());
  const partial = validateInput(casePartialOneSide());
  const conflictDoc = validateInput(caseConflictDuplicateDoc());
  const conflictOp = validateInput(caseConflictRoutePath());
  const findingBare = validateFinding({ message: "uncited" }, new Set());
  const shell = outputShell({ clock: "2026-09-10T00:00:00Z" });
  const outputOk = validateOutput({
    ...shell,
    coverage: "complete",
    decision: "unknown",
    citations: casePositive().citations,
    findings: [
      {
        id: "f1",
        code: "partial_coverage",
        message: "schema does not parse doc bodies",
        citationIds: ["old-readme"],
      },
    ],
    checklist: [
      {
        id: "row-1",
        kind: "changed",
        subject: "GET /extract",
        citationIds: ["old-readme", "new-readme"],
        coverage: "complete",
      },
    ],
  });
  const outputPassOnConflict = validateOutput({
    ...shell,
    coverage: "conflict",
    decision: "pass",
    citations: casePositive().citations,
    findings: [{ message: "x", citationIds: ["old-readme"] }],
    checklist: [
      { id: "row-c", kind: "conflict", subject: "GET /extract", citationIds: ["old-readme"] },
    ],
  });

  const failures = [];
  if (pinIssues.length) failures.push({ name: "pinned-sources", pinIssues });
  if (uncited.length) failures.push({ name: "uncited-fields", uncited });
  if (!(positive.ok && positive.coverage === "complete")) failures.push({ name: "positive", positive });
  if (!(missingClock.status === "invalid" && missingClock.issues.some((row) => row.instancePath === "/clock"))) {
    failures.push({ name: "negative-clock", missingClock });
  }
  if (!inventedClock.issues.some((row) => row.code === "invented_clock")) {
    failures.push({ name: "negative-now", inventedClock });
  }
  if (!paid.issues.some((row) => row.code === "paid_endpoint")) {
    failures.push({ name: "negative-paid", paid });
  }
  if (!(partial.coverage === "partial" && partial.status === "unknown")) {
    failures.push({ name: "partial", partial });
  }
  if (conflictDoc.coverage !== "conflict") failures.push({ name: "conflict-doc", conflictDoc });
  if (conflictOp.coverage !== "conflict") failures.push({ name: "conflict-op", conflictOp });
  if (findingBare.status !== "invalid") failures.push({ name: "finding-uncited", findingBare });
  if (!outputOk.ok) failures.push({ name: "output-ok", outputOk });
  if (outputPassOnConflict.status !== "invalid") {
    failures.push({ name: "output-pass-on-conflict", outputPassOnConflict });
  }
  return { ok: failures.length === 0, failures };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (process.argv.includes("--self-check")) {
    const result = selfCheck();
    process.stdout.write(`${JSON.stringify({ ok: result.ok, failures: result.failures.length }, null, 2)}\n`);
    process.exit(result.ok ? 0 : 1);
  }
  process.stdout.write(
    `${JSON.stringify({
      jobId: JOB_ID,
      inputSchema: INPUT_SCHEMA,
      outputSchema: OUTPUT_SCHEMA,
      packetSchema: PACKET_SCHEMA,
      fields: {
        input: INPUT_FIELDS.map((row) => row.name),
        output: OUTPUT_FIELDS.map((row) => row.name),
      },
      citations: CITATIONS.map((row) => ({ id: row.id, path: row.path, sha256: row.sha256 })),
    }, null, 2)}\n`,
  );
}
