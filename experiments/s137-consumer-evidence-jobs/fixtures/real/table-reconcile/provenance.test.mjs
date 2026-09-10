import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const dir = dirname(fileURLToPath(import.meta.url));
const packRoot = join(dir, "../../..");

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function csvFromRange(doc) {
  const lines = ["package,day,downloads,unit"];
  for (const row of doc.downloads) {
    lines.push(`${doc.package},${row.day},${row.downloads},count`);
  }
  return lines.join("\n") + "\n";
}

function parseCsv(text) {
  const [header, ...rows] = text.trimEnd().split("\n");
  assert.equal(header, "package,day,downloads,unit");
  return rows.map((line) => {
    const [pkg, day, downloads, unit] = line.split(",");
    return { package: pkg, day, downloads: Number(downloads), unit };
  });
}

const provenance = loadJson(join(dir, "PROVENANCE.json"));
const pair = loadJson(join(dir, "pair.json"));
const rangeA = loadJson(join(dir, "sources/npm-downloads-range-a.json"));
const rangeB = loadJson(join(dir, "sources/npm-downloads-range-b.json"));

test("PROVENANCE has retrievedAt, url, sha256, and license note", () => {
  assert.equal(provenance.cell, "c14");
  assert.equal(provenance.jobId, "R2-CONSUMER-JOBS-03");
  assert.equal(provenance.evidenceClass, "fixture");
  assert.equal(provenance.captureLabel, "live-capture");
  assert.match(provenance.retrievedAt, /^2026-09-10T11:22:45/);
  assert.match(provenance.licenseNote, /not a license grant/i);
  assert.match(provenance.licenseNote, /legal attestation/i);
  const a = provenance.artifacts["sources/npm-downloads-range-a.json"];
  const b = provenance.artifacts["sources/npm-downloads-range-b.json"];
  assert.equal(a.url, "https://api.npmjs.org/downloads/range/2026-08-01:2026-08-14/express");
  assert.equal(b.url, "https://api.npmjs.org/downloads/range/2026-08-08:2026-08-21/express");
  assert.equal(a.sha256.length, 64);
  assert.equal(b.sha256.length, 64);
  assert.equal(a.retrievedAt, provenance.retrievedAt);
  assert.equal(b.retrievedAt, provenance.retrievedAt);
});

test("artifact sha256 and byte lengths match stored files", () => {
  for (const [rel, meta] of Object.entries(provenance.artifacts)) {
    const path = join(dir, rel);
    const buf = readFileSync(path);
    assert.equal(sha256File(path), meta.sha256, rel);
    assert.equal(buf.byteLength, meta.bytes, rel);
  }
});

test("CSV slices are a lossless projection of captured JSON", () => {
  const csvA = readFileSync(
    join(dir, "tables/express-downloads-2026-08-01-2026-08-14.csv"),
    "utf8",
  );
  const csvB = readFileSync(
    join(dir, "tables/express-downloads-2026-08-08-2026-08-21.csv"),
    "utf8",
  );
  assert.equal(csvA, csvFromRange(rangeA));
  assert.equal(csvB, csvFromRange(rangeB));
  assert.equal(rangeA.package, "express");
  assert.equal(rangeB.package, "express");
  assert.equal(rangeA.start, "2026-08-01");
  assert.equal(rangeA.end, "2026-08-14");
  assert.equal(rangeB.start, "2026-08-08");
  assert.equal(rangeB.end, "2026-08-21");
  assert.equal(parseCsv(csvA).length, 14);
  assert.equal(parseCsv(csvB).length, 14);
});

test("positive: overlapping keys agree; negative: exclusive days exist", () => {
  const mapA = new Map(rangeA.downloads.map((r) => [r.day, r.downloads]));
  const mapB = new Map(rangeB.downloads.map((r) => [r.day, r.downloads]));
  const overlap = [...mapA.keys()].filter((d) => mapB.has(d));
  const onlyA = [...mapA.keys()].filter((d) => !mapB.has(d));
  const onlyB = [...mapB.keys()].filter((d) => !mapA.has(d));
  assert.equal(overlap.length, 7);
  assert.equal(onlyA.length, 7);
  assert.equal(onlyB.length, 7);
  for (const day of overlap) {
    assert.equal(mapA.get(day), mapB.get(day), day);
  }
  assert.equal(mapA.get("2026-08-14"), 0);
  assert.equal(mapB.get("2026-08-14"), 0);
});

test("pair findings cover positive, negative, partial, conflict and cite sources", () => {
  const kinds = new Set(pair.findings.map((f) => f.kind));
  assert.deepEqual([...kinds].sort(), ["conflict", "negative", "partial", "positive"]);
  const citeIds = new Set(pair.citations.map((c) => c.id));
  for (const finding of pair.findings) {
    assert.ok(finding.citationIds?.length > 0, finding.id);
    for (const id of finding.citationIds) {
      assert.ok(citeIds.has(id), `${finding.id} -> ${id}`);
    }
  }
  for (const c of pair.citations) {
    assert.equal(c.sha256.length, 64);
    assert.ok(c.path, c.id);
    const abs = join(packRoot, c.path);
    assert.equal(sha256File(abs), c.sha256, c.id);
  }
  assert.equal(
    pair.citations.find((c) => c.id === "cite-range-a").url,
    provenance.artifacts["sources/npm-downloads-range-a.json"].url,
  );
});

test("partial coverage is 7 of 21 union days; no invented union total", () => {
  const partial = pair.findings.find((f) => f.id === "partial-window-coverage");
  assert.equal(partial.unionDayCount, 21);
  assert.equal(partial.intersectionDayCount, 7);
  assert.equal(partial.onlyInACount + partial.onlyInBCount + partial.intersectionDayCount, 21);
  const blob = JSON.stringify(pair);
  assert.equal("unionTotal" in pair, false);
  assert.equal("overlapTotal" in pair, false);
  assert.doesNotMatch(blob, /unionTotal|overlapTotal|inventedTotal/);
  const conflict = pair.findings.find((f) => f.kind === "conflict");
  assert.deepEqual(conflict.sameKeyValueDisagreements, []);
  assert.equal(conflict.doubleCountHazardDays.length, 7);
});

test("sanitized headers omit cookies; docs state inclusive dates", () => {
  const ha = readFileSync(join(dir, "sources/npm-downloads-range-a.headers.txt"), "utf8");
  const hb = readFileSync(join(dir, "sources/npm-downloads-range-b.headers.txt"), "utf8");
  assert.doesNotMatch(ha, /set-cookie/i);
  assert.doesNotMatch(hb, /set-cookie/i);
  assert.match(ha, /HTTP\/2 200/);
  assert.match(hb, /HTTP\/2 200/);
  const docs = readFileSync(join(dir, "sources/npm-download-counts.md"), "utf8");
  assert.match(docs, /start and end dates are inclusive/i);
  assert.match(docs, /api\.npmjs\.org\/downloads\/range/);
});

test("claims remain offline and non-inventing", () => {
  assert.equal(pair.claims.inventsFacts, false);
  assert.equal(pair.claims.paidEndpoint, false);
  assert.equal(pair.claims.legalAttestation, false);
  assert.equal(pair.claims.modelAsOracle, false);
  assert.equal(pair.claims.assertsCustomerDemand, false);
  assert.equal(pair.offline, true);
  assert.equal(pair.payment.attempted, false);
  assert.equal(pair.cost.assignmentSpendUsd, 0);
});
