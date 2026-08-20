import { z } from "zod";

const AGENT_ACCESS = new Set(["agent_allowed", "agent_only", "mixed", "human_only", "unknown"]);
const ACCEPTANCE = new Set(["deterministic", "machine_scored", "timed_review", "discretionary", "unknown"]);
const SETTLEMENT = new Set(["direct", "escrow", "platform_balance", "discretionary", "unfunded", "unknown"]);
const AGENT_ACCESS_VALUES = /** @type {[string, ...string[]]} */ ([...AGENT_ACCESS]);
const ACCEPTANCE_VALUES = /** @type {[string, ...string[]]} */ ([...ACCEPTANCE]);
const SETTLEMENT_VALUES = /** @type {[string, ...string[]]} */ ([...SETTLEMENT]);

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

export function normalizeOpportunityPreflightRequest({
  method = "GET",
  query = {},
  body = {},
  hasPaymentCredential = false,
} = {}) {
  const normalizedMethod = String(method || "GET").trim().toUpperCase();
  const input = normalizedMethod === "POST" ? body : query;
  const isEmpty = !input || typeof input !== "object" || Object.keys(input).length === 0;
  const discoveryProbe = (normalizedMethod === "HEAD" || normalizedMethod === "POST")
    && !hasPaymentCredential
    && isEmpty;

  if (discoveryProbe) return { discoveryProbe: true, input: {} };

  return {
    discoveryProbe: false,
    input: normalizeOpportunityPreflightInput(input),
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

const opportunityEvidenceItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    factClass: { type: "string" },
    summary: { type: "string" },
    sourceUrl: { type: "string" },
    observedAt: { type: "string" },
    stageReached: { type: "string" },
    failedAt: { type: ["string", "null"] },
    confidence: { type: "string" },
  },
  required: ["factClass", "summary", "sourceUrl", "observedAt", "stageReached", "failedAt", "confidence"],
};

const opportunityEvidenceItemMcpSchema = z.object({
  factClass: z.string(),
  summary: z.string(),
  sourceUrl: z.string(),
  observedAt: z.string(),
  stageReached: z.string(),
  failedAt: z.string().nullable(),
  confidence: z.string(),
}).strict();

export function opportunityPreflightOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean", const: true },
      product: { type: "string", const: "samedaydesk-opportunity-preflight" },
      version: { type: "string", const: "1.0.0" },
      decision: { type: "string", enum: ["attempt", "verify_first", "abandon"] },
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          platform: { type: ["string", "null"] },
          rewardUsd: { type: "number" },
          hours: { type: "number" },
          hourlyCostUsd: { type: "number" },
          computeUsd: { type: "number" },
          mandatorySpendUsd: { type: "number" },
          reusableValueUsd: { type: "number" },
          selectionProbabilityPct: { type: ["number", "null"] },
          competition: { type: "integer" },
          slots: { type: "integer" },
          agentAccess: { type: "string", enum: AGENT_ACCESS_VALUES },
          acceptance: { type: "string", enum: ACCEPTANCE_VALUES },
          settlement: { type: "string", enum: SETTLEMENT_VALUES },
        },
        required: [
          "platform",
          "rewardUsd",
          "hours",
          "hourlyCostUsd",
          "computeUsd",
          "mandatorySpendUsd",
          "reusableValueUsd",
          "selectionProbabilityPct",
          "competition",
          "slots",
          "agentAccess",
          "acceptance",
          "settlement",
        ],
      },
      economics: {
        type: "object",
        additionalProperties: false,
        properties: {
          executionCostUsd: { type: "number" },
          mandatorySpendUsd: { type: "number" },
          totalAtRiskUsd: { type: "number" },
          reusableValueUsd: { type: "number" },
          expectedRewardUsd: { type: ["number", "null"] },
          expectedSurplusUsd: { type: ["number", "null"] },
          breakEvenSelectionProbabilityPct: { type: "number" },
          equalEntryShareReferencePct: { type: ["number", "null"] },
          probabilitySource: { type: "string", enum: ["missing", "caller_supplied"] },
          equalEntryShareBoundary: { type: "string" },
        },
        required: [
          "executionCostUsd",
          "mandatorySpendUsd",
          "totalAtRiskUsd",
          "reusableValueUsd",
          "expectedRewardUsd",
          "expectedSurplusUsd",
          "breakEvenSelectionProbabilityPct",
          "equalEntryShareReferencePct",
          "probabilitySource",
          "equalEntryShareBoundary",
        ],
      },
      gates: {
        type: "object",
        additionalProperties: false,
        properties: {
          hardBlocks: { type: "array", items: { type: "string" } },
          requiredChecks: { type: "array", items: { type: "string" } },
          warnings: { type: "array", items: { type: "string" } },
        },
        required: ["hardBlocks", "requiredChecks", "warnings"],
      },
      platformEvidence: {
        type: ["object", "null"],
        additionalProperties: false,
        properties: {
          platformId: { type: "string" },
          platformName: { type: "string" },
          healthCategory: { type: "string" },
          confidence: { type: "string" },
          freshness: { type: "string" },
          observedAt: { type: "string" },
          freshUntil: { type: "string" },
          sampleCount: { type: "integer" },
          settlementMechanism: { type: "array", items: { type: "string" } },
          rightsClass: { type: "string" },
          evidence: { type: "array", items: opportunityEvidenceItemJsonSchema },
          unknowns: { type: "array", items: { type: "string" } },
        },
        required: [
          "platformId",
          "platformName",
          "healthCategory",
          "confidence",
          "freshness",
          "observedAt",
          "freshUntil",
          "sampleCount",
          "settlementMechanism",
          "rightsClass",
          "evidence",
          "unknowns",
        ],
      },
      boundary: { type: "string" },
    },
    required: ["ok", "product", "version", "decision", "input", "economics", "gates", "platformEvidence", "boundary"],
  };
}

