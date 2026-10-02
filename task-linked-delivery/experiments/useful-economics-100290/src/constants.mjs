export const PACKAGE_ID = "useful-economics-100290";
export const BUNDLE_SCHEMA = "samedaydesk.useful-economics.bundle.v1";
export const OBSERVATION_SCHEMA = "samedaydesk.useful-economics.observation.v1";
export const RECEIPT_SCHEMA = "samedaydesk.useful-economics.receipt.v1";
export const QUERY_SCHEMA = "samedaydesk.useful-economics.query.v1";
export const COST_SCHEMA = "samedaydesk.useful-economics.cost-input.v1";
export const PUBLIC_SCHEMA = "samedaydesk.useful-economics.public.v1";

export const HISTORIC_BANKED_REVENUE_USDC = 10.955;
export const HISTORIC_BANKED_REVENUE_SOURCE = "pilot overview/EXPERIMENT-RETURN-LEDGER.json portfolioMandate.bankedRevenueUsdc at consumerCommit 0c136a96dfdecf72e141dd9078c2f6c2e38ca8aa";
export const CONSUMER_COMMIT = "0c136a96dfdecf72e141dd9078c2f6c2e38ca8aa";
export const EVIDENCE_JOIN_COMMIT = "4f5f631ec32d4738e8dee4cc5964ce4b5ecb55a6";
export const PRODUCER_COMMIT = "92b3610c5c39b09c2333b27c647f9df06c1db5f5";
export const GRANT_COMMIT = "5206246ca831aa5b7c01ec147f69b22b5f71447b";

export const STAGES = Object.freeze([
  "task_discovery",
  "qualification",
  "acquisition",
  "attempted_call",
  "settlement",
  "verified_delivery",
  "caller_expected_output",
  "authorized_retained_read",
  "corrected_or_withdrawn",
  "subsequent_useful_or_paid_job",
]);

export const SOURCE_CLASSES = Object.freeze([
  "owner_qa",
  "sponsored_evaluation",
  "public_aggregate",
  "settlement_authority",
  "server_execution",
  "caller_supplied",
  "explicit_source",
  "self_asserted_independent",
  "unknown",
]);

export const AUTHORITIES = Object.freeze([
  "server_execution",
  "caller_expectation",
  "trusted_settlement",
  "wallet_transfer",
  "explicit_source",
  "unknown",
]);

// F01–F04 are the research-accounting views named by delivery-outcome
// effortPlanes. This checkout does not contain EXPERIMENT-RETURN-LEDGER.json.
export const EFFORT_PLANES = Object.freeze([
  { id: "F01", field: "cashMarginal", ledgerView: "jobCash", sumsIntoCash: true },
  { id: "F02", field: "apiEquivalentBuildEffort", ledgerView: "measuredApiEquivalent", sumsIntoCash: false },
  { id: "F03", field: "includedQuotaOpportunityCost", ledgerView: "includedQuotaOpportunityCost", sumsIntoCash: false },
  { id: "F04", field: "sharedRnd", ledgerView: "sharedRnd", sumsIntoCash: false },
]);

export const NOT_USEFUL_REASONS = new Set([
  "not_delivery",
  "audit_incomplete",
  "additional_work_missing",
  "schema_invalid",
  "delivery_failed",
  "body_unavailable",
  "target_mismatch",
  "echoes_free_diagnostic",
  "http_200_not_useful",
  "challenge_not_useful",
  "missing_field",
  "byte_hash_not_useful",
  "execution_failed",
  "caller_flag_not_execution",
  "wallet_transfer_not_settlement",
  "incomplete_record",
]);

export const POSITIVE_CRITERION_REASONS = new Set([
  "additional_work_present",
  "observed_output_matches_declaration",
  "observed_output_sufficient_declaration_incomplete",
  "retest_matched",
  "paid_valid_delivery",
]);

export const EVENT_ID_RE = /^[a-z0-9][a-z0-9:_-]{0,80}$/;
export const TASK_REF_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const HEX64 = /^[0-9a-f]{64}$/;
export const ATOMIC = /^(0|[1-9][0-9]{0,77})$/;
export const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export const RECEIPT_OPERATION = "normalized-transaction-receipt";
export const SELLER_AUDIT_OPERATION = "get:/commerce/seller-integrity-audit";
