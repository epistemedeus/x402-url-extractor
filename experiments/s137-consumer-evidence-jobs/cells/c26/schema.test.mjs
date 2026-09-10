import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ARTIFACT_KIND,
  EXAMPLE_CASES,
  FIELD_VOCABULARY,
  INPUT_SCHEMA_ID,
  JOB_ID,
  LIMITATIONS,
  PROVENANCE_REQUIRED,
  RECEIPT_SCHEMA_ID,
  SCHEMA_FIELD_CITATIONS,
  ageMs,
  agesFor,
  classifyTimeField,
  createFreshnessEnvelope,
  lagAtDownloadMs,
  parseIsoInstant,
  pickDecision,
  sha256Text,
  timeCoverage,
  validateFinding,
  validateInput,
  validateProvenance,
  validateReceipt,
} from "../../src/freshness-receipt/schema.mjs";

const PACK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = join(PACK_ROOT, "../..");

function hashRepoFile(relPath) {
  const abs = join(REPO_ROOT, relPath);
  const buf = readFileSync(abs);
  return { path: relPath, contentSha256: sha256Text(buf), bytes: buf.length };
}

const PACKET_CITE = hashRepoFile("experiments/s137-consumer-evidence-jobs/src/packet.mjs");
const DRIFT_CITE = hashRepoFile("discovery-drift.mjs");
const DRIFT_DOC_CITE = hashRepoFile("docs/discovery-drift.md");

const LOCAL_CITATIONS = [
  { id: "packet-envelope", path: PACKET_CITE.path, contentSha256: PACKET_CITE.contentSha256 },
  { id: "discovery-drift-freshness", path: DRIFT_CITE.path, contentSha256: DRIFT_CITE.contentSha256 },
  { id: "discovery-drift-doc", path: DRIFT_DOC_CITE.path, contentSha256: DRIFT_DOC_CITE.contentSha256 },
  ...SCHEMA_FIELD_CITATIONS.filter(
    (c) => !["packet-envelope", "discovery-drift-freshness", "discovery-drift-doc"].includes(c.id),
  ),
];

test("pinned local citation hashes match files on disk", () => {
  assert.equal(PACKET_CITE.bytes, 1929);
  assert.equal(
    PACKET_CITE.contentSha256,
    "6f6f4116ba2b91adb43a19108d6e2f1609bae8f722594158ccac0abf16abe012",
  );
  assert.equal(
    DRIFT_CITE.contentSha256,
    "95b83c48779d6b16dd0d31e426e6c05293a1e33a1db64cb7e7d794644357c431",
  );
  assert.equal(
    DRIFT_DOC_CITE.contentSha256,
    "9e39132931262540fb5453d42d97d4edbc0f0e63cd8d59662b736c66391635d8",
  );
});

test("time-kind vocabulary: download fields are not source-update fields", () => {
  for (const field of FIELD_VOCABULARY.download) {
    assert.equal(classifyTimeField(field), "download", field);
  }
  for (const field of [
    "sourceUpdatedAt",
    "published_at",
    "publishedAt",
    "lastUpdated",
    "catalogLastUpdated",
    "time.modified",
    "Last-Modified",
    "lastModified",
    "time.8.4.2",
    "time.6.3.0",
  ]) {
    assert.equal(classifyTimeField(field), "source-update", field);
  }
  assert.equal(classifyTimeField("time.created"), "source-created");
  assert.equal(classifyTimeField("Date"), "http-date");
  assert.equal(classifyTimeField("mtime"), "filesystem-mtime");
  assert.equal(classifyTimeField("clock"), "operator-clock");
  assert.equal(classifyTimeField("now"), "operator-clock");
  for (const field of ["createdAt", "updatedAt", "Age", "etag", ""]) {
    assert.equal(classifyTimeField(field), "unknown", field);
  }
  const download = new Set(FIELD_VOCABULARY.download.map((f) => f.toLowerCase()));
  const source = new Set(
    FIELD_VOCABULARY["source-update"].filter((f) => !f.includes("<")).map((f) => f.toLowerCase()),
  );
  for (const key of download) assert.equal(source.has(key), false);
});

