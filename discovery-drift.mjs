#!/usr/bin/env node

import { openSync, readSync, closeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SCHEMAS,
  evaluateListingIdentity,
  evaluateOfferCoherence,
} from "agent-payment-policy";
import {
  PaymentOfferPreflightError,
  normalizePaymentTarget,
  paymentOfferPreflight,
} from "./payment-offer-preflight.mjs";

export const DISCOVERY_DRIFT_PRODUCT = "samedaydesk-discovery-drift";
export const DISCOVERY_DRIFT_VERSION = "1.0.0";
export const DISCOVERY_DRIFT_SCHEMA = "samedaydesk.discovery-drift-report.v1";
export const DISCOVERY_DRIFT_SNAPSHOT_SCHEMA = "samedaydesk.discovery-drift-snapshot.v1";
export const DISCOVERY_DRIFT_CHANGE_SCHEMA = "samedaydesk.discovery-drift-change.v1";
export const BAZAAR_MERCHANT_DISCOVERY = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant";
export const DISCOVERY_DRIFT_STATUSES = Object.freeze([
  "match",
  "mismatch",
  "unknown",
  "stale",
  "reordered-multiple-offer",
  "network-mismatch",
  "asset-mismatch",
]);

export const T1_S94 = Object.freeze({
  issue: "https://github.com/coinbase/cdp-sdk/issues/813",
  resource: "https://agent-economy-signal-x402-mainnet.bronzetti-andrea.workers.dev/premium/agent-brief",
  payTo: "0xbda48b29607b9dc66ef7e38b68ad53f2b17efb23",
  recordedAt: "2026-09-10T07:21:38.000Z",
  lastUpdated: "2026-09-09T18:21:18.178Z",
  amountAtomic: "20000",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  issueCreatedAt: "2026-09-09T18:32:35Z",
});

export const DISCOVERY_DRIFT_OPERATOR_COMMAND = `node discovery-drift.mjs observe --url '${T1_S94.resource}' --bazaar-pay-to '${T1_S94.payTo}'`;

const HERE = dirname(fileURLToPath(import.meta.url));
const ATOMIC = /^(?:0|[1-9][0-9]{0,77})$/;
const PAY_TO = /^0x[0-9a-f]{40}$/i;
const SOURCE = /^[A-Za-z0-9][A-Za-z0-9._:/+ -]{0,127}$/;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_CATALOG_BYTES = 250_000;
const BOUNDARY_CLAIM = "Compares registry/catalog discovery observations with live unpaid payment requirements. Observed match is not a resolved cause. lastUpdated lag is unknown unless an explicit freshness horizon is supplied. This diagnostic does not reindex catalogs, convert units across assets or decimals, follow redirects, or send payment.";

export class DiscoveryDriftError extends Error {
  constructor(message, { code = "discovery_drift_failed" } = {}) {
    super(message);
    this.name = "DiscoveryDriftError";
    this.code = code;
  }
}

function fail(message, code = "invalid_observation") {
  throw new DiscoveryDriftError(message, { code });
}

function cleanString(value, maximum = 500) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return clean ? clean.slice(0, maximum) : null;
}

function comparable(value) {
  // Only hexadecimal addresses are case-insensitive; other asset IDs are not.
  const text = String(value);
  return /^0x[0-9a-f]+$/i.test(text) ? text.toLowerCase() : text;
}

function isoTime(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail(`${label} must be an ISO-8601 timestamp`);
  return new Date(ms).toISOString();
}

function atomicAmount(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const amount = String(value);
  return ATOMIC.test(amount) ? amount : null;
}

function normalizeResource(value) {
  const raw = typeof value === "string" && value.length <= 2_048
    && !/[\u0000-\u0020\u007f]/.test(value) ? value : null;
  if (!raw) return null;
  try {
    return normalizePaymentTarget(raw).toString();
  } catch (error) {
    if (error instanceof PaymentOfferPreflightError && error.code === "credential_rejected") {
      fail("resource URL must not contain credentials", "credential_rejected");
    }
    if (error instanceof PaymentOfferPreflightError && error.code === "ssrf_rejected") {
      fail("resource URL host is not public", "ssrf_rejected");
    }
    return null;
  }
}

function freezeOffer(offer) {
  return Object.freeze({
    protocol: offer.protocol,
    network: offer.network,
    asset: offer.asset,
    amountAtomic: offer.amountAtomic,
    recipient: offer.recipient,
  });
}

function normalizeOffer(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("offer must be an object");
  const protocolRaw = cleanString(value.protocol, 40);
  const protocol = protocolRaw ? protocolRaw.toLowerCase() : null;
  if (protocol && !["x402", "mpp"].includes(protocol)) fail("offer protocol must be x402 or mpp");
  return freezeOffer({
    protocol,
    network: cleanString(value.network, 200),
    asset: cleanString(value.asset, 200),
    amountAtomic: atomicAmount(value.amountAtomic ?? value.amount),
    recipient: cleanString(value.recipient ?? value.payTo, 200),
  });
}

function offerIdentity(offer) {
  return [
    offer.protocol || "",
    offer.network ? comparable(offer.network) : "",
    offer.asset ? comparable(offer.asset) : "",
    offer.amountAtomic || "",
    offer.recipient ? comparable(offer.recipient) : "",
  ].join("|");
}

