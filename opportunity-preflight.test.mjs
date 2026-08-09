import assert from "node:assert/strict";
import test from "node:test";

import { opportunityPreflight } from "./opportunity-preflight.mjs";
import { getPlatformHealthCard } from "./platform-health.mjs";

const base = {
  rewardUsd: 10,
  hours: 0.25,
  hourlyCostUsd: 4,
  computeUsd: 0.5,
  mandatorySpendUsd: 0,
  reusableValueUsd: 1,
  selectionProbabilityPct: 80,
  competition: 1,
  slots: 1,
  agentAccess: "agent_allowed",
  acceptance: "deterministic",
  settlement: "escrow",
};

test("attempts a positive-surplus deterministic funded opportunity", () => {
  const result = opportunityPreflight(base);
  assert.equal(result.decision, "attempt");
  assert.equal(result.economics.executionCostUsd, 1.5);
  assert.equal(result.economics.expectedRewardUsd, 8);
  assert.equal(result.economics.expectedSurplusUsd, 7.5);
  assert.equal(result.economics.breakEvenSelectionProbabilityPct, 5);
});

test("abandons human-only, unfunded, or negative-surplus work", () => {
  assert.equal(opportunityPreflight({ ...base, agentAccess: "human_only" }).decision, "abandon");
  assert.equal(opportunityPreflight({ ...base, settlement: "unfunded" }).decision, "abandon");
  const negative = opportunityPreflight({ ...base, hours: 5, hourlyCostUsd: 20, reusableValueUsd: 0 });
  assert.equal(negative.decision, "abandon");
  assert.ok(negative.economics.expectedSurplusUsd < 0);
  assert.ok(negative.economics.breakEvenSelectionProbabilityPct > 100);
});

test("requires verification when probability or decisive policy facts are absent", () => {
  const missingProbability = opportunityPreflight({ ...base, selectionProbabilityPct: undefined });
  assert.equal(missingProbability.decision, "verify_first");
  assert.deepEqual(missingProbability.gates.requiredChecks, ["supply_selection_probability_pct"]);

  const unknownPolicy = opportunityPreflight({
    ...base,
    agentAccess: "unknown",
    acceptance: "unknown",
    settlement: "unknown",
  });
  assert.equal(unknownPolicy.decision, "verify_first");
  assert.deepEqual(unknownPolicy.gates.requiredChecks, [
    "verify_agent_access",
    "verify_acceptance_mechanism",
    "verify_settlement_state",
  ]);
  const unknownPlatform = opportunityPreflight({ ...base, platform: "unmapped-market" });
  assert.equal(unknownPlatform.decision, "verify_first");
  assert.ok(unknownPlatform.gates.requiredChecks.includes("platform_evidence_not_available_reverify_primary_source"));
});

test("adds dated platform evidence without turning it into a probability", () => {
  const card = getPlatformHealthCard("taskmarket", new Date("2026-08-09T08:00:00Z"));
  const result = opportunityPreflight({
    ...base,
    platform: "taskmarket",
    competition: 80,
    slots: 1,
    selectionProbabilityPct: 2,
  }, { platformCard: card });
  assert.equal(result.platformEvidence.platformId, "taskmarket");
  assert.equal(result.platformEvidence.healthCategory, "OVERSUPPLY_LOTTERY");
  assert.equal(result.economics.equalEntryShareReferencePct, 1.25);
  assert.ok(result.gates.warnings.includes("platform_has_observed_oversupply_or_selection_dilution"));
  assert.match(result.economics.equalEntryShareBoundary, /not a payout probability/);
});

test("fails closed on malformed numeric or enum inputs", () => {
  assert.throws(() => opportunityPreflight({ ...base, rewardUsd: "nan" }), /rewardUsd/);
  assert.throws(() => opportunityPreflight({ ...base, selectionProbabilityPct: 101 }), /selectionProbabilityPct/);
  assert.throws(() => opportunityPreflight({ ...base, agentAccess: "maybe" }), /agentAccess/);
  assert.throws(() => opportunityPreflight({ ...base, slots: 0 }), /slots/);
});
