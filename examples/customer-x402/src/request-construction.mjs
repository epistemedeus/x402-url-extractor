import { AuthorizationRefusal } from "./authorization.mjs";
import { admitPublicHttpOrHttpsUrl, BatchAdmissionError } from "./batch-admission.mjs";
import {
  LIVE_EXTRACT_PATH,
  LIVE_LOCKFILE_PATH,
  LIVE_ORIGIN,
} from "./constants.mjs";

function fail(message, field = "url") {
  throw new AuthorizationRefusal(message, { field });
}

function asUrl(raw, label = "url") {
  try {
    return new URL(String(raw || ""));
  } catch {
    fail(`${label} must be an absolute HTTPS URL`, label);
  }
}

function parseBody(body) {
  if (body == null || body === "") return undefined;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      fail("bodyRaw must be valid JSON", "body");
    }
  }
  return body;
}

function freezeConstruction(value) {
  return Object.freeze({
    kind: value.kind,
    purchaseReady: value.purchaseReady === true,
    missing: Object.freeze([...(value.missing || [])]),
    reason: value.reason || null,
    boundUrl: value.boundUrl || null,
    targetUrl: value.targetUrl || null,
  });
}

/**
 * Bind GET /extract to a caller page URL. Bare /extract is discovery, not this
 * bound resource. Preserves the caller string; does not add a trailing slash.
 */
export function bindGetExtractResourceUrl(pageUrl, { origin = LIVE_ORIGIN } = {}) {
  let admitted;
  try {
    admitted = admitPublicHttpOrHttpsUrl(pageUrl, { field: "url", httpsOnly: false });
  } catch (error) {
    if (error instanceof BatchAdmissionError) fail(error.message, error.field || "url");
    throw error;
  }
  return `${origin}${LIVE_EXTRACT_PATH}?url=${encodeURIComponent(admitted)}`;
}

/**
 * Required query keys advertised on an unpaid 402 Bazaar extension, if present.
 * Missing extension is not treated as "no input required".
 */
export function requiredQueryFromChallenge(challenge) {
  const bazaar = challenge?.extensions?.bazaar;
  const required = bazaar?.schema?.properties?.input?.properties?.queryParams?.required;
  const example = bazaar?.info?.input?.queryParams ?? null;
  return Object.freeze({
    required: Object.freeze(Array.isArray(required) ? required.map(String) : []),
    example: example && typeof example === "object" ? Object.freeze({ ...example }) : null,
  });
}

/**
 * Classify a supported SameDayDesk request before wallet access.
 * Unsigned empty discovery stays distinct from an invalid bound purchase.
 */
export function classifyRequestConstruction(requestUrl, { method = "GET", body = null } = {}) {
  const url = asUrl(requestUrl, "url");
  const methodUpper = String(method || "GET").toUpperCase();

  if (url.pathname === LIVE_EXTRACT_PATH && methodUpper === "GET") {
    const keys = [...url.searchParams.keys()];
    if (keys.length === 0) {
      return freezeConstruction({
        kind: "unsigned_discovery",
        purchaseReady: false,
        missing: ["url"],
        reason: "GET /extract without url is unpaid discovery, not a purchase",
        boundUrl: url.toString(),
      });
    }
    const targets = url.searchParams.getAll("url");
    if (targets.length !== 1 || !targets[0]) {
      return freezeConstruction({
        kind: "invalid_input",
        purchaseReady: false,
        missing: ["url"],
        reason: targets.length > 1
          ? "query parameter url must be supplied exactly once"
          : "authorization query must include url=",
        boundUrl: url.toString(),
      });
    }
    try {
      admitPublicHttpOrHttpsUrl(targets[0], { field: "url", httpsOnly: false });
    } catch (error) {
      return freezeConstruction({
        kind: "invalid_input",
        purchaseReady: false,
        missing: ["url"],
        reason: error instanceof BatchAdmissionError
          ? error.message
          : "url must be a public HTTP or HTTPS URL",
        boundUrl: url.toString(),
      });
    }
    return freezeConstruction({
      kind: "bound_request",
      purchaseReady: true,
      missing: [],
      boundUrl: url.toString(),
      targetUrl: targets[0],
    });
  }

  if (url.pathname === LIVE_LOCKFILE_PATH && methodUpper === "POST") {
    let parsed;
    try {
      parsed = parseBody(body);
    } catch (error) {
      return freezeConstruction({
        kind: "invalid_input",
        purchaseReady: false,
        missing: ["before", "after"],
        reason: error instanceof AuthorizationRefusal ? error.message : "bodyRaw must be valid JSON",
      });
    }
    if (parsed === undefined || (
      parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 0
    )) {
      return freezeConstruction({
        kind: "unsigned_discovery",
        purchaseReady: false,
        missing: ["before", "after"],
        reason: "empty lockfile POST is unpaid discovery, not a purchase",
      });
    }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return freezeConstruction({
        kind: "invalid_input",
        purchaseReady: false,
        missing: ["before", "after"],
        reason: "request body must be a JSON object",
      });
    }
    const missing = ["before", "after"].filter((key) => (
      parsed[key] == null || typeof parsed[key] !== "object" || Array.isArray(parsed[key])
    ));
    if (missing.length) {
      return freezeConstruction({
        kind: "invalid_input",
        purchaseReady: false,
        missing,
        reason: `${missing[0]} must be a JSON object (not a path or string)`,
      });
    }
    return freezeConstruction({
      kind: "bound_request",
      purchaseReady: true,
      missing: [],
      boundUrl: url.toString(),
    });
  }

  if (url.pathname === "/extract/batch" && methodUpper === "POST") {
    return freezeConstruction({
      kind: "bound_request",
      purchaseReady: true,
      missing: [],
      boundUrl: url.toString(),
    });
  }

  return freezeConstruction({
    kind: "undeclared",
    purchaseReady: false,
    missing: [],
    reason: "this client constructs GET /extract, POST /extract/batch, and POST /lockfile-pin-delta only",
  });
}

export function assertPurchaseReady(requestUrl, options = {}) {
  const construction = classifyRequestConstruction(requestUrl, options);
  if (construction.kind === "unsigned_discovery" || construction.kind === "invalid_input") {
    fail(construction.reason, construction.missing[0] || "url");
  }
  if (!construction.purchaseReady) {
    fail(construction.reason || "request is not purchase-ready", "url");
  }
  return construction;
}