function snapshotBoundary() {
  return Object.freeze({
    credentialsUsed: false,
    paymentSigned: false,
    paymentSent: false,
    redirectsFollowed: false,
    unitsConverted: false,
  });
}

export function normalizeDiscoveryObservation(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("observation must be an object");
  const source = cleanString(input.source, 128);
  if (!source || !SOURCE.test(source)) fail("observation source must be 1-128 safe printable characters");
  const observedAt = isoTime(input.observedAt, "observedAt");
  const resource = normalizeResource(input.resource);
  const lastUpdated = isoTime(input.lastUpdated, "lastUpdated");
  const offers = (Array.isArray(input.offers) ? input.offers : []).slice(0, 20).map(normalizeOffer);
  const unknowns = [...new Set((Array.isArray(input.unknowns) ? input.unknowns : [])
    .map((item) => cleanString(item, 200))
    .filter(Boolean))];
  if (!resource) unknowns.push("resource");
  if (!observedAt) unknowns.push("observedAt");
  if (Array.isArray(input.offers) && input.offers.length > 20) unknowns.push("offers_truncated");
  if (!lastUpdated) unknowns.push("lastUpdated");
  if (!offers.length) unknowns.push("offers");
  for (const [index, offer] of offers.entries()) {
    if (!offer.network) unknowns.push(`offers[${index}].network`);
    if (!offer.asset) unknowns.push(`offers[${index}].asset`);
    if (!offer.amountAtomic) unknowns.push(`offers[${index}].amountAtomic`);
  }
  return Object.freeze({
    schemaVersion: DISCOVERY_DRIFT_SNAPSHOT_SCHEMA,
    observedAt,
    source,
    resource,
    lastUpdated,
    offers: Object.freeze(offers),
    unknowns: Object.freeze([...new Set(unknowns)]),
    raw: input.raw && typeof input.raw === "object" ? Object.freeze({ ...input.raw }) : null,
    boundary: snapshotBoundary(),
  });
}

function bazaarAccepts(item) {
  return Array.isArray(item?.accepts) ? item.accepts : [];
}

export function observationFromBazaarMerchant(body, {
  resource,
  observedAt,
  source = "coinbase-bazaar-merchant-discovery",
} = {}) {
  const requested = normalizeResource(resource);
  if (!requested) fail("exact resource is required for Bazaar selection");
  const resources = Array.isArray(body?.resources) ? body.resources : [];
  const matches = resources.filter((item) => {
    try { return normalizeResource(item?.resource) === requested; } catch { return false; }
  });
  const match = matches.length === 1 ? matches[0] : null;
  const offers = bazaarAccepts(match).map((accept) => normalizeOffer({
    protocol: "x402",
    network: accept?.network,
    asset: accept?.asset,
    amountAtomic: accept?.amount,
    recipient: accept?.payTo ?? body?.payTo,
  }));
  const unknowns = [];
  if (!match) unknowns.push("exact_resource_not_in_catalog");
  if (matches.length > 1) unknowns.push("duplicate_resource");
  const pagination = body?.pagination;
  const complete = pagination && Number.isSafeInteger(pagination.total)
    && pagination.total >= 0 && pagination.offset === 0
    && pagination.total === resources.length;
  if (pagination && !complete) unknowns.push("catalog_page_incomplete");
  return normalizeDiscoveryObservation({
    observedAt,
    source,
    resource: match?.resource || resource,
    lastUpdated: match?.lastUpdated,
    offers,
    unknowns,
    raw: {
      provider: "coinbase-bazaar",
      payTo: cleanString(body?.payTo, 200),
      itemCount: resources.length,
      pagination: pagination ? { total: pagination.total ?? null, offset: pagination.offset ?? null, limit: pagination.limit ?? null } : null,
      coverage: complete ? "complete_returned_page" : "single_page_only",
      exactResourceMatch: Boolean(match),
      lastUpdated: match?.lastUpdated || null,
      accepts: bazaarAccepts(match).map((accept) => ({
        amount: atomicAmount(accept?.amount),
        asset: cleanString(accept?.asset, 200),
        network: cleanString(accept?.network, 200),
        payTo: cleanString(accept?.payTo, 200),
        scheme: cleanString(accept?.scheme, 40),
      })),
    },
  });
}

export function observationFromPreflight(preflight, { source = "live-unpaid-402" } = {}) {
  const offers = (Array.isArray(preflight?.offers) ? preflight.offers : [])
    .filter((offer) => offer?.valid === true)
    .map((offer) => normalizeOffer(offer));
  return normalizeDiscoveryObservation({
    observedAt: preflight?.checkedAt,
    source,
    resource: preflight?.target?.url,
    lastUpdated: null,
    offers,
    unknowns: [
      ...(preflight?.target?.httpStatus === 402 ? [] : ["live_http_status_not_402"]),
      ...((preflight?.offers || []).some(offer => offer?.valid !== true) ? ["invalid_live_offers"] : []),
      ...(["credentialsUsed", "paymentSent", "redirectsFollowed"].some(key => preflight?.boundary?.[key] === true) ? ["unsafe_live_boundary"] : []),
    ],
    raw: {
      httpStatus: preflight?.target?.httpStatus ?? null,
      decision: preflight?.decision ?? null,
      offerCount: preflight?.offerCount ?? offers.length,
      protocols: Array.isArray(preflight?.protocols) ? [...preflight.protocols] : [],
      credentialsUsed: preflight?.boundary?.credentialsUsed === true,
      paymentSent: preflight?.boundary?.paymentSent === true,
      redirectsFollowed: preflight?.boundary?.redirectsFollowed === true,
    },
  });
}

