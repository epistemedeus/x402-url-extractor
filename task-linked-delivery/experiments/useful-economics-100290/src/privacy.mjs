import { existsSync } from "node:fs";

import { fail } from "./errors.mjs";

const EXTRA = [
  "prompt", "rawprompt", "systemprompt", "completion", "messages",
  "ip", "ipaddress", "clientip", "useragent", "cookie", "authorization",
  "secret", "apikey", "email", "customerid", "wallet", "walletaddress",
  "payer", "payeraddress", "browserid",
  "remoteaddress", "remoteip", "clientaddress", "sourceip", "xforwardedfor",
  "userid", "accountid", "phone", "phonenumber",
  "accesstoken", "refreshtoken", "sessionid", "authorizationheader",
  "paymentsignature", "paymentcredential", "privatekey", "seedphrase",
  "transactionhash", "txhash", "txid",
  "sharedcustomerid", "crossbrandidentity", "globalcustomerid",
];

const EXTRA_SET = new Set(EXTRA);

function normalize(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function localRestricted(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => localRestricted(item, seen));
  for (const [key, child] of Object.entries(value)) {
    if (!key.includes("/") && EXTRA_SET.has(normalize(key))) return true;
    if (localRestricted(child, seen)) return true;
  }
  return false;
}

function claimsRevenue(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => claimsRevenue(item, seen));
  if (value.recognizedRevenue === true || value.isRevenue === true || value.booksDeltaAsRevenue === true) return true;
  if (value.organicAttribution === true || value.organic === true) return true;
  if (typeof value.recognizedRevenueAtomic === "string" && value.recognizedRevenueAtomic !== "0") return true;
  if (value.bookSettlementAsRevenue === true || value.bookHistoricalAsMargin === true) return true;
  if (value.historicalCountsAsMargin === true || value.historicalCountsAsFutureCashAllocation === true) return true;
  return Object.values(value).some((item) => claimsRevenue(item, seen));
}

export function hasDisallowedKey(value) {
  return localRestricted(value);
}

export async function assertProjectable(value) {
  if (localRestricted(value)) fail("restricted_fields");
  if (claimsRevenue(value)) fail("revenue_claim");
  const inheritedPath = new URL("../../../delivery-outcome-100173/src/privacy.mjs", import.meta.url);
  if (!existsSync(inheritedPath)) return;
  const inherited = await import(inheritedPath.href);
  if (inherited.hasDisallowedKey(value)) fail("restricted_fields");
}

export function refusesDirective(directives) {
  if (!directives || typeof directives !== "object") return null;
  if (directives.relabelUnknownAsIndependent === true || directives.relabelUnclassifiedAsIndependent === true) {
    return "relabel_refused";
  }
  if (directives.treatHttp200AsUseful === true) return "http200_directive_refused";
  if (directives.treatHttp402AsUseful === true) return "http402_directive_refused";
  if (directives.bookSettlementAsRevenue === true || directives.bookHistoricalAsMargin === true) {
    return "historical_not_margin";
  }
  if (directives.allocateSharedRnd === true) return "shared_rnd_not_allocatable";
  return null;
}
