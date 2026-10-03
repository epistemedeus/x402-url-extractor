import assert from "node:assert/strict";
import { test } from "node:test";
import { projectFunnelBaseline } from "../src/baseline.mjs";
import { aggregate, meta } from "./fixtures.mjs";

function project(doc) {
  return projectFunnelBaseline({
    coveredDocument: doc,
    coveredMeta: meta("https://agents.samedaydesk.com/v0/commerce-demand.json?days=1"),
    provenance: { testOnly: true },
  });
}

test("external result counts and crawler source counts have separate populations", () => {
  const doc = aggregate();
  doc.byResult.challenge = 7;
  doc.agentChallengeObservations = 30;
  doc.agentChallengeBySource = { "generic-agent-indexer": 25, "coinbase-bazaar": 5 };
  doc.constructedRequestEvents = 11;
  doc.constructedRequestBySource = { "direct-or-unattributed": 6, "generic-agent-indexer": 5 };
  const out = project(doc);
  assert.equal(out.stream.challengeEvents.observed, 7);
  assert.equal(out.stream.crawlerChallengeEvents.observed, 30);
  assert.equal(out.stream.constructedRequestEvents.observed, 11);
  assert.deepEqual(out.stream.sourceCounterPopulations.challengeBySource.originClasses, ["crawler"]);
  assert.deepEqual(out.stream.sourceCounterPopulations.constructedRequestBySource.originClasses, ["external", "crawler"]);
  for (const row of Object.values(out.stream.sourceCounterPopulations)) {
    assert.equal(row.samePopulationAsExternalResults, false);
    assert.equal(row.coverage, "not_inferred_from_external_stream");
  }
  assert.equal(out.stream.sourceCounterPopulations.challengeBySource.totalSourceField, "agentChallengeObservations");
  assert.equal(out.stream.sourceCounterPopulations.constructedRequestBySource.totalSourceField, "constructedRequestEvents");
  assert.equal(out.customerPlane.attributableCustomerCount, null);
  assert.equal(out.recognizedRevenueAtomic, "0");
});

for (const [label, value] of [["absent", undefined], ["negative", -1], ["fraction", 1.5], ["string", "30"]]) {
  test(`a ${label} crawler total stays unknown despite a populated source map`, () => {
    const doc = aggregate();
    doc.agentChallengeObservations = value;
    doc.agentChallengeBySource = { "generic-agent-indexer": 30 };
    const out = project(doc);
    assert.equal(out.stream.crawlerChallengeEvents.observed, null);
    assert.equal(out.stream.sourceCounterPopulations.challengeBySource.observed, null);
    assert.deepEqual(out.stream.challengeBySource, { "generic-agent-indexer": 30 });
    assert.equal(out.stream.challengeEvents.observed, 4);
  });
}

test("an explicitly observed crawler zero remains a zero, not an external rate", () => {
  const doc = aggregate();
  doc.agentChallengeObservations = 0;
  doc.agentChallengeBySource = {};
  const out = project(doc);
  assert.equal(out.stream.crawlerChallengeEvents.observed, 0);
  assert.equal(out.stream.sourceCounterPopulations.challengeBySource.observed, 0);
  assert.equal(out.stream.crawlerChallengeEvents.customerDenominator, null);
});

test("an incomplete external window does not manufacture source-population coverage", () => {
  const doc = aggregate({ complete: false });
  doc.agentChallengeObservations = 30;
  const out = project(doc);
  assert.equal(out.stream.coverage, "unknown_for_full_window");
  assert.equal(out.stream.sourceCounterPopulations.challengeBySource.coverage, "not_inferred_from_external_stream");
  assert.equal(out.stream.challengeEvents.customerDenominator, null);
});

test("missing constructed-request totals are not derived from source maps", () => {
  const doc = aggregate();
  delete doc.constructedRequestEvents;
  doc.constructedRequestBySource = { "direct-or-unattributed": 11 };
  const out = project(doc);
  assert.equal(out.stream.constructedRequestEvents.observed, null);
  assert.equal(out.stream.sourceCounterPopulations.constructedRequestBySource.observed, null);
  assert.equal(out.stream.constructedRequestEvents.reason, "matched_constructed_request_challenges_across_external_and_crawler");
});
