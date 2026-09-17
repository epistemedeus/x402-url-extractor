import { SCHEMAS, evaluateListingIdentity } from "agent-payment-policy";

import {
  AuthorizationRefusal,
  normalizeAuthorization,
} from "../../examples/customer-x402/src/authorization.mjs";
import { DEFAULT_AUTHORIZATION } from "../../examples/customer-x402/src/constants.mjs";
import {
  DELIVERY,
  RESOURCES,
  SETTLEMENT_CLASS,
  evaluateResponseBytes,
  isSupportedTarget,
} from "../../http-delivery-evidence/index.mjs";
import {
  CODES,
  FAIL_CLOSED_CODES,
  SCHEMA_FIXTURE,
  SCHEMA_REPORT,
  SDS,
} from "./constants.mjs";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function upper(value) {
  return String(value || "").toUpperCase();
}

function lowerAddr(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/i.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function pathnameOf(url) {
  try {
    return new URL(String(url)).pathname;
  } catch {
    return null;
  }
}

function originOf(url) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return null;
  }
}

function listingInputKeys(listing) {
  const properties = listing?.inputSchema?.properties;
  if (!properties || typeof properties !== "object") return [];
  return Object.keys(properties);
}

function listingOutputFields(listing) {
  const fields = listing?.outputContract?.requiredFields;
  return Array.isArray(fields) ? fields.map(String) : [];
}

