/**
 * c25: R2-CONSUMER-JOBS-05 API example replay pack tests.
 * Positive / negative / partial / conflict + one real GitHub REST snapshot.
 * Assert no live spend markers. Offline. No network. No invented provider bytes.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARTIFACT_KIND,
  BLOCKING_PREREQ_KINDS,
  DEFAULT_CLAIMS,
  INPUT_SCHEMA,
  JOB_ID,
  OUTPUT_SCHEMA,
  PACKET_SCHEMA,
  REDACTED,
  coverageForExample,
  createReplayPackEnvelope,
  defaultExecution,
  defaultOnline,
  makeCitation,
  makeFinding,
  makeOnlinePrereq,
  onlineReplayAllowed,
  replayModeFor,
  requiredOnlinePrereqs,
  selfCheck,
  selfCheckFixtures,
  sha256Hex,
  validateReplayPackInput,
  validateReplayPackOutput,
} from "../src/replay-pack/schema.mjs";
import {
  DECISIONS,
  EVIDENCE_CLASSES,
  requireCitedFinding,
} from "../src/packet.mjs";
import {
  collectExamples,
  loadAllCases,
  loadCase,
  loadCatalog,
  loadClock,
  loadOpenApi,
  loadProvenance,
  namedResponseExample,
  readJson,
  replayPackRoot,
} from "../fixtures/synthetic/replay-pack/load.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, "..");
const TRANSFORM_PATH = join(PACK, "src/replay-pack/transform.mjs");
const SYNTHETIC_ROOT = replayPackRoot();
const REAL_DIR = join(PACK, "fixtures/real/replay-pack");
const REAL_OPERATION = join(REAL_DIR, "github-rest-get-a-repository.operation.json");
const REAL_CURL = join(REAL_DIR, "github-rest-get-a-repository.html-curl.txt");
const REAL_HEADERS = join(REAL_DIR, "github-rest-get-a-repository.headers.txt");
const REAL_PROVENANCE = join(REAL_DIR, "PROVENANCE.json");
const SHA256 = /^[a-f0-9]{64}$/;
const LAB = "https://api.example.test";

const EXPECTED_DECISION = Object.freeze({
  "positive-unpaid-complete": "pass",
  "negative-missing-examples": "fail",
  "negative-paid-marker": "fail",
  "partial-mixed-operations": "partial",
  "conflict-example-mismatch": "conflict",
  "partial-external-value": "partial",
});

/** Markers of live spend / payment-protocol execution. HTTP 402 as a refusal marker is not spend. */
const LIVE_SPEND_MARKERS = Object.freeze([
  /\bX-PAYMENT\b/i,
  /\bPAYMENT-REQUIRED\b/i,
  /\bPAYMENT-SIGNATURE\b/i,
  /\bx402Client\b/,
  /\bExactEvmScheme\b/,
  /wallet\.sign/i,
  /"attempted"\s*:\s*true\b/,
  /"assignmentSpendUsd"\s*:\s*[1-9]/,
  /"providerExecuted"\s*:\s*true\b/,
  /"providerInvoked"\s*:\s*true\b/,
  /"fakedProviderExecution"\s*:\s*true\b/,
  /"synthesizedResponse"\s*:\s*true\b/,
  /"liveProviderCall"\s*:\s*true\b/,
]);

function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function hashedCitations(doc) {
  return doc.citations
    .filter((row) => typeof row.sha256 === "string" && SHA256.test(row.sha256))
    .map((row) => makeCitation({
      id: row.id,
      path: row.path || null,
      url: row.url || null,
      sha256: row.sha256,
      licenseNote: row.note || "synthetic fixture; not an official provider capture",
      evidenceClass: row.evidenceClass || "synthetic",
    }));
}

function citeIds(citations, ...wanted) {
  const have = new Set(citations.map((row) => row.id));
  const ids = wanted.filter((id) => have.has(id));
  if (ids.length) return ids;
  return [citations[0].id];
}

