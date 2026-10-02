export const SCHEMA = "samedaydesk.seller-repair-service.v1";
export const CASE_SCHEMA = "samedaydesk.seller-repair-case.v1";
export const CONTRIBUTION_SCHEMA = "samedaydesk.seller-repair-contribution.v1";
export const METRIC_SCHEMA = "samedaydesk.seller-repair-metric.v1";
export const PACKAGE_ID = "seller-repair-service-100266";
export const VERSION = "1.0.0";

export const PAID_METHOD = "GET";
export const PAID_ROUTE = "/commerce/seller-integrity-audit";
export const PAID_PRODUCT = "samedaydesk-seller-integrity-audit";
export const PAID_VERSION = "1.3.0";
export const PAID_PRICE_DISPLAY = "$0.01";
export const PAID_PRICE_ATOMIC = "10000";

export const CATALOG_SKU = "WIDGET-1";
export const PRIVATE_MARKER = "PRIVATE_SENTINEL_do_not_keep";

export const AUDIT_ADDS = Object.freeze([
  "unpaid_challenge_schema",
  "runtime_challenge_check_when_status_is_402",
  "openapi_response_contract_admissibility",
  "advisory_openapi_repair_plan",
  "optional_bazaar_finding",
  "x402_mpp_economics_reconciliation",
]);

export const AUDIT_DOES_NOT = Object.freeze([
  "paid_response_body",
  "handler_execution_of_a_required_array",
  "useful_task_equivalence",
  "seller_runtime_semantics",
]);

export const QUESTIONS = Object.freeze(["useful_output", "declaration_contract", "semantic"]);
export const PATCH_KINDS = Object.freeze(["response_overlay", "incomplete", "incorrect"]);
