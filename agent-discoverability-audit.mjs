import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { evaluateListingIdentity } from "agent-payment-policy";

import {
  PaymentOfferPreflightError,
  createPinnedLookup,
  normalizePaymentTarget,
  paymentOfferPreflight,
  resolvePublicAddress,
} from "./payment-offer-preflight.mjs";
import { searchMarket8004 } from "./market8004-discovery.mjs";
import { buildSearchUrl, measure, PACKAGE, parseCount, SOURCE } from "task-discoverability";

const BAZAAR_SEARCH = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search";
const BAZAAR_VALIDATE = "https://api.cdp.coinbase.com/platform/v2/x402/validate";
const AGENT402_ROUTE = "https://agent402.tools/api/route";
const CIRCLE_SEARCH = "https://api.circle.com/v2/x402/discovery/resources";
const AGENTIC_MARKET_SEARCH = "https://api.agentic.market/v1/services/search";
const AGENTICTRADE_SEARCH = "https://agentictrade.io/api/v1/discover";
const MPP_CATALOG = "https://mpp.dev/api/services";
const MPPSCAN_SEARCH = "https://www.mppscan.com/api/trpc/discover.search";
const PAYANAGENT_SEARCH = "https://payanagent.com/api/v1/discover";
const X402_JOBS_SEARCH = "https://api.x402.jobs/api/v1/resources";
const CANONICAL_BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const TARGET_SURFACES = Object.freeze({
  agentCard: "/.well-known/agent-card.json",
  agentRegistration: "/.well-known/agent-registration.json",
  actionCatalog: "/api/actions",
});
const TARGET_SURFACE_MAX_BYTES = 512 * 1024;
const TARGET_SURFACE_TIMEOUT_MS = 5_000;
export const CATALOG_RESPONSE_MAX_BYTES = 10_000_000;
const CATALOG_TIMEOUT_MS = 10_000;
const DISCOVERABILITY_AUDIT_VERSION = "1.13.0";
const DISCOVERY_IMPLEMENTATION = "0cf1e465c714991ab70fbde349ed51baddf64c12";
const DISCOVERY_INTERPRETER_INCOMPATIBLE = "task-discoverability measure() decodes one CDP discovery document and labels that provider. collectBounded also refuses every base other than the pinned search URL, is GET-only, and stops at 262144 bytes. This source keeps the count and request-construction contract: declared, inspected, and exact counts stay separate, catalog presence stays unknown when the exact target is outside the inspected rows, and request construction stays null. The body is not passed through that CDP decoder.";

const SOURCE_ORDER = [
  "coinbase-bazaar",
  "coinbase-agentic-market",
  "agent402-router",
  "circle-marketplace",
  "agentictrade-catalog",
  "official-mpp-catalog",
  "mppscan-public-search",
  "payanagent-public-search",
  "x402jobs-public-search",
  "8004market-public-search",
];
const SOURCE_FAMILIES = Object.freeze({
  "coinbase-bazaar": "coinbase",
  "coinbase-agentic-market": "coinbase",
  "agent402-router": "agent402",
  "circle-marketplace": "circle",
  "agentictrade-catalog": "agentictrade",
  "official-mpp-catalog": "mpp",
  "mppscan-public-search": "mppscan",
  "payanagent-public-search": "payanagent",
  "x402jobs-public-search": "x402jobs",
  "8004market-public-search": "market8004",
});
const DEPENDENT_SOURCES = Object.freeze({
  "payanagent-public-search": "Aggregates ecosystem supply, including Coinbase-origin records; retrieval is a distinct buyer surface but not independent underlying supply.",
  "8004market-public-search": "Indexes Solana Agent Registry identities; retrieval proves on-chain identity propagation, not a buyer call, settlement, or independent demand.",
});

function cleanString(value, maximum = 500) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function publicHostname(hostname) {
  const lower = String(hostname || "").toLowerCase();
  if (!lower || lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return false;
  if (/^(?:127|10|0)\./.test(lower) || /^192\.168\./.test(lower) || /^169\.254\./.test(lower)) return false;
  const private172 = /^172\.(\d{1,3})\./.exec(lower);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
  if (lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:")) return false;
  return true;
}

export function normalizeDiscoverabilityAuditInput(raw = {}) {
  const originUrl = httpsUrl(raw.origin);
  if (!originUrl || originUrl.origin !== originUrl.toString().replace(/\/$/, "")) {
    throw new Error("origin must be a public HTTPS origin with no path, query, fragment, or credentials");
  }
  if (!publicHostname(originUrl.hostname)) throw new Error("origin must use a public hostname");
  const intent = cleanString(raw.intent, 500);
  if (!intent || intent.length < 20) throw new Error("intent must describe the capability in 20 to 500 characters");
  if (intent.toLowerCase().includes(originUrl.hostname.toLowerCase())) {
    throw new Error("intent must be brand-blind and cannot contain the target hostname");
  }
  const expectedRoute = raw.route === undefined || raw.route === null || raw.route === ""
    ? null
    : cleanString(raw.route, 200);
  if (expectedRoute && (!expectedRoute.startsWith("/") || expectedRoute.includes("?") || expectedRoute.includes("#") || expectedRoute.includes(".."))) {
    throw new Error("route must be an absolute path without query, fragment, or traversal segments");
  }
  const payTo = raw.payTo === undefined || raw.payTo === null || raw.payTo === ""
    ? null
    : String(raw.payTo).toLowerCase();
  if (payTo && !/^0x[0-9a-f]{40}$/.test(payTo)) throw new Error("payTo must be a 0x-prefixed EVM address");
  let runtimeUrl = null;
  if (raw.runtimeUrl !== undefined && raw.runtimeUrl !== null && raw.runtimeUrl !== "") {
    if (!expectedRoute) throw new Error("runtimeUrl requires an exact route");
    const runtimeTarget = normalizePaymentTarget(raw.runtimeUrl);
    if (runtimeTarget.origin !== originUrl.origin) throw new Error("runtimeUrl must use the audited origin");
    if (runtimeTarget.pathname !== expectedRoute) throw new Error("runtimeUrl pathname must match route exactly");
    runtimeUrl = runtimeTarget.toString();
  }
  let surfaceAudit = false;
  if (![undefined, null, "", false, "false", "0", true, "true", "1"].includes(raw.surfaceAudit)) {
    throw new Error("surfaceAudit must be true or false");
  }
  if ([true, "true", "1"].includes(raw.surfaceAudit)) surfaceAudit = true;
  let materializationAudit = false;
  if (![undefined, null, "", false, "false", "0", true, "true", "1"].includes(raw.materializationAudit)) {
    throw new Error("materializationAudit must be true or false");
  }
  if ([true, "true", "1"].includes(raw.materializationAudit)) materializationAudit = true;
  if (materializationAudit && !expectedRoute) throw new Error("materializationAudit requires an exact route");
  const method = String(raw.method || "GET").toUpperCase();
  if (!["GET", "POST"].includes(method)) throw new Error("method must be GET or POST");
  if (runtimeUrl && method !== "GET") throw new Error("runtimeUrl is supported only when method is GET");
  let expectedPriceAtomic = null;
  let expectedPriceUsd = null;
  if (raw.expectedPriceUsd !== undefined && raw.expectedPriceUsd !== null && raw.expectedPriceUsd !== "") {
    if (!expectedRoute) throw new Error("expectedPriceUsd requires an exact route");
    const priceText = String(raw.expectedPriceUsd).trim();
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(priceText)) {
      throw new Error("expectedPriceUsd must be a non-negative decimal with at most six fractional digits");
    }
    const [whole, fraction = ""] = priceText.split(".");
    expectedPriceAtomic = (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))).toString();
    if (BigInt(expectedPriceAtomic) > 1_000_000_000_000n) throw new Error("expectedPriceUsd exceeds the supported bound");
    expectedPriceUsd = Number(expectedPriceAtomic) / 1_000_000;
  }
  return {
    origin: originUrl.origin,
    hostname: originUrl.hostname.toLowerCase(),
    intent,
    route: expectedRoute,
    runtimeUrl,
    payTo,
    surfaceAudit,
    materializationAudit,
    method,
    expectedPriceUsd,
    expectedPriceAtomic,
  };
}

function coinbaseSearchUrl(query, limit) {
  const url = buildSearchUrl({ query, limit });
  const sent = [...new URL(url).searchParams.keys()];
  const unsupported = sent.filter((key) => !SOURCE.sdkSearchQuery.includes(key));
  if (unsupported.length > 0) throw new Error(`unsupported Coinbase search parameters: ${unsupported.join(",")}`);
  return url;
}

function serviceUrlFor(input) {
  return input.route ? `${input.origin}${input.route}` : input.origin;
}

function discoveryPackage() {
  return {
    name: PACKAGE.name,
    version: PACKAGE.version,
    license: PACKAGE.license,
    schema: PACKAGE.schema,
    implementation: DISCOVERY_IMPLEMENTATION,
  };
}

