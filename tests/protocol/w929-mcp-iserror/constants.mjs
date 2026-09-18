/**
 * w929: unpaid MCP tools/call is HTTP 200 result.isError=true, not settlement.
 * Pins from SDS 1.23.49 extract ($0.005 = 5000). Unpaid only.
 */
export const SCHEMA_FIXTURE = "samedaydesk.x402-protocol-fixtures.w929-mcp-iserror.v1";
export const SCHEMA_REPORT = "samedaydesk.x402-protocol-report.w929-mcp-iserror.v1";

export const SDS = Object.freeze({
  origin: "https://agents.samedaydesk.com",
  mcpUrl: "https://agents.samedaydesk.com/mcp",
  mcpTool: "extract",
  mcpResourceUrl: "mcp://tool/extract",
  amountAtomic: "5000",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
  price: "$0.005",
  errorText: "Payment required to access this tool",
  serviceName: "x402-data-gateway",
  serviceVersion: "1.23.49",
});

export const FORBIDDEN_INVENTED = Object.freeze([
  "loyaltyPoints",
  "throughBlock",
  "buyerEmail",
  "npsScore",
  "tipAmount",
  "uniqueVisitors",
]);

export const CODES = Object.freeze({
  UNPAID_MCP_CHALLENGE: "unpaid_mcp_challenge",
  HTTP_200_CLASSIFIED_AS_CHARGED: "http_200_classified_as_charged",
  PAYMENT_REQUIRED_HEADER: "payment_required_header_present",
  HTTP_402_NOT_MCP_ISERROR: "http_402_not_mcp_iserror",
  JSONRPC_ERROR_NOT_ISERROR: "jsonrpc_error_not_iserror",
  ISERROR_OMITTED: "iserror_omitted",
  SNAKE_CASE_IS_ERROR: "snake_case_is_error",
  AMOUNT_MISMATCH: "amount_mismatch",
  PAYTO_MISMATCH: "payto_mismatch",
  NETWORK_MISMATCH: "network_mismatch",
  RESOURCE_MISMATCH: "resource_mismatch",
  INVENTED_RECEIPT_FIELD: "invented_receipt_field",
  PAYMENT_SIGNATURE_SENT: "payment_signature_sent",
  HANDLER_RAN_UNPAID: "handler_ran_unpaid",
  SETTLE_ON_UNPAID: "settle_on_unpaid",
  MALFORMED_FIXTURE: "malformed_fixture",
  TOOLS_LIST_NOT_UNPAID: "tools_list_not_unpaid",
});

export const REFUSED_FLAGS = Object.freeze([
  "--live",
  "--refresh",
  "--cdp",
  "--poll",
  "--pay",
  "--payment-signature",
  "--neo",
]);