function examplesForCase(caseId, doc, citations) {
  const openapi = loadOpenApi(caseId);
  if (caseId === "positive-unpaid-complete") {
    const companion = readJson("cases/positive-unpaid-complete/examples/getStatus.response.json");
    const enabled = namedResponseExample(openapi, "getStatus", "enabled");
    return [{
      id: "getStatus-enabled",
      kind: "http-exchange",
      citationIds: citeIds(citations, "c-openapi", "c-examples-getStatus-response-json"),
      request: { method: "GET", url: `${LAB}/v0/status` },
      response: { status: companion.httpStatus, body: companion.body },
      openapi: { value: enabled.value },
      coverage: "full",
      replayMode: "offline-fixture",
      execution: defaultExecution(),
    }];
  }
  if (caseId === "negative-missing-examples") {
    return [];
  }
  if (caseId === "negative-paid-marker") {
    const companion = readJson("cases/negative-paid-marker/examples/getPaidMarker.response.json");
    return [{
      id: "getPaidMarker-challenge",
      kind: "http-exchange",
      citationIds: citeIds(citations, "c-openapi", "c-examples-getPaidMarker-response-json"),
      request: { method: "GET", url: `${LAB}/v0/paid-marker` },
      response: { status: companion.httpStatus, body: companion.body },
      coverage: "full",
      replayMode: "offline-fixture",
      execution: defaultExecution(),
    }];
  }
  if (caseId === "partial-mixed-operations") {
    const request = readJson("cases/partial-mixed-operations/examples/postCompare.request.json");
    const health = readJson("cases/partial-mixed-operations/examples/getHealth.response.json");
    return [
      {
        id: "postCompare-request",
        kind: "http-exchange",
        citationIds: citeIds(citations, "c-openapi", "c-examples-postCompare-request-json"),
        request: { method: "POST", url: `${LAB}/v0/compare`, body: request.body },
        coverage: "partial",
        replayMode: "offline-fixture",
        execution: defaultExecution(),
      },
      {
        id: "getHealth-enabled",
        kind: "http-exchange",
        citationIds: citeIds(citations, "c-openapi", "c-examples-getHealth-response-json"),
        request: { method: "GET", url: `${LAB}/v0/health` },
        response: { status: health.httpStatus, body: health.body },
        coverage: "full",
        replayMode: "offline-fixture",
        execution: defaultExecution(),
      },
    ];
  }
  if (caseId === "conflict-example-mismatch") {
    const companion = readJson("cases/conflict-example-mismatch/examples/getStatus.response.json");
    const enabled = namedResponseExample(openapi, "getStatus", "enabled");
    const ids = citeIds(citations, "c-openapi", "c-examples-getStatus-response-json");
    return [
      {
        id: "getStatus-enabled",
        kind: "http-exchange",
        citationIds: ids,
        request: { method: "GET", url: `${LAB}/v0/status` },
        response: { status: 200, body: enabled.value },
      },
      {
        id: "getStatus-enabled",
        kind: "http-exchange",
        citationIds: ids,
        request: { method: "GET", url: `${LAB}/v0/status` },
        response: { status: companion.httpStatus, body: companion.body },
      },
    ];
  }
  if (caseId === "partial-external-value") {
    const remote = namedResponseExample(openapi, "getStatus", "remote");
    return [{
      id: "getStatus-remote",
      kind: "openapi-example",
      citationIds: citeIds(citations, "c-openapi"),
      request: { method: "GET", url: `${LAB}/v0/status` },
      openapi: { exampleName: "remote", externalValue: remote.externalValue },
      coverage: "partial",
      replayMode: "offline-fixture",
      execution: defaultExecution(),
    }];
  }
  throw new Error(`unknown case ${caseId}`);
}

