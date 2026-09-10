import assert from "node:assert/strict";
import test from "node:test";
import {
  INPUT_SCHEMA,
  OUTPUT_SCHEMA,
  JOB_ID,
  ARTIFACT_KIND,
  PACKET_SCHEMA,
  SCHEMA_LIMITATIONS,
  REDACTED,
  sha256Hex,
  canonicalJson,
  defaultOnline,
  defaultExecution,
  requiredOnlinePrereqs,
  makeCitation,
  makeFinding,
  makeOnlinePrereq,
  coverageForExample,
  onlineReplayAllowed,
  replayModeFor,
  validateReplayPackInput,
  validateReplayPackOutput,
  createReplayPackEnvelope,
  selfCheck,
  selfCheckFixtures,
} from "../../src/replay-pack/schema.mjs";

const CLOCK = "2026-09-10T00:00:00.000Z";

function citedExample(overrides = {}) {
  const body = { id: "1", name: "widget" };
  const content = canonicalJson({
    request: { method: "GET", url: "https://example.invalid/v1/widgets/1" },
    response: { status: 200, body },
  });
  const citation = makeCitation({
    id: "cit-widget",
    path: "cells/c21/inline-synthetic-widget.json",
    sha256: sha256Hex(content),
    licenseNote: "synthetic fixture; not an official provider capture",
    evidenceClass: "synthetic",
    content,
  });
  const example = {
    id: "widget-get",
    kind: "http-exchange",
    citationIds: ["cit-widget"],
    request: {
      method: "GET",
      url: "https://example.invalid/v1/widgets/1",
      headers: { accept: "application/json" },
    },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body,
    },
    ...overrides,
  };
  return { citation, example, content };
}

function positiveInput(overrides = {}) {
  const { citation, example } = citedExample();
  return {
    schema: INPUT_SCHEMA,
    clock: CLOCK,
    evidenceClass: "synthetic",
    citations: [citation],
    examples: [example],
    online: defaultOnline(),
    ...overrides,
  };
}

test("self-check covers positive/negative/partial/conflict", () => {
  const result = selfCheck();
  assert.equal(result.ok, true);
  const fixtures = selfCheckFixtures();
  assert.ok(fixtures.positiveInput.examples.length === 1);
  assert.ok(Object.keys(fixtures.negativeInputs).length >= 4);
});

test("positive: full official-shaped example validates offline", () => {
  const result = validateReplayPackInput(positiveInput());
  assert.equal(result.status, "ok", JSON.stringify(result.issues));
  assert.equal(result.ok, true);
  assert.equal(result.suggestedDecision, "pass");
  assert.equal(result.onlineReplayAllowed, false);
  assert.equal(coverageForExample(positiveInput().examples[0]), "full");
  assert.equal(replayModeFor(positiveInput().examples[0], defaultOnline()), "offline-fixture");
});

test("negative: missing clock is invalid", () => {
  const result = validateReplayPackInput(positiveInput({ clock: undefined }));
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.code === "clock.required"));
});

test("negative: invented clock 'now' is invalid", () => {
  const result = validateReplayPackInput(positiveInput({ clock: "now" }));
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.code === "clock.invented"));
});

test("negative: empty examples is invalid", () => {
  const result = validateReplayPackInput(positiveInput({ examples: [] }));
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.code === "examples.minItems"));
});

test("negative: example without citationIds is invalid", () => {
  const { example } = citedExample({ citationIds: [] });
  const input = positiveInput({ examples: [example] });
  const result = validateReplayPackInput(input);
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.code === "example.citationIds"));
});

test("negative: secret header values are refused", () => {
  const { example } = citedExample({
    request: {
      method: "GET",
      url: "https://example.invalid/v1/widgets/1",
      headers: { authorization: "Bearer super-secret" },
    },
  });
  const result = validateReplayPackInput(positiveInput({ examples: [example] }));
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.code === "headers.secret"));
});

test("negative: REDACTED secret header is allowed", () => {
  const { example } = citedExample({
    request: {
      method: "GET",
      url: "https://example.invalid/v1/widgets/1",
      headers: { authorization: REDACTED, accept: "application/json" },
    },
  });
  const result = validateReplayPackInput(positiveInput({ examples: [example] }));
  assert.equal(result.status, "ok", JSON.stringify(result.issues));
});

