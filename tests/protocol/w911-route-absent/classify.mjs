import { FORBIDDEN_INVENTED, SDS, SOURCE_ORDER } from "./constants.mjs";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function inventedHits(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  const hits = [];
  for (const name of FORBIDDEN_INVENTED) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`);
    if (re.test(text)) hits.push(name);
  }
  return hits;
}

function headerEntries(observation) {
  const names = [];
  const values = new Map();
  const headers = observation?.headers;
  if (isRecord(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      const name = String(key).toLowerCase();
      names.push(name);
      values.set(name, value);
    }
  }
  if (Array.isArray(observation?.headerNames)) {
    for (const key of observation.headerNames) names.push(String(key).toLowerCase());
  }
  return { names, values };
}

export function hasPaymentRequiredHeader(observation) {
  if (observation?.hasPaymentRequiredHeader === true) return true;
  const { names, values } = headerEntries(observation);
  if (names.includes("payment-required")) return true;
  const raw = values.get("payment-required");
  return typeof raw === "string" ? raw.length > 0 : Boolean(raw);
}

export function claimsDemandCharge(claims) {
  if (!isRecord(claims)) return false;
  return [
    claims.demand,
    claims.charged,
    claims.matched,
    claims.settlement,
    claims.settled,
    claims.paidDelivery,
    claims.successProven,
    claims.routePresent,
    claims.listed,
    claims.conversion,
    claims.sale,
  ].some((value) => value === true);
}

function sourceMap(observation) {
  return isRecord(observation?.sources) ? observation.sources : {};
}

function compactStatuses(observation, field) {
  if (isRecord(observation?.[field])) return observation[field];
  return null;
}

export function priceStatusesOf(observation) {
  const compact = compactStatuses(observation, "priceStatuses");
  if (compact) return compact;
  const out = {};
  for (const [name, source] of Object.entries(sourceMap(observation))) {
    const status = source?.priceObservation?.status;
    if (typeof status === "string") out[name] = status;
  }
  return out;
}

export function identityStatusesOf(observation) {
  const compact = compactStatuses(observation, "identityStatuses");
  if (compact) return compact;
  const out = {};
  for (const [name, source] of Object.entries(sourceMap(observation))) {
    const status = source?.identityObservation?.status;
    if (typeof status === "string") out[name] = status;
  }
  return out;
}

export function identityDecisionsOf(observation) {
  const compact = compactStatuses(observation, "identityDecisions");
  if (compact) return compact;
  const out = {};
  for (const [name, source] of Object.entries(sourceMap(observation))) {
    const decision = source?.identityObservation?.decision;
    if (typeof decision === "string") out[name] = decision;
  }
  return out;
}

function findingsOf(observation) {
  if (Array.isArray(observation?.findings)) {
    return observation.findings.map((item) => (typeof item === "string" ? item : item?.finding)).filter(Boolean);
  }
  return [];
}

export function classifyCatalogObservation(observation = {}, request = {}) {
  const prices = priceStatusesOf(observation);
  const identities = identityStatusesOf(observation);
  const decisions = identityDecisionsOf(observation);
  const findings = findingsOf(observation);
  const priceValues = Object.values(prices);
  const identityValues = Object.values(identities);
  const allPriceAbsent = priceValues.length > 0 && priceValues.every((status) => status === "route_absent");
  const allIdentityAbsent = identityValues.length > 0 && identityValues.every((status) => status === "route_absent");
  const anyMatched = priceValues.includes("matched") || identityValues.includes("canonical");
  const originFoundRouteAbsent = findings.includes("origin_found_expected_route_absent");
  const targetFound = observation.targetFound === true
    || Object.values(sourceMap(observation)).some((source) => source?.targetFound === true);
  const expectedRouteFound = observation.expectedRouteFound === true
    || Object.values(sourceMap(observation)).some((source) => source?.expectedRouteFound === true);
  const invented = inventedHits({ observation, request });

  let kind = "catalog_incomplete";
  if (originFoundRouteAbsent && targetFound && expectedRouteFound !== true && allPriceAbsent) {
    kind = "origin_found_expected_route_absent";
  } else if (allPriceAbsent && allIdentityAbsent && expectedRouteFound !== true) {
    kind = "catalog_route_absent";
  } else if (anyMatched || expectedRouteFound === true) {
    kind = "catalog_route_present";
  }

  return {
    kind,
    route: observation.route || request.route || SDS.lockfilePath,
    priceStatuses: prices,
    identityStatuses: identities,
    identityDecisions: decisions,
    findings,
    targetFound,
    expectedRouteFound,
    allPriceAbsent,
    allIdentityAbsent,
    sourceCount: Object.keys(prices).length || Object.keys(identities).length,
    coveredSources: SOURCE_ORDER.filter((source) => prices[source] || identities[source]),
    paymentSent: observation.paymentSent === true || request.paymentSent === true,
    paymentSignatureSent: observation.paymentSignatureSent === true || request.paymentSignatureSent === true,
    charged: false,
    demand: false,
    invented,
  };
}

export function classifyMerchantObservation(observation = {}, request = {}) {
  const httpStatus = Number(observation.httpStatus ?? observation.status ?? 0);
  const extractHttpStatus = Number(observation.extractHttpStatus ?? 0);
  const advertised = observation.advertisedOpenApi === true
    || observation.advertisedActions === true
    || observation.advertisedWellKnown === true;
  const challenge = httpStatus === 402 || hasPaymentRequiredHeader(observation) || observation.challenge === true;
  const charged = observation.charged === true;
  const invented = inventedHits({ observation, request });

  let kind = "merchant_other";
  if (httpStatus === 404 && !challenge && !charged && advertised !== true) {
    kind = "merchant_route_absent";
  } else if (challenge || httpStatus === 402) {
    kind = "merchant_402";
  } else if (charged) {
    kind = "merchant_charged";
  } else if (advertised) {
    kind = "merchant_advertised";
  }

  return {
    kind,
    httpStatus,
    extractHttpStatus,
    advertised,
    advertisedOpenApi: observation.advertisedOpenApi === true,
    advertisedActions: observation.advertisedActions === true,
    advertisedWellKnown: observation.advertisedWellKnown === true,
    challenge,
    charged,
    hasPaymentRequiredHeader: hasPaymentRequiredHeader(observation),
    facilitatorVerify: Number(observation.facilitatorVerify || 0),
    facilitatorSettle: Number(observation.facilitatorSettle || 0),
    paymentSignatureSent: observation.paymentSignatureSent === true || request.paymentSignatureSent === true,
    invented,
  };
}

export function kindOf(fixture) {
  return fixture?.kind || fixture?.method || null;
}

export function isMerchantFixture(fixture) {
  const kind = kindOf(fixture);
  return kind === "merchant-flag-off"
    || kind === "merchant-route-absent"
    || kind === "seeded-404-as-402"
    || kind === "seeded-lockfile-absent-as-charged"
    || fixture?.method === "POST /lockfile-pin-delta";
}

export function isOriginFoundFixture(fixture) {
  const kind = kindOf(fixture);
  return kind === "origin-found-expected-route-absent"
    || kind === "seeded-origin-found-as-demand";
}
