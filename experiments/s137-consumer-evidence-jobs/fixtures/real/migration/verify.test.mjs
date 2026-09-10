import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { requireCitedFinding } from "../../../src/packet.mjs";
import { validateInput } from "../../../src/migration-checklist/schema.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, "../../../../..");

function loadJson(name) {
  return JSON.parse(readFileSync(join(dir, name), "utf8"));
}

function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function resolveSource(rel) {
  if (rel.startsWith("experiments/")) return join(repoRoot, rel);
  return join(dir, rel);
}

function sourceText(rel) {
  return readFileSync(resolveSource(rel), "utf8");
}

const provenance = loadJson("PROVENANCE.json");
const input = loadJson("input.json");
const observations = loadJson("observations.json");

test("provenance has retrievedAt, urls, hashes, license note", () => {
  assert.equal(provenance.evidenceClass, "fixture");
  assert.equal(provenance.offline, true);
  assert.equal(provenance.paidEndpoint, false);
  assert.equal(provenance.legalAttestation, false);
  assert.equal(provenance.retrievedAt, "2026-09-10T11:24:43Z");
  assert.notEqual(provenance.retrievedAt, provenance.sourceCommitDate);
  assert.equal(provenance.license.spdx, "Apache-2.0");
  assert.match(provenance.license.note, /not a license opinion/i);
  assert.ok(Array.isArray(provenance.artifacts));
  assert.equal(provenance.artifacts.length, 7);
  for (const art of provenance.artifacts) {
    assert.ok(art.url.startsWith("https://"), art.id);
    assert.equal(art.retrievedAt, provenance.retrievedAt);
    assert.match(art.sha256, /^[0-9a-f]{64}$/);
    assert.equal(art.httpStatus, 200);
  }
});

test("captured bytes match recorded sha256", () => {
  for (const art of provenance.artifacts) {
    const abs = join(repoRoot, art.path);
    assert.equal(sha256File(abs), art.sha256, art.id);
    assert.equal(readFileSync(abs).length, art.bytes, art.id);
  }
});

test("old and new docs are distinct protocol versions", () => {
  const oldSpec = sourceText("source/old/x402-specification-v1.md");
  const newSpec = sourceText("source/new/x402-specification-v2.md");
  assert.match(oldSpec, /\*\*Protocol Version\*\*: 1/);
  assert.match(newSpec, /\*\*Protocol Version\*\*: 2/);
  assert.notEqual(
    provenance.artifacts.find((a) => a.id === "old-spec").sha256,
    provenance.artifacts.find((a) => a.id === "new-spec").sha256,
  );
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
});

test("negative: finding without citationIds is refused", () => {
  assert.throws(
    () => requireCitedFinding({ id: "uncited", kind: "positive" }),
    /citationId/,
  );
});

test("citation quotes appear in the named source file", () => {
  const cites = [...input.citations, ...observations.citations];
  for (const c of cites) {
    const text = sourceText(c.path);
    assert.equal(createHash("sha256").update(text).digest("hex"), c.sha256, c.id);
    if (!c.quote) continue;
    const collapsed = text.replace(/\s+/g, " ");
    const collapsedNeedle = c.quote.replace(/\s+/g, " ");
    assert.ok(
      collapsed.includes(collapsedNeedle) || text.includes(c.quote),
      `quote not in ${c.path} for ${c.id}: ${collapsedNeedle.slice(0, 80)}`,
    );
  }
});

test("caller operations are sourced from old docs only and cited", () => {
  assert.ok(input.operations.length >= 4);
  const citeIds = new Set(input.citations.map((c) => c.id));
  for (const op of input.operations) {
    requireCitedFinding(op);
    assert.equal(op.observedIn, "old", op.id);
    assert.match(op.method, /^(GET|POST)$/);
    assert.match(op.route, /^\//);
    for (const id of op.citationIds) assert.ok(citeIds.has(id), id);
  }
});

test("c01 validateInput accepts the real fixture (STATE omitted => unknown/partial)", () => {
  const result = validateInput(input);
  assert.notEqual(result.status, "invalid", JSON.stringify(result.issues, null, 2));
  assert.equal(result.coverage, "partial");
  assert.ok(result.issues.some((row) => row.code === "missing_source"));
  assert.equal(result.input.oldDocs.length, 2);
  assert.equal(result.input.newDocs.length, 2);
  assert.equal(result.input.operations.length, 4);
});

test("conflict: v1 spec X-PAYMENT error vs v1 HTTP JSON body", () => {
  const spec = sourceText("source/old/x402-specification-v1.md");
  const http = sourceText("source/old/http-transport.md");
  assert.match(spec, /X-PAYMENT header is required/);
  assert.match(http, /JSON response body/);
  assert.doesNotMatch(http, /PAYMENT-REQUIRED/);
  const finding = observations.findings.find((f) => f.id === "conflict-v1-payment-required-location");
  assert.equal(finding.kind, "conflict");
  assert.equal(finding.citationIds.length, 2);
});

test("partial: v2 points at uncaptured schemes and bazaar specs", () => {
  const newSpec = sourceText("source/new/x402-specification-v2.md");
  assert.match(newSpec, /specs\/schemes\//);
  assert.match(newSpec, /specs\/extensions\/bazaar\.md/);
  assert.ok(provenance.notCaptured.includes("specs/schemes/**"));
  assert.ok(provenance.notCaptured.some((p) => p.includes("extensions")));
});

test("LICENSE and NOTICE match Apache-2.0 note", () => {
  const license = sourceText("source/license/LICENSE");
  const notice = sourceText("source/license/NOTICE");
  assert.match(license, /Apache License/);
  assert.match(notice, /Copyright 2026 x402 Foundation/);
  assert.match(notice, /Apache-2.0 License/);
});
