import assert from "node:assert/strict";
import test from "node:test";

import {
  LAYER1_NAME,
  compose,
  providerNativeVerifiedFromComposition,
} from "../src/compose.mjs";
import { evaluateLayer1 } from "../src/layer1.mjs";
import { loadLayer2 } from "../src/layer2.mjs";
import { OBSERVATION_FIXTURE_FILES, PUBLISHED_RESULT_FIXTURE } from "../src/paths.mjs";
import { readJson } from "./helpers.mjs";

test("missing required observations plus layer-2 19/19 does not invent providerNativeVerified", () => {
  const result = compose({ observationsPath: OBSERVATION_FIXTURE_FILES.missingRequired });
  assert.equal(result.layers[LAYER1_NAME].status, "evaluated");
  assert.equal(result.layers[LAYER1_NAME].evaluation.decision, "partial");
  assert.deepEqual(result.layers[LAYER1_NAME].providerNativeVerified, []);
  assert.deepEqual(result.providerNativeVerified.controls, []);
  assert.equal(result.providerNativeVerified.upgradedFromLayer2, false);
  assert.equal(result.layers.layer2_independent_basepay_conformance.replay.checks.passed, 19);
  assert.equal(result.mappingCoverage.confirmation, "author_claim_only");
  for (const control of result.mappingCoverage.cases.covered) {
    assert.equal(result.providerNativeVerified.controls.includes(control), false);
  }
});

test("promoteFromLayer2 is refused and cannot copy mapping coverage into providerNativeVerified", () => {
  const result = compose({
    observationsPath: OBSERVATION_FIXTURE_FILES.missingRequired,
    promoteFromLayer2: true,
  });
  assert.equal(result.promotionRefused.fromLayer2ToProviderNativeVerified, true);
  assert.equal(result.promotionRefused.requestedPromoteFromLayer2, true);
  assert.equal(result.providerNativeVerified.refused, true);
  assert.equal(result.providerNativeVerified.upgradedFromLayer2, false);
  assert.deepEqual(result.providerNativeVerified.controls, []);
  assert.match(result.providerNativeVerified.reason, /cannot upgrade/);
});

test("BasePay result JSON cannot be evaluated as layer-1 observations", () => {
  const result = compose({ observations: readJson(PUBLISHED_RESULT_FIXTURE) });
  assert.equal(result.layers[LAYER1_NAME].status, "rejected");
  assert.equal(result.layers[LAYER1_NAME].kind, "wrong_layer");
  assert.deepEqual(result.providerNativeVerified.controls, []);
  assert.equal(result.layers.layer2_independent_basepay_conformance.checks.independentCount, 19);
});

test("helper refuses to union layer-2 mapping controls with layer-1 output", () => {
  const layer1 = evaluateLayer1(readJson(OBSERVATION_FIXTURE_FILES.missingRequired));
  const layer2 = loadLayer2();
  const verified = providerNativeVerifiedFromComposition(layer1, layer2, { promoteFromLayer2: true });
  assert.deepEqual(verified.controls, []);
  assert.equal(verified.upgradedFromLayer2, false);
  assert.equal(
    verified.controls.some((control) => layer2.mapping.covered.includes(control) || layer2.mapping.partial.includes(control)),
    false,
  );
});

test("application serialization stays off providerNativeVerified even when layer 1 credits it as application", () => {
  const result = compose({ observationsPath: OBSERVATION_FIXTURE_FILES.completeSafe });
  assert.ok(result.layers[LAYER1_NAME].applicationVerified.includes("application_serialization"));
  assert.equal(result.providerNativeVerified.controls.includes("application_serialization"), false);
  assert.ok(result.mappingCoverage.cases.gap.includes("application_serialized_concurrent_exceeds_cap"));
});
