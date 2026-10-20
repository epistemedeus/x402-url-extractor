import { isIP } from "node:net";

import {
  DEFAULT_SELLER_AUDIT_REQUIRED_OUTPUT,
  LIVE_ASSET,
  LIVE_NETWORK,
  LIVE_RECIPIENT,
  LIVE_SELLER_AUDIT_AMOUNT_ATOMIC,
  LIVE_SELLER_AUDIT_PATH,
  LIVE_SELLER_AUDIT_PRODUCT,
  LIVE_SELLER_AUDIT_VERSION,
} from "./constants.mjs";

/**
 * Match agent-payment-integrity@0b58000 normalizeOrigin without importing it:
 * credential-free HTTPS, no explicit port, pathname "/", hostname contains ".",
 * and literal IPv4 must be public. IPv6 literals fail the hostname-dot rule.
 */
const ROUTE = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/;
const PATH_PART = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,7}$/;
const REFERRAL = /^r1_[0-9a-f]{64}$/;
const ALLOWED_QUERY = Object.freeze([
  "origin", "route", "method", "requiredPaths", "requireBazaar", "referral",
]);
const FAILURE_CODES = new Set([
  "exact_route_not_declared",
  "openapi_unavailable",
  "openapi_invalid",
  "route_ceiling_exceeded",
  "bounded_transport_failure",
]);
const COMPLETE_DECISIONS = new Set(["machine_buyable", "contract_ready"]);
const BOUNDARY_CONSTS = Object.freeze([
  "credentialsUsed",
  "targetPaymentSigned",
  "targetPaymentSent",
  "targetRequestSent",
  "redirectsFollowed",
  "responseBodyRead",
  "schemaRetained",
  "queryValuesRetained",
]);

const ORIGIN_MESSAGE = "origin must be a credential-free public HTTPS origin on port 443";
const REFERRAL_MESSAGE = "referral must be r1_ followed by the lowercase SHA-256 hex digest of one complete signed x402 offer-receipt envelope";

export class SellerAuditAdmissionError extends Error {
  constructor(message, field = "url") {
    super(message);
    this.name = "SellerAuditAdmissionError";
    this.field = field;
  }
}

function fail(message, field) {
  throw new SellerAuditAdmissionError(message, field);
}

function publicIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export function admitSellerAuditOrigin(raw) {
  let url;
  try {
    url = new URL(String(raw ?? ""));
  } catch {
    fail(ORIGIN_MESSAGE, "origin");
  }
  const ipKind = isIP(url.hostname);
  if (
    url.protocol !== "https:"
    || url.port
    || url.pathname !== "/"
    || url.search
    || url.hash
    || url.username
    || url.password
    || !url.hostname.includes(".")
    || (ipKind === 4 && !publicIpv4(url.hostname))
    || ipKind === 6
  ) {
    fail(ORIGIN_MESSAGE, "origin");
  }
  return url.origin;
}

function normalizeReferral(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !REFERRAL.test(value)) fail(REFERRAL_MESSAGE, "referral");
  return value;
}

/** Same admitted object as merchant normalizeSellerIntegrityAuditInput. */
export function normalizeSellerAuditInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("input must be an object", "input");
  const unknown = Object.keys(input).filter((key) => !ALLOWED_QUERY.includes(key)).sort();
  if (unknown.length) fail(`unsupported input field: ${unknown[0]}`, unknown[0]);
  const origin = admitSellerAuditOrigin(input.origin);
  const route = String(input.route || "");
  if (!ROUTE.test(route) || route.includes("{") || route.includes("?") || route.includes("#")) {
    fail("route must be one exact absolute path without parameters, query, or fragment", "route");
  }
  if (input.requireBazaar !== undefined && typeof input.requireBazaar !== "boolean" && !["true", "false"].includes(input.requireBazaar)) {
    fail("requireBazaar must be true or false", "requireBazaar");
  }
  const method = String(input.method || "GET").toUpperCase();
  if (!["GET", "POST"].includes(method)) fail("method must be GET or POST", "method");
  const rawPaths = Array.isArray(input.requiredPaths)
    ? input.requiredPaths
    : String(input.requiredPaths || "").split(",").filter(Boolean);
  const requiredPaths = [...new Set(rawPaths.map((path) => String(path).trim()))].sort();
  if (requiredPaths.length > 16 || requiredPaths.some((path) => !PATH_PART.test(path))) {
    fail("requiredPaths must contain at most 16 safe dotted JSON paths", "requiredPaths");
  }
  return Object.freeze({
    origin,
    route,
    method,
    requiredPaths: Object.freeze(requiredPaths),
    requireBazaar: input.requireBazaar === true || input.requireBazaar === "true",
    referral: normalizeReferral(input.referral),
  });
}

