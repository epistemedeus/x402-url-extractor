export const PRIVATE_SCHEMA = "samedaydesk.useful-result-reuse.private.v1";
export const SHARED_SCHEMA = "samedaydesk.useful-result-reuse.shared.v1";
export const KNOWLEDGE_SCHEMA = "samedaydesk.useful-result-reuse.knowledge.v1";
export const ACCOUNTING_SCHEMA = "samedaydesk.closed-expense-accounting.v1";
export const CURRENT_SCHEMA = "samedaydesk.useful-result-reuse.current.v1";
export const METRIC_SCHEMA = "samedaydesk.useful-result-reuse.metric.v1";
export const OUTCOME_SCHEMA = "samedaydesk.useful-result.v1";
export const CURRENT_PATH = "/.well-known/useful-result-reuse/current.json";

export const PRIVATE_FILE = "useful-result-private.ndjson";
export const SHARED_FILE = "useful-result-shared.ndjson";
export const METRIC_FILE = "useful-result-metrics.ndjson";

export const MAX_RECORD_BYTES = 4096;
export const MAX_FILE_BYTES = 262_144;
export const PAGE_MAX = 50;
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RETAINED_GENERATIONS = 2;
export const SOURCE_ID = "caller-outcome";

export const CLASSIFICATIONS = Object.freeze(["owner", "sponsored", "unknown", "independent"]);

export const COHORT_FOR_CLASS = Object.freeze({
  owner: "owner_qa",
  sponsored: "sponsored_trial",
  unknown: "external_unknown",
  independent: "external_unknown",
});

export const ACTOR_FOR_CLASS = Object.freeze({
  owner: "owner_test",
  sponsored: "unknown",
  unknown: "unknown",
  independent: "independent",
});

export const OUTCOME_CODES = Object.freeze([
  "unpaid_receipt_readable",
  "delivery_failed",
  "audit_incomplete",
  "provider_unavailable",
  "additional_work_missing",
  "not_useful",
  "http_200_not_useful",
]);

export const DISPOSITIONS = Object.freeze(["useful", "failed", "partial", "unavailable", "not_useful"]);

export const EVIDENCE_CLASSES = Object.freeze([
  "supplied_observation",
  "server_executed_output",
  "independently_replayed_utility",
  "paid_settlement",
]);

export const METRIC_KINDS = Object.freeze([
  "exposure",
  "useful_result_received",
  "scoped_reuse",
  "corrected_reuse",
  "paid_attempt",
  "verified_settlement",
  "valid_delivery",
  "supplied_observation",
  "server_executed_output",
  "independently_replayed_utility",
  "paid_settlement",
]);

// Documented output of the existing handlers. Not a new price or SKU.
export const EXISTING_PAID_OPERATIONS = Object.freeze({
  seller_contract_decision: Object.freeze({
    method: "GET",
    route: "/commerce/seller-integrity-audit",
    product: "samedaydesk-seller-integrity-audit",
    documentedFields: Object.freeze([
      "decision",
      "report.auditCompleted",
      "report.responseContract",
      "report.repairPlan",
      "report.findings",
    ]),
    priceAuthority: "existing_route_challenge",
  }),
  normalized_transaction_receipt: Object.freeze({
    method: "GET",
    route: "/chain/transaction-receipt",
    product: "samedaydesk-transaction-receipt",
    documentedFields: Object.freeze([
      "decision",
      "transaction.status",
      "transaction.transactionFeeWei",
      "receipt.found",
      "transfers",
      "canonicalUsdcTransfers",
      "findings",
    ]),
    priceAuthority: "existing_route_challenge",
  }),
});

export const CLOSED_SPONSORED_REF = "0x593559ea7a19277645a76e41aa29e713ed219db1f97e4be29c9dac9cf6cd4b37";
export const PROTOCOL_ABSENT_FIELDS = Object.freeze(["decision", "parity", "offers", "findings"]);
