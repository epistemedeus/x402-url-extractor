import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DECISIONS, EVIDENCE_CLASSES, requireCitedFinding } from "../../../src/packet.mjs";
import { sha256File } from "./hash.mjs";
import {
  ARTIFACT_KIND,
  CASE_SCHEMA,
  FIXTURE_ROOT,
  JOB_ID,
  LANES,
  absFromRel,
  clock,
  loadCase,
  loadManifest,
  loadProvenance,
  loadSource,
  loadSourcePins,
  observeCase,
} from "./load.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");

function tagAgreement(obs) {
  if (!obs.lanes.announced.present || !obs.lanes.shipped.present) return null;
  return obs.lanes.announced.tag_name === obs.lanes.shipped.tag_name;
}

function shaAgreement(obs) {
  const shas = [];
  if (obs.lanes.announced.present && obs.lanes.announced.target_commitish) {
    shas.push(obs.lanes.announced.target_commitish);
  }
  if (obs.lanes.shipped.present && obs.lanes.shipped.objectSha) {
    shas.push(obs.lanes.shipped.objectSha);
  }
  if (obs.lanes.tested.present && obs.lanes.tested.head_sha) {
    shas.push(obs.lanes.tested.head_sha);
  }
  if (shas.length < 2) return null;
  return shas.every((sha) => sha === shas[0]);
}

test("manifest lists required cases, kinds, and job identity", () => {
  const manifest = loadManifest();
  assert.equal(manifest.label, "synthetic");
  assert.equal(manifest.evidenceClass, "synthetic");
  assert.equal(manifest.liveCapture ?? false, false);
  assert.equal(manifest.jobId, JOB_ID);
  assert.equal(manifest.artifactKind, ARTIFACT_KIND);
  assert.equal(manifest.clock, clock());
  assert.equal(manifest.offline, true);
  assert.equal(manifest.payment.attempted, false);
  assert.equal(manifest.cost.assignmentSpendUsd, 0);
  assert.deepEqual(manifest.requiredKinds, ["positive", "negative", "partial", "conflict"]);
  assert.deepEqual(manifest.lanes, [...LANES]);
  assert.deepEqual(manifest.decisionVocab, [...DECISIONS]);
  assert.ok(manifest.requiredCaseIds.length >= 4);
});

test("every required case file exists with synthetic envelope fields", () => {
  const manifest = loadManifest();
  const kinds = new Set();
  for (const id of manifest.requiredCaseIds) {
    const spec = loadCase(id);
    kinds.add(spec.caseClass);
    assert.equal(spec.schema, CASE_SCHEMA);
    assert.equal(spec.id, id);
    assert.equal(spec.jobId, JOB_ID);
    assert.equal(spec.artifactKind, ARTIFACT_KIND);
    assert.equal(spec.label, "synthetic");
    assert.equal(spec.evidenceClass, "synthetic");
    assert.equal(spec.clock, clock());
    assert.equal(spec.payment.attempted, false);
    assert.equal(spec.cost.assignmentSpendUsd, 0);
    assert.equal(spec.claims.inventsFacts, false);
    assert.equal(spec.claims.paidEndpoint, false);
    assert.equal(spec.claims.legalAttestation, false);
    assert.equal(spec.claims.modelAsOracle, false);
    assert.equal(spec.claims.assertsCustomerDemand, false);
    assert.ok(DECISIONS.includes(spec.expect.decision), spec.id);
    assert.ok(manifest.requiredKinds.includes(spec.caseClass), spec.caseClass);
  }
  for (const kind of manifest.requiredKinds) {
    assert.ok(kinds.has(kind), `missing caseClass ${kind}`);
  }
});

test("findings cite citationIds; citation sha256 matches source bytes", () => {
  const manifest = loadManifest();
  for (const id of manifest.requiredCaseIds) {
    const spec = loadCase(id);
    assert.ok(spec.findings.length > 0, id);
    assert.ok(spec.citations.length > 0, id);
    const byId = new Map(spec.citations.map((c) => [c.id, c]));
    for (const item of spec.findings) {
      requireCitedFinding(item);
      for (const cid of item.citationIds) {
        assert.ok(byId.has(cid), `${id} missing citation ${cid}`);
      }
    }
    for (const cit of spec.citations) {
      assert.equal(cit.evidenceClass, "synthetic");
      assert.equal(typeof cit.path, "string");
      assert.equal(cit.sha256, loadSource(cit.path).sha256, cit.path);
      assert.ok(existsSync(join(FIXTURE_ROOT, cit.path)), cit.path);
    }
  }
});