export function canonicalSellerAuditSearch(query) {
  const params = new URLSearchParams();
  params.set("origin", query.origin);
  params.set("route", query.route);
  params.set("method", query.method);
  if (query.requiredPaths.length) params.set("requiredPaths", query.requiredPaths.join(","));
  if (query.requireBazaar === true) params.set("requireBazaar", "true");
  if (query.referral) params.set("referral", query.referral);
  return params.toString();
}

export function canonicalSellerAuditUrl(merchantOrigin, query) {
  const url = new URL(LIVE_SELLER_AUDIT_PATH, merchantOrigin);
  url.search = canonicalSellerAuditSearch(query);
  url.hash = "";
  return url.href;
}

export function classifySellerAuditUrl(url) {
  const keys = [...url.searchParams.keys()];
  if (keys.length === 0) {
    return {
      kind: "unsigned_discovery",
      purchaseReady: false,
      missing: ["origin", "route", "method"],
      reason: "GET /commerce/seller-integrity-audit without a query is unpaid discovery, not a purchase",
      boundUrl: url.href,
    };
  }
  const counts = new Map();
  for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
  for (const [key, count] of counts) {
    if (count !== 1) {
      return {
        kind: "invalid_input",
        purchaseReady: false,
        missing: [key],
        reason: `query parameter ${key} must be supplied exactly once`,
        boundUrl: url.href,
      };
    }
  }
  const unknown = [...counts.keys()].find((key) => !ALLOWED_QUERY.includes(key));
  if (unknown) {
    return {
      kind: "invalid_input",
      purchaseReady: false,
      missing: [unknown],
      reason: `unsupported seller-audit query field: ${unknown}`,
      boundUrl: url.href,
    };
  }
  const missing = ["origin", "route", "method"].filter((key) => !url.searchParams.has(key) || !url.searchParams.get(key));
  if (missing.length) {
    return {
      kind: "invalid_input",
      purchaseReady: false,
      missing,
      reason: "seller-audit purchase requires origin, route, and method",
      boundUrl: url.href,
    };
  }
  let query;
  try {
    query = normalizeSellerAuditInput({
      origin: url.searchParams.get("origin"),
      route: url.searchParams.get("route"),
      method: url.searchParams.get("method"),
      ...(url.searchParams.has("requiredPaths") ? { requiredPaths: url.searchParams.get("requiredPaths") } : {}),
      ...(url.searchParams.has("requireBazaar") ? { requireBazaar: url.searchParams.get("requireBazaar") } : {}),
      ...(url.searchParams.has("referral") ? { referral: url.searchParams.get("referral") } : {}),
    });
  } catch (error) {
    return {
      kind: "invalid_input",
      purchaseReady: false,
      missing: [error.field || "url"],
      reason: error.message,
      boundUrl: url.href,
    };
  }
  const boundUrl = canonicalSellerAuditUrl(url.origin, query);
  if (url.href !== boundUrl) {
    return {
      kind: "invalid_input",
      purchaseReady: false,
      missing: ["url"],
      reason: "seller-audit query is not the exact canonical request",
      boundUrl,
    };
  }
  return {
    kind: "bound_request",
    purchaseReady: true,
    missing: [],
    reason: null,
    boundUrl,
    query,
  };
}

function pathsCovered(report, requiredPaths) {
  if (!requiredPaths.length) return true;
  const covered = new Set([
    ...(Array.isArray(report.responseContract?.requiredPaths) ? report.responseContract.requiredPaths : []),
    ...(Array.isArray(report.repairPlan?.guaranteedPaths) ? report.repairPlan.guaranteedPaths : []),
  ]);
  return requiredPaths.every((path) => covered.has(path));
}

function samePaths(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((path, index) => path === right[index]);
}

