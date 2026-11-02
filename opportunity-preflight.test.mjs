import assert from "node:assert/strict";
import test from "node:test";

import Ajv from "ajv";

import {
  normalizeOpportunityPreflightRequest,
  opportunityPreflight,
  opportunityPreflightGetOutputSchema,
  opportunityPreflightOutputSchema,
  opportunityPreflightTrial,
  opportunityPreflightTrialOutputSchema,
} from "./opportunity-preflight.mjs";
import { getPlatformHealthCard, PLATFORM_HEALTH_CARDS, projectPlatformHealthCard } from "./platform-health.mjs";

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
  const schema = opportunityPreflightOutputSchema();
  for (const field of schema.required) assert.equal(Object.hasOwn(result, field), true);
  for (const field of schema.properties.economics.required) {
    assert.equal(Object.hasOwn(result.economics, field), true);
  }
  assert.equal(result.platformEvidence, null);
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

test("permits only credential-free empty HEAD and POST registry probes", () => {
  assert.deepEqual(
    normalizeOpportunityPreflightRequest({ method: "HEAD" }),
    { discoveryProbe: true, input: {} },
  );
  assert.deepEqual(
    normalizeOpportunityPreflightRequest({ method: "POST", body: {} }),
    { discoveryProbe: true, input: {} },
  );
  assert.throws(
    () => normalizeOpportunityPreflightRequest({ method: "POST", body: {}, hasPaymentCredential: true }),
    /rewardUsd is required/,
  );
  assert.throws(
    () => normalizeOpportunityPreflightRequest({ method: "GET", query: {} }),
    /rewardUsd is required/,
  );
});

test("normalizes workflow JSON input through the same opportunity contract", () => {
  const result = normalizeOpportunityPreflightRequest({
    method: "POST",
    body: {
      platform: " TaskMarket ",
      rewardUsd: 10,
      hours: 0.25,
      hourlyCostUsd: 4,
      selectionProbabilityPct: 2,
    },
  });
  assert.equal(result.discoveryProbe, false);
  assert.equal(result.input.platform, "taskmarket");
  assert.equal(result.input.rewardUsd, 10);
  assert.equal(result.input.hours, 0.25);
  assert.equal(result.input.hourlyCostUsd, 4);
});

test("returns a fixed uncharged trial without weakening custom-input validation", () => {
  const trial = opportunityPreflightTrial();
  assert.equal(trial.ok, true);
  assert.equal(trial.sample, true);
  assert.equal(trial.charged, false);
  assert.equal(trial.decision, "attempt");
  assert.equal(trial.input.rewardUsd, 100);
  assert.equal(trial.input.selectionProbabilityPct, 25);
  assert.match(trial.trial.next, /0\.05-USDC/);
  assert.throws(
    () => normalizeOpportunityPreflightRequest({ method: "GET", query: { trial: "1" } }),
    /rewardUsd is required/,
  );
});

const AGENT_ACCESS_VALUES = ["agent_allowed", "agent_only", "mixed", "human_only", "unknown"];
const ACCEPTANCE_VALUES = ["deterministic", "machine_scored", "timed_review", "discretionary", "unknown"];
const SETTLEMENT_VALUES = ["direct", "escrow", "platform_balance", "discretionary", "unfunded", "unknown"];
const PAID_INPUT_SHAPES = Object.freeze([
  {},
  { selectionProbabilityPct: undefined },
  { selectionProbabilityPct: 0 },
  { selectionProbabilityPct: 100 },
  { competition: 0 },
  { competition: 80 },
  { hours: 5 },
  { computeUsd: 10, mandatorySpendUsd: 5 },
  { reusableValueUsd: 50 },
  { slots: 3 },
  { hours: 0 },
  { hourlyCostUsd: 0 },
  { rewardUsd: 0.000001 },
]);

function compileJsonSchema(schema) {
  return new Ajv({ allErrors: true, strict: false }).compile(structuredClone(schema));
}