test("negative: synthesizedResponse is refused", () => {
  const { example } = citedExample({ synthesizedResponse: true });
  const result = validateReplayPackInput(positiveInput({ examples: [example] }));
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.code === "example.synthesizedResponse"));
});

test("negative: paid-endpoint cannot be marked satisfied", () => {
  const result = validateReplayPackInput(positiveInput({
    online: {
      requested: true,
      consent: true,
      allowlistedUrls: ["https://example.invalid/v1/widgets/1"],
      prereqs: [
        ...requiredOnlinePrereqs().map((row) => ({ ...row, satisfied: true })),
        makeOnlinePrereq({ id: "paid", kind: "paid-endpoint", satisfied: true }),
      ],
    },
  }));
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.code === "prereq.blocking_satisfied"));
  assert.equal(result.onlineReplayAllowed, false);
});

test("partial: request without recorded response", () => {
  const { example } = citedExample();
  delete example.response;
  const result = validateReplayPackInput(positiveInput({ examples: [example] }));
  assert.equal(result.status, "partial", JSON.stringify(result.issues));
  assert.equal(result.ok, true);
  assert.equal(result.suggestedDecision, "partial");
  assert.ok(result.issues.some((row) => row.code === "example.coverage_partial"));
});

test("partial: citation without sha256", () => {
  const input = positiveInput();
  const { content: _omit, ...rest } = input.citations[0];
  input.citations = [{ ...rest, sha256: null, content: undefined }];
  const result = validateReplayPackInput(input);
  assert.equal(result.status, "partial");
  assert.ok(result.issues.some((row) => row.code === "citation.sha256_missing"));
});

test("partial: online requested without consent stays blocked", () => {
  const result = validateReplayPackInput(positiveInput({
    online: {
      requested: true,
      consent: false,
      prereqs: requiredOnlinePrereqs(),
      allowlistedUrls: ["https://example.invalid/v1/widgets/1"],
    },
  }));
  assert.equal(result.status, "partial");
  assert.equal(result.onlineReplayAllowed, false);
  assert.equal(replayModeFor(positiveInput().examples[0], {
    requested: true,
    consent: false,
    prereqs: requiredOnlinePrereqs(),
    allowlistedUrls: ["https://example.invalid/v1/widgets/1"],
  }), "online-blocked");
});

test("conflict: same example id with different bodies", () => {
  const { example } = citedExample();
  const result = validateReplayPackInput(positiveInput({
    examples: [
      example,
      { ...example, response: { status: 404, body: { error: "missing" } } },
    ],
  }));
  assert.equal(result.status, "conflict");
  assert.ok(result.issues.some((row) => row.code === "examples.conflict"));
});

test("conflict: live-capture citation missing retrievedAt and url", () => {
  const input = positiveInput({ evidenceClass: "live-capture" });
  input.citations = [makeCitation({
    id: "cit-widget",
    path: "cells/c21/inline-synthetic-widget.json",
    sha256: input.citations[0].sha256,
    evidenceClass: "live-capture",
  })];
  const result = validateReplayPackInput(input);
  assert.equal(result.status, "conflict");
  assert.ok(result.issues.some((row) => row.code === "citation.live_missing_retrievedAt"));
  assert.ok(result.issues.some((row) => row.code === "citation.live_missing_url"));
});

test("conflict: citation content hash mismatch", () => {
  const input = positiveInput();
  input.citations[0].content = "different-bytes";
  const result = validateReplayPackInput(input);
  assert.equal(result.status, "conflict");
  assert.ok(result.issues.some((row) => row.code === "citation.hash_mismatch"));
});

test("online-ready only when every prereq is explicit and non-blocking", () => {
  const online = {
    requested: true,
    consent: true,
    allowlistedUrls: ["https://example.invalid/v1/widgets/1"],
    prereqs: requiredOnlinePrereqs().map((row) => ({ ...row, satisfied: true })),
  };
  assert.equal(onlineReplayAllowed(online), true);
  assert.equal(replayModeFor(positiveInput().examples[0], online), "online-ready");
  const blocked = {
    ...online,
    prereqs: [
      ...online.prereqs,
      makeOnlinePrereq({ id: "spend", kind: "spend-authorization", satisfied: false }),
    ],
  };
  assert.equal(onlineReplayAllowed(blocked), false);
});