function onlineForCase(caseId, doc) {
  if (caseId === "negative-paid-marker") {
    return {
      requested: true,
      consent: false,
      prereqs: [
        ...requiredOnlinePrereqs(),
        makeOnlinePrereq({
          id: "paid-endpoint",
          kind: "paid-endpoint",
          satisfied: false,
          note: "HTTP 402 is a refusal marker. paid-endpoint cannot be satisfied.",
        }),
      ],
      allowlistedUrls: [],
    };
  }
  if (caseId === "partial-external-value") {
    return {
      requested: true,
      consent: false,
      prereqs: [
        ...requiredOnlinePrereqs(),
        makeOnlinePrereq({
          id: "network-https-get-external",
          kind: "network-https-get",
          satisfied: false,
          note: doc.onlinePrerequisites.items[0],
        }),
      ],
      allowlistedUrls: ["https://api.example.test/examples/status-200.json"],
    };
  }
  return defaultOnline();
}

function schemaInputFromSynthetic(caseId) {
  const doc = loadCase(caseId);
  const citations = hashedCitations(doc);
  return {
    schema: INPUT_SCHEMA,
    clock: loadClock(),
    evidenceClass: "synthetic",
    citations,
    examples: examplesForCase(caseId, doc, citations),
    online: onlineForCase(caseId, doc),
  };
}

function schemaInputFromReal() {
  const provenance = JSON.parse(readFileSync(REAL_PROVENANCE, "utf8"));
  const operation = JSON.parse(readFileSync(REAL_OPERATION, "utf8"));
  const example = operation.codeExamples[0];
  const citations = provenance.citations
    .filter((row) => typeof row.sha256 === "string" && SHA256.test(row.sha256))
    .map((row) => makeCitation({
      id: row.id,
      path: row.path || null,
      url: row.url || null,
      sha256: row.sha256,
      retrievedAt: row.retrievedAt || provenance.retrievedAt,
      licenseNote: provenance.license.note,
      evidenceClass: "fixture",
    }));
  return {
    schema: INPUT_SCHEMA,
    clock: provenance.retrievedAt.endsWith("Z") && !provenance.retrievedAt.includes(".")
      ? provenance.retrievedAt.replace("Z", ".000Z")
      : provenance.retrievedAt,
    evidenceClass: "fixture",
    citations,
    examples: [{
      id: "github-get-a-repository",
      kind: "docs-snippet",
      citationIds: citeIds(citations, "src-operation", "src-html-curl"),
      request: {
        method: "GET",
        url: "https://api.github.com/repos/OWNER/REPO",
        headers: {
          accept: "application/vnd.github+json",
          authorization: REDACTED,
        },
      },
      response: {
        status: Number(example.response.statusCode),
        headers: { "content-type": example.response.contentType },
        body: example.response.example,
      },
      coverage: "full",
      replayMode: "offline-fixture",
      execution: defaultExecution(),
    }],
    online: {
      requested: false,
      consent: false,
      prereqs: [
        makeOnlinePrereq({
          id: "paid-endpoint",
          kind: "paid-endpoint",
          satisfied: false,
          note: "Public docs snapshot. Live api.github.com was not called. Spend is out of bounds.",
        }),
      ],
      allowlistedUrls: [],
    },
  };
}

function envelopeFromInput(input, { decision, findings }) {
  return createReplayPackEnvelope({
    clock: input.clock,
    evidenceClass: input.evidenceClass,
    citations: input.citations,
    examples: input.examples,
    findings,
    decision,
    online: input.online || defaultOnline(),
  });
}

function findingFor(input, { id, kind, code, message, exampleId = null }) {
  return makeFinding({
    id,
    kind,
    code,
    message,
    citationIds: [input.citations[0].id],
    exampleId,
  });
}

