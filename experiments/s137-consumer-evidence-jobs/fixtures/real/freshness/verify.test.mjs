import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { requireCitedFinding } from "../../../src/packet.mjs";
import {
  JOB_ID,
  classifyTimeField,
  validateInput,
  validateProvenance,
} from "../../../src/freshness-receipt/schema.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, "../../../../..");

function loadJson(name) {
  return JSON.parse(readFileSync(join(dir, name), "utf8"));
}

function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function isoSecondFromUnix(unix) {
  return new Date(Number(unix) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const provenance = loadJson("PROVENANCE.json");
const input = loadJson("input.json");
const observations = loadJson("observations.json");
const slim = loadJson("slim.json");
const headers = loadJson("http-headers.json");
const view = loadJson("nyc-311-erm2-nwe9.view.json");

test("provenance has retrievedAt, url, sha256, license note", () => {
  const result = validateProvenance(provenance);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(provenance.cell, "c29");
  assert.equal(provenance.jobId, JOB_ID);
  assert.equal(provenance.evidenceClass, "fixture");
  assert.equal(provenance.offline, true);
  assert.equal(provenance.paidEndpoint, false);
  assert.equal(provenance.legalAttestation, false);
  assert.equal(provenance.payment.attempted, false);
  assert.equal(provenance.url, "https://data.cityofnewyork.us/api/views/erm2-nwe9.json");
  assert.equal(provenance.retrievedAt, "2026-09-10T11:24:14Z");
  assert.match(provenance.sha256, /^[0-9a-f]{64}$/);
  assert.match(provenance.licenseNote, /not a license grant/i);
  assert.notEqual(provenance.retrievedAt, provenance.sourceUpdatedAt);
});

test("captured bytes match recorded sha256", () => {
  assert.equal(provenance.artifacts.length, 4);
  for (const art of provenance.artifacts) {
    const abs = join(repoRoot, art.path);
    assert.equal(sha256File(abs), art.sha256, art.id);
    assert.equal(readFileSync(abs).length, art.bytes, art.id);
    assert.equal(art.retrievedAt, provenance.retrievedAt);
    assert.ok(art.url.startsWith("https://"), art.id);
  }
  for (const [key, art] of Object.entries(provenance.derived)) {
    const abs = join(repoRoot, art.path);
    assert.equal(sha256File(abs), art.sha256, key);
    assert.equal(readFileSync(abs).length, art.bytes, key);
  }
});

test("download time is HTTP Date, not rowsUpdatedAt or viewLastModified", () => {
  const raw = readFileSync(join(dir, "http-headers.raw.txt"), "latin1");
  assert.match(raw, /Date: Thu, 10 Sep 2026 11:24:14 GMT/);
  assert.equal(raw.includes("Last-Modified"), false);
  assert.equal(headers.headers.Date, "Thu, 10 Sep 2026 11:24:14 GMT");
  assert.equal(headers.lastModifiedPresent, false);
  assert.equal(slim.clocks.retrievedAt, provenance.retrievedAt);
  assert.equal(slim.clocks.httpDateHeader, headers.headers.Date);
  assert.equal(isoSecondFromUnix(view.rowsUpdatedAt), slim.clocks.rowsUpdatedAt);
  assert.equal(isoSecondFromUnix(view.viewLastModified), slim.clocks.viewLastModified);
  assert.equal(isoSecondFromUnix(view.createdAt), slim.clocks.createdAt);
  assert.equal(slim.clocks.rowsUpdatedAt, "2026-09-10T01:38:08Z");
  assert.equal(slim.clocks.viewLastModified, "2025-12-29T15:25:00Z");
  assert.notEqual(slim.clocks.retrievedAt, slim.clocks.rowsUpdatedAt);
  assert.notEqual(slim.clocks.retrievedAt, slim.clocks.viewLastModified);
  assert.notEqual(slim.clocks.rowsUpdatedAt, slim.clocks.viewLastModified);
});

test("positive/negative/partial/conflict observations all present and cited", () => {
  const kinds = new Set(observations.findings.map((f) => f.kind));
  for (const k of ["positive", "negative", "partial", "conflict"]) {
    assert.ok(kinds.has(k), k);
  }
  const citeIds = new Set(observations.citations.map((c) => c.id));
  for (const finding of observations.findings) {
    requireCitedFinding(finding);
    for (const id of finding.citationIds) {
      assert.ok(citeIds.has(id), `${finding.id} missing ${id}`);
    }
  }
  for (const c of observations.citations) {
    assert.ok(c.path || c.url, c.id);
    assert.equal(c.sha256, c.contentSha256);
    assert.equal(sha256File(join(repoRoot, c.path)), c.sha256, c.id);
  }
});

test("negative: finding without citationIds is refused", () => {
  assert.throws(
    () => requireCitedFinding({ id: "uncited", kind: "positive", text: "no cite" }),
    /citationId/,
  );
});

test("partial: license keys and column stats are absent in the source JSON", () => {
  assert.equal("license" in view, false);
  assert.equal("licenseId" in view, false);
  assert.equal("attributionLink" in view, false);
  assert.equal("data" in view, false);
  assert.equal("rowCount" in view, false);
  assert.equal(view.columns.length, 48);
  assert.equal(view.columns.filter((c) => c.cachedContents != null).length, 0);
  assert.equal(slim.coverage.licenseKeyPresent, false);
  assert.equal(slim.coverage.includesRowPayload, false);
  assert.equal(slim.coverage.columnsWithCachedContents, 0);
});

test("conflict: row clock, catalog clock, and Daily frequency disagree", () => {
  assert.equal(view.metadata.custom_fields.Update["Update Frequency"], "Daily");
  assert.match(view.description, /updated daily/);
  assert.ok(view.rowsUpdatedAt > view.viewLastModified);
  const conflict = observations.findings.find((f) => f.kind === "conflict");
  assert.ok(conflict);
  assert.match(conflict.text, /rowsUpdatedAt/);
  assert.match(conflict.text, /viewLastModified/);
});

test("input packet: retrievedAt ≠ sourceUpdatedAt and c26 validateInput passes", () => {
  const ds = input.datasets[0];
  assert.equal(input.schema, "s137.freshness-receipt.input.v1");
  assert.equal(input.evidenceClass, "fixture");
  assert.equal(input.offline, true);
  assert.equal(input.payment.attempted, false);
  assert.equal(ds.retrievedAt, provenance.retrievedAt);
  assert.equal(ds.sourceUpdatedAt, provenance.sourceUpdatedAt);
  assert.equal(ds.sourceUpdatedAtNativeField, "rowsUpdatedAt");
  assert.notEqual(ds.retrievedAt, ds.sourceUpdatedAt);
  assert.equal(classifyTimeField("retrievedAt"), "download");
  assert.equal(classifyTimeField("sourceUpdatedAt"), "source-update");
  assert.equal(classifyTimeField("createdAt"), "unknown");
  assert.equal(classifyTimeField("Date"), "http-date");
  const result = validateInput(input);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.decision, "pass");
  assert.equal(result.datasets[0].timesDistinct, true);
  assert.equal(result.datasets[0].coverage.time, "full");
  assert.equal(result.datasets[0].downloadedAt.field, "retrievedAt");
  assert.equal(result.datasets[0].sourceUpdatedAt.field, "sourceUpdatedAt");
  assert.ok(result.datasets[0].lagAtDownloadMs > 0);
});

test("field map does not treat HTTP Date or createdAt as source-update", () => {
  const byNative = Object.fromEntries(slim.fieldMap.map((m) => [m.nativeField, m]));
  assert.equal(byNative.Date.kind, "download");
  assert.equal(byNative.rowsUpdatedAt.kind, "source-update");
  assert.equal(byNative.viewLastModified.kind, "source-update");
  assert.equal(byNative.createdAt.kind, "unknown");
  assert.equal(byNative["Last-Modified"].present, false);
  assert.equal(view.id, "erm2-nwe9");
  assert.equal(view.name, "311 Service Requests from 2020 to Present");
  assert.equal(view.provenance, "official");
});
