const AGENT_ACCESS = new Set(["agent_allowed", "agent_only", "mixed", "human_only", "unknown"]);
const ACCEPTANCE = new Set(["deterministic", "machine_scored", "timed_review", "discretionary", "unknown"]);
const SETTLEMENT = new Set(["direct", "escrow", "platform_balance", "discretionary", "unfunded", "unknown"]);

function finiteNumber(value, name, { minimum = 0, maximum = 1_000_000, required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new TypeError(`${name} is required`);
    return 0;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new TypeError(`${name} must be a finite number from ${minimum} through ${maximum}`);
  }
  return number;
}

function optionalNumber(value, name, options = {}) {
  if (value === undefined || value === null || value === "") return null;
  return finiteNumber(value, name, options);
}

function integer(value, name, { minimum = 0, maximum = 1_000_000, required = false } = {}) {
  const number = finiteNumber(value, name, { minimum, maximum, required });
  if (!Number.isInteger(number)) throw new TypeError(`${name} must be an integer`);
  return number;
}

function enumValue(value, name, allowed, fallback = "unknown") {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!allowed.has(normalized)) {
    throw new TypeError(`${name} must be one of: ${[...allowed].join(", ")}`);
  }
  return normalized;
}

function roundUsd(value) {
  return value === null ? null : Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function roundPct(value) {
  return value === null ? null : Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function normalizeOpportunityPreflightInput(input = {}) {
  const rewardUsd = finiteNumber(input.rewardUsd, "rewardUsd", { required: true, minimum: 0.000001 });
  const hours = finiteNumber(input.hours, "hours", { required: true, maximum: 10_000 });
  const hourlyCostUsd = finiteNumber(input.hourlyCostUsd, "hourlyCostUsd", { required: true, maximum: 100_000 });
  const computeUsd = finiteNumber(input.computeUsd, "computeUsd");
  const mandatorySpendUsd = finiteNumber(input.mandatorySpendUsd, "mandatorySpendUsd");
  const reusableValueUsd = finiteNumber(input.reusableValueUsd, "reusableValueUsd");
  const selectionProbabilityPct = optionalNumber(
    input.selectionProbabilityPct,
    "selectionProbabilityPct",
    { minimum: 0, maximum: 100 },
  );
  const competition = integer(input.competition, "competition", { maximum: 10_000_000 });
  const slots = integer(input.slots ?? 1, "slots", { minimum: 1, maximum: 1_000_000, required: true });
  const platform = String(input.platform || "").trim().toLowerCase().slice(0, 100) || null;

  return {
    platform,
    rewardUsd,
    hours,
    hourlyCostUsd,
    computeUsd,
    mandatorySpendUsd,
    reusableValueUsd,
    selectionProbabilityPct,
    competition,
    slots,
    agentAccess: enumValue(input.agentAccess, "agentAccess", AGENT_ACCESS),
    acceptance: enumValue(input.acceptance, "acceptance", ACCEPTANCE),
    settlement: enumValue(input.settlement, "settlement", SETTLEMENT),
  };
}

function platformEvidence(card) {
  if (!card) return null;
  return {
    platformId: card.platform_id,
    platformName: card.platform_name,
    healthCategory: card.health_category,
    confidence: card.confidence,
    freshness: card.freshness,
    observedAt: card.observed_at,
    freshUntil: card.fresh_until,
    sampleCount: card.sample_count,
    settlementMechanism: card.settlement_mechanism,
    rightsClass: card.rights_class,
    evidence: (card.evidence || []).slice(0, 3).map((item) => ({
      factClass: item.fact_class,
      summary: item.summary,
      sourceUrl: item.source_url,
      observedAt: item.observed_at,
      stageReached: item.stage_reached,
      failedAt: item.failed_at,
      confidence: item.confidence,
    })),
    unknowns: (card.unknowns || []).slice(0, 8),
  };
}

export function opportunityPreflight(input, { platformCard = null } = {}) {
  const normalized = normalizeOpportunityPreflightInput(input);
  const executionCostUsd = normalized.hours * normalized.hourlyCostUsd + normalized.computeUsd;
  const totalAtRiskUsd = executionCostUsd + normalized.mandatorySpendUsd;
  const recoverableWithoutSelectionUsd = normalized.reusableValueUsd;
  const breakEvenProbabilityPct = Math.max(
    0,
    ((totalAtRiskUsd - recoverableWithoutSelectionUsd) / normalized.rewardUsd) * 100,
  );
  const equalEntryShareReferencePct = normalized.competition > 0
    ? Math.min(100, (normalized.slots / normalized.competition) * 100)
    : null;
  const probability = normalized.selectionProbabilityPct === null
    ? null
    : normalized.selectionProbabilityPct / 100;
  const expectedRewardUsd = probability === null ? null : normalized.rewardUsd * probability;
  const expectedSurplusUsd = probability === null
    ? null
    : expectedRewardUsd + recoverableWithoutSelectionUsd - totalAtRiskUsd;

  const hardBlocks = [];
  const requiredChecks = [];
  const warnings = [];

  if (normalized.agentAccess === "human_only") hardBlocks.push("human_only_execution");
  if (normalized.settlement === "unfunded") hardBlocks.push("unfunded_reward");
  if (normalized.selectionProbabilityPct === null) requiredChecks.push("supply_selection_probability_pct");
  if (normalized.agentAccess === "unknown") requiredChecks.push("verify_agent_access");
  if (normalized.acceptance === "unknown") requiredChecks.push("verify_acceptance_mechanism");
  if (normalized.settlement === "unknown") requiredChecks.push("verify_settlement_state");
  if (normalized.acceptance === "discretionary") warnings.push("human_or_buyer_selection_can_reject_technically_valid_work");
  if (normalized.settlement === "discretionary") warnings.push("payment_depends_on_counterparty_approval");
  if (normalized.competition > 0 && equalEntryShareReferencePct < breakEvenProbabilityPct) {
    warnings.push("equal_entry_share_reference_is_below_break_even_probability");
  }

  const health = platformCard?.health_category;
  if (normalized.platform && !platformCard) requiredChecks.push("platform_evidence_not_available_reverify_primary_source");
  if (platformCard?.freshness === "stale") requiredChecks.push("refresh_platform_health_evidence");
  if (["VERIFIER_BLOCK", "CUSTODY_OR_PAYOUT_FROZEN", "EMPTY_OR_ILLIQUID", "IDENTITY_GATED"].includes(health)) {
    requiredChecks.push(`resolve_platform_${health.toLowerCase()}`);
  }
  if (health === "OVERSUPPLY_LOTTERY") warnings.push("platform_has_observed_oversupply_or_selection_dilution");
  if (platformCard?.rights_class === "DO_NOT_AGGREGATE") warnings.push("primary_platform_must_remain_execution_authority");

  let decision;
  if (hardBlocks.length) decision = "abandon";
  else if (expectedSurplusUsd !== null && expectedSurplusUsd <= 0) decision = "abandon";
  else if (requiredChecks.length) decision = "verify_first";
  else decision = "attempt";

  return {
    ok: true,
    product: "samedaydesk-opportunity-preflight",
    version: "1.0.0",
    decision,
    input: normalized,
    economics: {
      executionCostUsd: roundUsd(executionCostUsd),
      mandatorySpendUsd: roundUsd(normalized.mandatorySpendUsd),
      totalAtRiskUsd: roundUsd(totalAtRiskUsd),
      reusableValueUsd: roundUsd(recoverableWithoutSelectionUsd),
      expectedRewardUsd: roundUsd(expectedRewardUsd),
      expectedSurplusUsd: roundUsd(expectedSurplusUsd),
      breakEvenSelectionProbabilityPct: roundPct(breakEvenProbabilityPct),
      equalEntryShareReferencePct: roundPct(equalEntryShareReferencePct),
      probabilitySource: probability === null ? "missing" : "caller_supplied",
      equalEntryShareBoundary:
        "slots divided by visible competitors is a reference ratio, not a payout probability or calibrated forecast.",
    },
    gates: { hardBlocks, requiredChecks, warnings },
    platformEvidence: platformEvidence(platformCard),
    boundary:
      "Deterministic arithmetic and dated categorical evidence only. The caller supplies cost and selection assumptions, must reverify the primary listing, and owns legal, policy, identity, spending, and execution decisions. No platform account, claim, bid, payment, or submission is made.",
  };
}