function pickBuild(mod) {
  const names = ["transform", "run", "analyze", "build", "packageReplayPack", "buildReplayPack"];
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

function asPack(result) {
  if (!result || typeof result !== "object") return result;
  if (result.packet && typeof result.packet === "object") return result.packet;
  if (result.pack && typeof result.pack === "object") return result.pack;
  return result;
}

function liveSpendHits(text) {
  return LIVE_SPEND_MARKERS.filter((re) => re.test(text)).map((re) => String(re));
}

function assertNoLiveSpend(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const hits = liveSpendHits(text);
  assert.deepEqual(hits, [], `${label} has live spend markers: ${hits.join(", ")}`);
}

function assertCited(pack) {
  assert.ok(Array.isArray(pack.citations), "citations[] required");
  const citationIds = new Set(pack.citations.map((row) => row.id));
  assert.ok(Array.isArray(pack.findings), "findings[] required");
  for (const finding of pack.findings) {
    requireCitedFinding(finding);
    for (const id of finding.citationIds) {
      assert.equal(citationIds.has(id), true, `dangling citationId ${id}`);
    }
  }
  for (const citation of pack.citations) {
    assert.ok(citation.path || citation.url, `citation ${citation.id} needs path or url`);
  }
}

function assertNoSpendEnvelope(pack) {
  assert.equal(pack.jobId, JOB_ID);
  assert.equal(pack.artifactKind, ARTIFACT_KIND);
  assert.equal(pack.offline, true);
  assert.equal(pack.payment.attempted, false);
  assert.equal(pack.cost.assignmentSpendUsd, 0);
  assert.equal(pack.claims.inventsFacts, false);
  assert.equal(pack.claims.paidEndpoint, false);
  assert.equal(pack.claims.legalAttestation, false);
  assert.equal(pack.claims.modelAsOracle, false);
  assert.equal(pack.claims.assertsCustomerDemand, false);
  assert.equal(DECISIONS.includes(pack.decision), true);
  assert.equal(EVIDENCE_CLASSES.includes(pack.evidenceClass), true);
  assert.equal(pack.summary.onlineReplayAllowed, false);
  assertCited(pack);
  assertNoLiveSpend(pack, pack.schema || "pack");
  for (const example of pack.examples || []) {
    assert.notEqual(example.synthesizedResponse, true);
    assert.notEqual(example.execution?.fakedProviderExecution, true);
    assert.notEqual(example.execution?.providerInvoked, true);
    if (example.execution) {
      assert.notEqual(example.execution.status, "live-capture");
    }
  }
}

function walkFiles(root, acc = []) {
  for (const name of readdirSync(root)) {
    const abs = join(root, name);
    const st = statSync(abs);
    if (st.isDirectory()) walkFiles(abs, acc);
    else acc.push(abs);
  }
  return acc;
}

test("schema self-check covers positive, negative, partial, conflict", () => {
  const result = selfCheck();
  assert.equal(result.ok, true);
  const fixtures = selfCheckFixtures();
  assert.equal(validateReplayPackInput(fixtures.positiveInput).status, "ok");
  assert.equal(validateReplayPackInput(fixtures.partialInput).status, "partial");
  assert.equal(validateReplayPackInput(fixtures.conflictInput).status, "conflict");
  for (const [name, doc] of Object.entries(fixtures.negativeInputs)) {
    assert.equal(validateReplayPackInput(doc).status, "invalid", name);
  }
});

test("synthetic catalog pins required kinds and zero-spend claims", () => {
  const catalog = loadCatalog();
  assert.equal(catalog.jobId, JOB_ID);
  assert.equal(catalog.evidenceClass, "synthetic");
  assert.equal(catalog.offline, true);
  assert.equal(catalog.payment.attempted, false);
  assert.equal(catalog.cost.assignmentSpendUsd, 0);
  assert.equal(catalog.clock, loadClock());
  const kinds = new Set(catalog.cases.map((row) => row.kind));
  for (const kind of ["positive", "negative", "partial", "conflict"]) {
    assert.equal(kinds.has(kind), true, `missing ${kind}`);
  }
  for (const entry of catalog.cases) {
    assert.equal(entry.expectedDecision, EXPECTED_DECISION[entry.id], entry.id);
  }
  assert.deepEqual(catalog.claims, { ...DEFAULT_CLAIMS });
  assertNoLiveSpend(catalog, "catalog");
});

test("positive: unpaid complete example validates offline and packs with spend 0", () => {
  const input = schemaInputFromSynthetic("positive-unpaid-complete");
  const checked = validateReplayPackInput(input);
  assert.equal(checked.status, "ok", JSON.stringify(checked.issues));
  assert.equal(checked.onlineReplayAllowed, false);
  assert.equal(coverageForExample(input.examples[0]), "full");
  assert.equal(replayModeFor(input.examples[0], input.online), "offline-fixture");
  const companion = readJson("cases/positive-unpaid-complete/examples/getStatus.response.json");
  assert.equal(companion.paid, false);
  assert.equal(companion.providerExecuted, false);
  assert.deepEqual(input.examples[0].response.body, companion.body);
  const pack = envelopeFromInput(input, {
    decision: "pass",
    findings: [findingFor(input, {
      id: "f-match",
      kind: "positive",
      code: "example.full",
      message: "GET /v0/status named example matches companion body. Unpaid.",
      exampleId: "getStatus-enabled",
    })],
  });
  const out = validateReplayPackOutput(pack);
  assert.equal(out.status, "ok", JSON.stringify(out.issues));
  assertNoSpendEnvelope(pack);
  assert.equal(pack.schema, OUTPUT_SCHEMA);
  assert.equal(pack.packetSchema, PACKET_SCHEMA);
});

test("negative: missing examples cannot be packed and do not invent bytes", () => {
  const openapi = loadOpenApi("negative-missing-examples");
  assert.equal(collectExamples(openapi).length, 0);
  const input = schemaInputFromSynthetic("negative-missing-examples");
  assert.equal(input.examples.length, 0);
  const checked = validateReplayPackInput(input);
  assert.equal(checked.status, "invalid");
  assert.ok(checked.issues.some((row) => row.code === "examples.minItems"));
  const doc = loadCase("negative-missing-examples");
  assert.equal(doc.expectedDecision, "fail");
  assert.equal(doc.replay.providerExecuted, false);
  assert.equal(doc.replay.fakeProviderExecution, false);
  assert.equal(existsSync(join(SYNTHETIC_ROOT, "cases/negative-missing-examples/examples")), false);
});

test("negative: paid-endpoint cannot be satisfied; 402 is not executed spend", () => {
  const input = schemaInputFromSynthetic("negative-paid-marker");
  assert.equal(input.examples[0].response.status, 402);
  assert.equal(input.examples[0].response.body.executed, false);
  assert.equal(input.examples[0].response.body.spendUsd, 0);
  assert.equal(onlineReplayAllowed(input.online), false);
  const blocking = input.online.prereqs.filter((row) => BLOCKING_PREREQ_KINDS.includes(row.kind));
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].satisfied, false);

  const satisfied = validateReplayPackInput({
    ...input,
    online: {
      requested: true,
      consent: true,
      allowlistedUrls: [`${LAB}/v0/paid-marker`],
      prereqs: [
        ...requiredOnlinePrereqs().map((row) => ({ ...row, satisfied: true })),
        makeOnlinePrereq({ id: "paid-endpoint", kind: "paid-endpoint", satisfied: true }),
      ],
    },
  });
  assert.equal(satisfied.status, "invalid");
  assert.ok(satisfied.issues.some((row) => row.code === "prereq.blocking_satisfied"));
  assert.equal(satisfied.onlineReplayAllowed, false);

  const pack = envelopeFromInput(input, {
    decision: "fail",
    findings: [findingFor(input, {
      id: "f-paid-marker",
      kind: "negative",
      code: "paid-marker",
      message: "HTTP 402 listed. Pack must not treat the example as an executed provider result.",
      exampleId: "getPaidMarker-challenge",
    })],
  });
  const out = validateReplayPackOutput(pack);
  assert.equal(out.ok, true, JSON.stringify(out.issues));
  assertNoSpendEnvelope(pack);
  assert.equal(pack.decision, "fail");
  assert.equal(pack.payment.attempted, false);
});

