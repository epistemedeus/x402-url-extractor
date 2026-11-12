import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCase, getCase, recordedShaOnlySourceCheck, recordedUnknownToolMapper } from "../src/index.mjs";

const unknownTool = getCase("CK-N12-001");
const eraPin = getCase("CK-N12-002");
const sdkDrift = getCase("CK-N12-003");
const serviceDrift = getCase("CK-N12-004");
const recordedError = () => {
  const { code, message, data } = unknownTool.earlierNegative.signature;
  return Object.assign(new Error(message), { code, data });
};
const recovered = { listed: ["compare_page_observations"], charged: false, verdict: "changed" };

test("failure: the b38dc14b mapper reproduces the earlier negative on the sdk 1.32.2 message", () => {
  assert.throws(() => recordedUnknownToolMapper("b38dc14b")(recordedError(), { attemptedName: "page_change" }), { message: "unknown_tool_recovery_unmapped" });
  const fixed = recordedUnknownToolMapper("24556fe2")(recordedError(), { attemptedName: "page_change" });
  assert.deepEqual(fixed, { nextMethod: "tools/list", tool: "compare_page_observations", paidFallback: false });
});

test("positive and recovery: the changed implementation accepts and recovers, so the case holds", () => {
  const result = evaluateCase(unknownTool, { error: recordedError(), changedAccepts: true, recovered, attemptedName: "page_change" });
  assert.equal(result.ok, true);
  assert.equal(result.earlierNegative.outcomeClass, "known_failure");
  assert.equal(result.earlierNegative.recordedMapperError, "unknown_tool_recovery_unmapped");
  assert.equal(result.changedImplementation.outcomeClass, "successful");
});

test("failure: a changed implementation that does not recover breaks the case", () => {
  const result = evaluateCase(unknownTool, { error: recordedError(), changedAccepts: true, recovered: { ...recovered, charged: true } });
  assert.equal(result.ok, false);
  assert.equal(result.changedImplementation.outcomeClass, "known_failure");
});

test("pairwise: the unprefixed 2.4.0 message does not reproduce the negative (residual R-01)", () => {
  const unprefixed = Object.assign(new Error("Unknown tool"), { code: -32602, data: unknownTool.earlierNegative.signature.data });
  const result = evaluateCase(unknownTool, { error: unprefixed, changedAccepts: true, recovered });
  assert.equal(result.earlierNegative.reproduced, false);
  assert.equal(result.ok, false);
});

test("era pin: recorded refusal is unsupported and default negotiation recovers", () => {
  const probe = {
    connected: false,
    code: "ERA_NEGOTIATION_FAILED",
    discover: { status: 400, errorCode: -32000, errorMessage: "Unsupported protocol version: 2026-07-28 (supported versions: 2025-11-25)" },
  };
  const result = evaluateCase(eraPin, { probe, recovered: { protocol: null, charged: false, verdict: "changed", paymentSignature: null } });
  assert.equal(result.ok, true);
  assert.equal(result.earlierNegative.outcomeClass, "unsupported");
  const wrongProtocol = evaluateCase(eraPin, { probe, recovered: { protocol: "2026-07-28", charged: false, verdict: "changed", paymentSignature: null } });
  assert.equal(wrongProtocol.ok, false);
});

test("source drift: the 967ec6a2 sha-only check misses the version change that c060afcd classifies", () => {
  const expected = { repo: "epistemedeus/x402-url-extractor", sha: sdkDrift.replay.beforeCommit, sdkVersion: "1.30.0", serviceVersion: "1.23.55" };
  const observed = { repo: "epistemedeus/x402-url-extractor", sha: "e90676f48da875c5e0f475f57f7774de947b75a7", sdkVersion: "1.32.2", serviceVersion: "1.23.55" };
  assert.equal(recordedShaOnlySourceCheck(expected, observed).sdkClassified, false);
  const drift = { ok: true, classification: "compatible-minor", changes: [{ kind: "client_sdk_changed", recovery: { action: "reconnect", protocol: "2025-11-25" } }] };
  assert.equal(evaluateCase(sdkDrift, { expected, observed, drift }).ok, true);
  const unmapped = { ok: false, classification: "unmapped", changes: [] };
  assert.equal(evaluateCase(sdkDrift, { expected, observed, drift: unmapped }).ok, false);

  const before = { repo: expected.repo, sha: serviceDrift.replay.beforeCommit, sdkVersion: "1.30.0", serviceVersion: "1.23.54" };
  const afterFacts = { repo: expected.repo, sha: serviceDrift.replay.afterCommit, sdkVersion: "1.30.0", serviceVersion: "1.23.55" };
  const serviceResult = { ok: true, classification: "compatible-minor", changes: [{ kind: "source_version_changed", recovery: { action: "re_pin" } }] };
  assert.equal(evaluateCase(serviceDrift, { expected: before, observed: afterFacts, drift: serviceResult }).ok, true);
});
