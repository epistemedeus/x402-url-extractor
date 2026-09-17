/**
 * Native POST /extract/batch unpaid 402 pins (W1-R11 R11-402-03).
 * Distinct from R6-02 SDS GET /extract amount 5000.
 */

export const SCHEMA_FIXTURE = "samedaydesk.x402-protocol-fixtures.extract-batch-402.v1";
export const SCHEMA_REPORT = "samedaydesk.x402-protocol-extract-batch-402-report.v1";

export const BATCH = Object.freeze({
  origin: "https://agents.samedaydesk.com",
  path: "/extract/batch",
  method: "POST",
  resourceUrl: "https://agents.samedaydesk.com/extract/batch",
  amountAtomic: "10000",
  priceUsd: "$0.01",
  priceDisplay: "0.01",
  openapi402: "payment required (x402 or MPP, $0.01 introductory flat batch quote)",
  mcpTool: "extract_batch",
  operationId: "extractPublicUrlsBatch",
  product: "samedaydesk-extract-batch",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
});

/** R6-02 GET /extract pin. Used only to refuse rewrite / amount-copy. */
export const EXTRACT_GET = Object.freeze({
  path: "/extract",
  method: "GET",
  resourceUrl: "https://agents.samedaydesk.com/extract",
  amountAtomic: "5000",
  mcpTool: "extract",
});

export const FORBIDDEN_INVENTED = Object.freeze([
  "loyaltyPoints",
  "throughBlock",
  "buyerEmail",
  "npsScore",
  "tipAmount",
  "uniqueVisitors",
]);

export const PAID_REQUEST_HEADERS = Object.freeze([
  "payment-signature",
  "x-payment-signature",
  "payment-payload",
]);

export const PAID_RESPONSE_HEADERS = Object.freeze([
  "payment-response",
  "x-payment-response",
  "payment-receipt",
  "x-payment-receipt",
]);

export const CODES = Object.freeze({
  NATIVE: "native_post_extract_batch",
  NOT_EXTRACT_REWRITE: "not_extract_rewrite",
  AMOUNT_MISMATCH: "amount_mismatch",
  INVENTED_RECEIPT_FIELD: "invented_receipt_field",
  PAYMENT_SENT: "payment_sent",
  MALFORMED_FIXTURE: "malformed_fixture",
  HTTP_NOT_402: "http_not_402",
  METHOD_NOT_POST: "method_not_post",
  PATH_NOT_BATCH: "path_not_batch",
  BAZAAR_METHOD_NOT_POST: "bazaar_method_not_post",
  TREAT_ABSENCE_AS_DEMAND: "treat_absence_as_demand",
  ROUTE_ABSENT: "route_absent",
  PROBE_FAILED: "probe_failed",
});

/** R6-02 codes this suite must never emit for native batch. */
export const R6_02_REWRITE_CODES = Object.freeze(["unsupported_target", "authorization_refused", "one_paywall"]);
