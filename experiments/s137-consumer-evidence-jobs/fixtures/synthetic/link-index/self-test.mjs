import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DECISIONS, EVIDENCE_CLASSES, requireCitedFinding } from "../../../src/packet.mjs";
import {
  CASE_SCHEMA,
  CLOCK,
  EVIDENCE_CLASS,
  JOB_ID,
  MANIFEST_SCHEMA,
  REQUIRED_KINDS,
  deriveDecision,
  fixtureRoot,
  inventoryCase,
  listFixtureRelPaths,
  loadManifest,
  sha256,
} from "./catalog.mjs";

const ROOT = fixtureRoot();
const LINK_COMPARE_KEYS = [
  "href",
  "text",
  "syntax",
  "markup",
  "index",
  "targetStatus",
  "targetPath",
  "fragment",
  "refId",
  "resolved",
  "idCount",
];

function pick(link, keys) {
  const out = {};
  for (const key of keys) {
    if (link[key] !== undefined) out[key] = link[key];
  }
  return out;
}

test("manifest lists required kinds and stays offline", () => {
  const manifest = loadManifest();
  assert.equal(manifest.schema, MANIFEST_SCHEMA);
  assert.equal(manifest.jobId, JOB_ID);
  assert.equal(manifest.cell, "c18");
  assert.equal(manifest.evidenceClass, EVIDENCE_CLASS);
  assert.equal(manifest.clock, CLOCK);
  assert.equal(manifest.liveCapture, false);
  assert.equal(manifest.paidDemand, false);
  assert.equal(manifest.networkContacted, false);
  assert.equal(manifest.offline, true);
  assert.equal(manifest.payment.attempted, false);
  assert.deepEqual(manifest.kindsRequired, [...REQUIRED_KINDS]);
  assert.equal(readFileSync(join(ROOT, "CLOCK.txt"), "utf8").trim(), CLOCK);
  const clockCite = manifest.citations.find((c) => c.citationId === "CLOCK.txt");
  assert.equal(clockCite.sha256, sha256(readFileSync(join(ROOT, "CLOCK.txt"))));
});

test("positive, negative, partial, and conflict cases are present", () => {
  const manifest = loadManifest();
  const kinds = new Set();
  const decisions = new Set();
  for (const id of manifest.requiredCaseIds) {
    const { expected } = inventoryCase(id);
    kinds.add(expected.kind);
    decisions.add(expected.expectedDecision);
    assert.equal(expected.schema, CASE_SCHEMA);
    assert.equal(expected.jobId, JOB_ID);
    assert.equal(expected.evidenceClass, "synthetic");
    assert.equal(expected.clock, CLOCK);
    assert.equal(expected.offline, true);
    assert.equal(expected.payment.attempted, false);
    assert.equal(expected.claims.inventsFacts, false);
    assert.equal(expected.claims.paidEndpoint, false);
    assert.equal(expected.claims.legalAttestation, false);
    assert.equal(expected.claims.modelAsOracle, false);
    assert.equal(expected.claims.assertsCustomerDemand, false);
    assert.ok(DECISIONS.includes(expected.expectedDecision), expected.expectedDecision);
    assert.ok(EVIDENCE_CLASSES.includes(expected.evidenceClass));
  }
  for (const kind of REQUIRED_KINDS) assert.ok(kinds.has(kind), kind);
  for (const decision of ["pass", "fail", "partial", "conflict"]) {
    assert.ok(decisions.has(decision), decision);
  }
});

test("inventory scan matches declared links, anchors, and decision", () => {
  const manifest = loadManifest();
  for (const id of manifest.requiredCaseIds) {
    const inv = inventoryCase(id);
    const observed = inv.links.map((link) => pick(link, LINK_COMPARE_KEYS));
    const declared = inv.expected.links.map((link) => pick(link, LINK_COMPARE_KEYS));
    assert.deepEqual(observed, declared, id);
    assert.deepEqual(inv.anchors, inv.expected.anchors, `${id} anchors`);
    assert.equal(deriveDecision(inv), inv.expected.expectedDecision, id);
    for (const link of inv.expected.links) {
      assert.equal(inv.entrySource.slice(link.index, link.index + link.markup.length), link.markup, `${id} ${link.linkId}`);
    }
  }
});

