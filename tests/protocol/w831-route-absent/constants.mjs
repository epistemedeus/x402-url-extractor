/**
 * w831: an x402 route that is not declared must stay route_absent.
 * It is not HTTP 402, not PAYMENT-REQUIRED, and not settlement.
 * Unpaid loopback only. Never send a live payment.
 */
export const SCHEMA_FIXTURE = "samedaydesk.x402-protocol-fixtures.w831-route-absent.v1";
export const SCHEMA_REPORT = "samedaydesk.x402-protocol-report.w831-route-absent.v1";

export const SDS = Object.freeze({
  origin: "https://agents.samedaydesk.com",
  host: "agents.samedaydesk.com",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
  amountAtomic: "5000",
  price: "$0.005",
  x402Version: 2,
  serviceVersion: "1.23.49",
});

export const DECLARED_PAID_ROUTE = "/extract";
export const DECLARED_FREE_ROUTE = "/healthz";
export const ABSENT_ROUTE = "/w831-absent-route";
export const LOOKALIKE_ROUTES = Object.freeze([
  "/extract-w831",
  "/extract/w831-child",
  "/extract.json",
  "/w831-extract",
]);
export const CASEFOLD_DECLARED_ROUTE = "/EXTRACT";
export const METHOD_ABSENT = Object.freeze({ method: "POST", path: "/extract" });
export const WELL_KNOWN_X402 = "/.well-known/x402";

export const CATALOG_ORIGIN = "https://api.example.com";
export const CATALOG_EXPECTED_ROUTE = "/extract";
export const CATALOG_LISTED_ROUTE = "/read";
export const CATALOG_INTENT = "extract a public website into structured JSON metadata";

export const CODES = Object.freeze({
  ROUTE_ABSENT_HOLDS: "route-absent-holds",
  ABSENT_ROUTE_AS_402: "absent_route_classified_as_402",
  ABSENT_ROUTE_PAYABLE: "absent_route_classified_as_payable",
  ABSENT_ROUTE_CHARGED: "absent_route_classified_as_charged",
  ABSENT_ROUTE_SETTLE: "absent_route_settle",
  ABSENT_ROUTE_VERIFY: "absent_route_verify",
  ABSENT_ROUTE_PAYMENT_REQUIRED: "absent_route_payment_required",
  ABSENT_ROUTE_PAYMENT_RESPONSE: "absent_route_payment_response",
  DECLARED_PAID_NOT_402: "declared_paid_not_402",
  DECLARED_PAID_AS_ABSENT: "declared_paid_classified_as_absent",
  FREE_SURFACE_AS_ABSENT: "free_surface_classified_as_absent",
  FREE_SURFACE_AS_402: "free_surface_classified_as_402",
  CATALOG_ROUTE_ABSENT_AS_MATCHED: "catalog_route_absent_classified_as_matched",
  CATALOG_MISSING_ROUTE_ABSENT: "catalog_missing_route_absent_status",
  WELL_KNOWN_LISTS_ABSENT: "well_known_lists_absent_route",
  PAYMENT_SENT: "payment_sent",
  LIVE_FACILITATOR: "live_facilitator",
  CHECKOUT_MUTATED: "checkout_mutated",
  PUBLISHED: "published",
  NEO_TOUCHED: "neo_touched",
  MALFORMED_FIXTURE: "malformed_fixture",
  COLD_INCOMPLETE: "cold_incomplete",
});

export const REFUSED_FLAGS = Object.freeze([
  "--live",
  "--refresh",
  "--cdp",
  "--poll",
  "--pay",
  "--payment-signature",
  "--publish",
]);
