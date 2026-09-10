import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  ARTIFACT_KIND,
  DECISIONS,
  EVIDENCE_CLASS,
  JOB_ID,
  REQUIRED_CASE_KINDS,
  ROOT,
  SCHEMA,
  TIME_FIELDS,
  ageMs,
  buildProvenance,
  datasetTimes,
  hashedRelFiles,
  loadCases,
  loadManifest,
  packPath,
  readClock,
  sha256File,
  timesAreCollapsed,
  timesAreDistinct,
} from "./catalog.mjs";

const LOCAL_CITATION_PREFIX = "experiments/s137-consumer-evidence-jobs/fixtures/synthetic/freshness/";

function localAbsFromCitation(path) {
  if (!path?.startsWith(LOCAL_CITATION_PREFIX)) return null;
  return join(ROOT, path.slice(LOCAL_CITATION_PREFIX.length));
}

test("manifest pins job, clock, and required case kinds", () => {
  const manifest = loadManifest();
  const clock = readClock();
  assert.equal(clock, "2026-09-10T09:54:59Z");
  assert.equal(manifest.jobId, JOB_ID);
  assert.equal(manifest.clock, clock);
  assert.equal(manifest.evidenceClass, EVIDENCE_CLASS);
  assert.equal(manifest.liveCapture, false);
  assert.equal(manifest.paidDemand, false);
  assert.deepEqual(manifest.timeFields, [...TIME_FIELDS]);
  for (const kind of REQUIRED_CASE_KINDS) {
    assert.ok(manifest.requiredCaseKinds.includes(kind), `missing kind ${kind}`);
  }
});

test("catalog covers positive, negative, partial, and conflict cases", () => {
  const cases = loadCases();
  const kinds = new Set(cases.map((c) => c.caseKind));
  for (const kind of REQUIRED_CASE_KINDS) {
    assert.ok(kinds.has(kind), `no case with caseKind=${kind}`);
  }
  const ids = cases.map((c) => c.caseId).sort();
  assert.deepEqual(ids, [
    "conflict-retrieved-before-source",
    "conflict-two-source-updates",
    "negative-future-source-update",
    "negative-missing-times",
    "partial-missing-source-update",
    "positive-complete",
  ]);
  const manifest = loadManifest();
  for (const id of [...manifest.requiredCaseIds, ...manifest.extraCaseIds]) {
    assert.ok(cases.some((c) => c.caseId === id), `manifest id missing file: ${id}`);
  }
});

test("every case is an offline synthetic input with cited findings", () => {
  const clock = readClock();
  for (const item of loadCases()) {
    assert.equal(item.schema, SCHEMA);
    assert.equal(item.jobId, JOB_ID);
    assert.equal(item.artifactKind, ARTIFACT_KIND);
    assert.equal(item.evidenceClass, EVIDENCE_CLASS);
    assert.equal(item.clock, clock);
    assert.equal(item.offline, true);
    assert.equal(item.payment?.attempted, false);
    assert.equal(item.cost?.assignmentSpendUsd, 0);
    assert.ok(DECISIONS.includes(item.expect.decision), item.caseId);
    assert.ok(Array.isArray(item.citations) && item.citations.length > 0, item.caseId);
    assert.ok(Array.isArray(item.expect.findings) && item.expect.findings.length > 0, item.caseId);

    const citationIds = new Set(item.citations.map((c) => c.id));
    assert.equal(citationIds.size, item.citations.length, `${item.caseId} duplicate citation id`);
    for (const citation of item.citations) {
      assert.ok(citation.id, `${item.caseId} citation missing id`);
      assert.ok(citation.path || citation.url, `${item.caseId} ${citation.id} needs path or url`);
      const digest = citation.contentSha256 || citation.sha256;
      assert.match(digest, /^[0-9a-f]{64}$/, `${item.caseId} ${citation.id}`);
      const localAbs = localAbsFromCitation(citation.path);
      if (localAbs) {
        assert.equal(existsSync(localAbs), true, citation.path);
        assert.equal(sha256File(localAbs), digest, `hash drift ${citation.path}`);
      }
    }
    for (const dataset of item.datasets) {
      assert.ok(dataset.locator?.path || dataset.locator?.url, `${item.caseId} ${dataset.id} locator`);
      assert.ok(Array.isArray(dataset.times), `${item.caseId} ${dataset.id} times[]`);
    }
    for (const finding of item.expect.findings) {
      assert.ok(finding.citationIds?.length > 0, `${item.caseId} ${finding.id} needs citationIds`);
      for (const cid of finding.citationIds) {
        assert.ok(citationIds.has(cid), `${item.caseId} ${finding.id} unknown citationId ${cid}`);
      }
    }
    for (const dataset of item.datasets) {
      assert.equal(timesAreCollapsed(dataset), false, `${item.caseId} ${dataset.id} collapsed time fields`);
      const { retrievedAt, sourceUpdatedAt } = datasetTimes(dataset);
      if (retrievedAt && sourceUpdatedAt) {
        assert.equal(timesAreDistinct(dataset), true, `${item.caseId} ${dataset.id} times must differ`);
      }
    }
  }
});

