import { evaluateListingIdentity } from "agent-payment-policy";

import {
  ABSENT_PROBES,
  FORBIDDEN_INVENTED,
  SDS,
  isRegisteredRoute,
} from "./constants.mjs";

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

function decodePaymentRequiredHeader(observation) {
  const { values } = headerEntries(observation);
  const raw = values.get("payment-required");
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function challengeBody(observation) {
  if (isRecord(observation?.body) && Number.isInteger(observation.body.x402Version)) {
    return observation.body;
  }
  if (isRecord(observation?.json) && Number.isInteger(observation.json.x402Version)) {
    return observation.json;
  }
  return decodePaymentRequiredHeader(observation);
}

function firstAccept(challenge) {
  const accepts = Array.isArray(challenge?.accepts) ? challenge.accepts : [];
  return isRecord(accepts[0]) ? accepts[0] : null;
}

export function claimsTreatAbsenceAsDemand(claims) {
  if (!isRecord(claims)) return false;
  return claims.treatAbsenceAsDemand === true
    || claims.demand === true
    || claims.listed === true
    || claims.http402 === true
    || claims.payable === true
    || claims.charged === true
    || claims.paidDelivery === true
    || claims.successProven === true
    || claims.settlement === true
    || claims.settled === true;
}

export function catalogListsRoute(catalog, route) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  const actions = Array.isArray(catalog?.actions) ? catalog.actions : [];
  const itemHit = items.some((item) => {
    const template = item?.resource?.routeTemplate;
    if (template === route) return true;
    const url = item?.resource?.url;
    if (typeof url !== "string") return false;
    try {
      return new URL(url).pathname === route;
    } catch {
      return false;
    }
  });
  const actionHit = actions.some((action) => action?.route === route);
  return itemHit || actionHit;
}

export function listingRecordsFromCatalog(items, origin = SDS.origin, source = SDS.catalogSource) {
  return (items || []).flatMap((item, index) => {
    const template = item?.resource?.routeTemplate;
    if (typeof template !== "string" || !template.startsWith("/")) return [];
    return [{ source, url: `${origin}${template}`, rank: index + 1 }];
  });
}

export function catalogIdentityForRoute({ origin = SDS.origin, route, items, source = SDS.catalogSource }) {
  const report = evaluateListingIdentity({
    schemaVersion: "agent-payment-policy.listing-identity-observation.v1",
    target: { canonicalOrigin: origin, route },
    sources: [source],
    records: listingRecordsFromCatalog(items, origin, source),
  }, { now: 0 });
  return report.sources[0];
}

function methodOf(observation, request) {
  return String(request?.method || observation?.method || "GET").toUpperCase();
}

function pathOf(observation, request) {
  return request?.path || request?.route || observation?.path || observation?.route || null;
}

export function classifyHttpObservation(observation = {}, request = {}) {
  const method = methodOf(observation, request);
  const path = pathOf(observation, request);
  const httpStatus = observation.httpStatus ?? observation.status ?? null;
  const registered = typeof path === "string" ? isRegisteredRoute(method, path) : false;
  const challenge = challengeBody(observation);
  const accept = firstAccept(challenge);
  const paymentRequiredHeader = hasPaymentRequiredHeader(observation);
  const acceptsCount = Array.isArray(challenge?.accepts) ? challenge.accepts.length : 0;
  const has402Challenge = httpStatus === 402 || paymentRequiredHeader || acceptsCount > 0;
  const invented = inventedHits({ observation, request });
  const paymentSignatureSent = request.paymentSignatureSent === true
    || observation.paymentSignatureSent === true;
  const base = {
    method,
    path,
    httpStatus,
    registered,
    paymentRequiredHeader,
    acceptsCount,
    amount: accept?.amount ?? null,
    payTo: accept?.payTo ?? null,
    network: accept?.network ?? null,
    asset: accept?.asset ?? null,
    invented,
    paymentSignatureSent,
    charged: false,
    paidDelivery: false,
    demand: false,
    listed: false,
  };

  if (!path) {
    return { ...base, kind: "malformed", status: "malformed" };
  }

  if (!registered) {
    if (has402Challenge) {
      return {
        ...base,
        kind: "absent_as_402",
        status: "absent_as_402",
        charged: false,
        demand: false,
      };
    }
    if (httpStatus === 200) {
      return {
        ...base,
        kind: "absent_as_paid_delivery",
        status: "absent_as_paid_delivery",
        paidDelivery: true,
      };
    }
    if (httpStatus === 404 && !paymentRequiredHeader && acceptsCount === 0) {
      return {
        ...base,
        kind: "route_absent",
        status: "route_absent",
        charged: false,
        paidDelivery: false,
        demand: false,
        listed: false,
      };
    }
    return { ...base, kind: "malformed", status: "malformed" };
  }

  if (httpStatus === 402 && (paymentRequiredHeader || acceptsCount > 0)) {
    return {
      ...base,
      kind: "present_unpaid_402",
      status: "present_unpaid_402",
      charged: false,
      paidDelivery: false,
    };
  }
  return { ...base, kind: "present_unexpected", status: "present_unexpected" };
}

export function classifyCatalogObservation(observation = {}, request = {}) {
  const route = request.path || request.route || observation.route;
  const items = observation.items || observation.catalog?.items || [];
  const actions = observation.actions || observation.catalog?.actions || [];
  const listed = catalogListsRoute({ items, actions }, route);
  const identity = typeof route === "string"
    ? catalogIdentityForRoute({ route, items, origin: SDS.origin })
    : null;
  const absentProbe = ABSENT_PROBES.some((probe) => probe.path === route);
  return {
    kind: "catalog",
    route,
    listed,
    identityStatus: identity?.status ?? null,
    exactRouteRecordCount: identity?.exactRouteRecordCount ?? null,
    ownershipProven: identity?.ownershipProven ?? false,
    absentProbe,
    charged: false,
    demand: listed && absentProbe,
  };
}