test("lane documents stay separate and labelled", () => {
  const manifest = loadManifest();
  for (const id of manifest.requiredCaseIds) {
    const spec = loadCase(id);
    for (const lane of LANES) {
      const rel = spec.lanes[lane];
      if (!rel) {
        assert.equal(spec.expect.laneCoverage[lane], false, `${id} ${lane}`);
        continue;
      }
      assert.equal(spec.expect.laneCoverage[lane], true, `${id} ${lane}`);
      const { doc } = loadSource(rel);
      assert.equal(doc.lane, lane, rel);
      assert.equal(doc.evidenceClass, "synthetic", rel);
      assert.equal(doc.clock, clock(), rel);
      if (lane === "announced") {
        assert.ok(Object.prototype.hasOwnProperty.call(doc, "tag_name"), rel);
        assert.ok(Object.prototype.hasOwnProperty.call(doc, "draft"), rel);
        assert.equal(Object.prototype.hasOwnProperty.call(doc, "conclusion"), false, rel);
        assert.equal(Object.prototype.hasOwnProperty.call(doc, "object"), false, rel);
      }
      if (lane === "shipped") {
        assert.equal(typeof doc.object?.sha, "string", rel);
        assert.equal(Object.prototype.hasOwnProperty.call(doc, "draft"), false, rel);
        assert.equal(Object.prototype.hasOwnProperty.call(doc, "conclusion"), false, rel);
      }
      if (lane === "tested") {
        assert.equal(typeof doc.head_sha, "string", rel);
        assert.equal(typeof doc.conclusion, "string", rel);
        assert.equal(Object.prototype.hasOwnProperty.call(doc, "draft"), false, rel);
        assert.equal(Object.prototype.hasOwnProperty.call(doc, "tag_name"), false, rel);
      }
    }
  }
});

test("observable disagreements match catalog expect", () => {
  const manifest = loadManifest();
  for (const id of manifest.requiredCaseIds) {
    const spec = loadCase(id);
    const obs = observeCase(spec);
    assert.equal(tagAgreement(obs), spec.expect.tagAgreement, `${id} tagAgreement`);
    assert.equal(shaAgreement(obs), spec.expect.shaAgreement, `${id} shaAgreement`);
    const codes = obs.disagreements.map((d) => d.code).sort();
    assert.deepEqual(codes, [...spec.expect.disagreementCodes].sort(), `${id} disagreements`);
    for (const lane of LANES) {
      assert.equal(obs.lanes[lane].present, spec.expect.laneCoverage[lane], `${id} ${lane}`);
    }
  }
});

test("positive case aligns published tag, SHA, and CI success", () => {
  const spec = loadCase("positive-aligned");
  const obs = observeCase(spec);
  assert.equal(spec.expect.decision, "pass");
  assert.equal(obs.presentCount, 3);
  assert.equal(obs.lanes.announced.draft, false);
  assert.equal(typeof obs.lanes.announced.published_at, "string");
  assert.equal(obs.lanes.announced.tag_name, "v1.2.0");
  assert.equal(obs.lanes.shipped.tag_name, "v1.2.0");
  assert.equal(obs.lanes.tested.conclusion, "success");
  assert.equal(obs.disagreements.length, 0);
});

test("negative cases have no published three-lane release", () => {
  const empty = loadCase("negative-empty");
  const emptyObs = observeCase(empty);
  assert.equal(empty.expect.decision, "unknown");
  assert.equal(empty.input.sources.length, 0);
  assert.equal(emptyObs.presentCount, 0);

  const draft = loadCase("negative-draft-only");
  const draftObs = observeCase(draft);
  assert.equal(draft.expect.decision, "fail");
  assert.equal(draftObs.lanes.announced.draft, true);
  assert.equal(draftObs.lanes.announced.published_at, null);
  assert.equal(draftObs.lanes.shipped.present, false);
  assert.equal(draftObs.lanes.tested.present, false);
  assert.ok(draftObs.disagreements.some((d) => d.code === "unpublished_draft"));
  assert.ok(draft.findings.some((f) => f.code === "draft_not_shipped"));
});

test("partial cases leave at least one lane absent", () => {
  for (const id of ["partial-missing-tested", "partial-announced-only", "partial-shipped-no-announce"]) {
    const spec = loadCase(id);
    const obs = observeCase(spec);
    assert.equal(spec.expect.decision, "partial", id);
    assert.ok(obs.presentCount > 0 && obs.presentCount < 3, id);
    const codes = obs.disagreements.map((d) => d.code).filter((c) => c !== "unpublished_draft");
    assert.deepEqual(codes, [], id);
  }
});