export function observationFromSellerIntegrity(report, {
  observedAt,
  source = "seller-integrity-audit",
} = {}) {
  const origin = cleanString(report?.request?.origin, 253);
  const route = cleanString(report?.request?.route, 200);
  const resource = origin && route ? `${origin}${route}` : null;
  const economics = report?.report?.economics || report?.economics || {};
  const offers = ["x402", "mpp"].flatMap((protocol) => {
    const item = economics[protocol];
    if (!item || typeof item !== "object") return [];
    return [normalizeOffer({
      protocol,
      network: item.network,
      asset: item.asset,
      amountAtomic: item.amountAtomic,
      recipient: item.recipient,
    })];
  });
  return normalizeDiscoveryObservation({
    observedAt: observedAt || report?.checkedAt,
    source,
    resource,
    lastUpdated: null,
    offers,
    unknowns: report?.report?.discovery?.bazaar ? [] : ["bazaar_discovery_unmeasured"],
    raw: {
      decision: report?.decision ?? null,
      bazaarPresent: report?.report?.discovery?.bazaar?.present ?? null,
      bazaarValid: report?.report?.discovery?.bazaar?.valid ?? null,
    },
  });
}

function dimension(name, catalogValue, liveValue, { exact = false } = {}) {
  const catalog = catalogValue ?? null;
  const live = liveValue ?? null;
  let disposition = "unknown";
  if (catalog !== null && live !== null) {
    const matched = exact ? String(catalog) === String(live) : comparable(catalog) === comparable(live);
    disposition = matched ? "matched" : "drifted";
  }
  return Object.freeze({ dimension: name, disposition, catalog, live });
}

function alignOffers(catalogOffers, liveOffers) {
  const catalogKeys = catalogOffers.map(offerIdentity);
  const liveKeys = liveOffers.map(offerIdentity);
  if (catalogOffers.length === 1 && liveOffers.length === 1) {
    return {
      status: "aligned",
      pairs: [{ catalog: catalogOffers[0], live: liveOffers[0] }],
      catalogCount: 1,
      liveCount: 1,
    };
  }
  if (!catalogOffers.length || !liveOffers.length) {
    return { status: "unknown", pairs: [], catalogCount: catalogOffers.length, liveCount: liveOffers.length };
  }
  const catalogSet = [...catalogKeys].sort();
  const liveSet = [...liveKeys].sort();
  const unique = new Set(catalogKeys).size === catalogKeys.length && new Set(liveKeys).size === liveKeys.length;
  const sameMultiset = catalogSet.length === liveSet.length && catalogSet.every((key, index) => key === liveSet[index]);
  if (unique && sameMultiset && catalogOffers.length > 1) {
    const liveByKey = new Map(liveOffers.map((offer, index) => [liveKeys[index], offer]));
    const pairs = catalogOffers.map((offer, index) => ({ catalog: offer, live: liveByKey.get(catalogKeys[index]) }));
    const reordered = catalogKeys.some((key, index) => key !== liveKeys[index]);
    return {
      status: reordered ? "reordered" : "aligned",
      pairs,
      catalogCount: catalogOffers.length,
      liveCount: liveOffers.length,
    };
  }
  // Join unique protocol/network/asset identities before comparing amounts.
  // Never pair arbitrary same-protocol rows or discard unmatched extra offers.
  const key = offer => [offer.protocol, comparable(offer.network || ""), comparable(offer.asset || "")].join("|");
  let catalogIds = catalogOffers.map(key), liveIds = liveOffers.map(key);
  if (!catalogIds.some(id => liveIds.includes(id))
      && catalogOffers.every(offer => offer.protocol) && liveOffers.every(offer => offer.protocol)
      && new Set(catalogOffers.map(offer => offer.protocol)).size === catalogOffers.length
      && new Set(liveOffers.map(offer => offer.protocol)).size === liveOffers.length) {
    catalogIds = catalogOffers.map(offer => offer.protocol);
    liveIds = liveOffers.map(offer => offer.protocol);
  }
  if (new Set(catalogIds).size === catalogIds.length
      && new Set(liveIds).size === liveIds.length
      && catalogIds.some(id => liveIds.includes(id))) {
    return { status: catalogOffers.length !== liveOffers.length ? "mismatch"
      : catalogIds.every(id => liveIds.includes(id)) ? "aligned" : "unknown",
      pairs: catalogOffers.map((offer, i) => ({
      catalog: offer, live: liveOffers[liveIds.indexOf(catalogIds[i])],
    })).filter(pair => pair.live), catalogCount: catalogOffers.length, liveCount: liveOffers.length };
  }
  return { status: catalogOffers.length !== liveOffers.length ? "mismatch" : "unknown",
    pairs: [], catalogCount: catalogOffers.length, liveCount: liveOffers.length };

}