function constructedRequestFor(document, serviceUrl) {
  const constructible = document?.requestConstructibility?.fromThisResponse === true
    || document?.service?.requestConstructible === true;
  if (!constructible) return null;
  const row = (document.rows || []).find((item) => item.resource === serviceUrl && item.constructedRequest);
  return row ? row.constructedRequest : null;
}

function requestWindow(read, extra = {}) {
  return {
    method: read.transport.method,
    url: read.transport.url,
    httpStatus: read.transport.httpStatus,
    observedAt: read.transport.completedAt,
    startedAt: read.transport.startedAt,
    plane: "actual-transport",
    window: {
      timeoutMs: read.transport.timeoutMs,
      maxBytes: read.transport.maxBytes,
      bytes: read.transport.bytes,
      bodyBound: read.transport.bodyBound,
      elapsedMs: read.transport.elapsedMs,
      contentLength: read.transport.contentLength,
      contentLengthHonored: false,
      ...extra,
    },
  };
}

async function interpretCoinbaseRead(read, input) {
  const serviceUrl = serviceUrlFor(input);
  const document = await measure({
    serviceUrl,
    body: read.body,
    observedAt: read.transport.completedAt,
  });
  const inspected = document.service?.inInspectedRows;
  const exactTargetCount = inspected === true
    ? document.service.ranks.length
    : inspected === false ? 0 : "unknown";
  return {
    applied: true,
    package: discoveryPackage(),
    provenance: document.provenance,
    transport: read.transport,
    request: {
      ...requestWindow(read, {
        limit: new URL(read.transport.url).searchParams.get("limit"),
        inspectedCount: document.coverage?.inspectedCount ?? "unknown",
      }),
      query: input.intent,
      suppliedBodyPlane: document.provenance?.kind || "supplied-body",
      sentParams: [...new URL(read.transport.url).searchParams.keys()],
    },
    coverage: {
      declaredReturnedCount: document.coverage?.declaredReturnedCount ?? "unknown",
      rawReturnedCount: Array.isArray(read.body?.resources) ? read.body.resources.length : "unknown",
      inspectedCount: document.coverage?.inspectedCount ?? "unknown",
      uninspectedCount: document.coverage?.uninspectedCount ?? "unknown",
      reportedPageTotal: document.coverage?.reportedPageTotal ?? "unknown",
      exactTargetCount,
      exactRouteCount: input.route ? exactTargetCount : null,
      countState: document.coverage?.countState ?? "unknown",
      countConflict: document.coverage?.countConflict === true,
      measuredZero: document.coverage?.measuredZero === true,
      partialResults: document.coverage?.partialResults ?? "unknown",
      catalogPresence: inspected === true ? "observed-in-inspected-rows" : "unknown",
      queryVisibility: document.service?.queryVisibility ?? "unknown",
    },
    filter: document.filter || { assumedHonored: false },
    requestConstruction: constructedRequestFor(document, serviceUrl),
    nextAction: document.nextAction || null,
    service: document.service || null,
  };
}

function providerCount(field, value) {
  const parsed = parseCount(value);
  return {
    field,
    semantic: "unknown",
    state: parsed.state,
    value: parsed.state === "measured" ? parsed.value : null,
  };
}

function unknownProviderCounts(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const counts = [];
  if (Object.prototype.hasOwnProperty.call(payload, "itemCount")) counts.push(providerCount("itemCount", payload.itemCount));
  const pagination = payload.pagination;
  if (pagination && typeof pagination === "object" && !Array.isArray(pagination)
    && Object.prototype.hasOwnProperty.call(pagination, "total")) {
    counts.push(providerCount("pagination.total", pagination.total));
  }
  return counts;
}

function rawReturnedCountFor(source, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "unknown";
  if (source === "agent402-router") return Array.isArray(payload.results) ? payload.results.length : "unknown";
  if (source === "circle-marketplace") {
    const items = payload.items ?? payload.resources;
    return Array.isArray(items) ? items.length : "unknown";
  }
  if (source === "coinbase-agentic-market" || source === "official-mpp-catalog") {
    if (!Array.isArray(payload.services)) return "unknown";
    return payload.services.reduce((sum, service) => sum + (Array.isArray(service?.endpoints) ? service.endpoints.length : 0), 0);
  }
  if (source === "agentictrade-catalog") return Array.isArray(payload.services) ? payload.services.length : "unknown";
  if (source === "mppscan-public-search") {
    return Array.isArray(payload.result?.data?.json) ? payload.result.data.json.length : "unknown";
  }
  if (source === "payanagent-public-search") return Array.isArray(payload.offers) ? payload.offers.length : "unknown";
  if (source === "x402jobs-public-search") return Array.isArray(payload.resources) ? payload.resources.length : "unknown";
  return "unknown";
}

function requestQuery(source, url, input) {
  if (source === "agent402-router") return input.intent;
  if (source === "official-mpp-catalog") return null;
  try {
    const params = new URL(url).searchParams;
    return params.get("query") || params.get("q") || params.get("search");
  } catch {
    return null;
  }
}

function interpretGeneralRead(source, read, items, input) {
  const inspectedCount = items.length;
  const rawReturnedCount = rawReturnedCountFor(source, read.body);
  const exactTargetCount = items.filter((item) => targetMatch(item, input)).length;
  const exactRouteCount = input.route
    ? items.filter((item) => targetMatch(item, input) && routeMatch(item, input.route)).length
    : null;
  return {
    applied: false,
    reason: DISCOVERY_INTERPRETER_INCOMPATIBLE,
    package: discoveryPackage(),
    provenance: { kind: "supplied-body", officialLiveRead: false, networkSent: false, credentialSent: false },
    transport: read.transport,
    request: {
      ...requestWindow(read, { inspectedCount }),
      query: requestQuery(source, read.transport.url, input),
      suppliedBodyPlane: "supplied-body",
    },
    coverage: {
      declaredReturnedCount: "unknown",
      rawReturnedCount,
      inspectedCount,
      reportedPageTotal: "unknown",
      providerCounts: unknownProviderCounts(read.body),
      exactTargetCount,
      exactRouteCount,
      countState: "unknown",
      countConflict: false,
      adapterReduced: typeof rawReturnedCount === "number" && rawReturnedCount !== inspectedCount,
      measuredZero: false,
      catalogPresence: exactTargetCount > 0 ? "observed-in-inspected-rows" : "unknown",
      queryVisibility: exactTargetCount > 0 ? "in-this-response" : "not-in-inspected-rows",
    },
    requestConstruction: null,
    nextAction: null,
  };
}

function interpretUninstrumented(items, input) {
  const exactTargetCount = items.filter((item) => targetMatch(item, input)).length;
  const exactRouteCount = input.route
    ? items.filter((item) => targetMatch(item, input) && routeMatch(item, input.route)).length
    : null;
  return {
    applied: false,
    reason: "8004Market search is an HTML adapter outside shared fetchJson. This result does not claim an HTTP status or a byte window.",
    package: discoveryPackage(),
    provenance: null,
    transport: null,
    request: null,
    coverage: {
      declaredReturnedCount: "unknown",
      rawReturnedCount: "unknown",
      inspectedCount: items.length,
      reportedPageTotal: "unknown",
      providerCounts: [],
      exactTargetCount,
      exactRouteCount,
      countState: "unknown",
      countConflict: false,
      adapterReduced: false,
      measuredZero: false,
      catalogPresence: exactTargetCount > 0 ? "observed-in-inspected-rows" : "unknown",
      queryVisibility: exactTargetCount > 0 ? "in-this-response" : "not-in-inspected-rows",
    },
    requestConstruction: null,
    nextAction: null,
  };
}

async function discoveryFor(source, read, items, input) {
  if (source === "coinbase-bazaar" && read) return interpretCoinbaseRead(read, input);
  if (read) return interpretGeneralRead(source, read, items, input);
  return interpretUninstrumented(items, input);
}

function validatorReport(body) {
  const plain = body && typeof body === "object" && !Array.isArray(body);
  const valid = plain && (body.valid === true || body.valid === false) ? body.valid : null;
  const simulation = plain && body.simulation && typeof body.simulation === "object" && !Array.isArray(body.simulation)
    ? body.simulation
    : null;
  const outcome = typeof simulation?.outcome === "string" ? simulation.outcome : null;
  const outcomeKnown = outcome === "accepted" || outcome === "rejected";
  let eligibility = "unknown";
  let eligibilityReason = "malformed";
  if (valid === null && outcomeKnown) eligibilityReason = "nonboolean-valid";
  else if (valid !== null && !outcomeKnown) eligibilityReason = "unknown-outcome";
  else if (valid === true && outcome === "accepted") {
    eligibility = "provider_reported_eligible";
    eligibilityReason = null;
  } else if (valid === false && outcome === "rejected") {
    eligibility = "provider_reported_not_eligible";
    eligibilityReason = null;
  } else if (valid !== null && outcomeKnown) eligibilityReason = "contradictory";
  return {
    status: "ok",
    valid,
    simulationOutcome: outcome ? cleanString(outcome, 80) : null,
    indexReturned: plain && body.index !== null && body.index !== undefined,
    eligibility,
    eligibilityReason,
  };
}