test("positive: retrievedAt ≠ time.modified; ages use matching slots only", () => {
  const input = {
    ...EXAMPLE_CASES.positive,
    citations: LOCAL_CITATIONS,
  };
  const result = validateInput(input);
  assert.equal(result.ok, true);
  assert.equal(result.decision, "pass");
  assert.equal(result.datasets.length, 1);
  const ds = result.datasets[0];
  assert.equal(ds.downloadedAt.field, "retrievedAt");
  assert.equal(ds.downloadedAt.kind, "download");
  assert.equal(ds.sourceUpdatedAt.field, "time.modified");
  assert.equal(ds.sourceUpdatedAt.kind, "source-update");
  assert.equal(ds.timesDistinct, true);
  assert.equal(ds.coverage.time, "full");
  assert.notEqual(ds.downloadedAt.value, ds.sourceUpdatedAt.value);
  assert.equal(ds.downloadAgeMs, ageMs(result.clock.ms, ds.downloadedAt.ms));
  assert.equal(ds.sourceAgeMs, ageMs(result.clock.ms, ds.sourceUpdatedAt.ms));
  assert.notEqual(ds.downloadAgeMs, ds.sourceAgeMs);
  assert.equal(ds.lagAtDownloadMs, lagAtDownloadMs(ds.downloadedAt.ms, ds.sourceUpdatedAt.ms));
  assert.ok(ds.lagAtDownloadMs > 0);
  assert.equal(ds.disposition, "unknown");
  assert.ok(ds.downloadedAt.citationId);
  assert.ok(ds.sourceUpdatedAt.citationId);
});

test("positive receipt: cited findings and matching ages", () => {
  const input = { ...EXAMPLE_CASES.positive, citations: LOCAL_CITATIONS };
  const normalized = validateInput(input);
  const ds = normalized.datasets[0];
  const findings = [
    {
      id: "times-distinct",
      polarity: "positive",
      datasetId: ds.id,
      code: "download_ne_source_update",
      message: "retrievedAt is download time; time.modified is source-update time",
      citationIds: ["s127-c11-retrievedAt", "s127-packument-slim"],
    },
  ];
  const envelope = createFreshnessEnvelope({
    clock: input.clock,
    evidenceClass: "fixture",
    decision: "pass",
    citations: LOCAL_CITATIONS,
    findings,
  });
  const receipt = {
    ...envelope,
    schema: RECEIPT_SCHEMA_ID,
    jobId: JOB_ID,
    artifactKind: ARTIFACT_KIND,
    datasets: [
      {
        id: ds.id,
        locator: input.datasets[0].locator,
        downloadedAt: ds.downloadedAt,
        sourceUpdatedAt: ds.sourceUpdatedAt,
        downloadAgeMs: ds.downloadAgeMs,
        sourceAgeMs: ds.sourceAgeMs,
        lagAtDownloadMs: ds.lagAtDownloadMs,
        timesDistinct: true,
        coverage: ds.coverage,
        disposition: ds.disposition,
      },
    ],
  };
  const check = validateReceipt(receipt);
  assert.equal(check.ok, true, JSON.stringify(check.issues, null, 2));
  assert.equal(receipt.payment.attempted, false);
  assert.equal(receipt.claims.inventsFacts, false);
  assert.ok(LIMITATIONS.length > 0);
});

test("negative: operator clock 'now' is refused", () => {
  const result = validateInput({
    ...EXAMPLE_CASES.negative,
    citations: LOCAL_CITATIONS,
  });
  assert.equal(result.ok, false);
  assert.equal(result.decision, "fail");
  assert.ok(result.issues.some((i) => i.code === "now_refused" || i.code === "invalid_iso" || i.message.includes("now")));
});

