import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPOSITION_SCHEMA,
  LAYER1_NAME,
  LAYER1_TITLE,
  LAYER2_NAME,
  LAYER2_TITLE,
  compose,
} from "../src/compose.mjs";
import { OBSERVATION_FIXTURE_FILES } from "../src/paths.mjs";

function report(observationsPath = OBSERVATION_FIXTURE_FILES.completeSafe) {
  return compose({ observationsPath });
}

test("composition report names both evidence layers and keeps them separate", () => {
  const result = report();
  assert.equal(result.schemaVersion, COMPOSITION_SCHEMA);
  assert.equal(result.layerNames[LAYER1_NAME], LAYER1_TITLE);
  assert.equal(result.layerNames[LAYER2_NAME], LAYER2_TITLE);
  assert.equal(result.layers[LAYER1_NAME].name, LAYER1_NAME);
  assert.equal(result.layers[LAYER2_NAME].name, LAYER2_NAME);
  assert.notEqual(result.layers[LAYER1_NAME], result.layers[LAYER2_NAME]);
  assert.equal(result.layers[LAYER1_NAME].authority.evaluator, "statefulWalletPolicyConformance");
  assert.equal(result.layers[LAYER1_NAME].evidenceOrigin, "caller_supplied_observation_assertions");
  assert.equal(result.layers[LAYER2_NAME].authority.officialCommand, "npm run conformance");
  assert.equal(result.layers[LAYER2_NAME].published.evidenceOrigin, "synthetic_offline_fixture");
  assert.equal(result.evidenceClasses.caller_layer1_observation_assertions, "caller_supplied_observation_assertions");
  assert.equal(result.evidenceClasses.independently_executed_harness_result, null);
  assert.equal(result.boundary.credentialsAccepted, false);
  assert.equal(result.boundary.walletAccessed, false);
  assert.equal(result.boundary.liveWalletAssurance, false);
  assert.equal(result.boundary.paidProviderApi, false);
});

test("layer-1 decision is not a layer-2 claim and layer-2 does not claim full stateful coverage", () => {
  const result = report();
  const layer1 = result.layers[LAYER1_NAME];
  const layer2 = result.layers[LAYER2_NAME];
  assert.equal(layer1.status, "evaluated");
  assert.equal(layer1.evaluation.decision, "conformant");
  assert.equal(layer1.evaluation.product, "samedaydesk-stateful-wallet-policy-conformance");
  assert.equal(layer2.mapping.fullStatefulCoverage, false);
  assert.equal(layer2.published.fullStatefulCoverage, false);
  assert.equal(layer2.published.liveWalletAssurance, false);
  assert.equal(layer2.replay.liveWalletAssurance, false);
  assert.equal(result.mappingCoverage.fullStatefulCoverage, false);
  assert.match(result.mappingCoverage.statement, /not full stateful coverage/);
  assert.equal(Object.hasOwn(layer2, "providerNativeVerified"), false);
  assert.equal(Object.hasOwn(layer2.published, "providerNativeVerified"), false);
});

test("layer-1 provider-native controls stay on layer 1 even when layer 2 is 19/19", () => {
  const result = report();
  const layer1 = result.layers[LAYER1_NAME];
  assert.deepEqual(layer1.providerNativeVerified, [
    "cumulative_limit",
    "post_sign_accounting",
    "extraction_integrity",
    "concurrency",
    "reference_integrity",
  ]);
  assert.deepEqual(layer1.applicationVerified, ["application_serialization"]);
  assert.equal(result.providerNativeVerified.source, LAYER1_NAME);
  assert.deepEqual(result.providerNativeVerified.controls, layer1.providerNativeVerified);
  assert.equal(result.providerNativeVerified.upgradedFromLayer2, false);
  assert.equal(result.layers[LAYER2_NAME].checks.independentCount, 19);
  assert.equal(result.layers[LAYER2_NAME].replay.checks.passed, 19);
});
