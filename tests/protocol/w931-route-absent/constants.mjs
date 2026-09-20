/**
 * w931: x402 `route_absent` is a checked observation, not demand.
 * Empty catalogs and a flag-off lockfile route stay unpaid. Never send
 * PAYMENT-SIGNATURE. Never pay. Never treat absence as a sale.
 *
 * Pins: SDS 1.23.49 lockfile-pin-delta is flag-gated (default off).
 * Catalog classifier: agent-discoverability-audit.mjs.
 */
export const SCHEMA_FIXTURE = "samedaydesk.x402-protocol-fixtures.w931-route-absent.v1";
export const SCHEMA_REPORT = "samedaydesk.x402-protocol-report.w931-route-absent.v1";

export const SDS = Object.freeze({
  origin: "https://agents.samedaydesk.com",
  lockfilePath: "/lockfile-pin-delta",
  extractPath: "/extract",
  amountAtomic: "5000",
  expectedPriceUsd: "0.005",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
  intent: "extract a public website into structured JSON metadata",
  serviceName: "x402-data-gateway",
  serviceVersion: "1.23.49",
});

export const SOURCE_ORDER = Object.freeze([
  "coinbase-bazaar",
  "coinbase-agentic-market",
  "agent402-router",
  "circle-marketplace",
  "agentictrade-catalog",
  "official-mpp-catalog",
  "mppscan-public-search",
  "payanagent-public-search",
  "x402jobs-public-search",
  "8004market-public-search",
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
  ROUTE_ABSENT: "route_absent",
  ORIGIN_FOUND_EXPECTED_ROUTE_ABSENT: "origin_found_expected_route_absent",
  MERCHANT_ROUTE_ABSENT: "merchant_route_absent",
  ROUTE_ABSENT_CLASSIFIED_AS_DEMAND: "route_absent_classified_as_demand",
  ROUTE_ABSENT_CLASSIFIED_AS_MATCHED: "route_absent_classified_as_matched",
  ROUTE_ABSENT_CLASSIFIED_AS_CHARGED: "route_absent_classified_as_charged",
  ABSENCE_TREATED_AS_402: "absence_treated_as_402",
  LOCKFILE_ADVERTISED_WHILE_ABSENT: "lockfile_advertised_while_absent",
  EXTRACT_CONTROL_NOT_402: "extract_control_not_402",
  PAYMENT_SIGNATURE_SENT: "payment_signature_sent",
  SETTLE_ON_ABSENT: "settle_on_absent",
  INVENTED_RECEIPT_FIELD: "invented_receipt_field",
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