test("negative: receipt cannot put retrievedAt in the source-update slot", () => {
  const slot = {
    value: "2026-09-10T10:46:44Z",
    field: "retrievedAt",
    kind: "download",
    citationId: "s127-c11-retrievedAt",
    ms: Date.parse("2026-09-10T10:46:44Z"),
  };
  const receipt = {
    schema: RECEIPT_SCHEMA_ID,
    jobId: JOB_ID,
    clock: "2026-09-10T10:48:00Z",
    evidenceClass: "fixture",
    decision: "pass",
    payment: { attempted: false },
    claims: { inventsFacts: false },
    citations: LOCAL_CITATIONS,
    findings: [
      {
        id: "bad",
        polarity: "negative",
        code: "conflation",
        message: "should fail validation",
        citationIds: ["s127-c11-retrievedAt"],
      },
    ],
    datasets: [
      {
        id: "conflated",
        downloadedAt: slot,
        sourceUpdatedAt: { ...slot, kind: "source-update" },
        downloadAgeMs: 76000,
        sourceAgeMs: 76000,
        lagAtDownloadMs: 0,
        timesDistinct: true,
      },
    ],
  };
  const check = validateReceipt(receipt);
  assert.equal(check.ok, false);
  assert.ok(check.issues.some((i) => i.code === "time_kind_conflation"));
});

test("negative: sourceAgeMs must not be filled from download time", () => {
  const downloadedAt = {
    value: "2026-09-10T10:46:44Z",
    field: "retrievedAt",
    kind: "download",
    citationId: "s127-c11-retrievedAt",
    ms: Date.parse("2026-09-10T10:46:44Z"),
  };
  const sourceUpdatedAt = {
    value: "2026-04-01T21:17:05.330Z",
    field: "time.modified",
    kind: "source-update",
    citationId: "s127-packument-slim",
    ms: Date.parse("2026-04-01T21:17:05.330Z"),
  };
  const clock = "2026-09-10T10:48:00Z";
  const expected = agesFor({ clock, downloadedAt, sourceUpdatedAt });
  const receipt = {
    schema: RECEIPT_SCHEMA_ID,
    jobId: JOB_ID,
    clock,
    evidenceClass: "fixture",
    decision: "pass",
    payment: { attempted: false },
    claims: { inventsFacts: false },
    citations: LOCAL_CITATIONS,
    findings: [
      {
        id: "ages",
        polarity: "negative",
        code: "age_swap",
        message: "swapped ages",
        citationIds: ["s127-c11-retrievedAt"],
      },
    ],
    datasets: [
      {
        id: "swapped",
        downloadedAt,
        sourceUpdatedAt,
        downloadAgeMs: expected.downloadAgeMs,
        sourceAgeMs: expected.downloadAgeMs,
        lagAtDownloadMs: expected.lagAtDownloadMs,
        timesDistinct: true,
      },
    ],
  };
  const check = validateReceipt(receipt);
  assert.equal(check.ok, false);
  assert.ok(check.issues.some((i) => i.code === "age_mismatch" && i.instancePath.endsWith("sourceAgeMs")));
});

test("negative: finding without citationIds is invalid", () => {
  const r = validateFinding({ id: "x", message: "uncited" }, new Set(["packet-envelope"]));
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "citationIds"));
});

