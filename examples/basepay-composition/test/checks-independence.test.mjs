import assert from "node:assert/strict";
import test from "node:test";

import { BASEPAY_CHECK_COUNT, BASEPAY_CHECK_IDS, compose } from "../src/compose.mjs";
import { CHECK_COUNT_NOT_DERIVED_FROM, CHECK_COUNT_SOURCE } from "../src/canonical-checks.mjs";
import { independentTipReplayConfirmed } from "../src/evidence.mjs";
import { BasePayCompositionError } from "../src/errors.mjs";
import { loadLayer2 } from "../src/layer2.mjs";
import { STATEFUL_WALLET_POLICY_CASE_NAMES } from "../../../stateful-wallet-policy-conformance.mjs";
import { BASEPAY_TIP_COMMIT, MERCHANT_CASE_NAMES, RESULT_GIT_BLOB, REPLAY_RESULT_GIT_BLOB } from "../src/pins.mjs";
import { OBSERVATION_FIXTURE_FILES } from "../src/paths.mjs";
import { clonePublished, cloneReplay, writeTempJson } from "./helpers.mjs";

test("canonical BasePay check IDs are the harness identity of 19, not merchant or mapping counts", () => {
  assert.equal(BASEPAY_CHECK_IDS.length, 19);
  assert.equal(BASEPAY_CHECK_COUNT, 19);
  assert.deepEqual(BASEPAY_CHECK_IDS, [
    "P0", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9",
    "F10", "F11", "F12", "F13", "F14", "F15", "F16", "F16b", "F17",
  ]);
  assert.equal(MERCHANT_CASE_NAMES.length, 7);
  assert.equal(STATEFUL_WALLET_POLICY_CASE_NAMES.length, 7);
  assert.notEqual(BASEPAY_CHECK_COUNT, MERCHANT_CASE_NAMES.length);
  assert.equal(CHECK_COUNT_SOURCE, "basepay-conformance/result.checks");
  assert.ok(CHECK_COUNT_NOT_DERIVED_FROM.includes("example_unit_tests"));
  assert.ok(CHECK_COUNT_NOT_DERIVED_FROM.includes("merchant_stateful_case_count"));
});

test("published and replay results independently carry the same 19 check IDs", () => {
  const layer2 = loadLayer2();
  assert.deepEqual([...layer2.published.checks.ids], [...BASEPAY_CHECK_IDS]);
  assert.deepEqual([...layer2.replay.checks.ids], [...BASEPAY_CHECK_IDS]);
  assert.equal(layer2.published.checks.source, CHECK_COUNT_SOURCE);
  assert.equal(layer2.replay.checks.independentCount, 19);
  assert.equal(layer2.checks.notDerivedFrom.includes("example_unit_tests"), true);
  assert.equal(layer2.published.checks.passed, 19);
  assert.equal(layer2.replay.checks.passed, 19);
  assert.equal(layer2.published.evidenceOrigin, "synthetic_offline_fixture");
  assert.equal(layer2.replay.evidenceOrigin, "synthetic_offline_fixture");
  assert.equal(layer2.replay.independentTipReplay, false);
  assert.equal(
    independentTipReplayConfirmed({
      gitBlobSha: REPLAY_RESULT_GIT_BLOB,
      commit: BASEPAY_TIP_COMMIT,
      replayPass: true,
    }),
    true,
  );
  assert.equal(
    independentTipReplayConfirmed({
      gitBlobSha: RESULT_GIT_BLOB,
      commit: BASEPAY_TIP_COMMIT,
      replayPass: true,
    }),
    false,
  );
});

test("layer-2 check count is read from the result fixture, not from this suite", () => {
  const result = compose({ observationsPath: OBSERVATION_FIXTURE_FILES.completeSafe });
  const checks = result.layers.layer2_independent_basepay_conformance.checks;
  assert.equal(checks.source, CHECK_COUNT_SOURCE);
  assert.equal(checks.independentCount, 19);
  assert.equal(checks.notDerivedFrom.includes("example_unit_tests"), true);
  assert.notEqual(checks.independentCount, MERCHANT_CASE_NAMES.length);
});

test("a 19-row result with the wrong check IDs is rejected", () => {
  const forged = cloneReplay();
  forged.checks.cases = forged.checks.cases.map((row, index) => ({
    ...row,
    id: `T${index + 1}`,
  }));
  const path = writeTempJson("wrong-ids.json", forged);
  assert.throws(
    () => loadLayer2({ replayResultPath: path }),
    (error) => error instanceof BasePayCompositionError && error.kind === "check_identity",
  );
});

test("checks.total 19 with fewer case rows is rejected", () => {
  const forged = clonePublished();
  forged.checks.cases = forged.checks.cases.slice(0, 18);
  const path = writeTempJson("short-cases.json", forged);
  assert.throws(
    () => loadLayer2({ publishedResultPath: path }),
    /git blob|check IDs|harness identity/,
  );
});