/** Classify one paid seller-audit JSON body against the bound query. */
export function classifySellerAuditBody(body, authorization) {
  const query = authorization?.sellerAuditQuery;
  if (!query) {
    return { valid: false, delivery: "invalid", reason: "seller-audit authorization is missing its bound query", report: null };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, delivery: "invalid", reason: "seller-audit response is not a JSON object", report: null };
  }
  if (body.product !== LIVE_SELLER_AUDIT_PRODUCT || body.version !== LIVE_SELLER_AUDIT_VERSION) {
    return { valid: false, delivery: "invalid", reason: "paid seller audit product or version does not match the authorized audit", report: null };
  }
  const request = body.request;
  if (!request || typeof request !== "object" || Array.isArray(request)
    || request.origin !== query.origin
    || request.route !== query.route
    || request.method !== query.method
    || !samePaths(request.requiredPaths, query.requiredPaths)
    || request.requireBazaar !== query.requireBazaar
    || (request.referral ?? null) !== (query.referral ?? null)) {
    return { valid: false, delivery: "invalid", reason: "paid seller audit request does not match the authorized query", report: null };
  }
  const boundary = body.boundary;
  if (!boundary || typeof boundary !== "object" || BOUNDARY_CONSTS.some((key) => boundary[key] !== false)) {
    return { valid: false, delivery: "invalid", reason: "paid seller audit boundary does not keep payment and credential constants false", report: null };
  }
  const report = body.report;
  if (!report || typeof report !== "object" || typeof report.auditCompleted !== "boolean") {
    return { valid: false, delivery: "invalid", reason: "paid seller audit report is missing auditCompleted", report: null };
  }
  if (typeof body.ok !== "boolean" || typeof body.decision !== "string" || typeof body.checkedAt !== "string") {
    return { valid: false, delivery: "invalid", reason: "paid seller audit is missing ok, decision, or checkedAt", report: null };
  }
  if (!report.auditCompleted) {
    if (body.ok !== false || body.decision !== "repair_required" || !FAILURE_CODES.has(report.failureCode)) {
      return { valid: false, delivery: "invalid", reason: "incomplete seller audit is missing a typed failure", report: null };
    }
    return {
      valid: true,
      delivery: "audit_incomplete",
      reason: `seller audit did not complete: ${report.failureCode}`,
      report: { failureCode: report.failureCode, decision: body.decision },
    };
  }
  if (report.failureCode != null) {
    return { valid: false, delivery: "invalid", reason: "completed seller audit must not carry a failure code", report: null };
  }
  if (body.decision === "repair_required") {
    if (body.ok !== false) {
      return { valid: false, delivery: "invalid", reason: "repair_required seller audit must set ok false", report: null };
    }
    return {
      valid: true,
      delivery: "audit_refused",
      reason: "seller audit decision is repair_required",
      report: { decision: body.decision },
    };
  }
  if (!COMPLETE_DECISIONS.has(body.decision) || body.ok !== true) {
    return { valid: false, delivery: "invalid", reason: "seller audit decision is not a completed compatible result", report: null };
  }
  if (!pathsCovered(report, query.requiredPaths)) {
    return {
      valid: true,
      delivery: "audit_refused",
      reason: "required_output_not_guaranteed",
      report: { decision: body.decision },
    };
  }
  return {
    valid: true,
    delivery: "audit_complete",
    reason: "seller audit completed and covers the authorized required output",
    report: { decision: body.decision },
  };
}

export function sellerAuditTerms(url, overrides = {}) {
  return {
    method: "GET",
    url,
    network: LIVE_NETWORK,
    asset: LIVE_ASSET,
    recipient: LIVE_RECIPIENT,
    amountCapAtomic: LIVE_SELLER_AUDIT_AMOUNT_ATOMIC,
    assetName: "USD Coin",
    assetVersion: "2",
    maxTimeoutSeconds: 300,
    requiredOutput: DEFAULT_SELLER_AUDIT_REQUIRED_OUTPUT,
    ...overrides,
  };
}

export const SELLER_AUDIT_CONTRACT = Object.freeze({
  command: "samedaydesk-seller-audit",
  version: "0.1.0",
  route: Object.freeze({ method: "GET", path: LIVE_SELLER_AUDIT_PATH }),
  product: LIVE_SELLER_AUDIT_PRODUCT,
  outputVersion: LIVE_SELLER_AUDIT_VERSION,
  preflight: Object.freeze({
    walletAccessed: false,
    paymentSigned: false,
    paymentSent: false,
    charged: false,
  }),
  paid: Object.freeze({
    requiresApprove: true,
    oneSend: true,
    livePaymentRefusedByDefault: true,
    sdk: "@x402/fetch@2.16.0",
  }),
  recovery: Object.freeze({
    reconcile: true,
    respend: false,
    requiresAttemptReceipt: true,
  }),
  feedbackRequired: false,
});
