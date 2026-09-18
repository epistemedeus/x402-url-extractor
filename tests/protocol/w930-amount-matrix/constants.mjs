/**
 * W0-X249 / w930 unpublished unpaid x402 amount matrix.
 * Atomic amounts are strings. OpenAPI display tokens are pinned literals,
 * never derived by dividing atomic units.
 */

export const WAVE = "w930";
export const SCHEMA_FIXTURE = "samedaydesk.w930-amount-matrix-fixture.v1";
export const SCHEMA_REPORT = "samedaydesk.w930-amount-matrix-report.v1";

export const SDS = Object.freeze({
  origin: "https://agents.samedaydesk.com",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
  scheme: "exact",
});

/** Control row: GET /extract is 5000. Agents must not copy this onto /scan. */
export const EXTRACT_AMOUNT_ATOMIC = "5000";
export const SCAN_AMOUNT_ATOMIC = "200000";
export const TX_RECEIPT_AMOUNT_ATOMIC = "2000";
export const SCHEMAFORGE_AMOUNT_ATOMIC = "250000";
export const READ_AMOUNT_ATOMIC = "5000";
export const PAYMENT_OFFER_PREFLIGHT_AMOUNT_ATOMIC = "5000";

/**
 * OpenAPI 402 description tokens are the merchant PRICE env strings.
 * x-payment-info.price.amount is atomicUsdcToDisplay of those amounts.
 * Both are pinned so evaluators never convert 200000 → 0.20.
 */
export const MATRIX = Object.freeze([
  Object.freeze({
    id: "extract",
    path: "/extract",
    method: "GET",
    query: "?url=https%3A%2F%2Fexample.com",
    mcpTool: "extract",
    amountAtomic: EXTRACT_AMOUNT_ATOMIC,
    openapi402Token: "$0.005",
    openapiPriceAmount: "0.005",
  }),
  Object.freeze({
    id: "read",
    path: "/read",
    method: "GET",
    query: "?url=https%3A%2F%2Fexample.com",
    mcpTool: "read",
    amountAtomic: READ_AMOUNT_ATOMIC,
    openapi402Token: "$0.005",
    openapiPriceAmount: "0.005",
  }),
  Object.freeze({
    id: "scan",
    path: "/scan",
    method: "GET",
    query: "?repo=octocat%2FHello-World",
    mcpTool: "scan",
    amountAtomic: SCAN_AMOUNT_ATOMIC,
    openapi402Token: "$0.20",
    openapiPriceAmount: "0.2",
  }),
  Object.freeze({
    id: "schemaforge",
    path: "/schemaforge",
    method: "GET",
    query: "?site=https%3A%2F%2Fexample.com",
    mcpTool: "schemaforge",
    amountAtomic: SCHEMAFORGE_AMOUNT_ATOMIC,
    openapi402Token: "$0.25",
    openapiPriceAmount: "0.25",
  }),
  Object.freeze({
    id: "payment-offer-preflight",
    path: "/commerce/payment-offer-preflight",
    method: "GET",
    query: "?url=https%3A%2F%2Fexample.com%2Fpaid",
    mcpTool: "payment_offer_preflight",
    amountAtomic: PAYMENT_OFFER_PREFLIGHT_AMOUNT_ATOMIC,
    openapi402Token: "$0.005",
    openapiPriceAmount: "0.005",
  }),
  Object.freeze({
    id: "transaction-receipt",
    path: "/chain/transaction-receipt",
    method: "GET",
    query: `?transactionHash=0x${"2".repeat(64)}`,
    mcpTool: "transaction_receipt",
    amountAtomic: TX_RECEIPT_AMOUNT_ATOMIC,
    openapi402Token: "$0.002",
    openapiPriceAmount: "0.002",
  }),
]);

export const FORBIDDEN_INVENTED = Object.freeze([
  "loyaltyPoints",
  "throughBlock",
  "buyerEmail",
  "npsScore",
  "tipAmount",
  "uniqueVisitors",
]);

export const CODES = Object.freeze({
  OK: "amount_matrix_match",
  AMOUNT_MISMATCH: "amount_mismatch",
  UNIT_CONVERSION: "unit_conversion_refused",
  INVENTED_FIELD: "invented_receipt_field_without_live_schema",
  TREAT_ABSENCE_AS_DEMAND: "treat_absence_as_demand",
  ROUTE_ABSENT: "route_absent",
  PAYMENT_ATTEMPTED: "payment_attempted",
  INVALID_AMOUNT_TYPE: "invalid_amount_type",
  PAY_TO_MISMATCH: "pay_to_mismatch",
  OPENAPI_402_TEXT_MISMATCH: "openapi_402_text_mismatch",
  HTTP_NOT_402: "http_not_402",
  MALFORMED_FIXTURE: "malformed_fixture",
  COPY_EXTRACT_ONTO_SCAN: "copy_extract_onto_scan",
});

export const PAYMENT_REQUEST_HEADER_NAMES = Object.freeze([
  "payment-signature",
  "payment-required",
  "x-payment",
  "x-payment-signature",
  "payment-response",
]);

export const REFUSED_FLAGS = Object.freeze([
  "live",
  "pay",
  "cdp",
  "poll",
  "refresh",
  "reindex",
  "bazaar-tracker",
  "openserv",
  "publish",
  "neo",
]);