test("every finding cites a hashed in-tree path", () => {
  const manifest = loadManifest();
  for (const id of manifest.requiredCaseIds) {
    const inv = inventoryCase(id);
    const citeById = new Map(inv.expected.citations.map((c) => [c.citationId, c]));
    assert.ok(inv.expected.findings.length > 0, id);
    for (const finding of inv.expected.findings) {
      requireCitedFinding(finding);
      for (const citationId of finding.citationIds) {
        const cite = citeById.get(citationId);
        assert.ok(cite, `${id} missing citation ${citationId}`);
        assert.equal(cite.evidenceClass, "synthetic");
        const abs = join(inv.dir, cite.path);
        assert.equal(existsSync(abs), true, abs);
        assert.equal(cite.sha256, sha256(readFileSync(abs)), cite.path);
      }
    }
  }
});

test("partial case keeps missing, external, and escaped targets unfetched", () => {
  const inv = inventoryCase("partial-mixed");
  assert.equal(existsSync(join(inv.dir, "artifacts/present.md")), true);
  assert.equal(existsSync(join(inv.dir, "artifacts/missing.md")), false);
  assert.equal(existsSync(join(inv.dir, "../outside.md")), false);
  const statuses = inv.expected.links.map((l) => l.targetStatus);
  assert.deepEqual(statuses, [
    "reachable",
    "unreachable-missing-file",
    "unreachable-missing-fragment",
    "unresolved-external",
    "unreachable-out-of-bound",
  ]);
  assert.equal(inv.expected.links[3].href, "https://example.invalid/never-fetched");
});

test("conflict cases record duplicate hrefs, conflicting text, and duplicate ids", () => {
  const dup = inventoryCase("conflict-duplicates");
  const textFinding = dup.expected.findings.find((f) => f.code === "conflicting-text-targets");
  assert.deepEqual(textFinding.hrefs, ["artifacts/alpha.md", "artifacts/beta.md"]);
  const hrefFinding = dup.expected.findings.find((f) => f.code === "duplicate-href");
  assert.equal(hrefFinding.count, 3);
  const ids = inventoryCase("conflict-duplicate-ids");
  assert.equal(ids.anchors.filter((a) => a.id === "install").length, 2);
  assert.equal(ids.links[0].targetStatus, "ambiguous-fragment");
});

test("negative empty file is zero bytes; malformed keeps only the empty href", () => {
  const empty = inventoryCase("negative-empty");
  assert.equal(statSync(empty.entryPath).size, 0);
  assert.equal(empty.links.length, 0);
  const malformed = inventoryCase("negative-malformed");
  assert.equal(malformed.links.length, 1);
  assert.equal(malformed.links[0].href, "");
  assert.equal(malformed.entrySource.includes("unterminated"), true);
  assert.equal(malformed.entrySource.includes("<a>no href</a>"), true);
});

test("PROVENANCE hashes authored files and is not live-capture", () => {
  const provenancePath = join(ROOT, "PROVENANCE.json");
  const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
  assert.equal(provenance.evidenceClass, "synthetic");
  assert.equal(provenance.label, "synthetic");
  assert.equal(provenance.retrievedAt, CLOCK);
  assert.equal(provenance.url, null);
  assert.equal(provenance.liveCapture, false);
  assert.equal(provenance.paidDemand, false);
  assert.equal(provenance.networkContacted, false);
  assert.match(provenance.license, /authored synthetic/i);
  const listed = Object.keys(provenance.files).sort();
  const walked = listFixtureRelPaths().sort();
  assert.deepEqual(listed, walked);
  for (const rel of walked) {
    const abs = join(ROOT, rel);
    assert.equal(provenance.files[rel].sha256, sha256(readFileSync(abs)), rel);
    assert.equal(provenance.files[rel].label, "synthetic");
  }
});