test("case input documents keep planes separate with identity and payload", () => {
  const kinds = {
    announced: "github-release-notes",
    shipped: "git-tag",
    tested: "ci-log",
  };
  const roles = {
    announced: "claimed",
    shipped: "observed",
    tested: "observed",
  };
  const manifest = loadManifest();
  for (const id of manifest.requiredCaseIds) {
    const spec = loadCase(id);
    assert.equal(spec.input.schema, "s137.release-brief.input.v1");
    assert.equal(spec.input.clock, clock());
    assert.equal(spec.input.evidenceClass, "synthetic");
    assert.ok(Array.isArray(spec.input.sources));
    for (const source of spec.input.sources) {
      const plane = source.plane;
      assert.ok(LANES.includes(plane), `${id} ${source.id}`);
      assert.equal(source.lane, plane);
      assert.equal(source.kind, kinds[plane]);
      assert.equal(source.identity.role, roles[plane]);
      assert.equal(source.sha256, loadSource(source.path).sha256);
      assert.equal(source.contentSha256, source.sha256);
      if (plane === "announced") {
        assert.equal(Object.hasOwn(source.payload, "conclusion"), false);
        assert.equal(Object.hasOwn(source.payload, "head_sha"), false);
        assert.equal(Object.hasOwn(source.payload, "object"), false);
      }
      if (plane === "shipped") {
        assert.equal(Object.hasOwn(source.payload, "body"), false);
        assert.equal(Object.hasOwn(source.payload, "draft"), false);
        assert.equal(Object.hasOwn(source.payload, "conclusion"), false);
      }
      if (plane === "tested") {
        assert.equal(Object.hasOwn(source.payload, "body"), false);
        assert.equal(Object.hasOwn(source.payload, "tag_name"), false);
        assert.equal(Object.hasOwn(source.payload, "draft"), false);
      }
    }
  }
});

test("conflict cases keep disagreeing facts instead of merging them", () => {
  const tag = observeCase(loadCase("conflict-tag-mismatch"));
  assert.equal(loadCase("conflict-tag-mismatch").expect.decision, "conflict");
  assert.equal(tag.lanes.announced.tag_name, "v1.2.0");
  assert.equal(tag.lanes.shipped.tag_name, "v1.1.9");
  assert.ok(tag.disagreements.some((d) => d.code === "tag_mismatch"));

  const sha = observeCase(loadCase("conflict-sha-mismatch"));
  assert.equal(sha.lanes.announced.tag_name, sha.lanes.shipped.tag_name);
  assert.notEqual(sha.lanes.announced.target_commitish, sha.lanes.shipped.objectSha);
  assert.ok(sha.disagreements.some((d) => d.code === "sha_mismatch"));

  const ci = observeCase(loadCase("conflict-ci-vs-announce"));
  assert.match(ci.lanes.announced.body, /All tests passed/);
  assert.equal(ci.lanes.tested.conclusion, "failure");
  assert.ok(ci.disagreements.some((d) => d.code === "ci_vs_announce"));
  assert.ok(loadCase("conflict-ci-vs-announce").findings.some((f) => f.status === "conflict"));
});

test("SOURCE-PINS excerpts still appear in pinned repo paths", () => {
  const pins = loadSourcePins();
  assert.equal(pins.evidenceClass, "synthetic");
  for (const pin of pins.pins) {
    const abs = join(REPO_ROOT, pin.repoPath);
    assert.ok(existsSync(abs), pin.repoPath);
    const text = readFileSync(abs, "utf8");
    assert.ok(text.includes(pin.excerpt), `${pin.id} missing from ${pin.repoPath}`);
  }
});

test("PROVENANCE labels synthetic and hashes match listed files", () => {
  const provenance = loadProvenance();
  assert.equal(provenance.label, "synthetic");
  assert.equal(provenance.evidenceClass, "synthetic");
  assert.equal(provenance.liveCapture, false);
  assert.equal(provenance.paidDemand, false);
  assert.equal(provenance.retrievedAt, clock());
  assert.equal(provenance.url, null);
  assert.deepEqual(provenance.originalUrls, {});
  assert.equal(typeof provenance.licenseNote, "string");
  assert.ok(provenance.licenseNote.length > 0);
  assert.equal(provenance.payment.attempted, false);
  const listed = Object.keys(provenance.files);
  assert.ok(listed.includes("MANIFEST.json"));
  assert.ok(listed.includes("cases/positive-aligned.json"));
  assert.ok(listed.includes("sources/positive-aligned/announced.json"));
  for (const [rel, meta] of Object.entries(provenance.files)) {
    const abs = absFromRel(rel);
    assert.ok(existsSync(abs), rel);
    assert.equal(meta.label, "synthetic");
    assert.equal(meta.sha256, sha256File(abs), rel);
    assert.equal(meta.bytes, readFileSync(abs).length, rel);
  }
});

test("fixtures do not claim live-capture or paid endpoints", () => {
  const manifest = loadManifest();
  assert.ok(EVIDENCE_CLASSES.includes("synthetic"));
  for (const id of manifest.requiredCaseIds) {
    const spec = loadCase(id);
    const blob = JSON.stringify(spec);
    assert.equal(spec.evidenceClass, "synthetic");
    assert.doesNotMatch(blob, /"live-capture"/);
    assert.doesNotMatch(blob, /https:\/\/api\.github\.com/);
  }
});