test("negative: HTTP Date, mtime, time.created, and clock do not fill source-update", () => {
  const result = validateInput({
    schema: INPUT_SCHEMA_ID,
    clock: "2026-09-10T10:48:00Z",
    evidenceClass: "synthetic",
    datasets: [
      {
        id: "not-source-update",
        locator: { path: "discovery-drift.mjs" },
        times: [
          { field: "Date", value: "2026-09-10T10:47:00Z", citationId: "discovery-drift-freshness" },
          { field: "mtime", value: "2026-09-01T00:00:00Z", citationId: "discovery-drift-freshness" },
          { field: "time.created", value: "2012-08-01T22:49:08.434Z", citationId: "s127-packument-slim" },
          { field: "clock", value: "2026-09-10T10:48:00Z", citationId: "packet-envelope" },
        ],
      },
    ],
    citations: LOCAL_CITATIONS,
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "unknown");
  assert.equal(result.datasets[0].sourceUpdatedAt, null);
  assert.equal(result.datasets[0].downloadedAt, null);
  assert.equal(result.datasets[0].coverage.time, "none");
  assert.equal(result.datasets[0].others.length, 4);
});

test("partial: capturedAtUtc without published_at leaves sourceAgeMs null", () => {
  const result = validateInput({
    ...EXAMPLE_CASES.partial,
    citations: LOCAL_CITATIONS,
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "partial");
  const ds = result.datasets[0];
  assert.equal(ds.coverage.downloadTime, "present");
  assert.equal(ds.coverage.sourceUpdateTime, "absent");
  assert.equal(ds.coverage.time, "partial");
  assert.equal(ds.sourceUpdatedAt, null);
  assert.equal(ds.sourceAgeMs, null);
  assert.equal(ds.lagAtDownloadMs, null);
  assert.equal(ds.timesDistinct, false);
  assert.equal(ds.downloadedAt.field, "capturedAtUtc");
  assert.equal(timeCoverage(true, false), "partial");
});

test("conflict: npm time.modified disagrees with time.8.4.2 as source-update", () => {
  const result = validateInput({
    ...EXAMPLE_CASES.conflict,
    citations: LOCAL_CITATIONS,
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "conflict");
  assert.ok(result.issues.some((i) => i.code === "conflicting_timestamps"));
  const ds = result.datasets[0];
  assert.equal(ds.sourceUpdatedAt, null);
  assert.equal(ds.downloadedAt.field, "retrievedAt");
  const values = result.issues.find((i) => i.code === "conflicting_timestamps").params.values;
  assert.equal(values.length, 2);
  assert.notEqual(values[0].value, values[1].value);
});

test("conflict: source-update after download is chronological disagreement", () => {
  const result = validateInput({
    schema: INPUT_SCHEMA_ID,
    clock: "2026-09-10T10:48:00Z",
    evidenceClass: "synthetic",
    datasets: [
      {
        id: "update-after-download",
        locator: { path: "discovery-drift.mjs" },
        times: [
          { field: "retrievedAt", value: "2026-09-10T10:00:00Z", citationId: "packet-envelope" },
          { field: "lastUpdated", value: "2026-09-10T10:30:00Z", citationId: "discovery-drift-freshness" },
        ],
      },
    ],
    citations: LOCAL_CITATIONS,
  });
  assert.equal(result.decision, "conflict");
  assert.ok(result.issues.some((i) => i.code === "source_update_after_download"));
  assert.ok(result.datasets[0].lagAtDownloadMs < 0);
});

test("unknown: future source-update versus clock does not become current", () => {
  const result = validateInput({
    schema: INPUT_SCHEMA_ID,
    clock: "2026-09-10T10:48:00Z",
    evidenceClass: "synthetic",
    horizonMs: 60_000,
    datasets: [
      {
        id: "future",
        locator: { path: "docs/discovery-drift.md" },
        times: [
          { field: "retrievedAt", value: "2026-09-10T10:46:44Z", citationId: "packet-envelope" },
          { field: "lastUpdated", value: "2026-09-11T00:00:00Z", citationId: "discovery-drift-doc" },
        ],
      },
    ],
    citations: LOCAL_CITATIONS,
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "unknown");
  assert.equal(result.datasets[0].sourceAgeMs, null);
  assert.equal(result.datasets[0].disposition, "unknown");
  assert.ok(result.issues.some((i) => i.code === "future_timestamp"));
});

test("horizonMs classifies source age only; does not use download age", () => {
  const clock = "2026-09-10T10:48:00Z";
  const base = {
    schema: INPUT_SCHEMA_ID,
    clock,
    evidenceClass: "fixture",
    datasets: [
      {
        id: "horizon",
        locator: { path: "discovery-drift.mjs" },
        times: [
          { field: "catalogObservedAt", value: "2026-09-10T10:47:00Z", citationId: "discovery-drift-freshness" },
          { field: "catalogLastUpdated", value: "2026-09-10T10:40:00Z", citationId: "discovery-drift-freshness" },
        ],
      },
    ],
    citations: LOCAL_CITATIONS,
  };
  const stale = validateInput({ ...base, horizonMs: 60_000 });
  assert.equal(stale.datasets[0].disposition, "stale");
  const current = validateInput({ ...base, horizonMs: 20 * 60_000 });
  assert.equal(current.datasets[0].disposition, "current");
  const noHorizon = validateInput(base);
  assert.equal(noHorizon.datasets[0].disposition, "unknown");
  assert.ok(stale.datasets[0].sourceAgeMs > stale.datasets[0].downloadAgeMs);
});

test("equal instants still require distinct fields; same field in both slots fails", () => {
  const result = validateInput({
    schema: INPUT_SCHEMA_ID,
    clock: "2026-09-10T10:48:00Z",
    evidenceClass: "synthetic",
    datasets: [
      {
        id: "equal-values",
        locator: { path: "experiments/s137-consumer-evidence-jobs/src/packet.mjs" },
        times: [
          { field: "retrievedAt", value: "2026-09-10T10:46:44Z", citationId: "packet-envelope" },
          { field: "published_at", value: "2026-09-10T10:46:44Z", citationId: "s122-provenance" },
        ],
      },
    ],
    citations: LOCAL_CITATIONS,
  });
  assert.equal(result.decision, "pass");
  assert.equal(result.datasets[0].downloadedAt.value, result.datasets[0].sourceUpdatedAt.value);
  assert.equal(result.datasets[0].timesDistinct, true);
  assert.notEqual(result.datasets[0].downloadedAt.field, result.datasets[0].sourceUpdatedAt.field);
});

test("PROVENANCE shape: retrievedAt is download time and is not copied to sourceUpdatedAt", () => {
  assert.deepEqual([...PROVENANCE_REQUIRED], ["retrievedAt", "url", "sha256", "licenseNote"]);
  const ok = validateProvenance({
    retrievedAt: "2026-09-10T10:46:44Z",
    url: "https://registry.npmjs.org/path-to-regexp",
    sha256: PACKET_CITE.contentSha256,
    licenseNote: "npm registry metadata; follow npm terms; package license separately",
    sourceUpdatedAt: "2026-04-01T21:17:05.330Z",
    sourceUpdatedAtField: "time.modified",
    evidenceClass: "fixture",
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.issues));
  const copied = validateProvenance({
    retrievedAt: "2026-09-10T10:46:44Z",
    url: "https://registry.npmjs.org/path-to-regexp",
    sha256: PACKET_CITE.contentSha256,
    licenseNote: "npm registry metadata; follow npm terms; package license separately",
    sourceUpdatedAt: "2026-09-10T10:46:44Z",
    evidenceClass: "fixture",
  });
  assert.equal(copied.ok, false);
  assert.ok(copied.issues.some((i) => i.code === "time_kind_conflation"));
});

test("parseIsoInstant refuses blank and non-strings; pickDecision is worst-first", () => {
  assert.equal(parseIsoInstant("now").ok, false);
  assert.equal(parseIsoInstant("").ok, false);
  assert.equal(parseIsoInstant(1).ok, false);
  assert.equal(pickDecision(["pass", "partial", "conflict"]), "conflict");
  assert.equal(pickDecision(["pass", "unknown"]), "unknown");
  assert.equal(pickDecision(["pass", "partial"]), "partial");
  assert.equal(INPUT_SCHEMA_ID, "s137.freshness-receipt.input.v1");
  assert.equal(RECEIPT_SCHEMA_ID, "s137.freshness-receipt.v1");
  assert.equal(JOB_ID, "R2-CONSUMER-JOBS-06");
});

