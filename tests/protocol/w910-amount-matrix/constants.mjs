/**
 * w910: unpaid x402 amount matrix.
 *
 * String-compare accepts[].amount across HTTP 402, MCP tools/list
 * `_meta.x402.accepts[].amount`, well-known items, and the OpenAPI 402
 * USD text. Amounts are canonical integer strings, never numbers.
 * A 402 is an unpaid offer, not settlement. Never send PAYMENT-SIGNATURE.
 *
 * Pins: SDS live 1.23.49 on Base USDC
 *   GET /extract                    5000   ($0.005)
 *   GET /scan                      200000  ($0.20)
 *   GET /chain/transaction-receipt  2000   ($0.002)
 */
export const SCHEMA_FIXTURE = "samedaydesk.x402-protocol-fixtures.w910-amount-matrix.v1";
export const SCHEMA_REPORT = "samedaydesk.x402-protocol-report.w910-amount-matrix.v1";

export const SDS = Object.freeze({
  origin: "https://agents.samedaydesk.com",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
  serviceName: "x402-data-gateway",
  serviceVersion: "1.23.49",
  x402Version: 2,
  scheme: "exact",
});

export const MATRIX_ROUTES = Object.freeze([
  Object.freeze({
    id: "extract",
    httpPath: "/extract",
    httpMethod: "GET",
    probePath: "/extract?url=https://example.com",
    mcpTool: "extract",
    mcpResourceUrl: "mcp://tool/extract",
    openapiPath: "/extract",
    openapiMethod: "get",
    amountAtomic: "5000",
    priceUsd: "$0.005",
  }),
  Object.freeze({
    id: "scan",
    httpPath: "/scan",
    httpMethod: "GET",
    probePath: "/scan?repo=octocat/Hello-World",
    mcpTool: "scan",
    mcpResourceUrl: "mcp://tool/scan",
    openapiPath: "/scan",
    openapiMethod: "get",
    amountAtomic: "200000",
    priceUsd: "$0.20",
  }),
  Object.freeze({
    id: "transaction_receipt",
    httpPath: "/chain/transaction-receipt",
    httpMethod: "GET",
    probePath: "/chain/transaction-receipt?transactionHash=0x0000000000000000000000000000000000000000000000000000000000000001",
    mcpTool: "transaction_receipt",
    mcpResourceUrl: "mcp://tool/transaction_receipt",
    openapiPath: "/chain/transaction-receipt",
    openapiMethod: "get",
    amountAtomic: "2000",
    priceUsd: "$0.002",
  }),
]);

export const ROUTES = Object.freeze(
  Object.fromEntries(MATRIX_ROUTES.map((route) => [route.id, route])),
);

export const ROUTE_IDS = Object.freeze(MATRIX_ROUTES.map((route) => route.id));

export const CANONICAL_ATOMIC = /^[1-9][0-9]{0,20}$/;
export const OPENAPI_PRICE_TOKEN = /\$[0-9]+(?:\.[0-9]{1,6})?/;

export const FORBIDDEN_INVENTED = Object.freeze([
  "loyaltyPoints",
  "throughBlock",
  "buyerEmail",
  "npsScore",
  "tipAmount",
  "uniqueVisitors",
]);

export const CODES = Object.freeze({
  UNPAID_AMOUNT_MATRIX: "unpaid_amount_matrix",
  AMOUNT_MISMATCH: "amount_mismatch",
  AMOUNT_NOT_STRING: "amount_not_string",
  AMOUNT_MISSING: "amount_missing",
  AMOUNT_NOT_CANONICAL: "amount_not_canonical_string",
  CROSS_SURFACE_DRIFT: "cross_surface_drift",
  OPENAPI_PRICE_MISMATCH: "openapi_price_mismatch",
  HTTP_NOT_402: "http_not_402",
  MCP_LIST_NOT_UNPAID: "mcp_list_not_unpaid",
  HTTP_402_CLASSIFIED_AS_SETTLEMENT: "http_402_classified_as_settlement",
  ABSENCE_AS_DEMAND: "absence_as_demand",
  INVENTED_RECEIPT_FIELD: "invented_receipt_field",
  PAYMENT_SIGNATURE_SENT: "payment_signature_sent",
  SETTLE_ON_UNPAID: "settle_on_unpaid",
  VERIFY_ON_UNPAID: "verify_on_unpaid",
  MALFORMED_FIXTURE: "malformed_fixture",
});

export const REFUSED_FLAGS = Object.freeze([
  "--live",
  "--refresh",
  "--cdp",
  "--poll",
  "--pay",
  "--payment-signature",
  "--publish",
  "--neo",
]);
