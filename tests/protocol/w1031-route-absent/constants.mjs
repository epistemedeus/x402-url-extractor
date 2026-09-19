/**
 * w1031: an HTTP method+path that is not a registered x402 resource is
 * `route_absent`. Absence is not a 402 challenge, not demand, not settlement.
 * Unpaid loopback only. Never send PAYMENT-SIGNATURE on a present route. Never pay.
 *
 * Pins: SDS 1.23.49, GET /extract $0.005 = 5000 atomic USDC on Base.
 * Flag-off: EXTRACT_BATCH_ENABLED=0, LOCKFILE_PIN_DELTA_ENABLED=0.
 */
import { CIRCLE_GATEWAY_PATH } from "../../../circle-gateway-route.mjs";
import { EXTRACT_BATCH_METHOD, EXTRACT_BATCH_PATH } from "../../../extract-batch-config.mjs";
import { DEFAULT_PAID_ROUTES } from "../../../idempotency-replay.mjs";
import { LOCKFILE_PIN_DELTA_METHOD, LOCKFILE_PIN_DELTA_PATH } from "../../../lockfile-pin-delta-config.mjs";

export const SCHEMA_FIXTURE = "samedaydesk.x402-protocol-fixtures.w1031-route-absent.v1";
export const SCHEMA_REPORT = "samedaydesk.x402-protocol-report.w1031-route-absent.v1";

export const SDS = Object.freeze({
  origin: "https://agents.samedaydesk.com",
  extractPath: "/extract",
  extractMethod: "GET",
  amountAtomic: "5000",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
  price: "$0.005",
  serviceVersion: "1.23.49",
  x402Version: 2,
  catalogSource: "sds-well-known-x402",
});

export const INVENTED_PATH = "/w1031-route-absent";

export const POST_ONLY_PATHS = Object.freeze(new Set([
  "/security/wallet-policy-conformance",
  "/security/stateful-wallet-policy-conformance",
]));

export const ALWAYS_ON_EXTRA_GET_PATHS = Object.freeze([
  "/commerce/seller-integrity-audit",
  "/commerce/contract-qualified-search",
  "/distribution/agent-surface-budget-audit",
  CIRCLE_GATEWAY_PATH,
]);

function registeredKeys() {
  const keys = new Set();
  for (const route of DEFAULT_PAID_ROUTES) {
    keys.add(`${POST_ONLY_PATHS.has(route) ? "POST" : "GET"} ${route}`);
  }
  for (const route of ALWAYS_ON_EXTRA_GET_PATHS) {
    keys.add(`GET ${route}`);
  }
  return keys;
}

export const REGISTERED_KEYS = Object.freeze(registeredKeys());

export const PRESENT_CONTROL = Object.freeze({
  method: SDS.extractMethod,
  path: SDS.extractPath,
  amountAtomic: SDS.amountAtomic,
});

export const ABSENT_PROBES = Object.freeze([
  Object.freeze({ id: "invented", method: "GET", path: INVENTED_PATH }),
  Object.freeze({ id: "extract-batch-flag-off", method: EXTRACT_BATCH_METHOD, path: EXTRACT_BATCH_PATH }),
  Object.freeze({ id: "lockfile-flag-off", method: LOCKFILE_PIN_DELTA_METHOD, path: LOCKFILE_PIN_DELTA_PATH }),
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
  PRESENT_UNPAID_402: "present_unpaid_402",
  ROUTE_ABSENT_CLASSIFIED_AS_DEMAND: "route_absent_classified_as_demand",
  ABSENT_ROUTE_AS_402: "absent_route_as_402",
  ABSENT_ROUTE_AS_CHARGED: "absent_route_classified_as_charged",
  SETTLE_ON_ABSENT: "settle_on_absent",
  VERIFY_ON_ABSENT: "verify_on_absent",
  CATALOG_LISTS_ABSENT: "catalog_lists_absent_route",
  PRESENT_NOT_402: "present_route_not_402",
  AMOUNT_MISMATCH: "amount_mismatch",
  INVENTED_RECEIPT_FIELD: "invented_receipt_field",
  PAYMENT_SIGNATURE_SENT: "payment_signature_sent",
  MALFORMED_FIXTURE: "malformed_fixture",
  IDENTITY_NOT_ROUTE_ABSENT: "identity_not_route_absent",
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

export function routeKey(method, path) {
  return `${String(method || "GET").toUpperCase()} ${path}`;
}

export function isRegisteredRoute(method, path) {
  return REGISTERED_KEYS.has(routeKey(method, path));
}

export function isAbsentProbe(method, path) {
  return ABSENT_PROBES.some((probe) => probe.method === method && probe.path === path);
}