function freshnessDimension({ catalogLastUpdated, catalogObservedAt, liveObservedAt, now, staleMs }) {
  const catalog = catalogLastUpdated || null;
  const live = liveObservedAt || null;
  const catalogMs = catalog ? Date.parse(catalog) : NaN;
  const ageMs = Number.isFinite(catalogMs) ? now - catalogMs : null;
  const horizonMs = Number.isInteger(staleMs) && staleMs >= 0 ? staleMs : null;
  if (ageMs === null || ageMs < 0 || !live || Date.parse(live) > now
      || !catalogObservedAt || Date.parse(catalogObservedAt) > now) {
    return Object.freeze({
      dimension: "freshness",
      disposition: "unknown",
      catalog,
      live,
      ageMs: null,
      horizonMs,
      note: "A timestamp is absent or future-dated; freshness is unknown, not a resolved cause.",
    });
  }
  if (horizonMs === null) {
    return Object.freeze({
      dimension: "freshness",
      disposition: "unknown",
      catalog,
      live,
      ageMs,
      horizonMs: null,
      note: "lastUpdated is observed. Lag is unknown as a cause without an explicit --stale-ms horizon. This is not proof of reindex, stale price, or resolved delay.",
    });
  }
  if (ageMs > horizonMs || now - Date.parse(live) > horizonMs || now - Date.parse(catalogObservedAt) > horizonMs) {
    return Object.freeze({
      dimension: "freshness",
      disposition: "stale",
      catalog,
      live,
      ageMs,
      horizonMs,
      note: "Catalog lastUpdated is older than the caller-supplied horizon. This is an observation-freshness status, not a proved price-stale cause or reindex result.",
    });
  }
  return Object.freeze({
    dimension: "freshness",
    disposition: "current",
    catalog,
    live,
    ageMs,
    horizonMs,
    note: "Catalog lastUpdated is within the caller-supplied horizon. Currency of the index is still not a resolved cause.",
  });
}

function decideStatus(dimensions, offerAlignment) {
  const by = Object.fromEntries(dimensions.map((item) => [item.dimension, item]));
  if (by.network?.disposition === "drifted") return "network-mismatch";
  if (by.asset?.disposition === "drifted") return "asset-mismatch";
  if (["resource", "protocol", "recipient", "amountAtomic"].some(key => by[key]?.disposition === "drifted") || offerAlignment.status === "mismatch") return "mismatch";
  if (["resource", "protocol", "network", "asset", "amountAtomic"].some(key => by[key]?.disposition === "unknown")) return "unknown";
  if (offerAlignment.status === "unknown") return "unknown";
  if (by.freshness?.disposition === "stale") return "stale";
  if (offerAlignment.status === "reordered") return "reordered-multiple-offer";
  if (by.resource?.disposition === "matched" && by.amountAtomic?.disposition === "matched") return "match";
  return "unknown";
}

function primaryPair(alignment) {
  return alignment.pairs[0] || { catalog: normalizeOffer({}), live: normalizeOffer({}) };
}

function coherenceFor(catalog, live, pair, now) {
  if (!catalog.resource || !live.resource || !pair.live.amountAtomic || !pair.live.network || !pair.live.asset || !pair.live.recipient) {
    return Object.freeze({ available: false, reason: "runtime_offer_incomplete_for_coherence" });
  }
  try {
    const report = evaluateOfferCoherence({
      schemaVersion: SCHEMAS.offerCoherenceObservation,
      catalog: {
        source: catalog.source,
        protocol: pair.catalog.protocol || undefined,
        method: "GET",
        url: catalog.resource,
        ...(pair.catalog.amountAtomic ? { amountAtomic: pair.catalog.amountAtomic } : {}),
        ...(pair.catalog.network ? { network: pair.catalog.network } : {}),
        ...(pair.catalog.asset ? { asset: pair.catalog.asset } : {}),
        ...(pair.catalog.recipient ? { recipient: pair.catalog.recipient } : {}),
      },
      runtime: {
        protocol: pair.live.protocol || "x402",
        method: "GET",
        url: live.resource,
        amountAtomic: pair.live.amountAtomic,
        network: pair.live.network,
        asset: pair.live.asset,
        recipient: pair.live.recipient,
        expiresAt: new Date(now + 300_000).toISOString(),
      },
    }, { now });
    return Object.freeze({
      available: true,
      decision: report.decision,
      matched: report.matched,
      unknown: report.unknown,
      drifted: report.drifted,
      nextAction: report.nextAction,
      note: "Offer coherence is reused evidence. drifted/partial/coherent are observations, not resolved causes. Runtime expiry here is diagnostic padding and is not a live challenge deadline.",
    });
  } catch (error) {
    return Object.freeze({ available: false, reason: cleanString(error?.message || "coherence_unavailable", 200) });
  }
}

