import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { projectBundle, retainReport } from "../../free-task-observation-100421/src/project.mjs";
import { projectFunnelBaseline } from "../src/baseline.mjs";
import { FunnelError } from "../src/errors.mjs";
import { routeForDays } from "../src/read.mjs";
import {
  joinSuppliedPhases,
  readObservationPort,
  refuseFalseComplete,
  refuseObservationAsProduction,
  rejectChangedRetention,
} from "../src/seam.mjs";
import { aggregate, meta, phase, positivePhases, references, SEEDED_PROPOSAL } from "./fixtures.mjs";

const coveredUrl = "https://agents.samedaydesk.com/v0/commerce-demand.json?days=1";
const wideUrl = "https://agents.samedaydesk.com/v0/commerce-demand.json?days=30";

function baselineFrom(covered, rare = null) {
  return projectFunnelBaseline({
    coveredDocument: covered,
    rareDocument: rare,
    coveredMeta: meta(coveredUrl),
    rareMeta: rare ? meta(wideUrl) : null,
    provenance: { model: "grok-4.7", effort: "xhigh" },
  });
}

test("covered one-day fixture keeps settlement, customers, and rare history unjoined", () => {
  const baseline = baselineFrom(
    aggregate({ days: 1, complete: true }),
    aggregate({
      days: 30,
      complete: false,
      headers: 102,
      paid: 12,
      actors: 9,
      errors: 90,
      byResult: { validation_failure: 80, paid_success: 12, challenge: 10 },
    }),
  );
  assert.equal(baseline.coveredWindow.selected, true);
  assert.equal(baseline.coveredWindow.requestedDays, 1);
  assert.equal(baseline.individualJoin, false);
  assert.equal(baseline.recognizedRevenueAtomic, "0");
  assert.equal(baseline.customerPlane.attributableCustomerCount, null);
  assert.equal(baseline.customerPlane.buyerValidDeliveryCount, null);
  assert.equal(baseline.settlementLedger.assignedToCoveredWindow, false);
  assert.equal(baseline.settlementLedger.ledgerSettlements, 43);
  assert.equal(baseline.settlementLedger.coveredWindowSettlements, null);
  assert.equal(baseline.settlementLedger.amountIsRevenue, false);
  assert.equal(baseline.settlementLedger.cohorts.probe_qa.ledgerSettlements, 1);
  assert.equal(baseline.settlementLedger.cohorts.internal_owner.ledgerSettlements, 12);
  assert.equal(baseline.settlementLedger.cohorts.unknown.ledgerSettlements, 30);
  assert.equal(baseline.settlementLedger.cohorts.sponsored.ledgerSettlements, null);
  assert.equal(baseline.settlementLedger.cohorts.recruited.ledgerSettlements, null);
  assert.equal(baseline.settlementLedger.cohorts.independent.ledgerSettlements, null);
  assert.equal(baseline.settlementLedger.cohorts.probe_qa.coveredWindowSettlements, null);
  assert.equal(baseline.rareCoveredSlice.paymentHeaderEvents.observed, 0);
  assert.equal(baseline.rareCoveredSlice.paymentHeaderEvents.census, false);
  assert.equal(baseline.rareFile.context.slice.paidSuccessEvents.observed, 12);
  assert.equal(baseline.rareFile.context.slice.paidSuccessEvents.census, false);
  assert.equal(baseline.journey.payingCustomers.observed, null);
  assert.equal(baseline.journey.independentlyUseful.observed, null);
  assert.equal(baseline.journey.authorizedRetention.observed, null);
  assert.equal(baseline.journey.laterUse.observed, null);
  assert.equal(baseline.journey.settlement.observed, null);
  assert.equal(baseline.missingLink.status, "absent");
  assert.equal(baseline.stream.paidSuccessActorHashes.census, false);
  assert.equal(baseline.eventPlanePaidActors.census, false);
});