export function opportunityPreflightTrialOutputSchema() {
  const paid = structuredClone(opportunityPreflightOutputSchema());
  paid.properties.sample = { type: "boolean", const: true };
  paid.properties.charged = { type: "boolean", const: false };
  paid.properties.trial = {
    type: "object",
    additionalProperties: false,
    properties: {
      contract: { type: "string", const: "fixed-non-authoritative-example" },
      next: { type: "string" },
    },
    required: ["contract", "next"],
  };
  paid.required = [...paid.required, "sample", "charged", "trial"];
  return paid;
}

// Public GET 200 is the paid custom result or the fixed uncharged trial wrapper.
// Trial fields stay optional so both runtime 200s validate. oneOf is not used
// because agent-payment-policy treats it as an unsupported keyword and would
// drop this route from an admissible purchase-evidence contract.
export function opportunityPreflightGetOutputSchema() {
  const schema = opportunityPreflightTrialOutputSchema();
  schema.required = [...opportunityPreflightOutputSchema().required];
  return schema;
}

export const opportunityPreflightMcpOutputSchema = z.object({
  ok: z.literal(true),
  product: z.literal("samedaydesk-opportunity-preflight"),
  version: z.literal("1.0.0"),
  decision: z.enum(["attempt", "verify_first", "abandon"]),
  input: z.object({
    platform: z.string().nullable(),
    rewardUsd: z.number(),
    hours: z.number(),
    hourlyCostUsd: z.number(),
    computeUsd: z.number(),
    mandatorySpendUsd: z.number(),
    reusableValueUsd: z.number(),
    selectionProbabilityPct: z.number().nullable(),
    competition: z.number().int(),
    slots: z.number().int(),
    agentAccess: z.enum(AGENT_ACCESS_VALUES),
    acceptance: z.enum(ACCEPTANCE_VALUES),
    settlement: z.enum(SETTLEMENT_VALUES),
  }).strict(),
  economics: z.object({
    executionCostUsd: z.number(),
    mandatorySpendUsd: z.number(),
    totalAtRiskUsd: z.number(),
    reusableValueUsd: z.number(),
    expectedRewardUsd: z.number().nullable(),
    expectedSurplusUsd: z.number().nullable(),
    breakEvenSelectionProbabilityPct: z.number(),
    equalEntryShareReferencePct: z.number().nullable(),
    probabilitySource: z.enum(["missing", "caller_supplied"]),
    equalEntryShareBoundary: z.string(),
  }).strict(),
  gates: z.object({
    hardBlocks: z.array(z.string()),
    requiredChecks: z.array(z.string()),
    warnings: z.array(z.string()),
  }).strict(),
  platformEvidence: z.object({
    platformId: z.string(),
    platformName: z.string(),
    healthCategory: z.string(),
    confidence: z.string(),
    freshness: z.string(),
    observedAt: z.string(),
    freshUntil: z.string(),
    sampleCount: z.number().int(),
    settlementMechanism: z.array(z.string()),
    rightsClass: z.string(),
    evidence: z.array(opportunityEvidenceItemMcpSchema),
    unknowns: z.array(z.string()),
  }).strict().nullable(),
  boundary: z.string(),
}).strict();

export function opportunityPreflightTrial() {
  const result = opportunityPreflight({
    rewardUsd: 100,
    hours: 1,
    hourlyCostUsd: 20,
    computeUsd: 0,
    mandatorySpendUsd: 0,
    reusableValueUsd: 0,
    selectionProbabilityPct: 25,
    competition: 4,
    slots: 1,
    agentAccess: "agent_allowed",
    acceptance: "deterministic",
    settlement: "escrow",
  });
  return {
    ...result,
    sample: true,
    charged: false,
    trial: {
      contract: "fixed-non-authoritative-example",
      next: "Send rewardUsd, hours, and hourlyCostUsd as GET query parameters or POST JSON, then satisfy the returned 0.05-USDC x402 or MPP challenge for a custom result.",
    },
    boundary:
      "Free fixed arithmetic sample for machine evaluation. It contains no caller opportunity, platform evidence, account action, payment, or revenue. Custom inputs remain payment-gated and must be independently verified.",
  };
}