test("partial: request-only operation stays partial; response is not synthesized", () => {
  const input = schemaInputFromSynthetic("partial-mixed-operations");
  const checked = validateReplayPackInput(input);
  assert.equal(checked.status, "partial", JSON.stringify(checked.issues));
  assert.ok(checked.issues.some((row) => row.code === "example.coverage_partial"));
  assert.equal(coverageForExample(input.examples[0]), "partial");
  assert.equal(coverageForExample(input.examples[1]), "full");
  assert.equal(Object.hasOwn(input.examples[0], "response"), false);
  const pack = envelopeFromInput(input, {
    decision: "partial",
    findings: [findingFor(input, {
      id: "f-post-request-only",
      kind: "partial",
      code: "example.coverage_partial",
      message: "postCompare has a request example and no 200 body. Do not invent it.",
      exampleId: "postCompare-request",
    })],
  });
  const out = validateReplayPackOutput(pack);
  assert.equal(out.status, "partial", JSON.stringify(out.issues));
  assertNoSpendEnvelope(pack);
});

test("conflict: OpenAPI example vs companion body is not merged", () => {
  const openapi = loadOpenApi("conflict-example-mismatch");
  const companion = readJson("cases/conflict-example-mismatch/examples/getStatus.response.json");
  const enabled = namedResponseExample(openapi, "getStatus", "enabled");
  assert.equal(enabled.value.ok, true);
  assert.equal(companion.body.ok, false);
  const input = schemaInputFromSynthetic("conflict-example-mismatch");
  const checked = validateReplayPackInput(input);
  assert.equal(checked.status, "conflict");
  assert.ok(checked.issues.some((row) => row.code === "examples.conflict"));
  const pack = envelopeFromInput(input, {
    decision: "conflict",
    findings: [findingFor(input, {
      id: "f-body-disagreement",
      kind: "conflict",
      code: "examples.conflict",
      message: "OpenAPI ok:true disagrees with companion ok:false. Do not merge.",
      exampleId: "getStatus-enabled",
    })],
  });
  const out = validateReplayPackOutput(pack);
  assert.equal(out.status, "conflict", JSON.stringify(out.issues));
  assertNoSpendEnvelope(pack);
});

