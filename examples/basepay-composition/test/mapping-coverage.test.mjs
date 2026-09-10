import assert from "node:assert/strict";
import test from "node:test";

import { compose } from "../src/compose.mjs";
import { loadLayer2 } from "../src/layer2.mjs";
import { EXPECTED_MAPPING_COVERAGE, MERCHANT_CASE_NAMES } from "../src/pins.mjs";
import { OBSERVATION_FIXTURE_FILES } from "../src/paths.mjs";
import { cloneMapping, writeTempJson } from "./helpers.mjs";

test("mapping coverage is 4 covered / 1 partial / 2 gaps from the mapping file", () => {
  const layer2 = loadLayer2();
  assert.deepEqual(layer2.mapping.summary, { covered: 4, partial: 1, gap: 2 });
  assert.deepEqual([...layer2.mapping.covered], [...EXPECTED_MAPPING_COVERAGE.covered]);
  assert.deepEqual([...layer2.mapping.partial], [...EXPECTED_MAPPING_COVERAGE.partial]);
  assert.deepEqual([...layer2.mapping.gap], [...EXPECTED_MAPPING_COVERAGE.gap]);
  assert.equal(layer2.mapping.matchesAuthorClaim, true);
  assert.equal(layer2.mapping.confirmation, "author_claim_only");
  assert.equal(layer2.mapping.confirmationScope, "not replay-confirmed");
  assert.equal(layer2.mapping.evidenceOrigin, "synthetic_offline_fixture");
  assert.equal(layer2.mapping.fullStatefulCoverage, false);
});

test("mapping case names are the exact merchant stateful case strings", () => {
  const layer2 = loadLayer2();
  assert.deepEqual(layer2.mapping.rows.map((row) => row.case), [...MERCHANT_CASE_NAMES]);
});

test("composition records 4/1/2 as author_claim_only on the synthetic default path", () => {
  const result = compose({ observationsPath: OBSERVATION_FIXTURE_FILES.completeSafe });
  assert.equal(result.mappingCoverage.covered, 4);
  assert.equal(result.mappingCoverage.partial, 1);
  assert.equal(result.mappingCoverage.gap, 2);
  assert.equal(result.mappingCoverage.confirmation, "author_claim_only");
  assert.equal(result.mappingCoverage.confirmationScope, "not replay-confirmed");
  assert.equal(result.mappingCoverage.fullStatefulCoverage, false);
  assert.equal(result.evidenceClasses.independently_executed_harness_result, null);
  assert.equal(result.mappingCoverage.revision.basepayTip, "94fa65d65c204c02f4af5a9bc9fd27225c688994");
  assert.equal(result.mappingCoverage.revision.publishedResultFixtureCommit, "8a46910ede4830de8481a3ae7f095e120a312d62");
});

test("without an independent tip replay, coverage stays author_claim_only", () => {
  const layer2 = loadLayer2({ replayResultPath: null, requireReplay: false });
  assert.equal(layer2.replay, null);
  assert.equal(layer2.mapping.matchesAuthorClaim, true);
  assert.equal(layer2.mapping.confirmation, "author_claim_only");
  assert.equal(layer2.mapping.fullStatefulCoverage, false);
});

test("a mapping that claims full coverage is not confirmed", () => {
  const forged = cloneMapping();
  for (const row of forged.mapping) row.coverage = "covered";
  const path = writeTempJson("all-covered.json", forged);
  const layer2 = loadLayer2({ mappingPath: path });
  assert.equal(layer2.mapping.matchesAuthorClaim, false);
  assert.equal(layer2.mapping.confirmation, "rejected_mismatch");
  assert.equal(layer2.mapping.fullStatefulCoverage, false);
  assert.equal(layer2.mapping.evidenceOrigin, "caller_supplied_unverified_report");
});