export async function auditCoinbaseMaterialization(input, { fetchImpl = fetch, limit = 20, catalogRead = null } = {}) {
  if (!input.materializationAudit) return { requested: false };
  const resource = `${input.origin}${input.route}`;
  const searchUrl = coinbaseSearchUrl(input.intent, limit);
  const [validationResult, catalogResult] = await Promise.allSettled([
    fetchJson(BAZAAR_VALIDATE, {
      fetchImpl,
      method: "POST",
      body: { resource, method: input.method },
    }),
    catalogRead ? Promise.resolve(catalogRead) : fetchJson(searchUrl, { fetchImpl }),
  ]);
  const validationBody = validationResult.status === "fulfilled" ? validationResult.value?.body : null;
  const validator = validationResult.status === "fulfilled"
    ? validatorReport(validationBody)
    : { status: "error", eligibility: "unknown", eligibilityReason: "unavailable", error: cleanString(validationResult.reason?.message || "validator unavailable", 200) };
  let discovery = null;
  let catalog;
  if (catalogResult.status === "fulfilled") {
    const read = catalogResult.value;
    if (!read?.body || !Array.isArray(read.body.resources)) {
      catalog = { status: "error", error: "catalog response is missing resources" };
    } else if (read.transport?.url && read.transport.url !== searchUrl) {
      catalog = { status: "error", error: "catalog read did not use the supported search URL" };
    } else {
      discovery = await interpretCoinbaseRead(read, input);
      catalog = {
        status: "ok",
        catalogPresence: discovery.coverage.catalogPresence,
        queryVisibility: discovery.coverage.queryVisibility,
        exactMatchCount: discovery.coverage.exactTargetCount,
        declaredReturnedCount: discovery.coverage.declaredReturnedCount,
        rawReturnedCount: discovery.coverage.rawReturnedCount,
        inspectedCount: discovery.coverage.inspectedCount,
        reportedPageTotal: discovery.coverage.reportedPageTotal,
        measuredZero: discovery.coverage.measuredZero,
        countState: discovery.coverage.countState,
        countConflict: discovery.coverage.countConflict,
      };
    }
  } else {
    catalog = { status: "error", error: cleanString(catalogResult.reason?.message || "catalog unavailable", 200) };
  }
  let state = "unresolved";
  if (catalog.status === "ok" && catalog.catalogPresence === "observed-in-inspected-rows") state = "observed_in_query_window";
  else if (catalog.status === "ok") state = "query_window_catalog_presence_unknown";
  return {
    requested: true,
    provider: "coinbase-cdp",
    evidencePlane: "provider_returned",
    resource,
    method: input.method,
    state,
    validator,
    catalog,
    discovery,
    search: {
      url: searchUrl,
      supportedParams: SOURCE.sdkSearchQuery.slice(),
      sentParams: [...new URL(searchUrl).searchParams.keys()],
    },
    boundary: "Validator eligibility stays on its own plane. The catalog read is one supported task-search window using the maintained SDK parameters. A missing exact target in that window is unknown catalog presence for the query. It does not prove the route is unlisted and it does not support a reindex action. Coinbase may make one unpaid request to the seller when validation is requested; no credential, signature, or payment is supplied.",
  };
}

function runtimePriceReference(runtimeOfferAudit) {
  if (runtimeOfferAudit?.status !== "ok" || runtimeOfferAudit.decision !== "parseable_offer") return null;
  if (runtimeOfferAudit.parity?.compared && runtimeOfferAudit.parity.consistent !== true) return null;
  const validOffers = Array.isArray(runtimeOfferAudit.offers)
    ? runtimeOfferAudit.offers.filter((offer) => offer?.valid === true
      && offer.network === "eip155:8453"
      && String(offer.asset || "").toLowerCase() === CANONICAL_BASE_USDC
      && /^\d+$/.test(String(offer.amountAtomic || "")))
    : [];
  const amounts = [...new Set(validOffers.map((offer) => String(offer.amountAtomic)))];
  if (amounts.length !== 1) return null;
  return {
    basis: "live_unsigned_offer",
    amountAtomic: amounts[0],
    amountUsd: Number(amounts[0]) / 1_000_000,
    protocols: [...new Set(validOffers.map((offer) => offer.protocol).filter(Boolean))].sort(),
  };
}

async function inspectRuntimeOffer(input, { paymentPreflightImpl, now }) {
  if (!input.runtimeUrl) return { requested: false };
  try {
    const result = await paymentPreflightImpl({ url: input.runtimeUrl }, { now });
    return {
      requested: true,
      status: "ok",
      target: result.target,
      decision: result.decision,
      protocols: result.protocols,
      offerCount: result.offerCount,
      offers: result.offers,
      parity: result.parity,
      findings: result.findings,
      boundary: result.boundary,
    };
  } catch (error) {
    return {
      requested: true,
      status: "error",
      code: error?.code || "runtime_offer_unavailable",
      error: cleanString(error?.message || "runtime offer unavailable", 200),
    };
  }
}

function targetSurfaceError(error) {
  if (error instanceof PaymentOfferPreflightError) {
    return { status: "error", code: error.code, error: cleanString(error.message, 200) };
  }
  return { status: "error", code: "surface_fetch_failed", error: cleanString(error?.message || "surface unavailable", 200) };
}

export async function fetchPinnedTargetJson(urlValue, {
  lookupImpl = dnsLookup,
  requestImpl = httpsRequest,
  timeoutMs = TARGET_SURFACE_TIMEOUT_MS,
  maxBytes = TARGET_SURFACE_MAX_BYTES,
} = {}) {
  const target = normalizePaymentTarget(urlValue);
  const resolved = await resolvePublicAddress(target.hostname.replace(/^\[|\]$/g, ""), { lookupImpl });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const request = requestImpl(target, {
      method: "GET",
      headers: {
        accept: "application/json",
        "accept-encoding": "identity",
        "user-agent": "SameDayDesk-Discoverability-Surface-Audit/1.0 (+https://samedaydesk.com)",
      },
      maxHeaderSize: 64 * 1024,
      lookup: createPinnedLookup(resolved),
    }, (response) => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400) {
        response.destroy();
        return finish(reject, new PaymentOfferPreflightError("target surface redirect was rejected", { code: "redirect_rejected", statusCode: 502 }));
      }
      if (status !== 200) {
        response.destroy();
        return finish(reject, new PaymentOfferPreflightError(`target surface returned HTTP ${status}`, { code: "surface_http_error", statusCode: 502 }));
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          response.destroy();
          finish(reject, new PaymentOfferPreflightError("target surface exceeded the response-size limit", { code: "surface_too_large", statusCode: 502 }));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", (error) => finish(reject, new PaymentOfferPreflightError(String(error?.message || error), { code: "surface_fetch_failed", statusCode: 502 })));
      response.once("end", () => {
        if (settled) return;
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("target surface JSON must be an object");
          finish(resolve, payload);
        } catch (error) {
          finish(reject, new PaymentOfferPreflightError(String(error?.message || "target surface returned malformed JSON"), { code: "surface_json_invalid", statusCode: 502 }));
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("target surface request timed out")));
    request.once("error", (error) => finish(reject, new PaymentOfferPreflightError(String(error?.message || error), { code: "surface_fetch_failed", statusCode: 502 })));
    request.end();
  });
}

