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

test("a missing origin split stays unknown and does not turn external events into outside customers", () => {
  const out = project(aggregate());
  assert.equal(out.stream.trafficProvenance.status, "unknown");
  assert.equal(out.stream.externalEvents.observed, 10);
  assert.equal(out.stream.externalEvents.customerDenominator, null);
  assert.equal(out.stream.trafficProvenance.historicalBackfill, false);
  assert.equal(out.rareCoveredSlice.originPopulations.status, "unknown");
  assert.equal(out.recognizedRevenueAtomic, "0");
});

test("present provenance populations stay separate from external events and cannot grant outside demand", () => {
  const doc = aggregate();
  doc.externalEvents = 4;
  doc.trafficProvenance = {
    schemaVersion: "samedaydesk.commerce-traffic-provenance.v1",
    historicalBackfill: true,
    populations: {
      verifiedInternal: { events: 3, paidSuccesses: 1, constructedChallenges: 2, credentialAttempts: 1, provedOutsideDemand: true, verification: "verified_internal_token" },
      selfReportedOwnerMonitor: { events: 2, paidSuccesses: 0, constructedChallenges: 2, credentialAttempts: 0, verification: "unverified" },
      unattributedExternal: { events: 4, paidSuccesses: 0, constructedChallenges: 1, credentialAttempts: 0, verification: "unverified", independentDemand: true },
    },
  };
  doc.durableRareFunnel.originPopulations = {
    verifiedInternal: { paymentHeaderEvents: 1, paidSuccessEvents: 1, parseableCredentialAttemptEvents: 1, verification: "verified_internal_token", provedOutsideDemand: true },
    unattributedExternal: { paymentHeaderEvents: 0, paidSuccessEvents: 0, parseableCredentialAttemptEvents: 0, verification: "unverified" },
  };
  const out = project(doc);
  assert.equal(out.stream.externalEvents.observed, 4);
  assert.equal(out.stream.trafficProvenance.status, "present");
  assert.equal(out.stream.trafficProvenance.historicalBackfill, false);
  assert.equal(out.stream.trafficProvenance.selfReportedGrantsTrust, false);
  assert.equal(out.stream.trafficProvenance.verifiedInternal.events, 3);
  assert.equal(out.stream.trafficProvenance.verifiedInternal.provedOutsideDemand, false);
  assert.equal(out.stream.trafficProvenance.selfReportedOwnerMonitor.events, 2);
  assert.equal(out.stream.trafficProvenance.unattributedExternal.events, 4);
  assert.equal(out.stream.trafficProvenance.unattributedExternal.independentDemand, false);
  assert.equal(out.rareCoveredSlice.originPopulations.status, "present");
  assert.equal(out.rareCoveredSlice.originPopulations.verifiedInternal.paidSuccessEvents, 1);
  assert.equal(out.rareCoveredSlice.originPopulations.verifiedInternal.provedOutsideDemand, false);
  assert.equal(out.rareCoveredSlice.paidSuccessEvents.observed, 0);
  assert.equal(out.customerPlane.attributableCustomerCount, null);
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