function collectCharges(fixture) {
  const charges = [];
  const seen = new Set();
  const push = (charge) => {
    if (!charge || typeof charge !== "object") return;
    const resource = charge.resource || charge.resourceUrl || null;
    const payTo = charge.payTo || charge.x402WalletAddress || null;
    const amountAtomic = charge.amountAtomic == null ? null : String(charge.amountAtomic);
    const method = upper(charge.method);
    const key = `${charge.role || ""}|${method}|${resource}|${lowerAddr(payTo) || ""}|${amountAtomic || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    charges.push({
      role: charge.role || "unknown",
      method: method || null,
      resource,
      amountAtomic,
      payTo,
    });
  };

  if (Array.isArray(fixture.charges) && fixture.charges.length > 0) {
    for (const charge of fixture.charges) push(charge);
    return charges;
  }

  const observed = asRecord(fixture.observed402) || {};
  for (const [role, challenge] of Object.entries(observed)) {
    if (!asRecord(challenge)) continue;
    if (challenge.status === 402 || challenge.amountAtomic || challenge.payTo) {
      push({
        role,
        method: challenge.method,
        resource: challenge.resource || challenge.resourceUrl,
        amountAtomic: challenge.amountAtomic,
        payTo: challenge.payTo,
      });
    }
  }
  return charges;
}

function listingVisibleSettlement(listing) {
  const values = [
    listing?.payTo,
    listing?.x402WalletAddress,
    listing?.settlementIdentity,
    listing?.outputContract?.payTo,
  ];
  return new Set(values.map(lowerAddr).filter(Boolean));
}

export function listingIdentityObservationFor(fixture) {
  const seller = asRecord(fixture.seller) || {};
  const listing = asRecord(fixture.listing) || {};
  const url = listing.resourceUrl || listing.webhookUrl || null;
  const listingPayTo = listing.payTo || listing.x402WalletAddress || listing.settlementIdentity;
  const record = url
    ? {
      source: String(fixture.kind || "fixture"),
      url,
      rank: 1,
      ...(listingPayTo || seller.payTo
        ? { settlementIdentity: listingPayTo || seller.payTo }
        : {}),
    }
    : null;
  return {
    schemaVersion: SCHEMAS.listingIdentityObservation,
    target: {
      canonicalOrigin: seller.origin || SDS.origin,
      route: seller.path || SDS.extractPath,
      ...(seller.payTo ? { settlementIdentity: seller.payTo } : {}),
    },
    sources: [String(fixture.kind || "fixture")],
    records: record ? [record] : [],
  };
}

function methodRewrite(fixture) {
  const listing = asRecord(fixture.listing) || {};
  const seller = asRecord(fixture.seller) || {};
  if (listing.rewritesSellerMethod === true) return true;
  const listedPath = pathnameOf(listing.resourceUrl);
  return listedPath === SDS.extractPath
    && upper(listing.method) === "POST"
    && upper(seller.method || SDS.extractMethod) === "GET";
}

function evaluateMethodRewrite(fixture) {
  if (!methodRewrite(fixture)) {
    return {
      rewritten: false,
      supported: true,
      deliveryClass: null,
      authorizationOutcome: null,
      codes: [],
    };
  }
  const listing = asRecord(fixture.listing) || {};
  const method = upper(listing.method) || "POST";
  const supported = isSupportedTarget(method, RESOURCES.EXTRACT);
  const delivery = evaluateResponseBytes({
    method,
    resource: RESOURCES.EXTRACT,
    responseBytes: Buffer.from("{}"),
    merchantHttpStatus: 402,
    settlementClass: SETTLEMENT_CLASS.UNPAID,
  });
  let authorizationOutcome = null;
  const codes = [];
  if (!supported || delivery.deliveryClass === DELIVERY.UNSUPPORTED_TARGET) {
    codes.push(CODES.UNSUPPORTED_TARGET);
  }
  try {
    normalizeAuthorization({
      ...DEFAULT_AUTHORIZATION,
      method,
      url: DEFAULT_AUTHORIZATION.url,
    });
    authorizationOutcome = "authorized";
  } catch (error) {
    if (error instanceof AuthorizationRefusal || error?.code === CODES.AUTHORIZATION_REFUSED) {
      authorizationOutcome = CODES.AUTHORIZATION_REFUSED;
      codes.push(CODES.AUTHORIZATION_REFUSED);
    } else {
      authorizationOutcome = "unknown";
      codes.push(CODES.AUTHORIZATION_REFUSED);
    }
  }
  return {
    rewritten: true,
    supported,
    deliveryClass: delivery.deliveryClass,
    authorizationOutcome,
    codes,
    delivery,
  };
}

function preservedContract(fixture) {
  const listing = asRecord(fixture.listing) || {};
  const seller = asRecord(fixture.seller) || {};
  const sellerMethod = upper(seller.method || SDS.extractMethod);
  const listingMethod = upper(listing.method);
  const method = listingMethod === sellerMethod;
  const requiredInputs = Array.isArray(seller.inputKeys) ? seller.inputKeys : SDS.inputKeys;
  const listedInputs = listingInputKeys(listing);
  const inputs = requiredInputs.every((key) => listedInputs.includes(key));
  const requiredOutputs = Array.isArray(seller.outputRequiredFields)
    ? seller.outputRequiredFields
    : SDS.outputRequiredFields;
  const listedOutputs = listingOutputFields(listing);
  const outputs = requiredOutputs.every((field) => listedOutputs.includes(field));
  const codes = [];
  if (!listingMethod || !method) codes.push(CODES.LOST_METHOD);
  if (!inputs) codes.push(CODES.LOST_INPUTS);
  if (!outputs) codes.push(CODES.LOST_OUTPUTS);
  return { method, inputs, outputs, codes };
}

export function evaluatePaywallWrapper(fixture) {
  const codes = [];
  const record = asRecord(fixture);
  if (!record) {
    return {
      schemaVersion: SCHEMA_REPORT,
      ok: false,
      decision: "refuse",
      codes: [CODES.MALFORMED_FIXTURE],
      paywallCount: 0,
      settlementOwnerCount: 0,
      boundary: boundary(record),
    };
  }
  if (record.schemaVersion !== SCHEMA_FIXTURE) codes.push(CODES.MALFORMED_FIXTURE);
  if (record.liveListing !== false) codes.push(CODES.LIVE_LISTING);

  const listing = asRecord(record.listing) || {};
  const seller = asRecord(record.seller) || {};
  const charges = collectCharges(record);
  const owners = new Set(charges.map((charge) => lowerAddr(charge.payTo)).filter(Boolean));
  const paywallCount = charges.length;
  const settlementOwnerCount = owners.size;

  if (paywallCount >= 2 || settlementOwnerCount >= 2) {
    codes.push(CODES.TWO_PAYWALL);
  }
  if (paywallCount === 0) codes.push(CODES.MALFORMED_FIXTURE);

  const sellerPayTo = lowerAddr(seller.payTo || SDS.payTo);
  const visible = listingVisibleSettlement(listing);
  const listingIsSellerSurface = originOf(listing.resourceUrl) === (seller.origin || SDS.origin)
    && pathnameOf(listing.resourceUrl) === (seller.path || SDS.extractPath);
  const advertisedMismatch = Boolean(sellerPayTo && visible.size && !visible.has(sellerPayTo));
  const omittedOnForeignSurface = Boolean(sellerPayTo && visible.size === 0 && !listingIsSellerSurface);
  const chargeMismatch = Boolean(
    sellerPayTo
    && (
      charges.length === 0
      || charges.some((charge) => !lowerAddr(charge.payTo) || lowerAddr(charge.payTo) !== sellerPayTo)
    ),
  );
  if (advertisedMismatch || omittedOnForeignSurface || chargeMismatch) {
    codes.push(CODES.SETTLEMENT_OWNER_HIDDEN);
  }

  const rewrite = evaluateMethodRewrite(record);
  codes.push(...rewrite.codes);

  const preserved = preservedContract(record);
  codes.push(...preserved.codes);

  let listingIdentity = null;
  try {
    listingIdentity = evaluateListingIdentity(listingIdentityObservationFor(record));
  } catch (error) {
    listingIdentity = { available: false, reason: String(error?.message || "listing_identity_unavailable") };
    codes.push(CODES.MALFORMED_FIXTURE);
  }
  if (!listingIdentity?.decision || listingIdentity.decision !== "canonical") {
    codes.push(CODES.ROUTE_ABSENT);
  }

  const uniqueCodes = [...new Set(codes)];
  const failClosed = uniqueCodes.filter((code) => FAIL_CLOSED_CODES.includes(code));
  const onePaywall = paywallCount === 1
    && settlementOwnerCount === 1
    && failClosed.length === 0
    && record.liveListing === false;
  const ok = onePaywall;
  return {
    schemaVersion: SCHEMA_REPORT,
    ok,
    decision: ok ? CODES.ONE_PAYWALL : "refuse",
    codes: ok ? [CODES.ONE_PAYWALL] : failClosed,
    paywallCount,
    settlementOwnerCount,
    charges,
    preserved,
    listingIdentity: listingIdentity && listingIdentity.decision
      ? {
        decision: listingIdentity.decision,
        nextAction: listingIdentity.nextAction,
        statuses: (listingIdentity.sources || []).map((source) => source.status),
      }
      : listingIdentity,
    rewrite: {
      rewritten: rewrite.rewritten,
      supported: rewrite.supported,
      deliveryClass: rewrite.deliveryClass,
      authorizationOutcome: rewrite.authorizationOutcome,
    },
    claimsRejected: Boolean(record.claims?.ok === true && !ok),
    boundary: boundary(record),
  };
}

function boundary(fixture) {
  return Object.freeze({
    liveListing: fixture?.liveListing !== false,
    unpublished: fixture?.unpublished !== false,
    openservAccountUsed: false,
    agent402SourceCopied: false,
    networkAccessed: false,
    walletAccessed: false,
    paymentSigned: false,
    paymentSent: false,
    statement: "Local fixture evaluation only. OpenServ issue 6 is a fixture contract, not an integration.",
  });
}
