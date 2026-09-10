import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createEnvelope, requireCitedFinding, EVIDENCE_CLASSES, DECISIONS } from "../../../src/packet.mjs";
import { sha256File } from "./hash.mjs";
import {
  collectExamples,
  loadAllCases,
  loadCatalog,
  loadClock,
  loadOpenApi,
  loadProvenance,
  namedResponseExample,
  readJson,
  replayPackRoot,
} from "./load.mjs";

const ROOT = replayPackRoot();
const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");

function citationMap(doc) {
  return new Map(doc.citations.map((c) => [c.id, c]));
}

test("catalog pins required kinds and synthetic offline claims", () => {
  const catalog = loadCatalog();
  const clock = loadClock();
  assert.equal(catalog.schema, "s137.consumer-evidence.replay-pack.catalog.v1");
  assert.equal(catalog.jobId, "R2-CONSUMER-JOBS-05");
  assert.equal(catalog.evidenceClass, "synthetic");
  assert.equal(catalog.offline, true);
  assert.equal(catalog.payment.attempted, false);
  assert.equal(catalog.cost.assignmentSpendUsd, 0);
  assert.equal(catalog.clock, clock);
  assert.equal(clock, "2026-09-10T12:00:00.000Z");
  assert.equal(catalog.labServer, "https://api.example.test");
  assert.deepEqual(catalog.requiredKinds, ["positive", "negative", "partial", "conflict"]);
  const kinds = new Set(catalog.cases.map((c) => c.kind));
  for (const kind of catalog.requiredKinds) assert.equal(kinds.has(kind), true, `missing kind ${kind}`);
  assert.equal(catalog.claims.inventsFacts, false);
  assert.equal(catalog.claims.paidEndpoint, false);
  assert.equal(catalog.claims.modelAsOracle, false);
  assert.equal(catalog.oas31ExampleObject.retrieved, false);
});

test("PROVENANCE hashes listed artifacts and records license note", () => {
  const provenance = loadProvenance();
  assert.equal(provenance.evidenceClass, "synthetic");
  assert.equal(provenance.liveCapture, false);
  assert.equal(provenance.paidDemand, false);
  assert.equal(provenance.retrievedAt, loadClock());
  assert.equal(provenance.url, null);
  assert.match(provenance.licenseNote, /Not a license grant/);
  assert.equal(typeof provenance.patternSources.unpaidOpenApiCompanion.sha256, "string");
  assert.equal(provenance.patternSources.unpaidOpenApiCompanion.sha256.length, 64);
  const pageChange = join(REPO, "page-change-http.mjs");
  assert.equal(existsSync(pageChange), true);
  assert.equal(provenance.patternSources.unpaidOpenApiCompanion.sha256, sha256File(pageChange));
  for (const [rel, rec] of Object.entries(provenance.files)) {
    if (rel === "PROVENANCE.json" || rec.missing) continue;
    const abs = join(ROOT, rel);
    assert.equal(existsSync(abs), true, rel);
    assert.equal(rec.sha256, sha256File(abs), rel);
  }
});

test("every case is cited, synthetic, and packet-envelope compatible", () => {
  for (const entry of loadAllCases()) {
    const doc = entry.doc;
    assert.equal(doc.schema, "s137.consumer-evidence.replay-pack.case.v1");
    assert.equal(doc.jobId, "R2-CONSUMER-JOBS-05");
    assert.equal(doc.evidenceClass, "synthetic");
    assert.equal(EVIDENCE_CLASSES.includes(doc.evidenceClass), true);
    assert.equal(DECISIONS.includes(doc.expectedDecision), true);
    assert.equal(doc.offline, true);
    assert.equal(doc.payment.attempted, false);
    assert.equal(doc.replay.providerExecuted, false);
    assert.equal(doc.replay.fakeProviderExecution, false);
    assert.equal(doc.claims.paidEndpoint, false);
    assert.equal(doc.onlinePrerequisites.fetched, false);
    assert.equal(doc.findings.length > 0, true, entry.id);
    const cites = citationMap(doc);
    for (const finding of doc.findings) {
      requireCitedFinding(finding);
      for (const id of finding.citationIds) {
        assert.equal(cites.has(id), true, `${entry.id} missing citation ${id}`);
      }
    }
    for (const [id, c] of cites) {
      if (c.path && c.path.startsWith("cases/")) {
        assert.equal(typeof c.sha256, "string", `${entry.id} ${id}`);
        assert.equal(c.sha256, sha256File(join(ROOT, c.path)), `${entry.id} ${id}`);
      }
      if (c.url) {
        assert.equal(c.retrieved, false, `${entry.id} ${id} must not claim a fetch`);
      }
    }
    const packet = createEnvelope({
      jobId: doc.jobId,
      artifactKind: doc.artifactKind,
      clock: doc.clock,
      evidenceClass: doc.evidenceClass,
      sources: doc.sources,
      findings: doc.findings,
      decision: doc.expectedDecision,
      limitations: doc.limitations,
      citations: doc.citations,
    });
    assert.equal(packet.offline, true);
    assert.equal(packet.payment.attempted, false);
    const openapi = entry.openapi;
    assert.equal(openapi.openapi, "3.1.0");
    assert.equal(openapi.servers[0].url, "https://api.example.test");
    assert.match(JSON.stringify(openapi.info), /synthetic|lab/i);
  }
});