test("partial: unfetched externalValue is an explicit online prereq, not a fetch", () => {
  const input = schemaInputFromSynthetic("partial-external-value");
  const checked = validateReplayPackInput(input);
  assert.equal(checked.status, "partial", JSON.stringify(checked.issues));
  assert.equal(checked.onlineReplayAllowed, false);
  assert.equal(input.examples[0].openapi.externalValue, "https://api.example.test/examples/status-200.json");
  assert.equal(Object.hasOwn(input.examples[0].openapi, "value"), false);
  const doc = loadCase("partial-external-value");
  assert.equal(doc.onlinePrerequisites.fetched, false);
  assert.equal(doc.onlinePrerequisites.required, true);
  const pack = envelopeFromInput(input, {
    decision: "partial",
    findings: [findingFor(input, {
      id: "f-external-unfetched",
      kind: "partial",
      code: "example.coverage_partial",
      message: "externalValue was not fetched. Online prerequisite stays explicit.",
      exampleId: "getStatus-remote",
    })],
  });
  assert.equal(validateReplayPackOutput(pack).status, "partial");
  assertNoSpendEnvelope(pack);
});

test("real GitHub REST Get a repository fixture: provenance, REDACTED auth, no live API", () => {
  const provenance = JSON.parse(readFileSync(REAL_PROVENANCE, "utf8"));
  const operation = JSON.parse(readFileSync(REAL_OPERATION, "utf8"));
  const curl = readFileSync(REAL_CURL, "utf8");
  assert.equal(provenance.evidenceClass, "fixture");
  assert.equal(provenance.offline, true);
  assert.equal(provenance.payment.attempted, false);
  assert.equal(provenance.cost.assignmentSpendUsd, 0);
  assert.equal(provenance.onlinePrerequisites.executed, false);
  assert.equal(provenance.onlinePrerequisites.liveProviderCall, false);
  assert.equal(sha256File(REAL_OPERATION), provenance.sha256);
  assert.equal(SHA256.test(provenance.sha256), true);
  assert.equal(provenance.license.spdx, "CC-BY-4.0");
  assert.ok(provenance.license.note.includes("not a license grant") || provenance.license.note.includes("Not a license grant") || provenance.license.note.includes("not a license"));
  assert.equal(operation.title, "Get a repository");
  assert.equal(operation.verb, "get");
  assert.equal(operation.codeExamples[0].response.statusCode, "200");
  assert.equal(operation.codeExamples[0].response.example.full_name, "octocat/Hello-World");
  assert.match(curl, /Bearer <YOUR-TOKEN>/);
  assert.doesNotMatch(curl, /Bearer (?!<YOUR-TOKEN>)\S+/);
  assert.match(provenance.captureMethod, /Live https:\/\/api\.github.com\/repos\/OWNER\/REPO was not requested/);

  const kinds = new Set(provenance.observedCases.map((row) => row.kind));
  assert.deepEqual([...kinds].sort(), ["conflicting", "negative", "partial", "positive"]);
  for (const finding of provenance.observedCases) {
    requireCitedFinding(finding);
  }

  const schema = operation.codeExamples[0].response.schema;
  const example = operation.codeExamples[0].response.example;
  assert.ok(schema.required.includes("language"));
  assert.equal(Object.hasOwn(example, "language"), false);

  const input = schemaInputFromReal();
  assert.equal(input.examples[0].request.headers.authorization, REDACTED);
  const checked = validateReplayPackInput(input);
  assert.equal(checked.status, "ok", JSON.stringify(checked.issues));
  assert.equal(checked.onlineReplayAllowed, false);
  const pack = envelopeFromInput(input, {
    decision: "conflict",
    findings: provenance.observedCases.map((row) => makeFinding({
      id: row.id,
      kind: row.kind === "conflicting" ? "conflict" : row.kind,
      code: row.id,
      message: row.detail,
      citationIds: row.citationIds,
      exampleId: "github-get-a-repository",
    })),
  });
  const out = validateReplayPackOutput(pack);
  assert.equal(out.ok, true, JSON.stringify(out.issues));
  assertNoSpendEnvelope(pack);
  assert.equal(pack.evidenceClass, "fixture");
  assert.equal(existsSync(REAL_HEADERS), true);
  assert.equal(sha256File(REAL_HEADERS), provenance.headersSha256);
  assertNoLiveSpend(provenance, "real PROVENANCE");
  assertNoLiveSpend(operation.codeExamples[0].request, "real request example");
});

