import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { getCase, loadCorpus, loadResiduals } from "samedaydesk-interop-corpus";
import {
  observeEraPin,
  observeTasksDeclared,
  observeUnknownTool,
  observeUnknownToolPairs,
  replayCorpus,
  CORPUS_REPLAY_SCHEMA,
} from "../consumer.mjs";
import { evaluateCase } from "samedaydesk-interop-corpus";
import { startLoopbackPageChange } from "../test-only/start-loopback-page-change.mjs";

let profile;

before(async () => {
  profile = await startLoopbackPageChange();
});

after(async () => {
  await profile.close();
});

test("CK-N12-001 positive: the changed implementation accepts the live sdk 1.32.2 unknown-tool error and recovers", async () => {
  const entry = getCase("CK-N12-001");
  const observed = await observeUnknownTool(profile.endpoint, "1.32.2");
  assert.equal(observed.error?.code, -32602);
  assert.equal(observed.changedAccepts, true);
  assert.deepEqual(observed.recovered, entry.recovery.expected);
});

test("CK-N12-001 failure: the recorded b38dc14b mapper reproduces the earlier negative on the live error", async () => {
  const entry = getCase("CK-N12-001");
  const observed = await observeUnknownTool(profile.endpoint, "1.32.2");
  assert.equal(observed.error.message, entry.earlierNegative.signature.message);
  const evaluated = evaluateCase(entry, observed);
  assert.equal(evaluated.earlierNegative.reproduced, true);
  assert.equal(evaluated.earlierNegative.recordedMapperError, "unknown_tool_recovery_unmapped");
  assert.equal(evaluated.earlierNegative.outcomeClass, "known_failure");
  assert.equal(evaluated.fixedMapper.accepted, true);
});

test("CK-N12-001 recovery: the case holds end to end through the normal consumer", async () => {
  const entry = getCase("CK-N12-001");
  const evaluated = evaluateCase(entry, await observeUnknownTool(profile.endpoint, "1.32.2"));
  assert.equal(evaluated.ok, true);
  assert.equal(evaluated.changedImplementation.outcomeClass, entry.outcomeClass.changedImplementation);
});

test("corpus replay: every case reproduces its earlier negative and recovers on the changed implementation", async () => {
  const replay = await replayCorpus(profile.endpoint);
  assert.equal(replay.schema, CORPUS_REPLAY_SCHEMA);
  assert.equal(replay.scope, "baseline-relative");
  assert.equal(replay.changedImplementation.commit, "c060afcd1419cafff69d3e568ae7fc3d163c79b0");
  assert.deepEqual(replay.cases.map((item) => item.caseId), loadCorpus().map((entry) => entry.id));
  for (const item of replay.cases) {
    assert.equal(item.ok, true, `${item.caseId}: ${JSON.stringify(item)}`);
  }
  assert.equal(replay.ok, true);
});

test("R-01 pairwise: unknown-tool message shape per client SDK line on 2025-11-25", async () => {
  const pairs = await observeUnknownToolPairs(profile.endpoint);
  assert.equal(pairs.length, 2);
  for (const pair of pairs) {
    assert.equal(pair.message, pair.expectedMessage, `${pair.client.package}@${pair.client.version}`);
    assert.equal(pair.recordedMapperAccepts, pair.expectedRecordedMapperAccepts);
    assert.equal(pair.changedAccepts, true);
    assert.equal(pair.recovered.charged, false);
  }
});

test("R-02 fault: the 2026-07-28 refusal carries -32000, classified unsupported, with no live migration", async () => {
  const residual = loadResiduals().residuals.find((item) => item.id === "R-02");
  const { probe, recovered } = await observeEraPin(profile.endpoint);
  assert.equal(probe.discover.status, residual.observed.discoverHttpStatus);
  assert.equal(probe.discover.errorCode, residual.observed.jsonRpcCode);
  assert.notEqual(probe.discover.errorCode, -32022);
  assert.equal(residual.liveServiceMigration, false);
  const evaluated = evaluateCase(getCase("CK-N12-002"), { probe, recovered });
  assert.equal(evaluated.earlierNegative.outcomeClass, "unsupported");
  assert.equal(evaluated.ok, true);
});

test("R-03 fault: declaring Tasks per request still returns a synchronous CallToolResult", async () => {
  const residual = loadResiduals().residuals.find((item) => item.id === "R-03");
  const observed = await observeTasksDeclared(profile.endpoint);
  assert.deepEqual(observed, residual.observed);
});