function paidSuccessVariants() {
  const variants = [];
  for (const agentAccess of AGENT_ACCESS_VALUES) {
    for (const acceptance of ACCEPTANCE_VALUES) {
      for (const settlement of SETTLEMENT_VALUES) {
        for (const shape of PAID_INPUT_SHAPES) {
          variants.push(opportunityPreflight({
            ...base,
            ...shape,
            agentAccess,
            acceptance,
            settlement,
          }));
        }
      }
    }
  }
  const now = new Date("2026-08-09T08:00:00Z");
  for (const card of PLATFORM_HEALTH_CARDS) {
    variants.push(opportunityPreflight({
      ...base,
      platform: card.platform_id,
    }, { platformCard: getPlatformHealthCard(card.platform_id, now) }));
  }
  return variants;
}

test("GET success schema is the paid result plus optional trial wrapper fields", () => {
  const paid = opportunityPreflightOutputSchema();
  const getSchema = opportunityPreflightGetOutputSchema();
  const trialSchema = opportunityPreflightTrialOutputSchema();
  assert.equal(Object.hasOwn(paid.properties, "sample"), false);
  assert.equal(Object.hasOwn(paid.properties, "charged"), false);
  assert.equal(Object.hasOwn(paid.properties, "trial"), false);
  assert.equal(getSchema.oneOf, undefined);
  assert.equal(getSchema.additionalProperties, false);
  assert.deepEqual(getSchema.required, paid.required);
  assert.equal(getSchema.properties.sample.const, true);
  assert.equal(getSchema.properties.charged.const, false);
  assert.equal(getSchema.properties.trial.properties.contract.const, "fixed-non-authoritative-example");
  assert.equal(trialSchema.additionalProperties, false);
  assert.deepEqual(trialSchema.required.slice(-3), ["sample", "charged", "trial"]);
});

test("free GET trial matches GET schema and is rejected by the paid POST schema", () => {
  const trial = JSON.parse(JSON.stringify(opportunityPreflightTrial()));
  const paid = JSON.parse(JSON.stringify(opportunityPreflight(base)));
  const validatePaid = compileJsonSchema(opportunityPreflightOutputSchema());
  const validateGet = compileJsonSchema(opportunityPreflightGetOutputSchema());
  const validateTrial = compileJsonSchema(opportunityPreflightTrialOutputSchema());

  assert.equal(validateGet(trial), true, JSON.stringify(validateGet.errors, null, 2));
  assert.equal(validateTrial(trial), true, JSON.stringify(validateTrial.errors, null, 2));
  assert.equal(validatePaid(trial), false);
  assert.ok((validatePaid.errors || []).some((error) => (
    error.keyword === "additionalProperties" && ["sample", "charged", "trial"].includes(error.params?.additionalProperty)
  )));

  assert.equal(validatePaid(paid), true, JSON.stringify(validatePaid.errors, null, 2));
  assert.equal(validateGet(paid), true, JSON.stringify(validateGet.errors, null, 2));
  assert.equal(validateTrial(paid), false);
});

test("1,955 paid success variants keep matching the paid schema", () => {
  const variants = paidSuccessVariants();
  assert.equal(variants.length, 1955);
  const validatePaid = compileJsonSchema(opportunityPreflightOutputSchema());
  const validateGet = compileJsonSchema(opportunityPreflightGetOutputSchema());
  const validateTrial = compileJsonSchema(opportunityPreflightTrialOutputSchema());
  for (const value of variants) {
    const encoded = JSON.parse(JSON.stringify(value));
    assert.equal(validatePaid(encoded), true, JSON.stringify(validatePaid.errors, null, 2));
    assert.equal(validateGet(encoded), true, JSON.stringify(validateGet.errors, null, 2));
    assert.equal(validateTrial(encoded), false);
    assert.equal(Object.hasOwn(encoded, "sample"), false);
    assert.equal(Object.hasOwn(encoded, "charged"), false);
    assert.equal(Object.hasOwn(encoded, "trial"), false);
  }
});