test("positive case computes both ages from distinct times", () => {
  const item = loadCases().find((c) => c.caseId === "positive-complete");
  assert.equal(item.caseKind, "positive");
  assert.equal(item.expect.decision, "pass");
  assert.equal(item.expect.coverageComplete, true);
  assert.equal(item.datasets.length, 2);
  const clock = item.clock;
  for (const dataset of item.datasets) {
    const { retrievedAt, sourceUpdatedAt } = datasetTimes(dataset);
    assert.ok(retrievedAt);
    assert.ok(sourceUpdatedAt);
    assert.notEqual(retrievedAt, sourceUpdatedAt);
    const retrievalAge = ageMs(clock, retrievedAt);
    const sourceAge = ageMs(clock, sourceUpdatedAt);
    assert.equal(retrievalAge, 0);
    assert.ok(sourceAge > 0, "source update is before clock");
    assert.ok(sourceAge <= item.horizonMs, "positive slims are inside 24h horizon vs clock");
    assert.ok(Date.parse(retrievedAt) >= Date.parse(sourceUpdatedAt));
    assert.ok(Date.parse(retrievedAt) <= Date.parse(clock));
    assert.deepEqual(dataset.coverage.fieldsMissing, []);
    assert.equal(dataset.coverage.expectedRecords, dataset.coverage.observedRecords);
  }
  const vercelSource = item.expect.findings.find((f) => f.id === "vercel-source-update-age");
  assert.equal(vercelSource.ageMs, ageMs(clock, "2026-09-10T01:12:17.696Z"));
  const claudeSource = item.expect.findings.find((f) => f.id === "claude-source-update-age");
  assert.equal(claudeSource.ageMs, ageMs(clock, "2026-09-09T18:25:42.820Z"));
});

test("negative missing times stay unknown and do not inherit the clock", () => {
  const item = loadCases().find((c) => c.caseId === "negative-missing-times");
  assert.equal(item.caseKind, "negative");
  assert.equal(item.expect.decision, "unknown");
  const dataset = item.datasets[0];
  assert.equal(dataset.retrievedAt, null);
  assert.equal(dataset.sourceUpdatedAt, null);
  assert.equal(ageMs(item.clock, dataset.retrievedAt), null);
  assert.equal(ageMs(item.clock, dataset.sourceUpdatedAt), null);
  assert.ok(dataset.coverage.fieldsMissing.includes("retrievedAt"));
  assert.ok(dataset.coverage.fieldsMissing.includes("sourceUpdatedAt"));
  assert.ok(item.expect.unknownReasons.includes("missing_retrievedAt"));
  assert.ok(item.expect.unknownReasons.includes("missing_sourceUpdatedAt"));
});

test("negative future sourceUpdatedAt keeps age unknown (null), not negative", () => {
  const item = loadCases().find((c) => c.caseId === "negative-future-source-update");
  assert.equal(item.caseKind, "negative");
  assert.equal(item.expect.decision, "unknown");
  const dataset = item.datasets[0];
  assert.equal(dataset.id, "synthetic:future-dated-control");
  const sourceAge = ageMs(item.clock, dataset.sourceUpdatedAt);
  assert.equal(sourceAge, null);
  assert.equal(item.expect.findings.find((f) => f.id === "future-source-update").ageMs, null);
  assert.ok(Date.parse(dataset.sourceUpdatedAt) > Date.parse(item.clock));
  assert.ok(item.expect.unknownReasons.includes("future_sourceUpdatedAt"));
});

