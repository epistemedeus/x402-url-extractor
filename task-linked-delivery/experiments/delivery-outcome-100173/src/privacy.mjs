import { containsRestrictedKey } from "../../../tools/ops/three-site-settlement-join/measure/src/restricted.mjs";
import { fail } from "./errors.mjs";

const EXTRA = new Set([
  "paymentsignature", "paymentcredential", "browserprofile", "rawbrowserprofile",
  "privatekey", "seedphrase", "contact", "contactemail", "authheader",
  "paymentheader", "xpayment",
]);

function normalize(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extraRestricted(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => extraRestricted(item, seen));
  for (const [key, child] of Object.entries(value)) {
    // Route catalogs use path keys such as "/contact/*". Those are not contact fields.
    if (!key.includes("/") && EXTRA.has(normalize(key))) return true;
    if (extraRestricted(child, seen)) return true;
  }
  return false;
}

export function hasDisallowedKey(value) {
  return containsRestrictedKey(value) || extraRestricted(value);
}

export function assertProjectable(value) {
  if (hasDisallowedKey(value)) fail("restricted_fields");
  if (claimsRevenue(value)) fail("revenue_claim");
}

export function assertEnvelope(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) fail("invalid_snapshot");
  const { events, forwardRecords, ...rest } = snapshot;
  assertProjectable(rest);
  if (claimsRevenue(events) || claimsRevenue(forwardRecords)) fail("revenue_claim");
}

function claimsRevenue(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => claimsRevenue(item, seen));
  if (value.recognizedRevenue === true || value.isRevenue === true || value.booksDeltaAsRevenue === true) return true;
  if (value.organicAttribution === true || value.organic === true) return true;
  if (typeof value.recognizedRevenueAtomic === "string" && value.recognizedRevenueAtomic !== "0") return true;
  if (value.bookSettlementAsRevenue === true) return true;
  return Object.values(value).some((item) => claimsRevenue(item, seen));
}

export function refusesDirective(snapshot) {
  const directives = snapshot?.directives;
  if (!directives || typeof directives !== "object") return null;
  if (directives.relabelUnclassifiedAsIndependent === true) return "relabel_refused";
  if (directives.bookSettlementAsRevenue === true) return "revenue_claim";
  if (directives.countExit0AsInstall === true) return "exit0_directive_refused";
  if (directives.treatHttp200AsUseful === true) return "http200_directive_refused";
  return null;
}