test("non-current platform evidence keeps dated facts and requires reverify", () => {
  const fresh = getPlatformHealthCard("taskmarket", new Date("2026-08-09T08:00:00.000Z"));
  const freshResult = opportunityPreflight({
    ...base,
    platform: "taskmarket",
    competition: 80,
    selectionProbabilityPct: 2,
  }, { platformCard: fresh });
  assert.equal(fresh.current_availability.open_inventory_count, 18);
  assert.equal(freshResult.gates.requiredChecks.includes("refresh_platform_health_evidence"), false);
  assert.equal(freshResult.platformEvidence.freshness, "fresh");
  assert.equal(freshResult.platformEvidence.observedAt, fresh.observed_at);

  const stale = getPlatformHealthCard("bountybook", new Date("2026-11-02T07:10:00.000Z"));
  const staleResult = opportunityPreflight({ ...base, platform: "bountybook" }, { platformCard: stale });
  assert.equal(stale.current_platform_state.open_inventory_count, 100);
  assert.equal(stale.current_availability.open_inventory_count, null);
  assert.equal(staleResult.decision, "verify_first");
  assert.equal(staleResult.platformEvidence.healthCategory, "VERIFIER_BLOCK");
  assert.equal(staleResult.platformEvidence.freshness, "stale");
  assert.equal(staleResult.platformEvidence.observedAt, "2026-08-08T17:42:00.000Z");
  assert.equal(staleResult.platformEvidence.evidence.length > 0, true);
  assert.equal(staleResult.gates.requiredChecks.includes("refresh_platform_health_evidence"), true);
  assert.equal(compileJsonSchema(opportunityPreflightOutputSchema())(JSON.parse(JSON.stringify(staleResult))), true);

  const future = projectPlatformHealthCard({
    platform_id: "synthetic-lane",
    platform_name: "Synthetic Lane",
    health_category: "INSUFFICIENT_EVIDENCE",
    confidence: "low",
    observed_at: "2026-12-01T00:00:00.000Z",
    fresh_until: "2026-12-02T00:00:00.000Z",
    sample_count: 1,
    settlement_mechanism: ["UNFUNDED_OR_UNKNOWN"],
    rights_class: "PUBLIC_READ",
    evidence: [{
      fact_class: "PUBLIC_PAGE",
      summary: "future observation",
      source_url: "https://example.invalid/synthetic",
      observed_at: "2026-12-01T00:00:00.000Z",
      stage_reached: "discoverable",
      failed_at: null,
      confidence: "low",
    }],
    unknowns: ["current inventory"],
    current_platform_state: {
      open_inventory_count: 7,
      competition_signal: "advertised",
      custody_status: null,
      notes: "open does not mean claimable",
    },
  }, new Date("2026-11-02T07:10:00.000Z"));
  assert.equal(future.freshness, "not_current");
  assert.equal(future.current_availability.open_inventory_count, null);
  assert.equal(future.current_platform_state.open_inventory_count, 7);
  const futureResult = opportunityPreflight({ ...base, platform: "synthetic-lane" }, { platformCard: future });
  assert.equal(futureResult.decision, "verify_first");
  assert.equal(futureResult.platformEvidence.freshness, "not_current");
  assert.equal(futureResult.gates.requiredChecks.includes("refresh_platform_health_evidence"), true);
  assert.equal(compileJsonSchema(opportunityPreflightOutputSchema())(JSON.parse(JSON.stringify(futureResult))), true);

  const renamed = opportunityPreflight(base, { platformCard: { ...fresh, freshness: "unknown" } });
  assert.equal(renamed.gates.requiredChecks.includes("refresh_platform_health_evidence"), true);
  assert.equal(renamed.platformEvidence.freshness, "unknown");
});