test("positive: OpenAPI named example matches companion body", () => {
  const openapi = loadOpenApi("positive-unpaid-complete");
  const companion = readJson("cases/positive-unpaid-complete/examples/getStatus.response.json");
  const enabled = namedResponseExample(openapi, "getStatus", "enabled");
  assert.deepEqual(enabled.value, companion.body);
  assert.equal(companion.httpStatus, 200);
  assert.equal(companion.paid, false);
  assert.equal(companion.providerExecuted, false);
  assert.equal(companion.body.paid, false);
  const doc = readJson("cases/positive-unpaid-complete/case.json");
  assert.equal(doc.kind, "positive");
  assert.equal(doc.expectedDecision, "pass");
  assert.equal(doc.onlinePrerequisites.required, false);
});

test("negative: missing examples cannot be packed", () => {
  const openapi = loadOpenApi("negative-missing-examples");
  const examples = collectExamples(openapi);
  assert.equal(examples.length, 0);
  const doc = readJson("cases/negative-missing-examples/case.json");
  assert.equal(doc.kind, "negative");
  assert.equal(doc.expectedDecision, "fail");
  assert.equal(existsSync(join(ROOT, "cases/negative-missing-examples/examples")), false);
  const text = JSON.stringify(openapi);
  assert.equal(text.includes("\"example\""), false);
  assert.equal(text.includes("\"examples\""), false);
});

test("negative: paid marker is refused and not executed", () => {
  const openapi = loadOpenApi("negative-paid-marker");
  assert.equal(Object.prototype.hasOwnProperty.call(openapi.paths["/v0/paid-marker"].get.responses, "402"), true);
  assert.equal(openapi.paths["/v0/paid-marker"].get.responses["200"], undefined);
  const companion = readJson("cases/negative-paid-marker/examples/getPaidMarker.response.json");
  assert.equal(companion.httpStatus, 402);
  assert.equal(companion.providerExecuted, false);
  assert.equal(companion.body.executed, false);
  assert.equal(companion.body.spendUsd, 0);
  const doc = readJson("cases/negative-paid-marker/case.json");
  assert.equal(doc.expectedDecision, "fail");
  assert.equal(doc.onlinePrerequisites.required, true);
  assert.equal(doc.payment.attempted, false);
  const text = JSON.stringify(openapi) + JSON.stringify(companion) + JSON.stringify(doc);
  assert.equal(/x402​Client|Exact​EvmScheme|wallet\.sign/i.test(text), false);
});

test("partial: one complete operation and one request-only operation", () => {
  const openapi = loadOpenApi("partial-mixed-operations");
  const examples = collectExamples(openapi);
  const post = examples.filter((ex) => ex.operationId === "postCompare");
  const health = examples.filter((ex) => ex.operationId === "getHealth");
  assert.equal(post.length, 1);
  assert.equal(post[0].location, "requestBody");
  assert.equal(health.length, 1);
  assert.equal(health[0].location, "response");
  const request = readJson("cases/partial-mixed-operations/examples/postCompare.request.json");
  const response = readJson("cases/partial-mixed-operations/examples/getHealth.response.json");
  assert.deepEqual(post[0].value, request.body);
  assert.deepEqual(health[0].value, response.body);
  assert.equal(existsSync(join(ROOT, "cases/partial-mixed-operations/examples/postCompare.response.json")), false);
  const doc = readJson("cases/partial-mixed-operations/case.json");
  assert.equal(doc.expectedDecision, "partial");
  const pageChange = readFileSync(join(REPO, "page-change-http.mjs"), "utf8");
  assert.match(pageChange, /example: \{[\s\S]*before:/);
  assert.match(pageChange, /"200": \{[\s\S]*pageChangeHttpOutputSchema\(\)/);
});

test("conflict: OpenAPI example disagrees with companion; do not merge", () => {
  const openapi = loadOpenApi("conflict-example-mismatch");
  const companion = readJson("cases/conflict-example-mismatch/examples/getStatus.response.json");
  const enabled = namedResponseExample(openapi, "getStatus", "enabled");
  assert.equal(enabled.value.ok, true);
  assert.equal(companion.body.ok, false);
  assert.notDeepEqual(enabled.value, companion.body);
  const doc = readJson("cases/conflict-example-mismatch/case.json");
  assert.equal(doc.kind, "conflict");
  assert.equal(doc.expectedDecision, "conflict");
  const finding = doc.findings.find((f) => f.id === "f-body-disagreement");
  assert.equal(finding.openapiOk, true);
  assert.equal(finding.companionOk, false);
});

test("partial externalValue records explicit unfetched online prerequisite", () => {
  const openapi = loadOpenApi("partial-external-value");
  const remote = namedResponseExample(openapi, "getStatus", "remote");
  assert.equal(remote.externalValue, "https://api.example.test/examples/status-200.json");
  assert.equal(remote.value, undefined);
  const doc = readJson("cases/partial-external-value/case.json");
  assert.equal(doc.expectedDecision, "partial");
  assert.equal(doc.onlinePrerequisites.required, true);
  assert.equal(doc.onlinePrerequisites.fetched, false);
  assert.equal(doc.onlinePrerequisites.items.length > 0, true);
  const extCite = doc.citations.find((c) => c.id === "c-oas31-example-object");
  assert.equal(extCite.retrieved, false);
  assert.equal(extCite.sha256, null);
});

test("fixtures do not call the network or mark spend", () => {
  const catalog = loadCatalog();
  const provenance = loadProvenance();
  assert.equal(catalog.payment.attempted, false);
  assert.equal(catalog.evidenceClass, "synthetic");
  assert.equal(provenance.liveCapture, false);
  assert.equal(provenance.paidDemand, false);
  for (const entry of loadAllCases()) {
    assert.equal(entry.doc.cost.assignmentSpendUsd, 0);
    assert.equal(entry.doc.evidenceClass, "synthetic");
    assert.match(entry.openapi.servers[0].url, /\.test$/);
    assert.equal(entry.doc.onlinePrerequisites.fetched, false);
  }
});