test("secret header values must be REDACTED; credentials are not stored", () => {
  const input = schemaInputFromSynthetic("positive-unpaid-complete");
  const leaked = validateReplayPackInput({
    ...input,
    examples: [{
      ...input.examples[0],
      request: {
        ...input.examples[0].request,
        headers: { authorization: "Bearer super-secret" },
      },
    }],
  });
  assert.equal(leaked.status, "invalid");
  assert.ok(leaked.issues.some((row) => row.code === "headers.secret"));
  const redacted = validateReplayPackInput({
    ...input,
    examples: [{
      ...input.examples[0],
      request: {
        ...input.examples[0].request,
        headers: { authorization: REDACTED, accept: "application/json" },
      },
    }],
  });
  assert.equal(redacted.status, "ok", JSON.stringify(redacted.issues));
});

test("output refuses spend, faked execution, and invented responses", () => {
  const input = schemaInputFromSynthetic("positive-unpaid-complete");
  const pack = envelopeFromInput(input, {
    decision: "fail",
    findings: [findingFor(input, {
      id: "f-illegal",
      kind: "negative",
      code: "spend",
      message: "illegal spend markers must fail validation",
    })],
  });
  pack.payment.attempted = true;
  pack.cost.assignmentSpendUsd = 1;
  pack.examples[0].execution = {
    status: "not-executed",
    fakedProviderExecution: true,
    providerInvoked: false,
  };
  pack.examples[0].synthesizedResponse = true;
  const result = validateReplayPackOutput(pack);
  assert.equal(result.status, "invalid");
  const codes = new Set(result.issues.map((row) => row.code));
  assert.equal(codes.has("payment.attempted"), true);
  assert.equal(codes.has("cost.assignmentSpendUsd"), true);
  assert.equal(codes.has("execution.faked"), true);
  assert.equal(codes.has("example.synthesizedResponse"), true);
});