function listingIdentityFor(catalog, live, pair, now) {
  if (!live.resource && !catalog.resource) {
    return Object.freeze({ available: false, reason: "resource_unavailable" });
  }
  const resource = live.resource || catalog.resource;
  let parsed;
  try {
    parsed = new URL(resource);
  } catch {
    return Object.freeze({ available: false, reason: "resource_unparseable" });
  }
  const settlement = pair.catalog.recipient || pair.live.recipient || catalog.raw?.payTo || null;
  try {
    const report = evaluateListingIdentity({
      schemaVersion: SCHEMAS.listingIdentityObservation,
      target: {
        canonicalOrigin: parsed.origin,
        route: parsed.pathname,
        ...(settlement ? { settlementIdentity: settlement } : {}),
      },
      sources: [catalog.source],
      records: catalog.resource ? [{
        source: catalog.source,
        url: catalog.resource,
        ...(settlement ? { settlementIdentity: settlement } : {}),
        rank: 1,
      }] : [],
    }, { now });
    return Object.freeze({
      available: true,
      decision: report.decision,
      nextAction: report.nextAction,
      note: "Listing identity is reused catalog evidence. It does not prove hostname ownership, reindex, or live payment terms.",
    });
  } catch (error) {
    return Object.freeze({ available: false, reason: cleanString(error?.message || "listing_identity_unavailable", 200) });
  }
}

export function compareDiscoveryLive(catalogInput, liveInput, {
  now = Date.now(),
  staleMs = null,
} = {}) {
  if (!Number.isFinite(now)) fail("now must be a finite epoch millisecond value");
  if (staleMs !== null && staleMs !== undefined && (!Number.isInteger(staleMs) || staleMs < 0)) {
    fail("staleMs must be a non-negative integer when supplied", "invalid_horizon");
  }
  const catalog = normalizeDiscoveryObservation(catalogInput);
  const live = normalizeDiscoveryObservation(liveInput);
  const alignment = alignOffers(catalog.offers, live.offers);
  const pair = primaryPair(alignment);
  const dimensions = Object.freeze([
    dimension("resource", catalog.resource, live.resource, { exact: true }),
    ...["protocol", "network", "asset", "recipient", "amountAtomic"].map(name => {
      const compared = alignment.pairs.map(item => dimension(name, item.catalog[name], item.live[name], { exact: name === "amountAtomic" }));
      const disposition = compared.some(item => item.disposition === "drifted") ? "drifted"
        : !compared.length || compared.some(item => item.disposition === "unknown") ? "unknown" : "matched";
      return Object.freeze({ dimension: name, disposition,
        catalog: compared.length === 1 ? compared[0].catalog : compared.map(item => item.catalog),
        live: compared.length === 1 ? compared[0].live : compared.map(item => item.live) });
    }),
    freshnessDimension({
      catalogLastUpdated: catalog.lastUpdated,
      catalogObservedAt: catalog.observedAt,
      liveObservedAt: live.observedAt,
      now,
      staleMs,
    }),
  ]);
  const incomplete = [...catalog.unknowns, ...live.unknowns].some(value =>
    ["offers_truncated", "live_http_status_not_402", "invalid_live_offers", "unsafe_live_boundary", "catalog_page_incomplete", "duplicate_resource"].includes(value));
  const status = incomplete ? "unknown" : decideStatus(dimensions, alignment);
  const unknowns = [...new Set([
    ...catalog.unknowns,
    ...live.unknowns,
    ...dimensions.filter((item) => item.disposition === "unknown").map((item) => item.dimension),
    ...(alignment.status === "unknown" ? ["offer-alignment"] : []),
  ])];
  const observedMatch = ["match", "stale", "reordered-multiple-offer"].includes(status);
  return Object.freeze({
    schemaVersion: DISCOVERY_DRIFT_SCHEMA,
    product: DISCOVERY_DRIFT_PRODUCT,
    version: DISCOVERY_DRIFT_VERSION,
    checkedAt: new Date(now).toISOString(),
    status,
    observedMatch,
    resolvedCause: false,
    dimensions,
    offerAlignment: Object.freeze({
      status: alignment.status,
      catalogCount: alignment.catalogCount,
      liveCount: alignment.liveCount,
    }),
    catalog,
    live,
    coherence: alignment.pairs.length === 1 ? coherenceFor(catalog, live, pair, now) : { available: false, reason: "multiple_or_unaligned_offers" },
    listingIdentity: listingIdentityFor(catalog, live, pair, now),
    unknowns: Object.freeze(unknowns),
    notClaimed: Object.freeze([
      "did not reindex any catalog",
      "did not resolve lastUpdated lag as a cause",
      "did not equate units across assets or decimals",
      "did not follow redirects",
      "did not send payment",
    ]),
    boundary: Object.freeze({
      credentialsUsed: false,
      paymentSigned: false,
      paymentSent: false,
      redirectsFollowed: false,
      unitsConverted: false,
      reindexPerformed: false,
      claim: BOUNDARY_CLAIM,
    }),
  });
}

function reportAmount(report, side) {
  return report?.[side]?.offers?.[0]?.amountAtomic ?? null;
}

