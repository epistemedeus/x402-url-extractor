import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

import {
  PaymentOfferPreflightError,
  createPinnedLookup,
  normalizePaymentTarget,
  paymentOfferPreflight,
  resolvePublicAddress,
} from "./payment-offer-preflight.mjs";
import { searchMarket8004 } from "./market8004-discovery.mjs";

const BAZAAR_SEARCH = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search";
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
    expectedPriceUsd,
    expectedPriceAtomic,
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

const X402_JOBS_GENERIC_ROUTE_TERMS = new Set(["api", "v0", "v1", "defi", "commerce", "distribution", "work"]);
const X402_JOBS_STOP_TERMS = new Set(["the", "and", "for", "from", "into", "with", "without", "one", "https"]);

function x402JobsLexicalQuery(input) {
  const routeTerms = [...tokens(input.route)].filter((term) => !X402_JOBS_GENERIC_ROUTE_TERMS.has(term));
  const intentTerms = [...tokens(input.intent)].filter((term) => !X402_JOBS_STOP_TERMS.has(term));
  const selected = [];
  for (const term of routeTerms) {
    if (!selected.includes(term)) selected.push(term);
    if (selected.length === 2) break;
  }
  for (const term of intentTerms) {
    if (!selected.includes(term)) selected.push(term);
    if (selected.length === 2) break;
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

async function fetchJson(urlValue, { fetchImpl, method = "GET", body } = {}) {
  const url = httpsUrl(urlValue);
  if (!url) throw new Error("catalog endpoint must use HTTPS");
  const response = await fetchImpl(url, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "SameDayDesk-Discoverability-Audit/1.0",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response?.ok) throw new Error(`catalog returned HTTP ${response?.status}`);
  const text = await response.text();
  if (text.length > 10_000_000) throw new Error("catalog response exceeded 10 MB");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("catalog response was not valid JSON");
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

function summarizeIdentity(items, input) {
  if (!input.route) return null;
  const routeItems = items.filter((item) => targetMatch(item, input) && routeMatch(item, input.route));
  const canonicalRecords = routeItems.filter((item) => item.origin === input.origin);
  const aliasOrigins = [...new Set(routeItems
    .map((item) => item.origin)
    .filter((origin) => origin && origin !== input.origin))].sort();
  let status = "canonical";
  if (!routeItems.length) status = "route_absent";
  else if (routeItems.length > 1) status = aliasOrigins.length ? "alias_collision" : "duplicate_records";
  else if (!canonicalRecords.length && aliasOrigins.length) status = "alias_only";
  return {
    status,
    exactRouteRecordCount: routeItems.length,
    canonicalRecordCount: canonicalRecords.length,
    aliasOrigins,
    identityBasis: "canonical_origin_or_caller_payto_match",
    ownershipProven: aliasOrigins.length === 0,
    evidenceBoundary: aliasOrigins.length
      ? "A non-canonical record matched the caller-supplied payTo and exact route. This links advertised settlement identity but does not prove hostname ownership."
      : "Canonical status means the observed record uses the caller-supplied origin; it does not prove marketplace ownership or control.",
  };
}

function summarizeSource(items, input) {
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
    identityObservation: summarizeIdentity(items, input),
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
  const calls = {
    "coinbase-bazaar": async () => normalizeBazaar(await fetchJson(`${BAZAAR_SEARCH}?query=${encoded}&limit=${limit}`, { fetchImpl })),
    "agent402-router": async () => normalizeAgent402(await fetchJson(AGENT402_ROUTE, {
      fetchImpl,
      method: "POST",
      body: { query: input.intent, top: limit, include: "all" },
    })),
    "circle-marketplace": async () => normalizeCircle(await fetchJson(`${CIRCLE_SEARCH}?query=${encoded}&limit=${limit}`, { fetchImpl })),
    "coinbase-agentic-market": async () => normalizeAgenticMarket(await fetchJson(`${AGENTIC_MARKET_SEARCH}?q=${encoded}`, { fetchImpl })),
    "agentictrade-catalog": async () => normalizeAgenticTrade(await fetchJson(`${AGENTICTRADE_SEARCH}?q=${encoded}&limit=${limit}`, { fetchImpl })),
    "official-mpp-catalog": async () => normalizeMpp(await fetchJson(MPP_CATALOG, { fetchImpl }), input.intent, limit),
    "mppscan-public-search": async () => normalizeMppscan(await fetchJson(mppscanUrl, { fetchImpl })).slice(0, limit),
    "payanagent-public-search": async () => normalizePayanAgent(await fetchJson(`${PAYANAGENT_SEARCH}?q=${encoded}&limit=${limit}`, { fetchImpl })),
    "x402jobs-public-search": async () => normalizeX402Jobs(await fetchJson(`${X402_JOBS_SEARCH}?search=${encodeURIComponent(x402JobsQuery)}&limit=${limit}&sort=popular`, { fetchImpl })),
    "8004market-public-search": async () => normalizeMarket8004(await searchMarket8004(input.intent, { fetchImpl, limit })),
  };
  const settled = await Promise.allSettled(SOURCE_ORDER.map((source) => calls[source]()));
  const sources = {};
  SOURCE_ORDER.forEach((source, index) => {
    const result = settled[index];
    sources[source] = result.status === "fulfilled"
      ? summarizeSource(result.value, comparisonInput)
      : { status: "error", error: cleanString(result.reason?.message || "catalog unavailable", 200) };
  });
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
    if (observation.status !== "ok") {
      findings.push({ source, finding: "source_unavailable" });
      nextActions.push({ source, action: "rerun_after_source_recovers", basis: "No rank conclusion is valid while the source is unavailable." });
      continue;
    }
    if (!observation.targetFound) {
      findings.push({ source, finding: "target_absent_from_ranked_results" });
      nextActions.push({ source, action: "verify_listing_then_refresh_task_outcome_metadata", basis: "The target did not appear in the first ranked result window for this exact brand-blind intent." });
      continue;
    }
    if (input.route && !observation.expectedRouteFound) {
      findings.push({ source, finding: "origin_found_expected_route_absent", bestTargetRank: observation.bestTargetRank });
      nextActions.push({ source, action: "index_or_reconcile_expected_route", basis: "The seller appeared, but the requested route did not." });
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
    version: "1.10.0",
    generatedAt: new Date(now).toISOString(),
    input: {
      origin: input.origin,
      intent: input.intent,
      route: input.route,
      runtimeUrl: input.runtimeUrl,
      payTo: input.payTo,
      surfaceAudit: input.surfaceAudit,
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
    },
    sources,
    runtimeOfferAudit,
    targetSurfaces,
    findings,
    nextActions,
    method: "The capability intent is sent without the target origin or payTo. Registry order is preserved for Bazaar, Agentic Market, Agent402, Circle, AgenticTrade, MPPScan, PayanAgent, x402.jobs, and 8004Market public search. Coinbase Bazaar and Agentic Market are two views in one source family and are not counted as independent reach. PayanAgent aggregates ecosystem supply, including Coinbase-origin records, so it is labeled dependent rather than treated as independent underlying supply. x402.jobs is a directly registerable resource and workflow market whose search order and zero-or-positive call and value metrics remain point-in-time observations, not proof of independent demand. 8004Market is a search view over Solana Agent Registry identities, so it is also dependency-labeled and its retrieval is identity propagation rather than buyer demand. Official MPP exposes a flat catalog, so its order is a declared local lexical rank over official metadata. For an exact route, every source also reports whether the matched records are canonical, duplicated, alias-only, or collide across canonical and non-canonical origins. A non-canonical record becomes an alias candidate only when it matches the caller-supplied payTo and exact route; that links advertised settlement identity but does not prove hostname ownership. When runtimeUrl is supplied, one same-origin, exact-route, credentials-free headers-only request derives the comparison amount only from a parseable coherent live offer. Otherwise an optional caller-supplied expected price remains clearly labeled as caller expected. When explicitly requested, the target-surface check reads only three fixed same-origin public JSON documents after payment.",
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
      redirectsFollowed: false,
    },
    boundary: livePriceReference
      ? "This is a point-in-time discovery observation, not demand, conversion, reliability, or future-rank evidence. A runtime-derived price comparison uses one unsigned canonical Base-USDC headers-only offer and still does not establish seller trust, settlement reliability, or future terms. Every purchase must preflight again before authorization."
      : input.expectedPriceAtomic !== null
        ? "This is a point-in-time discovery observation, not demand, conversion, reliability, or future-rank evidence. Price comparisons use the caller-supplied expectation rather than runtime truth. Every purchase must preflight again before authorization."
        : "This is a point-in-time discovery observation, not demand, conversion, reliability, or future-rank evidence. No exact price reference was supplied or safely derived. Every purchase must preflight again before authorization.",
  };
}