test("partial case has retrieval age but not source-update age, plus incomplete coverage", () => {
  const item = loadCases().find((c) => c.caseId === "partial-missing-source-update");
  assert.equal(item.caseKind, "partial");
  assert.equal(item.expect.decision, "partial");
  const vercel = item.datasets.find((d) => d.id === "npm:vercel");
  const eol = item.datasets.find((d) => d.id === "endoflife:nodejs");
  assert.equal(vercel.retrievedAt, item.clock);
  assert.equal(vercel.sourceUpdatedAt, null);
  assert.equal(ageMs(item.clock, vercel.retrievedAt), 0);
  assert.equal(ageMs(item.clock, vercel.sourceUpdatedAt), null);
  assert.equal(eol.coverage.expectedRecords, 26);
  assert.equal(eol.coverage.observedRecords, 3);
  assert.ok(eol.coverage.observedRecords < eol.coverage.expectedRecords);
  assert.equal(eol.sourceUpdatedAt, null);
});

test("conflict retrievedAt before sourceUpdatedAt is not reordered", () => {
  const item = loadCases().find((c) => c.caseId === "conflict-retrieved-before-source");
  assert.equal(item.caseKind, "conflict");
  assert.equal(item.expect.decision, "conflict");
  const dataset = item.datasets[0];
  assert.ok(Date.parse(dataset.retrievedAt) < Date.parse(dataset.sourceUpdatedAt));
  assert.equal(ageMs(item.clock, dataset.retrievedAt), 3491699000);
  assert.equal(ageMs(item.clock, dataset.sourceUpdatedAt), 31361304);
  const finding = item.expect.findings.find((f) => f.kind === "time_order_conflict");
  assert.equal(finding.retrievalAgeMs, 3491699000);
  assert.equal(finding.sourceUpdateAgeMs, 31361304);
});

test("conflict two sourceUpdatedAt values for one dataset id stay listed", () => {
  const item = loadCases().find((c) => c.caseId === "conflict-two-source-updates");
  assert.equal(item.caseKind, "conflict");
  assert.equal(item.expect.decision, "conflict");
  assert.equal(item.datasets.length, 1);
  const published = item.datasets[0].times
    .filter((obs) => obs.field === "published_at")
    .map((obs) => obs.value);
  assert.equal(new Set(published).size, 2);
  const finding = item.expect.findings.find((f) => f.kind === "source_update_conflict");
  assert.deepEqual(finding.values.slice().sort(), published.slice().sort());
});

test("source slims keep published_at as sourceUpdatedAt only", () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, "sources/npm-vercel-current.slim.json"), "utf8"));
  const versionDoc = JSON.parse(readFileSync(join(ROOT, "sources/npm-vercel-version-doc.slim.json"), "utf8"));
  const eol = JSON.parse(readFileSync(join(ROOT, "sources/eol-nodejs-watch.slim.json"), "utf8"));
  assert.equal(vercel.sourceUpdatedAt, "2026-09-10T01:12:17.696Z");
  assert.equal(Object.prototype.hasOwnProperty.call(vercel, "retrievedAt"), false);
  assert.equal(versionDoc.sourceUpdatedAt, null);
  assert.equal(eol.sourceUpdatedAt, null);
  assert.equal(eol.asOfClock, readClock());
  assert.notEqual(eol.asOfClock, eol.sourceUpdatedAt);
});

test("PROVENANCE hashes match files and stay synthetic", () => {
  const abs = join(ROOT, "PROVENANCE.json");
  assert.equal(existsSync(abs), true);
  const onDisk = JSON.parse(readFileSync(abs, "utf8"));
  const built = buildProvenance();
  assert.equal(onDisk.label, "synthetic");
  assert.equal(onDisk.liveCapture, false);
  assert.equal(onDisk.paidDemand, false);
  assert.equal(onDisk.payment.attempted, false);
  assert.equal(onDisk.cost.assignmentSpendUsd, 0);
  assert.deepEqual(onDisk.files, built.files);
  assert.deepEqual(onDisk.cases, built.cases);
  const files = hashedRelFiles();
  assert.ok(!("PROVENANCE.json" in files));
  assert.ok(files["CLOCK.txt"]);
  assert.equal(files["CLOCK.txt"].sha256, sha256File(join(ROOT, "CLOCK.txt")));
  assert.equal(packPath("CLOCK.txt"), `${LOCAL_CITATION_PREFIX}CLOCK.txt`);
});

test("c26 validateInput accepts each case and matches expect.decision", async () => {
  const schemaUrl = new URL("../../../src/freshness-receipt/schema.mjs", import.meta.url);
  const { validateInput } = await import(schemaUrl.href);
  for (const item of loadCases()) {
    const result = validateInput(item);
    assert.equal(result.ok, true, `${item.caseId} ${JSON.stringify(result.issues)}`);
    assert.equal(result.decision, item.expect.decision, item.caseId);
  }
});
