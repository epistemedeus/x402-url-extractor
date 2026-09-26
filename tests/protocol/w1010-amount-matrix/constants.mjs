/**
 * w1010: unpaid x402 amount matrix across SDS HTTP 402, MCP tools/list,
 * and OpenAPI 402 text. Atomic amounts are strings. Display tokens are
 * pinned literals, never derived by dividing atomic units.
 * Unpaid only. Never send PAYMENT-SIGNATURE. Never pay.
 */

export const WAVE = "w1010";
export const SCHEMA_FIXTURE = "samedaydesk.x402-protocol-fixtures.w1010-amount-matrix.v1";
export const SCHEMA_REPORT = "samedaydesk.x402-protocol-report.w1010-amount-matrix.v1";

export const SDS = Object.freeze({
  origin: "https://agents.samedaydesk.com",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
  scheme: "exact",
  serviceVersion: "1.23.49",
});

/** Control row: GET /extract is 5000. Agents must not copy this onto /scan. */
export const EXTRACT_AMOUNT_ATOMIC = "5000";
export const SCAN_AMOUNT_ATOMIC = "200000";
export const TX_RECEIPT_AMOUNT_ATOMIC = "2000";

/**
 * OpenAPI 402 description tokens are the merchant price env strings.
 * x-payment-info.price.amount is atomicUsdcToDisplay of those amounts.
 * Both are pinned here so evaluators never convert 200000 → 0.20.
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
    amountAtomic: "5000",
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
    amountAtomic: "250000",
    openapi402Token: "$0.25",
    openapiPriceAmount: "0.25",
  }),
  Object.freeze({
    id: "payment-offer-preflight",
    path: "/commerce/payment-offer-preflight",
    method: "GET",
    query: "?url=https%3A%2F%2Fexample.com%2Fpaid",
    mcpTool: "payment_offer_preflight",
    amountAtomic: "5000",
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
  ACCEPT_TERMS_MISMATCH: "accept_terms_mismatch",
  OPENAPI_402_TEXT_MISMATCH: "openapi_402_text_mismatch",
  HTTP_NOT_402: "http_not_402",
  MALFORMED_FIXTURE: "malformed_fixture",
  COPY_EXTRACT_ONTO_SCAN: "copy_extract_onto_scan",
  MCP_AMOUNT_MISSING: "mcp_amount_missing",
});

export const PAYMENT_REQUEST_HEADER_NAMES = Object.freeze([
  "payment-signature",
  "payment-required",
  "x-payment",
  "x-payment-signature",
  "payment-response",
  "x-payment-response",
]);

/** Settlement evidence on responses. Do not include payment-required (the unpaid 402 challenge). */
export const PAYMENT_RESPONSE_SETTLEMENT_HEADER_NAMES = Object.freeze([
  "payment-response",
  "x-payment-response",
  "payment-signature",
  "x-payment-signature",
]);

export const REFUSED_FLAGS = Object.freeze([
  "--live",
  "--pay",
  "--cdp",
  "--publish",
  "--neo",
  "--payment-signature",
  "--refresh",
  "--poll",
  "--openserv",
  "--bazaar-tracker",
  "--reindex",
  "--stripe",
  "--checkout",
  "--settle",
]);