test("an incomplete request is not a covered denominator", () => {
  const baseline = baselineFrom(aggregate({ days: 90, complete: false }));
  assert.equal(baseline.coveredWindow.selected, false);
  assert.equal(baseline.coveredWindow.requestedWindowCoverage, "unknown_for_full_window");
  assert.equal(baseline.stream.coverage, "unknown_for_full_window");
  assert.equal(baseline.journey.attempts.observed, null);
});

test("filled customer plane, revenue, and a restricted field are rejected", () => {
  assert.throws(
    () => baselineFrom(aggregate({ customers: 5 })),
    (error) => error instanceof FunnelError && error.code === "aggregate_customer_plane",
  );
  const revenue = aggregate();
  revenue.recognizedRevenue = true;
  assert.throws(
    () => baselineFrom(revenue),
    (error) => error instanceof FunnelError && error.code === "revenue_claim",
  );
  const restricted = aggregate();
  restricted.wallet = "not-a-customer";
  assert.throws(
    () => baselineFrom(restricted),
    (error) => error instanceof FunnelError && error.code === "restricted_fields",
  );
});

test("conflicting rare reads do not supply the wide numerator", () => {
  const wide = aggregate({ days: 30, complete: false, headers: 102, paid: 12, actors: 9, errors: 90, byResult: {} });
  wide.durableRareFunnel.coverage.retainedParseableRecordCount = 99;
  const baseline = baselineFrom(aggregate(), wide);
  assert.equal(baseline.rareFile.context.status, "conflicting_reads");
  assert.equal(baseline.rareFile.context.slice, null);
});

test("seeded false-complete join is rejected", () => {
  const baseline = baselineFrom(aggregate(), aggregate({ days: 30, complete: false, headers: 102, paid: 12, actors: 9, errors: 90, byResult: { paid_success: 12 } }));
  const refusal = refuseFalseComplete(baseline, SEEDED_PROPOSAL);
  assert.equal(refusal.decision, "reject");
  assert.deepEqual(refusal.reasons, [
    "actor_or_header_is_not_agent",
    "cross_rail_join_absent",
    "later_repeat_join_absent",
    "ledger_is_not_window_count",
    "owner_qa_is_not_production",
    "public_example_absent",
    "rare_zero_is_not_census",
    "settlement_is_not_customer",
    "stream_zero_does_not_cover_rare_plane",
  ]);
  assert.equal(refusal.customerDenominator, null);
  assert.equal(refusal.coveredWindowSettlements, null);
});

test("one supplied attempt joins its own phases and does not invent usefulness", () => {
  const joined = joinSuppliedPhases(positivePhases());
  assert.equal(joined.decision, "joined");
  assert.equal(joined.attempts.observed, 1);
  assert.equal(joined.attempts.customerDenominator, null);
  assert.equal(joined.deliverySuccess.observed, 1);
  assert.equal(joined.deliveryFailure.observed, 0);
  assert.equal(joined.deliveryFailure.census, false);
  assert.equal(joined.settlement.observed, 1);
  assert.equal(joined.laterUse.observed, 1);
  assert.equal(joined.laterUse.usefulness, "unknown");
  assert.equal(joined.independentlyUseful.observed, null);
  assert.equal(joined.authorizedRetention.observed, null);
});

test("duplicates do not raise the numerator", () => {
  const phases = positivePhases();
  phases.push(phases[1]);
  const joined = joinSuppliedPhases(phases);
  assert.equal(joined.decision, "joined");
  assert.equal(joined.duplicatesCollapsed, 1);
  assert.equal(joined.attempts.observed, 1);
  assert.equal(joined.deliverySuccess.observed, 1);
});

test("a missing settlement stays unknown", () => {
  const joined = joinSuppliedPhases([
    phase(),
    phase({ phase: "delivery", httpStatus: 200, bodyDigest: references.DIGEST }),
  ]);
  assert.equal(joined.decision, "joined");
  assert.equal(joined.attempts.observed, 1);
  assert.equal(joined.settlement.observed, null);
});

