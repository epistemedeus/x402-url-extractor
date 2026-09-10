import assert from "node:assert/strict";
import test from "node:test";

import { LAYER1_NAME, buildObservationMatrix, compose } from "../src/compose.mjs";
import { evaluateLayer1 } from "../src/layer1.mjs";
import { loadLayer2 } from "../src/layer2.mjs";
import { BasePayCompositionError } from "../src/errors.mjs";
import { OBSERVATION_FIXTURE_FILES } from "../src/paths.mjs";
import { cloneReplay, writeTempJson } from "./helpers.mjs";

test("missing required cases evaluate as partial and do not complete the matrix", () => {
  const result = compose({ observationsPath: OBSERVATION_FIXTURE_FILES.missingRequired });
  const layer1 = result.layers[LAYER1_NAME];
  assert.equal(layer1.status, "evaluated");
  assert.equal(layer1.kind, "partial");
  assert.equal(layer1.evaluation.complete, false);
  assert.ok(layer1.evaluation.missingRequiredCases.includes("sequential_exceeds_cap"));
  assert.deepEqual(result.providerNativeVerified.controls, []);
});

test("partial provider-error observations stay non-conformant", () => {
  const result = compose({ observationsPath: OBSERVATION_FIXTURE_FILES.partial });
  const layer1 = result.layers[LAYER1_NAME];
  assert.equal(layer1.status, "evaluated");
  assert.notEqual(layer1.evaluation.decision, "conformant");
  assert.ok(layer1.evaluation.inconclusiveCases.includes("extraction_integrity") || layer1.providerNativeUnverified.includes("extraction_integrity"));
  assert.equal(result.providerNativeVerified.controls.includes("extraction_integrity"), false);
  assert.equal(result.layers.layer2_independent_basepay_conformance.replay.checks.passed, 19);
});

test("contradictory deny-without-enforcementClass is rejected as contradictory", () => {
  const result = compose({ observationsPath: OBSERVATION_FIXTURE_FILES.contradictory });
  assert.equal(result.layers[LAYER1_NAME].status, "rejected");
  assert.equal(result.layers[LAYER1_NAME].kind, "contradictory");
  assert.deepEqual(result.providerNativeVerified.controls, []);
});

test("unknown case names are rejected without touching layer 2", () => {
  const result = compose({ observationsPath: OBSERVATION_FIXTURE_FILES.unknownCase });
  assert.equal(result.layers[LAYER1_NAME].kind, "unknown_case");
  assert.equal(result.layers.layer2_independent_basepay_conformance.checks.independentCount, 19);
});

test("version-skew schemaVersion is rejected as version_change", () => {
  const result = compose({ observationsPath: OBSERVATION_FIXTURE_FILES.versionSkew });
  assert.equal(result.layers[LAYER1_NAME].kind, "version_change");
  assert.match(result.layers[LAYER1_NAME].rejection.message, /unsupported stateful wallet policy observation schema/);
});

test("duplicate cases, extra fields, and credentials are contradictory or rejected", () => {
  const duplicate = buildObservationMatrix({ includeOptional: false });
  duplicate.observations.push({ ...duplicate.observations[0] });
  assert.equal(evaluateLayer1(duplicate).kind, "contradictory");

  const extras = buildObservationMatrix();
  extras.observations[1] = { ...extras.observations[1], rawCounter: 1 };
  assert.equal(evaluateLayer1(extras).kind, "contradictory");

  const secrets = { ...buildObservationMatrix(), apiKey: "secret" };
  assert.equal(evaluateLayer1(secrets).kind, "contradictory");
});

test("layer-2 schema or commit skew is version_change and does not confirm coverage", () => {
  const forged = cloneReplay();
  forged.schema_version = "2.0.0";
  const path = writeTempJson("version-skew-result.json", forged);
  assert.throws(
    () => loadLayer2({ replayResultPath: path }),
    (error) => error instanceof BasePayCompositionError && error.kind === "version_change",
  );

  const otherCommit = cloneReplay();
  otherCommit.fixture.commit = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  const otherPath = writeTempJson("other-commit.json", otherCommit);
  assert.throws(
    () => loadLayer2({ replayResultPath: otherPath }),
    (error) => error instanceof BasePayCompositionError && error.kind === "version_change",
  );
});