export function compareDiscoveryDriftChange(beforeInput, afterInput, { clock = null } = {}) {
  const before = beforeInput && typeof beforeInput === "object" ? beforeInput : fail("before report must be an object");
  const after = afterInput && typeof afterInput === "object" ? afterInput : fail("after report must be an object");
  const comparableReports = before.schemaVersion === DISCOVERY_DRIFT_SCHEMA && after.schemaVersion === DISCOVERY_DRIFT_SCHEMA;
  const fields = [
    ["status", before.status, after.status],
    ["catalog.source", before.catalog?.source, after.catalog?.source],
    ["live.source", before.live?.source, after.live?.source],
    ...["catalog", "live"].map(side => [`${side}.offers`,
      JSON.stringify((before[side]?.offers || []).map(normalizeOffer).map(offerIdentity).sort()),
      JSON.stringify((after[side]?.offers || []).map(normalizeOffer).map(offerIdentity).sort())]),
    ["catalog.resource", before.catalog?.resource, after.catalog?.resource],
    ["live.resource", before.live?.resource, after.live?.resource],
    ["catalog.amountAtomic", reportAmount(before, "catalog"), reportAmount(after, "catalog")],
    ["live.amountAtomic", reportAmount(before, "live"), reportAmount(after, "live")],
    ["catalog.network", before.catalog?.offers?.[0]?.network, after.catalog?.offers?.[0]?.network],
    ["live.network", before.live?.offers?.[0]?.network, after.live?.offers?.[0]?.network],
    ["catalog.asset", before.catalog?.offers?.[0]?.asset, after.catalog?.offers?.[0]?.asset],
    ["live.asset", before.live?.offers?.[0]?.asset, after.live?.offers?.[0]?.asset],
    ["catalog.lastUpdated", before.catalog?.lastUpdated, after.catalog?.lastUpdated],
  ];
  const changes = fields
    .filter(([, left, right]) => String(left ?? "") !== String(right ?? ""))
    .map(([field, left, right]) => Object.freeze({ field, before: left ?? null, after: right ?? null }));
  const unknown = !comparableReports
    || !DISCOVERY_DRIFT_STATUSES.includes(before.status) || !DISCOVERY_DRIFT_STATUSES.includes(after.status)
    || ["catalog", "live"].some(side => !before[side]?.source || !after[side]?.source
      || !before[side]?.resource || before[side].source !== after[side].source
      || before[side].resource !== after[side].resource
      || !Array.isArray(before[side].offers) || !Array.isArray(after[side].offers))
    || !Number.isFinite(Date.parse(before.checkedAt)) || !Number.isFinite(Date.parse(after.checkedAt))
    || Date.parse(after.checkedAt) < Date.parse(before.checkedAt)
    || before.status == null
    || after.status == null
    || before.resolvedCause === true
    || after.resolvedCause === true;
  const verdict = unknown ? "unknown" : changes.length ? "changed" : "unchanged";
  return Object.freeze({
    schemaVersion: DISCOVERY_DRIFT_CHANGE_SCHEMA,
    product: DISCOVERY_DRIFT_PRODUCT,
    version: DISCOVERY_DRIFT_VERSION,
    comparedAt: clock || new Date().toISOString(),
    verdict,
    observedMatch: before.observedMatch === true && after.observedMatch === true && verdict === "unchanged",
    resolvedCause: false,
    changes: Object.freeze(changes),
    before: Object.freeze({
      status: before.status ?? null,
      checkedAt: before.checkedAt ?? null,
      catalogAmountAtomic: reportAmount(before, "catalog"),
      liveAmountAtomic: reportAmount(before, "live"),
      lastUpdated: before.catalog?.lastUpdated ?? null,
    }),
    after: Object.freeze({
      status: after.status ?? null,
      checkedAt: after.checkedAt ?? null,
      catalogAmountAtomic: reportAmount(after, "catalog"),
      liveAmountAtomic: reportAmount(after, "live"),
      lastUpdated: after.catalog?.lastUpdated ?? null,
    }),
    note: "Repeat-change compares two already captured discovery-drift reports. It does not fetch, pay, reindex, or schedule a daemon.",
    boundary: Object.freeze({
      credentialsUsed: false,
      paymentSent: false,
      redirectsFollowed: false,
      reindexPerformed: false,
      claim: BOUNDARY_CLAIM,
    }),
  });
}

function bazaarMerchantUrl(payTo) {
  const value = String(payTo || "").toLowerCase();
  if (!PAY_TO.test(value)) fail("bazaar payTo must be a 0x-prefixed EVM address", "invalid_pay_to");
  const url = new URL(BAZAAR_MERCHANT_DISCOVERY);
  url.searchParams.set("payTo", value);
  return url;
}

export async function fetchBazaarMerchant(payTo, {
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const url = bazaarMerchantUrl(payTo);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail("timeout must be positive", "invalid_args");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader;
  try {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    signal: controller.signal,
    headers: {
      accept: "application/json",
      "user-agent": "SameDayDesk-Discovery-Drift/1.0 (+https://samedaydesk.com)",
    },
  });
  if (response?.status !== 200) fail(`catalog returned HTTP ${response?.status}`, "catalog_fetch_failed");
  if (response.redirected || response.url && response.url !== url.href) fail("catalog redirect refused", "redirect_rejected");
  if (!response.body?.getReader) fail("catalog response has no readable body", "catalog_fetch_failed");
  reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_CATALOG_BYTES) fail("catalog response exceeded the size cap", "catalog_too_large");
    chunks.push(Buffer.from(value));
  }
  const text = Buffer.concat(chunks, size).toString("utf8");
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    fail("catalog response was not valid JSON", "catalog_json_invalid");
  }
  if (!body || !Array.isArray(body.resources) || comparable(body.payTo) !== comparable(payTo)) {
    fail("catalog merchant identity or resource shape mismatch", "catalog_identity_mismatch");
  }
  return body;
  } catch (error) {
    if (controller.signal.aborted) fail("catalog deadline exceeded", "catalog_timeout");
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) await reader.cancel().catch(() => {});
  }
}