test("replay-pack fixtures and modules contain no live spend markers", () => {
  const roots = [
    join(PACK, "src/replay-pack"),
    join(PACK, "fixtures/synthetic/replay-pack"),
    join(PACK, "fixtures/real/replay-pack"),
  ];
  const files = roots.flatMap((root) => walkFiles(root)).filter((abs) => {
    return /\.(json|md|txt|mjs)$/.test(abs) && !abs.endsWith("hash.mjs");
  });
  assert.ok(files.length > 10, "expected replay-pack artifacts");
  for (const abs of files) {
    const text = readFileSync(abs, "utf8");
    assertNoLiveSpend(text, abs.slice(PACK.length + 1));
  }
  for (const entry of loadAllCases()) {
    assert.equal(entry.doc.payment.attempted, false, entry.id);
    assert.equal(entry.doc.cost.assignmentSpendUsd, 0, entry.id);
    assert.equal(entry.doc.replay.providerExecuted, false, entry.id);
    assert.equal(entry.doc.replay.fakeProviderExecution, false, entry.id);
    assert.equal(entry.doc.onlinePrerequisites.fetched, false, entry.id);
    assert.equal(entry.openapi.servers[0].url, LAB);
  }
  const provenance = loadProvenance();
  assert.equal(provenance.liveCapture, false);
  assert.equal(provenance.paidDemand, false);
});

test("c22 transform, when present, keeps offline no-spend decisions on catalog cases", async () => {
  const loaded = await loadTransform();
  if (!loaded.present || typeof loaded.build !== "function") {
    assert.equal(existsSync(TRANSFORM_PATH), false);
    return;
  }
  for (const [id, decision] of Object.entries(EXPECTED_DECISION)) {
    if (id === "negative-missing-examples") continue;
    const input = schemaInputFromSynthetic(id);
    const pack = asPack(loaded.build(input));
    assertNoSpendEnvelope(pack);
    assert.equal(pack.decision, decision, id);
    assert.equal(pack.offline, true, id);
    assert.equal(pack.payment.attempted, false, id);
    assert.equal(onlineReplayAllowed(pack.online || {}), false, id);
  }
  const missing = schemaInputFromSynthetic("negative-missing-examples");
  const missingPack = asPack(loaded.build(missing));
  assert.ok(missingPack.decision === "fail" || missingPack.ok === false);
  assert.notEqual(missingPack.payment?.attempted, true);
  const realPack = asPack(loaded.build(schemaInputFromReal()));
  assertNoSpendEnvelope(realPack);
  assert.equal(realPack.evidenceClass, "fixture");
  assert.notEqual(realPack.decision, "pass");
});