test("finding without citationIds is invalid on output", () => {
  const input = positiveInput();
  const pack = createReplayPackEnvelope({
    clock: CLOCK,
    evidenceClass: "synthetic",
    citations: input.citations,
    examples: [{ ...input.examples[0], coverage: "full", replayMode: "offline-fixture", execution: defaultExecution() }],
    findings: [{ id: "f-bad", kind: "positive", code: "x", message: "uncited", citationIds: [] }],
    decision: "pass",
  });
  const result = validateReplayPackOutput(pack);
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.code === "finding.citationIds"));
});

test("output envelope is offline, zero-spend, packet-linked", () => {
  const input = positiveInput();
  const pack = createReplayPackEnvelope({
    clock: CLOCK,
    evidenceClass: "synthetic",
    citations: input.citations,
    examples: [{
      ...input.examples[0],
      coverage: "full",
      replayMode: "offline-fixture",
      execution: defaultExecution(),
    }],
    findings: [
      makeFinding({
        id: "f-positive",
        kind: "positive",
        code: "example.full",
        message: "supplied request and recorded response",
        citationIds: ["cit-widget"],
        exampleId: "widget-get",
      }),
    ],
    decision: "pass",
  });
  assert.equal(pack.schema, OUTPUT_SCHEMA);
  assert.equal(pack.packetSchema, PACKET_SCHEMA);
  assert.equal(pack.jobId, JOB_ID);
  assert.equal(pack.artifactKind, ARTIFACT_KIND);
  assert.equal(pack.offline, true);
  assert.equal(pack.payment.attempted, false);
  assert.equal(pack.cost.assignmentSpendUsd, 0);
  assert.equal(pack.claims.inventsFacts, false);
  assert.equal(pack.claims.paidEndpoint, false);
  assert.equal(pack.summary.onlineReplayAllowed, false);
  assert.deepEqual(pack.limitations, [...SCHEMA_LIMITATIONS]);
  const result = validateReplayPackOutput(pack);
  assert.equal(result.status, "ok", JSON.stringify(result.issues));
});

test("output refuses spend and faked execution", () => {
  const input = positiveInput();
  const pack = createReplayPackEnvelope({
    clock: CLOCK,
    citations: input.citations,
    examples: [{
      ...input.examples[0],
      coverage: "full",
      execution: { status: "not-executed", fakedProviderExecution: true, providerInvoked: false },
    }],
    findings: [
      makeFinding({
        id: "f1",
        kind: "negative",
        code: "faked",
        message: "illegal fake",
        citationIds: ["cit-widget"],
      }),
    ],
    decision: "fail",
  });
  pack.cost.assignmentSpendUsd = 1;
  pack.payment.attempted = true;
  const result = validateReplayPackOutput(pack);
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.code === "execution.faked"));
  assert.ok(result.issues.some((row) => row.code === "cost.assignmentSpendUsd"));
  assert.ok(result.issues.some((row) => row.code === "payment.attempted"));
});

test("openapi example without HTTP request is partial, not invented", () => {
  const { citation } = citedExample();
  const result = validateReplayPackInput(positiveInput({
    citations: [citation],
    examples: [{
      id: "openapi-widget",
      kind: "openapi-example",
      citationIds: ["cit-widget"],
      openapi: { mediaType: "application/json", exampleName: "ok", value: { id: "1" } },
    }],
  }));
  assert.equal(result.status, "partial");
  assert.ok(result.issues.some((row) => row.code === "example.coverage_partial"));
});

test("file/mcp protocols are refused", () => {
  const { example } = citedExample({
    request: { method: "GET", url: "file:///etc/passwd" },
  });
  const result = validateReplayPackInput(positiveInput({ examples: [example] }));
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((row) => row.code === "request.url.protocol"));
});

test("sha256 helper is deterministic", () => {
  assert.equal(sha256Hex("abc"), sha256Hex("abc"));
  assert.equal(sha256Hex({ z: 1, a: 2 }), sha256Hex({ a: 2, z: 1 }));
  assert.notEqual(sha256Hex("abc"), sha256Hex("abd"));
});