export async function observeDiscoveryDrift({
  url,
  catalog,
  bazaarPayTo,
  bazaarBody,
  preflight,
  now = Date.now(),
  staleMs = null,
  fetchImpl = fetch,
  paymentPreflightImpl = paymentOfferPreflight,
} = {}) {
  const target = normalizePaymentTarget(url).toString();
  if (!catalog && !bazaarBody && !bazaarPayTo) fail("catalog input is required", "catalog_required");
  if (bazaarPayTo) bazaarMerchantUrl(bazaarPayTo);
  const liveReport = preflight || await paymentPreflightImpl({ url: target }, { now });
  if (normalizeResource(liveReport?.target?.url) !== target) fail("live source identity mismatch", "source_identity_mismatch");
  if (liveReport?.boundary?.credentialsUsed) fail("live probe used credentials", "credential_rejected");
  if (liveReport?.boundary?.redirectsFollowed) fail("live probe followed a redirect", "redirect_rejected");
  if (liveReport?.boundary?.paymentSent) fail("live probe sent payment", "payment_rejected");
  const live = observationFromPreflight(liveReport);
  let catalogObservation;
  if (catalog) {
    catalogObservation = normalizeDiscoveryObservation(catalog);
  } else if (bazaarBody) {
    catalogObservation = observationFromBazaarMerchant(bazaarBody, { resource: target, observedAt: new Date(now).toISOString() });
  } else if (bazaarPayTo) {
    const body = await fetchBazaarMerchant(bazaarPayTo, { fetchImpl });
    catalogObservation = observationFromBazaarMerchant(body, { resource: target, observedAt: new Date(now).toISOString() });
  } else {
    fail("catalog snapshot, bazaar body, or bazaar payTo is required", "catalog_required");
  }
  return compareDiscoveryLive(catalogObservation, live, { now, staleMs });
}

function loadJson(path) {
  const fd = openSync(resolve(path), "r");
  try {
    const bytes = Buffer.alloc(MAX_CATALOG_BYTES + 1);
    let size = 0, count;
    while (size < bytes.length && (count = readSync(fd, bytes, size, bytes.length - size, null)) > 0) size += count;
    if (size > MAX_CATALOG_BYTES) fail("saved JSON exceeds size cap", "capture_too_large");
    return JSON.parse(bytes.subarray(0, size).toString("utf8"));
  } finally { closeSync(fd); }
}

export function t1S94FixturePaths() {
  const root = resolve(HERE, "fixtures/discovery-drift/t1-s94");
  return {
    root,
    bazaar: resolve(root, "bazaar-merchant.json"),
    preflight: resolve(root, "live-preflight.json"),
  };
}

export function replayT1S94({
  now = Date.parse(T1_S94.recordedAt),
  staleMs = null,
  bazaarBody,
  preflight,
} = {}) {
  const paths = t1S94FixturePaths();
  const catalogBody = bazaarBody || loadJson(paths.bazaar);
  const livePreflight = preflight || loadJson(paths.preflight);
  const catalog = observationFromBazaarMerchant(catalogBody, {
    resource: T1_S94.resource,
    observedAt: T1_S94.recordedAt,
  });
  const live = observationFromPreflight(livePreflight);
  const report = compareDiscoveryLive(catalog, live, { now, staleMs });
  return Object.freeze({
    ...report,
    replay: Object.freeze({
      mode: "recorded-fixture",
      issue: T1_S94.issue,
      recordedAt: T1_S94.recordedAt,
      claim: "Recorded S94 unpaid replay. Amount match is an observation. This did not reindex Bazaar and does not resolve lastUpdated lag.",
    }),
  });
}

export async function replayT1S94Live({
  now = Date.now(),
  staleMs = null,
  fetchImpl = fetch,
  paymentPreflightImpl = paymentOfferPreflight,
} = {}) {
  const report = await observeDiscoveryDrift({
    url: T1_S94.resource,
    bazaarPayTo: T1_S94.payTo,
    now,
    staleMs,
    fetchImpl,
    paymentPreflightImpl,
  });
  return Object.freeze({
    ...report,
    replay: Object.freeze({
      mode: "live-unpaid",
      issue: T1_S94.issue,
      recordedAt: new Date(now).toISOString(),
      claim: "Live unpaid GET replay. Amount match or mismatch is an observation. This did not reindex Bazaar and does not resolve lastUpdated lag.",
    }),
  });
}

