/**
 * c10: R2-CONSUMER-JOBS-02 release evidence brief tests.
 * Positive / negative / partial / conflict + one real GitHub snapshot.
 * Offline. No network. No paid endpoints. No invented facts.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  ARTIFACT_KIND,
  BRIEF_SCHEMA,
  INPUT_SCHEMA,
  JOB_ID,
  PLANES,
  codesOf,
  impliedDecision,
  kindPlane,
  runCaseCatalog,
  schemaCases,
  sha256Hex,
  validateReleaseBrief,
  validateReleaseBriefInput,
} from "../src/release-brief/schema.mjs";
import {
  DECISIONS,
  EVIDENCE_CLASSES,
  PACKET_SCHEMA,
  requireCitedFinding,
} from "../src/packet.mjs";
import {
  FIXTURE_ROOT,
  LANES,
  clock as syntheticClock,
  loadManifest,
  observeCase,
} from "../fixtures/synthetic/release-brief/load.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, "..");
const TRANSFORM_PATH = join(PACK, "src/release-brief/transform.mjs");
const REAL_DIR = join(PACK, "fixtures/real/release-brief");
const REAL_JSON = join(REAL_DIR, "github-express-v5.2.1.json");
const REAL_HEADERS = join(REAL_DIR, "github-express-v5.2.1.headers.txt");
const REAL_PROVENANCE = join(REAL_DIR, "PROVENANCE.json");
const SHA1 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

const EXPECTED_DECISION = Object.freeze({
  "positive-aligned": "pass",
  // Empty sources are incomplete evidence → unknown (not a caller defect / not fail).
  "negative-empty": "unknown",
  "negative-draft-only": "fail",
  "partial-missing-tested": "partial",
  "partial-announced-only": "partial",
  "partial-shipped-no-announce": "partial",
  "conflict-tag-mismatch": "conflict",
  "conflict-sha-mismatch": "conflict",
  "conflict-ci-vs-announce": "conflict",
});

function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function stripV(tag) {
  if (typeof tag !== "string") return undefined;
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

function maybeSha(value) {
  return typeof value === "string" && SHA1.test(value) ? value.toLowerCase() : undefined;
}

function relFromPack(abs) {
  return abs.startsWith(`${PACK}/`) ? abs.slice(PACK.length + 1) : abs;
}

function fixtureSpec(id) {
  const lanes = {};
  for (const lane of LANES) {
    const rel = `sources/${id}/${lane}.json`;
    if (existsSync(join(FIXTURE_ROOT, rel))) lanes[lane] = rel;
  }
  if (id === "negative-empty") {
    return { id, kind: "negative", lanes: {}, notice: "sources/negative-empty/NOTICE.json" };
  }
  const kind = id.startsWith("positive")
    ? "positive"
    : id.startsWith("negative")
      ? "negative"
      : id.startsWith("partial")
        ? "partial"
        : "conflict";
  return { id, kind, lanes };
}

function sourceFromAnnounced(rel, doc, sha) {
  return {
    id: `announced:${rel}`,
    plane: "announced",
    kind: "github-release-notes",
    path: rel,
    contentSha256: sha,
    licenseNote: "synthetic fixture; not a live capture",
    identity: {
      role: "claimed",
      tag: doc.tag_name || undefined,
      version: stripV(doc.tag_name),
      commitSha: maybeSha(doc.target_commitish),
    },
    payload: {
      title: doc.name ?? undefined,
      body: doc.body ?? undefined,
      publishedAt: doc.published_at ?? undefined,
      draft: doc.draft,
      prerelease: doc.prerelease,
    },
  };
}

function sourceFromShipped(rel, doc, sha) {
  const commitSha = maybeSha(doc.object?.sha);
  return {
    id: `shipped:${rel}`,
    plane: "shipped",
    kind: "git-tag",
    path: rel,
    contentSha256: sha,
    licenseNote: "synthetic fixture; not a live capture",
    identity: {
      role: "observed",
      tag: doc.tag_name || undefined,
      version: stripV(doc.tag_name),
      commitSha,
    },
    payload: {
      targetCommitish: commitSha || doc.object?.sha || undefined,
    },
  };
}

function sourceFromTested(rel, doc, sha) {
  const passed = doc.conclusion === "success";
  return {
    id: `tested:${rel}`,
    plane: "tested",
    kind: "ci-log",
    path: rel,
    contentSha256: sha,
    licenseNote: "synthetic fixture; not a live capture",
    identity: {
      role: "observed",
      commitSha: maybeSha(doc.head_sha),
    },
    payload: {
      command: doc.name || "ci",
      passed,
      exitCode: passed ? 0 : 1,
    },
  };
}

function schemaInputFromSynthetic(id) {
  const spec = fixtureSpec(id);
  const sources = [];
  if (spec.lanes.announced) {
    const loaded = JSON.parse(readFileSync(join(FIXTURE_ROOT, spec.lanes.announced), "utf8"));
    sources.push(sourceFromAnnounced(
      `fixtures/synthetic/release-brief/${spec.lanes.announced}`,
      loaded,
      sha256File(join(FIXTURE_ROOT, spec.lanes.announced)),
    ));
  }
  if (spec.lanes.shipped) {
    const loaded = JSON.parse(readFileSync(join(FIXTURE_ROOT, spec.lanes.shipped), "utf8"));
    sources.push(sourceFromShipped(
      `fixtures/synthetic/release-brief/${spec.lanes.shipped}`,
      loaded,
      sha256File(join(FIXTURE_ROOT, spec.lanes.shipped)),
    ));
  }
  if (spec.lanes.tested) {
    const loaded = JSON.parse(readFileSync(join(FIXTURE_ROOT, spec.lanes.tested), "utf8"));
    sources.push(sourceFromTested(
      `fixtures/synthetic/release-brief/${spec.lanes.tested}`,
      loaded,
      sha256File(join(FIXTURE_ROOT, spec.lanes.tested)),
    ));
  }
  return {
    schema: INPUT_SCHEMA,
    clock: syntheticClock(),
    evidenceClass: "synthetic",
    jobId: JOB_ID,
    subject: { name: "demo-release-kit" },
    sources,
  };
}

function schemaInputFromReal() {
  const provenance = JSON.parse(readFileSync(REAL_PROVENANCE, "utf8"));
  const snapshot = JSON.parse(readFileSync(REAL_JSON, "utf8"));
  const sha = sha256File(REAL_JSON);
  const path = relFromPack(REAL_JSON);
  return {
    schema: INPUT_SCHEMA,
    clock: provenance.clock,
    evidenceClass: "fixture",
    jobId: JOB_ID,
    subject: { name: "express", tag: snapshot.tag_name },
    sources: [{
      id: "github-release-express-v5.2.1",
      kind: "github-release",
      url: provenance.url,
      path,
      contentSha256: sha,
      retrievedAt: provenance.retrievedAt,
      licenseNote: provenance.license.note,
      split: {
        announced: {
          identity: { role: "claimed", tag: snapshot.tag_name, version: stripV(snapshot.tag_name) },
          payload: {
            title: snapshot.name,
            body: snapshot.body,
            publishedAt: snapshot.published_at,
            draft: snapshot.draft,
            prerelease: snapshot.prerelease,
            htmlUrl: snapshot.html_url,
          },
        },
        shipped: {
          identity: { role: "observed", tag: snapshot.tag_name, version: stripV(snapshot.tag_name) },
          payload: {
            targetCommitish: snapshot.target_commitish,
            tarballUrl: snapshot.tarball_url,
            zipballUrl: snapshot.zipball_url,
          },
        },
      },
    }],
  };
}

function asBrief(result) {
  if (!result || typeof result !== "object") return result;
  if (result.brief && typeof result.brief === "object") return result.brief;
  if (result.packet && typeof result.packet === "object") return result.packet;
  return result;
}

function pickBuild(mod) {
  const names = [
    "buildReleaseBrief",
    "transformReleaseBrief",
    "toReleaseBrief",
    "buildBrief",
    "transform",
  ];
  for (const name of names) {
    if (typeof mod[name] === "function") return mod[name];
  }
  return null;
}

async function loadTransform() {
  if (!existsSync(TRANSFORM_PATH)) return { present: false, build: null, mod: null };
  const mod = await import(pathToFileURL(TRANSFORM_PATH).href);
  return { present: true, build: pickBuild(mod), mod };
}

function assertCited(brief) {
  assert.ok(Array.isArray(brief.citations), "citations[] required");
  const citationIds = new Set(brief.citations.map((row) => row.id));
  assert.ok(Array.isArray(brief.findings), "findings[] required");
  for (const finding of brief.findings) {
    requireCitedFinding(finding);
    for (const id of finding.citationIds) {
      assert.equal(citationIds.has(id), true, `dangling citationId ${id}`);
    }
  }
  for (const citation of brief.citations) {
    assert.ok(citation.path || citation.url, `citation ${citation.id} needs path or url`);
    const digest = citation.contentSha256 || citation.sha256;
    if (brief.evidenceClass === "fixture" || brief.evidenceClass === "live-capture") {
      assert.equal(SHA256.test(digest || ""), true, `citation ${citation.id} needs sha256`);
    }
  }
}

function assertEnvelope(brief) {
  assert.ok(brief.schema === BRIEF_SCHEMA || brief.schema === PACKET_SCHEMA);
  assert.equal(brief.jobId, JOB_ID);
  assert.equal(brief.offline, true);
  assert.equal(brief.payment?.attempted, false);
  assert.equal(brief.cost?.assignmentSpendUsd, 0);
  assert.equal(brief.claims?.inventsFacts, false);
  assert.equal(brief.claims?.paidEndpoint, false);
  assert.equal(brief.claims?.legalAttestation, false);
  assert.equal(brief.claims?.modelAsOracle, false);
  assert.equal(brief.claims?.assertsCustomerDemand, false);
  assert.equal(DECISIONS.includes(brief.decision), true);
  assert.equal(EVIDENCE_CLASSES.includes(brief.evidenceClass), true);
  assertCited(brief);
}

function assertPlanesSeparate(brief) {
  const announcedText = JSON.stringify(brief.announced || {});
  const shippedText = JSON.stringify(brief.shipped || {});
  const testedText = JSON.stringify(brief.tested || {});
  assert.equal(/"exitCode"|"passCount"|"failCount"/.test(announcedText), false);
  assert.equal(/"body"|"claimedFeatures"|"releaseNotes"/.test(shippedText), false);
  assert.equal(/"tarballUrl"|"distIntegrity"/.test(testedText), false);
}

test("schema catalog covers positive, negative, partial, conflict", () => {
  const kinds = new Set(schemaCases().map((row) => row.kind));
  for (const kind of ["positive", "negative", "partial", "conflict"]) {
    assert.equal(kinds.has(kind), true, `missing ${kind}`);
  }
  const results = runCaseCatalog();
  assert.deepEqual(results.filter((row) => !row.ok), []);
});

test("kind catalog binds announced/shipped/tested and refuses changelog-as-shipped", () => {
  assert.equal(kindPlane("changelog"), "announced");
  assert.equal(kindPlane("git-tag"), "shipped");
  assert.equal(kindPlane("test-receipt"), "tested");
  const bad = validateReleaseBriefInput({
    schema: INPUT_SCHEMA,
    clock: "2026-09-10T12:00:00.000Z",
    evidenceClass: "synthetic",
    sources: [{
      id: "bad",
      plane: "shipped",
      kind: "changelog",
      path: "synthetic://bad",
      identity: { role: "observed", tag: "v1.0.0" },
      payload: {},
    }],
  });
  assert.equal(bad.ok, false);
  assert.equal(codesOf(bad.issues).includes("kind_plane_mismatch"), true);
});

test("synthetic fixtures exist for required pos/neg/partial/conflict ids", () => {
  const manifest = loadManifest();
  assert.equal(manifest.evidenceClass, "synthetic");
  assert.equal(manifest.liveCapture, false);
  assert.equal(manifest.clock, syntheticClock());
  assert.deepEqual([...manifest.requiredKinds].sort(), ["conflict", "negative", "partial", "positive"]);
  for (const id of manifest.requiredCaseIds) {
    assert.equal(id in EXPECTED_DECISION, true, id);
    if (id === "negative-empty") {
      assert.equal(existsSync(join(FIXTURE_ROOT, "sources/negative-empty/NOTICE.json")), true);
      continue;
    }
    const spec = fixtureSpec(id);
    const present = LANES.filter((lane) => spec.lanes[lane]);
    if (id.startsWith("positive")) assert.equal(present.length, 3, id);
    if (id.startsWith("partial")) assert.ok(present.length < 3, id);
  }
});

test("observeCase: positive aligned, negatives, partials, conflicts", () => {
  const aligned = observeCase(fixtureSpec("positive-aligned"));
  assert.equal(aligned.presentCount, 3);
  assert.deepEqual(aligned.disagreements, []);
  assert.equal(aligned.lanes.announced.tag_name, aligned.lanes.shipped.tag_name);
  assert.equal(aligned.lanes.shipped.objectSha, aligned.lanes.tested.head_sha);
  assert.equal(aligned.lanes.tested.conclusion, "success");

  const empty = observeCase(fixtureSpec("negative-empty"));
  assert.equal(empty.presentCount, 0);

  const draft = observeCase(fixtureSpec("negative-draft-only"));
  assert.equal(draft.lanes.announced.draft, true);
  assert.equal(draft.lanes.announced.published_at, null);
  assert.ok(draft.disagreements.some((row) => row.code === "unpublished_draft"));

  const untested = observeCase(fixtureSpec("partial-missing-tested"));
  assert.equal(untested.lanes.tested.present, false);
  assert.equal(untested.lanes.announced.present, true);
  assert.equal(untested.lanes.shipped.present, true);

  const announcedOnly = observeCase(fixtureSpec("partial-announced-only"));
  assert.equal(announcedOnly.presentCount, 1);

  const shippedNoAnnounce = observeCase(fixtureSpec("partial-shipped-no-announce"));
  assert.equal(shippedNoAnnounce.lanes.announced.present, false);
  assert.equal(shippedNoAnnounce.lanes.shipped.present, true);

  const tag = observeCase(fixtureSpec("conflict-tag-mismatch"));
  assert.ok(tag.disagreements.some((row) => row.code === "tag_mismatch"));

  const sha = observeCase(fixtureSpec("conflict-sha-mismatch"));
  assert.ok(sha.disagreements.some((row) => row.code === "sha_mismatch"));

  const ci = observeCase(fixtureSpec("conflict-ci-vs-announce"));
  assert.ok(ci.disagreements.some((row) => row.code === "ci_vs_announce"));
  assert.match(ci.lanes.announced.body, /All tests passed/);
  assert.equal(ci.lanes.tested.conclusion, "failure");
});

test("fixture-derived schema inputs validate; implied decisions match catalog", () => {
  for (const [id, decision] of Object.entries(EXPECTED_DECISION)) {
    const input = schemaInputFromSynthetic(id);
    const got = validateReleaseBriefInput(input);
    assert.equal(got.ok, true, `${id}: ${codesOf(got.issues).join(",")}`);
    if (decision === "fail") continue;
    const stubBrief = {
      schema: BRIEF_SCHEMA,
      clock: input.clock,
      evidenceClass: "synthetic",
      announced: { items: [] },
      shipped: { items: [] },
      tested: { items: [] },
      findings: [{ id: "f", citationIds: input.sources[0] ? [input.sources[0].id] : ["empty"], message: "stub" }],
      citations: input.sources.map((source) => ({
        id: source.id,
        plane: source.plane,
        path: source.path,
        contentSha256: source.contentSha256,
      })),
    };
    if (input.sources.length === 0) {
      stubBrief.findings = [];
      stubBrief.citations = [];
    }
    for (const source of input.sources) {
      stubBrief[source.plane].items.push({
        identity: source.identity,
        payload: source.payload,
        citationIds: [source.id],
      });
    }
    const implied = impliedDecision(stubBrief);
    if (decision === "pass") assert.equal(implied, "pass", id);
    if (decision === "partial") assert.equal(implied, "partial", id);
    if (decision === "conflict" && id !== "conflict-ci-vs-announce") {
      assert.equal(implied, "conflict", id);
    }
    if (id === "conflict-ci-vs-announce") {
      assert.equal(implied, "pass", "identities align; conflict is announced prose vs tested conclusion");
    }
  }
});


test("real express v5.2.1 snapshot: provenance, hash, announced vs shipped vs untested", () => {
  const provenance = JSON.parse(readFileSync(REAL_PROVENANCE, "utf8"));
  const snapshotBuf = readFileSync(REAL_JSON);
  const snapshot = JSON.parse(snapshotBuf.toString("utf8"));
  assert.equal(provenance.evidenceClass, "fixture");
  assert.equal(provenance.retrievedAt, "2026-09-10T11:23:59Z");
  assert.equal(provenance.url, "https://api.github.com/repos/expressjs/express/releases/tags/v5.2.1");
  assert.equal(sha256File(REAL_JSON), provenance.sha256);
  assert.equal(SHA256.test(provenance.sha256), true);
  assert.ok(typeof provenance.license.note === "string" && provenance.license.note.length > 0);
  assert.equal(snapshot.tag_name, "v5.2.1");
  assert.equal(snapshot.draft, false);
  assert.equal(snapshot.target_commitish, "master");
  assert.equal(SHA1.test(snapshot.target_commitish), false);
  assert.equal(Array.isArray(snapshot.assets) && snapshot.assets.length === 0, true);
  const keys = Object.keys(snapshot).join(" ");
  assert.equal(/test|ci|coverage|check_run|junit/i.test(keys), false);
  assert.match(snapshot.body, /CVE-2024-51999/);
  const input = schemaInputFromReal();
  const checked = validateReleaseBriefInput(input);
  assert.equal(checked.ok, true, codesOf(checked.issues).join(","));
  assert.equal(existsSync(REAL_HEADERS), true);
  assert.equal(sha256File(REAL_HEADERS), provenance.artifacts[1].sha256);
});

test("c07 transform is present and keeps planes separate on catalog + fixtures + real", async () => {
  assert.equal(existsSync(TRANSFORM_PATH), true, "src/release-brief/transform.mjs required (c07)");
  const { build, mod } = await loadTransform();
  assert.ok(typeof build === "function", `export one of buildReleaseBrief|transformReleaseBrief; got ${Object.keys(mod)}`);

  const positive = schemaCases().find((row) => row.id === "positive.three-plane-aligned");
  const posBrief = asBrief(build(positive.input));
  const posCheck = validateReleaseBrief(posBrief);
  assert.equal(posCheck.ok, true, codesOf(posCheck.issues).join(","));
  assertEnvelope(posBrief);
  assertPlanesSeparate(posBrief);
  assert.equal(posBrief.decision, "pass");
  assert.equal(posBrief.artifactKind, ARTIFACT_KIND);
  assert.ok(posBrief.announced.items.length > 0);
  assert.ok(posBrief.shipped.items.length > 0);
  assert.ok(posBrief.tested.items.length > 0);

  const conflictCase = schemaCases().find((row) => row.id === "conflict.announced-version-vs-shipped-tag");
  const conflictBrief = asBrief(build(conflictCase.input));
  assert.equal(conflictBrief.decision, "conflict");
  assert.ok(conflictBrief.findings.some((row) => row.status === "conflict" || row.code?.includes("identity") || row.code?.includes("disagree")));
  assertCited(conflictBrief);

  const partialCase = schemaCases().find((row) => row.id === "partial.announced-and-shipped-untested");
  const partialBrief = asBrief(build(partialCase.input));
  assert.equal(partialBrief.decision, "partial");
  assert.equal((partialBrief.tested?.items || []).length, 0);

  for (const [id, decision] of Object.entries(EXPECTED_DECISION)) {
    const input = schemaInputFromSynthetic(id);
    const brief = asBrief(build(input));
    assertEnvelope(brief);
    assertPlanesSeparate(brief);
    assert.equal(brief.decision, decision, id);
    assert.equal(brief.evidenceClass, "synthetic");
    if (decision === "pass") {
      assert.equal(impliedDecision(brief), "pass", id);
    }
    if (decision === "conflict") {
      assert.ok(
        impliedDecision(brief) === "conflict"
          || brief.findings.some((row) => row.status === "conflict"),
        id,
      );
    }
    if (id === "conflict-ci-vs-announce") {
      assert.ok(brief.findings.some((row) => /test|ci|announce/i.test(`${row.code} ${row.message}`)), id);
    }
    if (id === "negative-draft-only") {
      assert.ok(brief.findings.some((row) => row.code === "draft_not_shipped" || /draft/i.test(row.message)), id);
    }
  }

  const realBrief = asBrief(build(schemaInputFromReal()));
  assertEnvelope(realBrief);
  assertPlanesSeparate(realBrief);
  assert.equal(realBrief.evidenceClass, "fixture");
  assert.notEqual(realBrief.decision, "pass");
  assert.equal(realBrief.decision, "partial");
  assert.equal((realBrief.tested?.items || []).length, 0);
  const shippedCommit = realBrief.shipped?.items?.[0]?.identity?.commitSha;
  assert.ok(!shippedCommit || shippedCommit === "master" || SHA1.test(shippedCommit));
  if (shippedCommit) assert.equal(SHA1.test(shippedCommit), false, "do not invent a git SHA from branch name master");
  const announcedBody = realBrief.announced?.items?.[0]?.payload?.body || "";
  assert.match(announcedBody, /CVE-2024-51999/);
  assert.equal(JSON.stringify(realBrief.shipped || {}).includes("CVE-2024-51999"), false);
  assert.equal(realBrief.claims.inventsFacts, false);
});