test("wrong settlement reference, changed later input, and cross-rail joins are refused", () => {
  const wrong = joinSuppliedPhases([
    phase({ phase: "delivery", httpStatus: 200, settlementReference: references.TX, bodyDigest: references.DIGEST }),
    phase({ phase: "settlement", settlementReference: references.OTHER }),
  ]);
  assert.equal(wrong.decision, "reject");
  assert.equal(wrong.attempts.observed, null);
  assert.equal(wrong.refusals[0].reason, "wrong_join");

  const changed = joinSuppliedPhases([
    phase({ phase: "delivery", httpStatus: 200, bodyDigest: references.DIGEST }),
    phase({ phase: "later_read", bodyDigest: references.OTHER_DIGEST }),
  ]);
  assert.equal(changed.decision, "reject");
  assert.equal(changed.refusals[0].reason, "changed_later_input");
  assert.equal(changed.laterUse.observed, null);

  const cross = joinSuppliedPhases([
    phase({ phase: "settlement", settlementReference: references.TX }),
    phase({ rail: "xrp-ledger", phase: "settlement", settlementReference: references.OTHER }),
  ]);
  assert.equal(cross.decision, "reject");
  assert.equal(cross.attempts.observed, null);
  assert.equal(cross.refusals[0].reason, "cross_rail_join_absent");
});

test("a wallet field and a later-repeat inheritance are refused", () => {
  assert.throws(
    () => joinSuppliedPhases([phase({ wallet: "not-a-customer" })]),
    (error) => error instanceof FunnelError && error.code === "wallet_or_header_is_not_identity",
  );
  assert.throws(
    () => joinSuppliedPhases([
      phase({ callId: "first-call" }),
      phase({ callId: "later-call" }),
    ], { inheritAcrossCallIds: true }),
    (error) => error instanceof FunnelError && error.code === "later_repeat_join_absent",
  );
});

test("distinct call ids stay distinct attempts", () => {
  const joined = joinSuppliedPhases([
    phase({ callId: "first-call1", phase: "delivery", httpStatus: 200 }),
    phase({ callId: "later-call1", phase: "delivery", httpStatus: 200 }),
  ]);
  assert.equal(joined.decision, "joined");
  assert.equal(joined.attempts.observed, 2);
  assert.equal(joined.attempts.customerDenominator, null);
});

test("the 421 observation port stays owner QA and a changed retention is rejected", () => {
  const bundleUrl = fileURLToPath(new URL("../../free-task-observation-100421/fixtures/after.bundle.json", import.meta.url));
  const bundle = JSON.parse(readFileSync(bundleUrl, "utf8"));
  const observation = readObservationPort(bundle);
  assert.equal(observation.populationJoinsProductionRareRows, false);
  assert.deepEqual(observation.cohorts, ["owner_qa"]);
  assert.equal(observation.independentlyUseful.observed, 2);
  assert.equal(observation.authorizedRetention.observed, 4);
  assert.equal(observation.laterUse.observed, 2);
  assert.equal(observation.settlement, "unknown");
  assert.equal(observation.recognizedRevenueAtomic, "0");
  assert.deepEqual(refuseObservationAsProduction(observation, {}), {
    decision: "kept_separate",
    productionAttemptsJoined: null,
  });
  assert.throws(
    () => refuseObservationAsProduction(observation, { productionPopulation: true }),
    (error) => error instanceof FunnelError && error.code === "owner_qa_is_not_production",
  );
  const report = projectBundle(bundle);
  const receipt = retainReport(bundle, report);
  receipt.report.journeys[0].usefulness = "changed";
  const rejected = rejectChangedRetention(receipt);
  assert.equal(rejected.decision, "reject");
  assert.equal(rejected.reason, "replay_mismatch");
  assert.equal(rejected.inheritedUsefulness, null);
});

test("only the existing commerce-demand day query is readable", () => {
  assert.equal(routeForDays(1), coveredUrl);
  assert.throws(
    () => routeForDays(0),
    (error) => error instanceof FunnelError && error.code === "public_aggregate_rejected",
  );
});