function usage() {
  return `SameDayDesk discovery↔live payment drift diagnostic

Library + CLI. Not a hosted route, daemon, or paid service.
Credential-free. No payment. No redirect following. No unit conversion.

${DISCOVERY_DRIFT_OPERATOR_COMMAND}

Recorded T1 S94 replay (no network):
  node discovery-drift.mjs replay-t1

Compare two already captured snapshots:
  node discovery-drift.mjs compare --catalog fixtures/discovery-drift/t1-s94/catalog.json --live fixtures/discovery-drift/t1-s94/live.json
  node discovery-drift.mjs change --before before.json --after after.json

Options:
  --url HTTPS              Live unpaid GET resource
  --bazaar-pay-to 0x...    Coinbase Bazaar merchant discovery payTo
  --catalog FILE           Caller-supplied catalog observation JSON
  --live FILE              Caller-supplied live observation or preflight JSON
  --before FILE            Prior discovery-drift report
  --after FILE             Later discovery-drift report
  --stale-ms N             Explicit freshness horizon; omitted lastUpdated lag stays unknown
  --now ISO8601            Comparison clock
  --live-replay            replay-t1 against current public GET (still unpaid)
`;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--live-replay") {
      args.liveReplay = true;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      if (!["url", "bazaar-pay-to", "catalog", "live", "before", "after", "stale-ms", "now"].includes(key)
          || Object.hasOwn(args, key)) fail(`unknown or duplicate option --${key}`, "invalid_args");
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) fail(`missing value for --${key}`, "invalid_args");
      args[key] = value;
      index += 1;
      continue;
    }
    args._.push(token);
  }
  return args;
}

function integerFlag(value, name) {
  if (value === undefined) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) fail(`${name} must be a non-negative integer`, "invalid_args");
  return number;
}

function asLiveObservation(value) {
  if (value?.schemaVersion === DISCOVERY_DRIFT_SNAPSHOT_SCHEMA || Array.isArray(value?.offers) && value?.source) {
    return normalizeDiscoveryObservation(value);
  }
  if (value?.product === "samedaydesk-payment-offer-preflight" || value?.offers && value?.target) {
    return observationFromPreflight(value);
  }
  fail("live file must be a discovery snapshot or payment-offer-preflight report", "invalid_live");
}

function asCatalogObservation(value, resource) {
  if (value?.schemaVersion === DISCOVERY_DRIFT_SNAPSHOT_SCHEMA || Array.isArray(value?.offers) && value?.source) {
    return normalizeDiscoveryObservation(value);
  }
  if (Array.isArray(value?.resources)) {
    return observationFromBazaarMerchant(value, { resource, observedAt: value.fetchedAt || value.observedAt });
  }
  if (value?.report?.economics || value?.product === "samedaydesk-seller-integrity-audit") {
    return observationFromSellerIntegrity(value);
  }
  fail("catalog file must be a discovery snapshot, Bazaar merchant payload, or seller-integrity report", "invalid_catalog");
}

export async function runDiscoveryDriftCli(argv = process.argv.slice(2), {
  fetchImpl = fetch,
  paymentPreflightImpl = paymentOfferPreflight,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const args = parseArgs(argv);
  if (args.help || args._.length === 0) {
    stdout(usage());
    return 0;
  }
  const command = args._[0];
  const allowed = {
    "replay-t1": ["now", "stale-ms", "liveReplay"],
    compare: ["catalog", "live", "url", "now", "stale-ms"],
    change: ["before", "after", "now"],
    observe: ["url", "catalog", "bazaar-pay-to", "now", "stale-ms"],
  }[command];
  if (args._.length !== 1 || !allowed || Object.keys(args).some(key => key !== "_" && !allowed.includes(key))) {
    fail("unsupported command or option combination", "invalid_args");
  }
  const now = args.now ? Date.parse(args.now) : Date.now();
  if (!Number.isFinite(now)) fail("now must be an ISO-8601 timestamp", "invalid_args");
  const staleMs = integerFlag(args["stale-ms"], "stale-ms");
  if (command === "replay-t1") {
    const report = args.liveReplay
      ? await replayT1S94Live({ now, staleMs, fetchImpl, paymentPreflightImpl })
      : replayT1S94({ now: args.now ? now : Date.parse(T1_S94.recordedAt), staleMs });
    stdout(JSON.stringify(report, null, 2));
    return 0;
  }
  if (command === "compare") {
    if (!args.catalog || !args.live) fail("compare requires --catalog and --live", "invalid_args");
    const live = asLiveObservation(loadJson(args.live));
    const catalog = asCatalogObservation(loadJson(args.catalog), args.url || live.resource);
    stdout(JSON.stringify(compareDiscoveryLive(catalog, live, { now, staleMs }), null, 2));
    return 0;
  }
  if (command === "change") {
    if (!args.before || !args.after) fail("change requires --before and --after", "invalid_args");
    stdout(JSON.stringify(compareDiscoveryDriftChange(loadJson(args.before), loadJson(args.after), {
      clock: args.now || new Date(now).toISOString(),
    }), null, 2));
    return 0;
  }
  if (command === "observe") {
    if (!args.url) fail("observe requires --url", "invalid_args");
    const report = await observeDiscoveryDrift({
      url: args.url,
      catalog: args.catalog ? asCatalogObservation(loadJson(args.catalog), args.url) : undefined,
      bazaarPayTo: args["bazaar-pay-to"],
      now,
      staleMs,
      fetchImpl,
      paymentPreflightImpl,
    });
    stdout(JSON.stringify(report, null, 2));
    return 0;
  }
  stderr(usage());
  fail(`unknown command ${command}`, "invalid_args");
}

async function main() {
  try {
    process.exitCode = await runDiscoveryDriftCli();
  } catch (error) {
    console.error(`${error.name || "Error"}: ${error.message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || "")).href) {
  await main();
}