function mentionsExactRoute(value, route) {
  if (typeof value !== "string") return false;
  return value.split(/\s+/).some((token) => token
    .replace(/^[('"`]+/, "")
    .replace(/[)'"`,.;:!?]+$/, "") === route);
}

function routeInAgentCard(payload, route) {
  const skills = Array.isArray(payload?.skills) ? payload.skills.slice(0, 200) : [];
  const routeFound = route ? skills.some((skill) => [skill?.id, skill?.name, skill?.description, ...(Array.isArray(skill?.examples) ? skill.examples : [])]
    .some((value) => mentionsExactRoute(value, route))) : null;
  return { status: "ok", skillCount: skills.length, expectedRouteFound: routeFound };
}

function routeInRegistration(payload, route, origin) {
  const services = Array.isArray(payload?.services) ? payload.services.slice(0, 500) : [];
  const routeFound = route ? services.some((service) => {
    const endpoint = httpsUrl(service?.endpoint);
    return endpoint?.origin === origin && endpoint.pathname === route;
  }) : null;
  return { status: "ok", serviceCount: services.length, expectedRouteFound: routeFound };
}

function routeInActionCatalog(payload, route, origin) {
  const actions = Array.isArray(payload?.actions) ? payload.actions.slice(0, 500) : [];
  const routeFound = route ? actions.some((action) => {
    const actionUrl = httpsUrl(action?.url);
    return action?.route === route || (actionUrl?.origin === origin && actionUrl.pathname === route);
  }) : null;
  return { status: "ok", actionCount: actions.length, expectedRouteFound: routeFound };
}

export async function auditTargetDiscoverySurfaces(input, { surfaceFetchImpl = fetchPinnedTargetJson } = {}) {
  const entries = Object.entries(TARGET_SURFACES);
  const settled = await Promise.allSettled(entries.map(([, path]) => surfaceFetchImpl(`${input.origin}${path}`)));
  const surfaces = {};
  entries.forEach(([name], index) => {
    const result = settled[index];
    if (result.status === "rejected") {
      surfaces[name] = targetSurfaceError(result.reason);
      return;
    }
    if (name === "agentCard") surfaces[name] = routeInAgentCard(result.value, input.route);
    if (name === "agentRegistration") surfaces[name] = routeInRegistration(result.value, input.route, input.origin);
    if (name === "actionCatalog") surfaces[name] = routeInActionCatalog(result.value, input.route, input.origin);
  });
  const available = entries.map(([name]) => name).filter((name) => surfaces[name].status === "ok");
  const found = input.route ? available.filter((name) => surfaces[name].expectedRouteFound) : [];
  return {
    requested: true,
    availableSurfaceCount: available.length,
    expectedRouteFoundSurfaceCount: input.route ? found.length : null,
    expectedRouteFoundSurfaces: found,
    surfaces,
    method: "Three fixed same-origin JSON documents are fetched after payment with pinned public DNS, no redirects, a five-second timeout, a 512-KiB response cap, and no credentials.",
  };
}

function decimalPrice(accepts) {
  const offer = Array.isArray(accepts) ? accepts.find((item) => /^\d+$/.test(String(item?.amount || ""))) : null;
  if (!offer) return null;
  const decimals = Number.isInteger(Number(offer.extra?.decimals)) ? Number(offer.extra.decimals) : 6;
  const value = Number(offer.amount) / (10 ** decimals);
  return Number.isFinite(value) ? value : null;
}

function candidate({ name, url, origin, route, description, priceUsd, score, payTo, serviceUrls }) {
  const safeUrl = httpsUrl(url)?.toString() || null;
  const safeOrigin = httpsUrl(origin)?.origin || (safeUrl ? new URL(safeUrl).origin : null);
  const safeServiceUrls = [...new Set((serviceUrls || [])
    .map((value) => httpsUrl(value)?.toString())
    .filter(Boolean))].slice(0, 50);
  return {
    name: cleanString(name, 200),
    url: safeUrl,
    origin: safeOrigin,
    route: cleanString(route, 200) || (safeUrl ? new URL(safeUrl).pathname : null),
    description: cleanString(description, 500),
    priceUsd: priceUsd !== null && priceUsd !== undefined && Number.isFinite(Number(priceUsd)) ? Number(priceUsd) : null,
    score: score !== null && score !== undefined && Number.isFinite(Number(score)) ? Number(score) : null,
    payTo: /^0x[0-9a-f]{40}$/i.test(String(payTo || "")) ? String(payTo).toLowerCase() : null,
    ...(safeServiceUrls.length ? {
      serviceUrls: safeServiceUrls,
      serviceOrigins: [...new Set(safeServiceUrls.map((value) => new URL(value).origin))],
      serviceRoutes: [...new Set(safeServiceUrls.map((value) => new URL(value).pathname))],
    } : {}),
  };
}

function normalizeBazaar(payload) {
  if (!Array.isArray(payload?.resources)) throw new Error("Bazaar response is missing resources");
  return payload.resources.map((item) => candidate({
    name: item.serviceName,
    url: item.resource,
    description: item.description,
    priceUsd: decimalPrice(item.accepts),
    payTo: item.accepts?.[0]?.payTo,
  }));
}

function normalizeAgent402(payload) {
  if (!Array.isArray(payload?.results)) throw new Error("Agent402 response is missing results");
  return payload.results.map((item) => candidate({
    name: item.name || item.sellerName,
    url: item.url,
    origin: item.seller,
    route: item.route,
    description: item.description,
    priceUsd: item.priceUsd ?? item.price,
    score: item.score,
    payTo: item.payTo ?? item.recipient,
  }));
}

function normalizeCircle(payload) {
  const items = payload?.items ?? payload?.resources;
  if (!Array.isArray(items)) throw new Error("Circle response is missing items");
  return items.map((item) => candidate({
    name: item.serviceName || item.metadata?.provider?.name,
    url: item.resource,
    description: item.description,
    priceUsd: decimalPrice(item.accepts),
    payTo: item.accepts?.[0]?.payTo,
  }));
}

function normalizeAgenticMarket(payload) {
  if (!Array.isArray(payload?.services)) throw new Error("Agentic Market response is missing services");
  return payload.services.flatMap((service) => (service.endpoints || []).map((endpoint) => candidate({
    name: service.name,
    url: endpoint.url,
    origin: service.providerUrl,
    description: `${service.description || ""} ${endpoint.description || ""}`,
    priceUsd: endpoint.pricing?.amount,
  })));
}

function normalizeAgenticTrade(payload) {
  if (!Array.isArray(payload?.services)) throw new Error("AgenticTrade response is missing services");
  return payload.services.map((service) => candidate({
    name: service.name,
    url: service.endpoint,
    description: service.description,
    priceUsd: service.pricing?.price_per_call,
  }));
}

function normalizeMppscan(payload) {
  const items = payload?.result?.data?.json;
  if (!Array.isArray(items) || items.length > 100) throw new Error("MPPScan response is missing or excessive");
  return items.flatMap((item) => {
    const origin = httpsUrl(item?.origin)?.origin;
    const route = cleanString(item?.endpoint?.path, 200);
    const method = cleanString(item?.endpoint?.method, 20)?.toUpperCase();
    if (!origin || !route?.startsWith("/") || route.startsWith("//") || /[?#]/.test(route)) return [];
    if (!method || !/^[A-Z]+$/.test(method)) return [];
    const exactPrice = /^([0-9]+(?:\.[0-9]+)?) USD$/i.exec(String(item?.endpoint?.price || "").trim());
    return [candidate({
      name: item?.title,
      url: new URL(route, `${origin}/`).toString(),
      origin,
      route,
      description: `${item?.description || ""} ${item?.endpoint?.summary || ""}`,
      priceUsd: exactPrice ? Number(exactPrice[1]) : null,
    })];
  });
}

function normalizePayanAgent(payload) {
  const items = payload?.offers;
  if (!Array.isArray(items) || items.length > 100) throw new Error("PayanAgent response is missing or excessive");
  const seen = new Set();
  return items.flatMap((item) => {
    const id = cleanString(item?._id ?? item?.id, 100);
    const buyPath = cleanString(item?.buyUrl, 200);
    const title = cleanString(item?.title, 200);
    const description = cleanString(item?.description, 500);
    if (!id || !/^[a-z0-9]{20,100}$/.test(id) || buyPath !== `/x402/${id}` || !title || !description) return [];
    if (seen.has(id)) throw new Error(`PayanAgent response contained duplicate offer ${id}`);
    seen.add(id);
    const target = httpsUrl(title);
    return [candidate({
      name: title,
      url: `https://payanagent.com${buyPath}`,
      origin: target?.origin,
      route: target?.pathname,
      description,
      priceUsd: item?.priceUsd,
    })];
  });
}

function normalizeX402Jobs(payload) {
  const items = payload?.resources;
  if (!Array.isArray(items) || items.length > 100) throw new Error("x402.jobs response is missing or excessive");
  const seen = new Set();
  return items.flatMap((item) => {
    const id = cleanString(item?.id, 100);
    const resourceUrl = httpsUrl(item?.resource_url ?? item?.url);
    if (!id || !resourceUrl) return [];
    if (seen.has(id)) throw new Error(`x402.jobs response contained duplicate resource ${id}`);
    seen.add(id);
    const atomic = String(item?.max_amount_required ?? "");
    const priceUsd = /^\d+$/.test(atomic) ? Number(atomic) / 1_000_000 : null;
    return [candidate({
      name: item?.name,
      url: item?.x402jobs_url ?? resourceUrl.toString(),
      origin: resourceUrl.origin,
      route: resourceUrl.pathname,
      description: item?.description,
      priceUsd,
      payTo: item?.pay_to,
    })];
  });
}

function normalizeMarket8004(items) {
  return items.map((item) => candidate({
    name: item.name,
    url: item.listingUrl,
    description: item.description,
    serviceUrls: item.serviceUrls,
  }));
}

function tokens(value) {
  return new Set(String(value || "").toLowerCase().match(/[a-z0-9]{2,}/g) || []);
}

const X402_JOBS_GENERIC_ROUTE_TERMS = new Set(["api", "v0", "v1", "defi", "commerce", "distribution", "work", "data"]);
const X402_JOBS_STOP_TERMS = new Set(["the", "and", "for", "from", "into", "with", "without", "one", "https"]);

function x402JobsLexicalQuery(input) {
  const routeTerms = [...tokens(input.route)].filter((term) => !X402_JOBS_GENERIC_ROUTE_TERMS.has(term));
  const intentTerms = [...tokens(input.intent)].filter((term) => !X402_JOBS_STOP_TERMS.has(term));
  const selected = [];
  // Route and intent share one query budget, including routes already holding two terms.
  for (const term of [...routeTerms, ...intentTerms]) {
    if (!selected.includes(term)) selected.push(term);
    if (selected.length >= 2) break;
  }
  return selected.join(" ");
}

function overlap(queryTokens, value, weight) {
  const available = tokens(value);
  let result = 0;
  for (const token of queryTokens) if (available.has(token)) result += weight;
  return result;
}

function normalizeMpp(payload, intent, limit) {
  const services = Array.isArray(payload?.services) ? payload.services : [];
  const queryTokens = tokens(intent);
  const ranked = [];
  for (const service of services) {
    const serviceUrl = service.serviceUrl || service.url || service.baseUrl;
    if (!httpsUrl(serviceUrl)) continue;
    for (const endpoint of service.endpoints || []) {
      if (!endpoint?.payment) continue;
      const score = overlap(queryTokens, endpoint.description, 10)
        + overlap(queryTokens, service.name, 8)
        + overlap(queryTokens, service.tags?.join(" "), 6)
        + overlap(queryTokens, service.categories?.join(" "), 5)
        + overlap(queryTokens, service.description, 3)
        + overlap(queryTokens, endpoint.path, 2);
      if (!score) continue;
      const decimals = Number(endpoint.payment.decimals);
      const priceUsd = /^\d+$/.test(String(endpoint.payment.amount || "")) && Number.isInteger(decimals)
        ? Number(endpoint.payment.amount) / (10 ** decimals)
        : null;
      let endpointUrl = null;
      try {
        endpointUrl = new URL(endpoint.path, `${String(serviceUrl).replace(/\/$/, "")}/`).toString();
      } catch {
        endpointUrl = null;
      }
      ranked.push(candidate({
        name: service.name,
        url: endpointUrl,
        origin: serviceUrl,
        route: endpoint.path,
        description: `${service.description || ""} ${endpoint.description || ""}`,
        priceUsd,
        score,
        payTo: endpoint.payment.recipient || endpoint.payment.payTo,
      }));
    }
  }
  return ranked.sort((left, right) => (right.score ?? 0) - (left.score ?? 0)
    || (left.priceUsd ?? Infinity) - (right.priceUsd ?? Infinity)
    || String(left.url).localeCompare(String(right.url))).slice(0, limit);
}

function asBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

async function cancelUnread(response, reason) {
  const body = response && response.body;
  if (!body || typeof body.cancel !== "function" || body.locked) return;
  try {
    await body.cancel(reason);
  } catch {
    // A closed stream has nothing left to stop.
  }
}

function capError(maxBytes, bytes) {
  const error = new Error(maxBytes === CATALOG_RESPONSE_MAX_BYTES
    ? "catalog response exceeded 10 MB"
    : `catalog response exceeded ${maxBytes} bytes`);
  error.code = "body-cap";
  error.bytes = bytes;
  return error;
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === want) return value == null ? null : String(value);
  }
  return null;
}

async function readStream(response, maxBytes, signal) {
  const reader = response.body.getReader();
  const onAbort = () => {
    reader.cancel("timeout").catch(() => {});
  };
  if (signal) {
    if (signal.aborted) {
      await reader.cancel("timeout");
      const error = new Error("catalog request timed out");
      error.name = "TimeoutError";
      error.bodyBound = "stream";
      throw error;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  const chunks = [];
  let total = 0;
  let rejectAbort = () => {};
  const aborted = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  const failTimeout = () => {
    const error = new Error("catalog request timed out");
    error.name = "TimeoutError";
    error.bodyBound = "stream";
    rejectAbort(error);
  };
  if (signal) signal.addEventListener("abort", failTimeout, { once: true });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), aborted]);
      if (signal?.aborted) {
        const error = new Error("catalog request timed out");
        error.name = "TimeoutError";
        error.bodyBound = "stream";
        throw error;
      }
      if (next.done) break;
      const chunk = asBytes(next.value);
      if (!chunk) {
        await reader.cancel("stream-failed").catch(() => {});
        const error = new Error("catalog response stream failed");
        error.code = "stream-failed";
        error.bodyBound = "stream";
        throw error;
      }
      if (total + chunk.byteLength > maxBytes) {
        await reader.cancel("body-cap");
        const error = capError(maxBytes, total + chunk.byteLength);
        error.bodyBound = "stream";
        throw error;
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }
    return {
      bytes: total,
      text: Buffer.concat(chunks, total).toString("utf8"),
      bodyBound: "stream",
    };
  } catch (error) {
    if (signal?.aborted || (error && (error.name === "TimeoutError" || error.name === "AbortError"))) {
      const timed = new Error("catalog request timed out");
      timed.name = "TimeoutError";
      timed.bodyBound = "stream";
      throw timed;
    }
    if (error && (error.code === "body-cap" || error.code === "stream-failed")) throw error;
    await reader.cancel("stream-failed").catch(() => {});
    const failed = new Error("catalog response stream failed");
    failed.code = "stream-failed";
    failed.bodyBound = "stream";
    throw failed;
  } finally {
    if (signal) {
      signal.removeEventListener("abort", onAbort);
      signal.removeEventListener("abort", failTimeout);
    }
  }
}

async function readBuffered(response, maxBytes) {
  let bytes;
  if (typeof response.arrayBuffer === "function") bytes = Buffer.from(await response.arrayBuffer());
  else if (typeof response.text === "function") bytes = Buffer.from(String(await response.text()));
  else bytes = Buffer.alloc(0);
  if (bytes.byteLength > maxBytes) {
    const error = capError(maxBytes, bytes.byteLength);
    error.bodyBound = "buffered-fallback";
    throw error;
  }
  return { bytes: bytes.byteLength, text: bytes.toString("utf8"), bodyBound: "buffered-fallback" };
}

export async function fetchJson(urlValue, {
  fetchImpl,
  method = "GET",
  body,
  timeoutMs = CATALOG_TIMEOUT_MS,
  maxBytes = CATALOG_RESPONSE_MAX_BYTES,
} = {}) {
  const url = httpsUrl(urlValue);
  if (!url) throw new Error("catalog endpoint must use HTTPS");
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;
  try {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      redirect: "error",
      signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "SameDayDesk-Discoverability-Audit/1.0",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error && (error.name === "TimeoutError" || error.name === "AbortError" || signal.aborted)) {
      throw new Error("catalog request timed out");
    }
    throw error;
  }
  const status = Number.isInteger(response?.status) ? response.status : null;
  if (status !== null && status >= 300 && status < 400) {
    await cancelUnread(response, "redirect");
    throw new Error("catalog redirect was rejected");
  }
  if (!response?.ok) {
    await cancelUnread(response, "http-error");
    throw new Error(`catalog returned HTTP ${response?.status}`);
  }
  const contentLength = headerValue(response.headers, "content-length");
  let read;
  try {
    read = response.body && typeof response.body.getReader === "function"
      ? await readStream(response, maxBytes, signal)
      : await readBuffered(response, maxBytes);
  } catch (error) {
    if (error && (error.name === "TimeoutError" || error.name === "AbortError" || signal.aborted)) {
      throw new Error("catalog request timed out");
    }
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    throw new Error("catalog response was not valid JSON");
  }
  const completedMs = Date.now();
  return {
    body: parsed,
    transport: {
      plane: "actual-transport",
      method,
      url: url.toString(),
      httpStatus: status,
      bytes: read.bytes,
      bodyBound: read.bodyBound,
      contentLength,
      contentLengthHonored: false,
      elapsedMs: completedMs - startedMs,
      startedAt,
      completedAt: new Date(completedMs).toISOString(),
      timeoutMs,
      maxBytes,
      redirectsFollowed: 0,
    },
  };
  } finally {
    clearTimeout(timer);
  }
}

function targetMatch(item, input) {
  return item.origin === input.origin
    || item.serviceOrigins?.includes(input.origin)
    || item.payTo === input.payTo && input.payTo !== null;
}

function routeMatch(item, route) {
  return item.route === route || item.serviceRoutes?.includes(route);
}

function observedPriceAtomic(priceUsd) {
  if (!Number.isFinite(priceUsd) || priceUsd < 0) return null;
  const atomic = Math.round(priceUsd * 1_000_000);
  return Number.isSafeInteger(atomic) ? String(atomic) : null;
}

function summarizePrice(items, input) {
  if (input.expectedPriceAtomic === null) return null;
  const routeItems = items.filter((item) => targetMatch(item, input) && routeMatch(item, input.route));
  if (!routeItems.length) {
    return {
      status: "route_absent",
      expectedPriceUsd: input.expectedPriceUsd,
      expectedPriceAtomic: input.expectedPriceAtomic,
      observedPricesUsd: [],
      observedPricesAtomic: [],
    };
  }
  const observations = routeItems.flatMap((item) => {
    const atomic = observedPriceAtomic(item.priceUsd);
    return atomic === null ? [] : [{ usd: Number(atomic) / 1_000_000, atomic }];
  });
  const observedPricesAtomic = [...new Set(observations.map((item) => item.atomic))];
  const observedPricesUsd = observedPricesAtomic.map((atomic) => Number(atomic) / 1_000_000);
  if (!observedPricesAtomic.length) {
    return {
      status: "price_unknown",
      expectedPriceUsd: input.expectedPriceUsd,
      expectedPriceAtomic: input.expectedPriceAtomic,
      observedPricesUsd,
      observedPricesAtomic,
    };
  }
  const matches = observedPricesAtomic.includes(input.expectedPriceAtomic);
  const drifts = observedPricesAtomic.some((atomic) => atomic !== input.expectedPriceAtomic);
  return {
    status: matches && drifts ? "mixed" : matches ? "matched" : "drift",
    expectedPriceUsd: input.expectedPriceUsd,
    expectedPriceAtomic: input.expectedPriceAtomic,
    observedPricesUsd,
    observedPricesAtomic,
  };
}

function listingIdentityRecords(source, items, input) {
  return items.flatMap((item, index) => {
    const url = [...new Set([
      item.url,
      ...(item.serviceUrls || []),
      item.origin && item.route ? `${item.origin}${item.route}` : null,
    ].filter(Boolean))].find((candidateUrl) => httpsUrl(candidateUrl)?.pathname === input.route);
    const parsed = httpsUrl(url);
    if (!parsed) return [];
    const record = {
      source,
      url: parsed.toString(),
      ...(item.payTo ? { settlementIdentity: item.payTo } : {}),
      rank: index + 1,
    };
    try {
      evaluateListingIdentity({
        schemaVersion: "agent-payment-policy.listing-identity-observation.v1",
        target: {
          canonicalOrigin: input.origin,
          route: input.route,
          ...(input.payTo ? { settlementIdentity: input.payTo } : {}),
        },
        sources: [source],
        records: [record],
      }, { now: 0 });
      return [record];
    } catch {
      return [];
    }
  }).slice(0, 100);
}

function summarizeIdentity(source, items, input) {
  if (!input.route) return null;
  const report = evaluateListingIdentity({
    schemaVersion: "agent-payment-policy.listing-identity-observation.v1",
    target: {
      canonicalOrigin: input.origin,
      route: input.route,
      ...(input.payTo ? { settlementIdentity: input.payTo } : {}),
    },
    sources: [source],
    records: listingIdentityRecords(source, items, input),
  });
  const observation = report.sources[0];
  return {
    ...observation,
    schemaVersion: report.schemaVersion,
    decision: report.decision,
    identityBasis: "agent-payment-policy@0.8.0",
  };
}

function summarizeSource(source, items, input) {
  const targetRanks = [];
  const expectedRouteRanks = [];
  items.forEach((item, index) => {
    if (!targetMatch(item, input)) return;
    targetRanks.push(index + 1);
    if (!input.route || routeMatch(item, input.route)) expectedRouteRanks.push(index + 1);
  });
  const bestTargetIndex = targetRanks.length ? targetRanks[0] - 1 : null;
  return {
    status: "ok",
    resultCount: items.length,
    targetFound: targetRanks.length > 0,
    targetRanks,
    bestTargetRank: targetRanks[0] ?? null,
    expectedRouteFound: input.route ? expectedRouteRanks.length > 0 : null,
    expectedRouteRanks: input.route ? expectedRouteRanks : [],
    priceObservation: summarizePrice(items, input),
    identityObservation: summarizeIdentity(source, items, input),
    targetResults: items
      .map((item, index) => ({ rank: index + 1, ...item }))
      .filter((item) => targetMatch(item, input))
      .slice(0, 5),
    competitorsAboveTarget: bestTargetIndex === null
      ? items.slice(0, 5).map((item, index) => ({ rank: index + 1, ...item }))
      : items.slice(0, bestTargetIndex).slice(0, 5).map((item, index) => ({ rank: index + 1, ...item })),
    topResults: items.slice(0, 3).map((item, index) => ({ rank: index + 1, ...item })),
  };
}

export async function agentDiscoverabilityAudit(rawInput, {
  fetchImpl = fetch,
  surfaceFetchImpl = fetchPinnedTargetJson,
  paymentPreflightImpl = paymentOfferPreflight,
  coinbaseMaterializationImpl = auditCoinbaseMaterialization,
  limit = 20,
  now = Date.now(),
} = {}) {
  const input = normalizeDiscoverabilityAuditInput(rawInput);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("limit must be an integer from 1 through 20");
  const runtimeOfferAudit = await inspectRuntimeOffer(input, { paymentPreflightImpl, now });
  const livePriceReference = runtimePriceReference(runtimeOfferAudit);
  const priceReference = livePriceReference || (input.expectedPriceAtomic === null ? null : {
    basis: "caller_expected",
    amountAtomic: input.expectedPriceAtomic,
    amountUsd: input.expectedPriceUsd,
    protocols: [],
  });
  const comparisonInput = priceReference
    ? { ...input, expectedPriceAtomic: priceReference.amountAtomic, expectedPriceUsd: priceReference.amountUsd }
    : input;
  const encoded = encodeURIComponent(input.intent);
  const x402JobsQuery = x402JobsLexicalQuery(input);
  const mppscanUrl = new URL(MPPSCAN_SEARCH);
  mppscanUrl.searchParams.set("input", JSON.stringify({ json: { query: input.intent } }));
  const reads = new Map();
  let bazaarRead;
  const readBazaar = () => {
    if (!bazaarRead) bazaarRead = fetchJson(coinbaseSearchUrl(input.intent, limit), { fetchImpl });
    return bazaarRead;
  };
  const calls = {
    "coinbase-bazaar": async () => {
      const read = await readBazaar();
      reads.set("coinbase-bazaar", read);
      return normalizeBazaar(read.body);
    },
    "agent402-router": async () => {
      const read = await fetchJson(AGENT402_ROUTE, {
        fetchImpl,
        method: "POST",
        body: { query: input.intent, top: limit, include: "all" },
      });
      reads.set("agent402-router", read);
      return normalizeAgent402(read.body);
    },
    "circle-marketplace": async () => {
      const read = await fetchJson(`${CIRCLE_SEARCH}?query=${encoded}&limit=${limit}`, { fetchImpl });
      reads.set("circle-marketplace", read);
      return normalizeCircle(read.body);
    },
    "coinbase-agentic-market": async () => {
      const read = await fetchJson(`${AGENTIC_MARKET_SEARCH}?q=${encoded}`, { fetchImpl });
      reads.set("coinbase-agentic-market", read);
      return normalizeAgenticMarket(read.body);
    },
    "agentictrade-catalog": async () => {
      const read = await fetchJson(`${AGENTICTRADE_SEARCH}?q=${encoded}&limit=${limit}`, { fetchImpl });
      reads.set("agentictrade-catalog", read);
      return normalizeAgenticTrade(read.body);
    },
    "official-mpp-catalog": async () => {
      const read = await fetchJson(MPP_CATALOG, { fetchImpl });
      reads.set("official-mpp-catalog", read);
      return normalizeMpp(read.body, input.intent, limit);
    },
    "mppscan-public-search": async () => {
      const read = await fetchJson(mppscanUrl, { fetchImpl });
      reads.set("mppscan-public-search", read);
      return normalizeMppscan(read.body).slice(0, limit);
    },
    "payanagent-public-search": async () => {
      const read = await fetchJson(`${PAYANAGENT_SEARCH}?q=${encoded}&limit=${limit}`, { fetchImpl });
      reads.set("payanagent-public-search", read);
      return normalizePayanAgent(read.body);
    },
    "x402jobs-public-search": async () => {
      const read = await fetchJson(`${X402_JOBS_SEARCH}?search=${encodeURIComponent(x402JobsQuery)}&limit=${limit}&sort=popular`, { fetchImpl });
      reads.set("x402jobs-public-search", read);
      return normalizeX402Jobs(read.body);
    },
    "8004market-public-search": async () => normalizeMarket8004(await searchMarket8004(input.intent, { fetchImpl, limit })),
  };
  const materializationPromise = input.materializationAudit
    ? coinbaseMaterializationImpl(input, { fetchImpl, limit, catalogRead: readBazaar() })
    : Promise.resolve({ requested: false });
  const [settled, coinbaseMaterialization] = await Promise.all([
    Promise.allSettled(SOURCE_ORDER.map((source) => calls[source]())),
    materializationPromise,
  ]);
  const sources = {};
  for (let index = 0; index < SOURCE_ORDER.length; index += 1) {
    const source = SOURCE_ORDER[index];
    const result = settled[index];
    if (result.status !== "fulfilled") {
      sources[source] = { status: "error", error: cleanString(result.reason?.message || "catalog unavailable", 200) };
      continue;
    }
    const summary = summarizeSource(source, result.value, comparisonInput);
    summary.discovery = await discoveryFor(source, reads.get(source) || null, result.value, input);
    summary.coverage = summary.discovery.coverage;
    summary.request = summary.discovery.request;
    summary.requestConstruction = summary.discovery.requestConstruction;
    sources[source] = summary;
  }
  sources["coinbase-bazaar"].materialization = coinbaseMaterialization;
  if (sources["x402jobs-public-search"].status === "ok") {
    sources["x402jobs-public-search"].queryUsed = x402JobsQuery;
    sources["x402jobs-public-search"].queryAdapted = x402JobsQuery !== input.intent.toLowerCase();
  }
  const availableSources = SOURCE_ORDER.filter((source) => sources[source].status === "ok");
  const foundSources = availableSources.filter((source) => sources[source].targetFound);
  const routeFoundSources = input.route
    ? availableSources.filter((source) => sources[source].expectedRouteFound)
    : [];
  const sourceFamilies = [...new Set(SOURCE_ORDER.map((source) => SOURCE_FAMILIES[source]))];
  const availableSourceFamilies = sourceFamilies.filter((family) =>
    SOURCE_ORDER.some((source) => SOURCE_FAMILIES[source] === family && sources[source].status === "ok"));
  const foundSourceFamilies = availableSourceFamilies.filter((family) =>
    SOURCE_ORDER.some((source) => SOURCE_FAMILIES[source] === family && sources[source].status === "ok" && sources[source].targetFound));
  const routeFoundSourceFamilies = input.route
    ? availableSourceFamilies.filter((family) => SOURCE_ORDER.some((source) =>
      SOURCE_FAMILIES[source] === family && sources[source].status === "ok" && sources[source].expectedRouteFound))
    : [];
  const priceObservationSources = priceReference === null
    ? []
    : availableSources.filter((source) => sources[source].priceObservation !== null);
  const matchedPriceSources = priceObservationSources.filter((source) => sources[source].priceObservation.status === "matched");
  const driftedPriceSources = priceObservationSources.filter((source) => ["drift", "mixed"].includes(sources[source].priceObservation.status));
  const unknownPriceSources = priceObservationSources.filter((source) => ["price_unknown", "route_absent"].includes(sources[source].priceObservation.status));
  const identityObservationSources = input.route
    ? availableSources.filter((source) => sources[source].identityObservation !== null)
    : [];
  const identityConflictSources = identityObservationSources.filter((source) =>
    ["alias_collision", "alias_only", "duplicate_records"].includes(sources[source].identityObservation.status));
  const dependentSources = SOURCE_ORDER.filter((source) => DEPENDENT_SOURCES[source]);
  const independentSources = SOURCE_ORDER.filter((source) => !DEPENDENT_SOURCES[source]);
  const findings = [];
  const nextActions = [];
  if (input.runtimeUrl && runtimeOfferAudit.status !== "ok") {
    findings.push({ source: "target-runtime-offer", finding: "runtime_offer_unavailable", code: runtimeOfferAudit.code });
    nextActions.push({ source: "target-runtime-offer", action: "repair_runtime_offer_surface", basis: "The exact target did not return a safely inspectable unsigned payment offer." });
  } else if (input.runtimeUrl && !livePriceReference) {
    findings.push({ source: "target-runtime-offer", finding: "runtime_price_reference_unavailable" });
    nextActions.push({ source: "target-runtime-offer", action: "reconcile_runtime_protocol_terms", basis: "The exact target did not expose one coherent live amount suitable as a catalog comparison reference." });
  }
  if (livePriceReference && input.expectedPriceAtomic !== null && input.expectedPriceAtomic !== livePriceReference.amountAtomic) {
    findings.push({
      source: "target-runtime-offer",
      finding: "caller_expected_price_runtime_drift",
      callerExpectedPriceAtomic: input.expectedPriceAtomic,
      runtimePriceAtomic: livePriceReference.amountAtomic,
    });
  }
  for (const source of SOURCE_ORDER) {
    const observation = sources[source];
    if (source === "coinbase-bazaar" && coinbaseMaterialization.requested) {
      if (coinbaseMaterialization.validator?.eligibility === "provider_reported_not_eligible") {
        findings.push({ source, finding: "exact_route_not_provider_eligible", resource: coinbaseMaterialization.resource, plane: "validator" });
        nextActions.push({
          source,
          action: "repair_seller_provider_eligibility",
          basis: "The Coinbase validator did not report this exact route as eligible. Validator eligibility is its own plane and does not prove the route is absent from the catalog.",
        });
      }
      if (coinbaseMaterialization.state === "unresolved") {
        findings.push({ source, finding: "materialization_state_unresolved" });
      }
    }
    if (observation.status !== "ok") {
      findings.push({ source, finding: "source_unavailable" });
      nextActions.push({ source, action: "rerun_after_source_recovers", basis: "No rank conclusion is valid while the source is unavailable." });
      continue;
    }
    if (observation.coverage && (observation.coverage.countState === "invalid" || observation.coverage.countConflict === true)) {
      findings.push({
        source,
        finding: "count_contract_not_usable",
        countState: observation.coverage.countState,
        declaredReturnedCount: observation.coverage.declaredReturnedCount,
        inspectedCount: observation.coverage.inspectedCount,
        exactTargetCount: observation.coverage.exactTargetCount,
      });
    }
    if (!observation.targetFound) {
      findings.push({
        source,
        finding: "target_not_in_inspected_window",
        catalogPresence: observation.coverage?.catalogPresence || "unknown",
        declaredReturnedCount: observation.coverage?.declaredReturnedCount ?? "unknown",
        inspectedCount: observation.coverage?.inspectedCount ?? "unknown",
        exactTargetCount: observation.coverage?.exactTargetCount ?? "unknown",
      });
      continue;
    }
    if (observation.requestConstruction) {
      findings.push({ source, finding: "exact_target_request_constructible", invoked: false, paid: false });
      nextActions.push({
        source,
        action: "inspect_constructed_request",
        basis: observation.discovery?.nextAction || "A structured request can be read from the supplied schema. Writing it does not invoke or pay.",
        invoked: false,
        paid: false,
      });
    }
    if (input.route && !observation.expectedRouteFound) {
      findings.push({
        source,
        finding: "origin_found_expected_route_absent",
        bestTargetRank: observation.bestTargetRank,
        catalogPresence: "unknown",
      });
      continue;
    }
    if (observation.identityObservation && ["alias_collision", "alias_only", "duplicate_records"].includes(observation.identityObservation.status)) {
      findings.push({
        source,
        finding: "route_listing_identity_conflict",
        status: observation.identityObservation.status,
        exactRouteRecordCount: observation.identityObservation.exactRouteRecordCount,
        canonicalRecordCount: observation.identityObservation.canonicalRecordCount,
        aliasOrigins: observation.identityObservation.aliasOrigins,
      });
      nextActions.push({
        source,
        action: "preserve_canonical_listing_and_reconcile_aliases",
        basis: "The exact route appears through duplicate records or a non-canonical origin matched by caller-supplied identity evidence. Preserve the durable canonical record, independently prove an alias is stale before retiring it, and update metadata in place.",
      });
    }
    if (priceReference !== null && observation.priceObservation.status === "drift") {
      findings.push({
        source,
        finding: "expected_route_price_drift",
        expectedPriceAtomic: priceReference.amountAtomic,
        observedPricesAtomic: observation.priceObservation.observedPricesAtomic,
      });
      nextActions.push({
        source,
        action: "reconcile_stale_catalog_price",
        basis: "Verify the seller's live unsigned payment terms first. If owned x402, MPP, OpenAPI, and manifest terms agree and this catalog documents settlement-triggered materialization, use at most one bounded owner canary, then hand propagation to event-driven monitoring.",
      });
    } else if (priceReference !== null && observation.priceObservation.status === "mixed") {
      findings.push({
        source,
        finding: "mixed_current_and_stale_route_prices",
        expectedPriceAtomic: priceReference.amountAtomic,
        observedPricesAtomic: observation.priceObservation.observedPricesAtomic,
      });
      nextActions.push({
        source,
        action: "deduplicate_or_reconcile_route_price_records",
        basis: "The catalog exposes both the caller-expected price and at least one conflicting price for the same route. Preserve the current record and reconcile stale duplicates without repeated owner traffic.",
      });
    } else if (priceReference !== null && observation.priceObservation.status === "price_unknown") {
      findings.push({ source, finding: "expected_route_price_unavailable" });
      nextActions.push({
        source,
        action: "inspect_source_price_contract",
        basis: "The expected route is present but this discovery view did not expose a parseable exact price.",
      });
    }
    const band = observation.bestTargetRank <= 3 ? "top_3" : observation.bestTargetRank <= 10 ? "top_10" : "below_top_10";
    findings.push({ source, finding: "target_ranked", bestTargetRank: observation.bestTargetRank, band });
    if (observation.bestTargetRank > 3) {
      nextActions.push({ source, action: "compare_task_outcome_language_with_competitors_above", basis: `${observation.bestTargetRank - 1} ranked result(s) appeared above the target for this intent.` });
    }
  }
  const targetSurfaces = input.surfaceAudit
    ? await auditTargetDiscoverySurfaces(input, { surfaceFetchImpl })
    : { requested: false, reason: "Set surfaceAudit=true to inspect the target's public Agent Card, registration document, and action catalog." };
  if (input.surfaceAudit && targetSurfaces.availableSurfaceCount === 0) {
    findings.push({ source: "target-owned-discovery-surfaces", finding: "owned_surfaces_unavailable" });
    nextActions.push({
      source: "target-owned-discovery-surfaces",
      action: "verify_public_dns_and_machine_document_availability",
      basis: "None of the three fixed seller-owned machine-discovery documents could be read safely.",
    });
  } else if (input.surfaceAudit && input.route && targetSurfaces.expectedRouteFoundSurfaceCount < targetSurfaces.availableSurfaceCount) {
    findings.push({
      source: "target-owned-discovery-surfaces",
      finding: "expected_route_missing_from_one_or_more_owned_surfaces",
      foundSurfaceCount: targetSurfaces.expectedRouteFoundSurfaceCount,
      availableSurfaceCount: targetSurfaces.availableSurfaceCount,
    });
    nextActions.push({
      source: "target-owned-discovery-surfaces",
      action: "synchronize_agent_card_registration_and_action_catalog",
      basis: "A reachable expected route is missing from one or more available seller-owned machine-discovery documents.",
    });
  }
  return {
    ok: true,
    product: "samedaydesk-agent-discoverability-audit",
    version: DISCOVERABILITY_AUDIT_VERSION,
    discoveryInterpretation: discoveryPackage(),
    generatedAt: new Date(now).toISOString(),
    input: {
      origin: input.origin,
      intent: input.intent,
      route: input.route,
      runtimeUrl: input.runtimeUrl,
      payTo: input.payTo,
      surfaceAudit: input.surfaceAudit,
      materializationAudit: input.materializationAudit,
      method: input.method,
      expectedPriceUsd: input.expectedPriceUsd,
      expectedPriceAtomic: input.expectedPriceAtomic,
      brandBlind: true,
    },
    summary: {
      sourceCount: SOURCE_ORDER.length,
      availableSourceCount: availableSources.length,
      targetFoundSourceCount: foundSources.length,
      expectedRouteFoundSourceCount: input.route ? routeFoundSources.length : null,
      topThreeSourceCount: foundSources.filter((source) => sources[source].bestTargetRank <= 3).length,
      topTenSourceCount: foundSources.filter((source) => sources[source].bestTargetRank <= 10).length,
      foundSources,
      missingSources: availableSources.filter((source) => !sources[source].targetFound),
      unavailableSources: SOURCE_ORDER.filter((source) => sources[source].status !== "ok"),
      sourceFamilyCount: sourceFamilies.length,
      availableSourceFamilyCount: availableSourceFamilies.length,
      targetFoundSourceFamilyCount: foundSourceFamilies.length,
      expectedRouteFoundSourceFamilyCount: input.route ? routeFoundSourceFamilies.length : null,
      priceReference,
      priceObservationSourceCount: priceReference === null ? null : priceObservationSources.length,
      matchedPriceSourceCount: priceReference === null ? null : matchedPriceSources.length,
      driftedPriceSourceCount: priceReference === null ? null : driftedPriceSources.length,
      unknownPriceSourceCount: priceReference === null ? null : unknownPriceSources.length,
      matchedPriceSources: priceReference === null ? [] : matchedPriceSources,
      driftedPriceSources: priceReference === null ? [] : driftedPriceSources,
      unknownPriceSources: priceReference === null ? [] : unknownPriceSources,
      identityObservationSourceCount: input.route ? identityObservationSources.length : null,
      identityConflictSourceCount: input.route ? identityConflictSources.length : null,
      identityConflictSources: input.route ? identityConflictSources : [],
      foundSourceFamilies,
      missingSourceFamilies: availableSourceFamilies.filter((family) => !foundSourceFamilies.includes(family)),
      unavailableSourceFamilies: sourceFamilies.filter((family) => !availableSourceFamilies.includes(family)),
      dependentSources,
      independentTargetFoundSourceCount: independentSources.filter((source) => sources[source].status === "ok" && sources[source].targetFound).length,
      coinbaseMaterializationState: coinbaseMaterialization.requested ? coinbaseMaterialization.state : null,
    },
    sources,
    runtimeOfferAudit,
    targetSurfaces,
    findings,
    nextActions,
    method: "The capability intent is sent without the target origin or payTo. Registry order is preserved for Bazaar, Agentic Market, Agent402, Circle, AgenticTrade, MPPScan, PayanAgent, x402.jobs, and 8004Market public search. Coinbase Bazaar and Agentic Market are two views in one source family and are not counted as independent reach. PayanAgent aggregates ecosystem supply, including Coinbase-origin records, so it is labeled dependent rather than treated as independent underlying supply. x402.jobs is a directly registerable resource and workflow market whose search order and zero-or-positive call and value metrics remain point-in-time observations, not proof of independent demand. 8004Market is a search view over Solana Agent Registry identities, so it is also dependency-labeled and its retrieval is identity propagation rather than buyer demand. Official MPP exposes a flat catalog, so its order is a declared local lexical rank over official metadata. For an exact route, every source also reports whether the matched records are canonical, duplicated, alias-only, or collide across canonical and non-canonical origins. A non-canonical record becomes an alias candidate only when it matches the caller-supplied payTo and exact route; that links advertised settlement identity but does not prove hostname ownership. When runtimeUrl is supplied, one same-origin, exact-route, credentials-free headers-only request derives the comparison amount only from a parseable coherent live offer. Otherwise an optional caller-supplied expected price remains clearly labeled as caller expected. When explicitly requested, the target-surface check reads only three fixed same-origin public JSON documents after payment. Response version 1.13.0 keeps the withdrawal of provider_accepted_not_materialized and the reindex action. Validator eligibility is provider_reported_eligible only when valid is boolean true and simulation.outcome is accepted, and provider_reported_not_eligible only when valid is boolean false and simulation.outcome is rejected. Any other successful validator body stays unknown and does not propose a repair. A provider total or an unrecognized count is not a returned count. The catalog read is one supported task-search window. A missing exact target in that window is unknown catalog presence for the query, not proof the route is unlisted.",
    sourceDependencies: DEPENDENT_SOURCES,
    safety: {
      credentialsUsed: false,
      paymentSignedToCatalogs: false,
      paymentSentToCatalogs: false,
      runtimeCredentialUsed: runtimeOfferAudit?.boundary?.credentialsUsed ?? false,
      runtimePaymentSigned: runtimeOfferAudit?.boundary?.paymentSigned ?? false,
      runtimePaymentSent: runtimeOfferAudit?.boundary?.paymentSent ?? false,
      runtimeResponseBodyRead: runtimeOfferAudit?.boundary?.responseBodyRead ?? false,
      targetOriginFetchAttempted: input.surfaceAudit,
      targetOriginFetched: input.surfaceAudit && targetSurfaces.availableSurfaceCount > 0,
      targetOriginFetchScope: input.surfaceAudit ? Object.values(TARGET_SURFACES) : [],
      providerValidationRequested: input.materializationAudit,
      providerCredentialUsed: false,
      providerPaymentSigned: false,
      providerPaymentSent: false,
      providerMayRequestTarget: input.materializationAudit,
      redirectsFollowed: false,
    },
    boundary: livePriceReference
      ? "This is a point-in-time discovery observation, not demand, conversion, reliability, or future-rank evidence. A runtime-derived price comparison uses one unsigned canonical Base-USDC headers-only offer and still does not establish seller trust, settlement reliability, or future terms. Every purchase must preflight again before authorization."
      : input.expectedPriceAtomic !== null
        ? "This is a point-in-time discovery observation, not demand, conversion, reliability, or future-rank evidence. Price comparisons use the caller-supplied expectation rather than runtime truth. Every purchase must preflight again before authorization."
        : "This is a point-in-time discovery observation, not demand, conversion, reliability, or future-rank evidence. No exact price reference was supplied or safely derived. Every purchase must preflight again before authorization.",
  };
}
