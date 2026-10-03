export const BASELINE_SCHEMA = "samedaydesk.production-funnel-baseline.v1";
export const JOB_ID = "HEAVY-423-FUNNEL-100423";
export const SOURCE_COMMIT = "26d806f20e57d0c073321675dacb13395e30c643";
export const MERCHANT157 = "015f07d5a75d02a4e74709b17b2b1176501e92a5";
export const RELAY_UNION = "ea4e20b350bd519967535f00fb7dfaaa5bd257b7";
export const COVERED_DAYS = 1;
export const RARE_CONTEXT_DAYS = 30;
export const PUBLIC_ROUTE = "https://agents.samedaydesk.com/v0/commerce-demand.json";

// Settlement class names already emitted by the payment-evidence readout.
// Absent classes stay null. They are not counted as zero.
export const SETTLEMENT_COHORTS = Object.freeze({
  validation: "probe_qa",
  internal: "internal_owner",
  incentivized: "sponsored",
  affiliated: "recruited",
  independent: "independent",
  unclassified: "unknown",
});

export const REQUIRED_COHORTS = Object.freeze([
  "probe_qa",
  "sponsored",
  "recruited",
  "independent",
  "internal_owner",
  "unknown",
]);

export const PHASES = new Set(["challenge", "delivery", "settlement", "later_read"]);
export const RAILS = new Set(["x402-base", "mpp", "xrp-ledger"]);
export const ATTEMPT_COHORTS = new Set([
  "probe_qa",
  "sponsored",
  "recruited",
  "independent",
  "internal_owner",
  "unknown",
]);
export const EVIDENCE_KINDS = new Set(["supplied_fixture", "supplied_caller_cut"]);
export const PHASE_KEYS = Object.freeze([
  "bodyDigest",
  "callId",
  "cohort",
  "evidenceKind",
  "httpStatus",
  "phase",
  "rail",
  "route",
  "settlementReference",
]);
