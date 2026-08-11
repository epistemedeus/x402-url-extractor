const BAZAAR_SEARCH = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search";
const AGENT402_ROUTE = "https://agent402.tools/api/route";
const CIRCLE_SEARCH = "https://api.circle.com/v2/x402/discovery/resources";
const AGENTIC_MARKET_SEARCH = "https://api.agentic.market/v1/services/search";
const AGENTICTRADE_SEARCH = "https://agentictrade.io/api/v1/discover";
const MPP_CATALOG = "https://mpp.dev/api/services";
const MPPSCAN_SEARCH = "https://www.mppscan.com/api/trpc/discover.search";
const PAYANAGENT_SEARCH = "https://payanagent.com/api/v1/discover";

const SOURCE_ORDER = [
  "coinbase-bazaar",
  "coinbase-agentic-market",
  "agent402-router",
  "circle-marketplace",
  "agentictrade-catalog",
  "official-mpp-catalog",
  "mppscan-public-search",
  "payanagent-public-search",
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
});
const DEPENDENT_SOURCES = Object.freeze({
  "payanagent-public-search": "Aggregates ecosystem supply, including Coinbase-origin records; retrieval is a distinct buyer surface but not independent underlying supply.",
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
  return {
    origin: originUrl.origin,
    hostname: originUrl.hostname.toLowerCase(),
    intent,
    route: expectedRoute,
    payTo,
  };
}

function decimalPrice(accepts) {
  const offer = Array.isArray(accepts) ? accepts.find((item) => /^\d+$/.test(String(item?.amount || ""))) : null;
  if (!offer) return null;
  const decimals = Number.isInteger(Number(offer.extra?.decimals)) ? Number(offer.extra.decimals) : 6;
  const value = Number(offer.amount) / (10 ** decimals);
  return Number.isFinite(value) ? value : null;
}

function candidate({ name, url, origin, route, description, priceUsd, score, payTo }) {
  const safeUrl = httpsUrl(url)?.toString() || null;
  const safeOrigin = httpsUrl(origin)?.origin || (safeUrl ? new URL(safeUrl).origin : null);
  return {
    name: cleanString(name, 200),
    url: safeUrl,
    origin: safeOrigin,
    route: cleanString(route, 200) || (safeUrl ? new URL(safeUrl).pathname : null),
    description: cleanString(description, 500),
    priceUsd: priceUsd !== null && priceUsd !== undefined && Number.isFinite(Number(priceUsd)) ? Number(priceUsd) : null,
    score: score !== null && score !== undefined && Number.isFinite(Number(score)) ? Number(score) : null,
    payTo: /^0x[0-9a-f]{40}$/i.test(String(payTo || "")) ? String(payTo).toLowerCase() : null,
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

function tokens(value) {
  return new Set(String(value || "").toLowerCase().match(/[a-z0-9]{2,}/g) || []);
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
  return item.origin === input.origin || item.payTo === input.payTo && input.payTo !== null;
}

function summarizeSource(items, input) {
  const targetRanks = [];
  const expectedRouteRanks = [];
  items.forEach((item, index) => {
    if (!targetMatch(item, input)) return;
    targetRanks.push(index + 1);
    if (!input.route || item.route === input.route) expectedRouteRanks.push(index + 1);
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
  limit = 20,
  now = Date.now(),
} = {}) {
  const input = normalizeDiscoverabilityAuditInput(rawInput);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("limit must be an integer from 1 through 20");
  const encoded = encodeURIComponent(input.intent);
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
  };
  const settled = await Promise.allSettled(SOURCE_ORDER.map((source) => calls[source]()));
  const sources = {};
  SOURCE_ORDER.forEach((source, index) => {
    const result = settled[index];
    sources[source] = result.status === "fulfilled"
      ? summarizeSource(result.value, input)
      : { status: "error", error: cleanString(result.reason?.message || "catalog unavailable", 200) };
  });
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
  const dependentSources = SOURCE_ORDER.filter((source) => DEPENDENT_SOURCES[source]);
  const independentSources = SOURCE_ORDER.filter((source) => !DEPENDENT_SOURCES[source]);
  const findings = [];
  const nextActions = [];
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
    const band = observation.bestTargetRank <= 3 ? "top_3" : observation.bestTargetRank <= 10 ? "top_10" : "below_top_10";
    findings.push({ source, finding: "target_ranked", bestTargetRank: observation.bestTargetRank, band });
    if (observation.bestTargetRank > 3) {
      nextActions.push({ source, action: "compare_task_outcome_language_with_competitors_above", basis: `${observation.bestTargetRank - 1} ranked result(s) appeared above the target for this intent.` });
    }
  }
  return {
    ok: true,
    product: "samedaydesk-agent-discoverability-audit",
    version: "1.4.0",
    generatedAt: new Date(now).toISOString(),
    input: {
      origin: input.origin,
      intent: input.intent,
      route: input.route,
      payTo: input.payTo,
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
      foundSourceFamilies,
      missingSourceFamilies: availableSourceFamilies.filter((family) => !foundSourceFamilies.includes(family)),
      unavailableSourceFamilies: sourceFamilies.filter((family) => !availableSourceFamilies.includes(family)),
      dependentSources,
      independentTargetFoundSourceCount: independentSources.filter((source) => sources[source].status === "ok" && sources[source].targetFound).length,
    },
    sources,
    findings,
    nextActions,
    method: "The capability intent is sent without the target origin or payTo. Registry order is preserved for Bazaar, Agentic Market, Agent402, Circle, AgenticTrade, MPPScan, and PayanAgent public search. Coinbase Bazaar and Agentic Market are two views in one source family and are not counted as independent reach. PayanAgent is a distinct buyer-facing retrieval surface but aggregates ecosystem supply, including Coinbase-origin records, so it is labeled dependent rather than treated as independent underlying supply. AgenticTrade, MPPScan, and PayanAgent use their public text-search order. Official MPP exposes a flat catalog, so its order is a declared local lexical rank over official metadata.",
    sourceDependencies: DEPENDENT_SOURCES,
    safety: {
      credentialsUsed: false,
      paymentSignedToCatalogs: false,
      paymentSentToCatalogs: false,
      targetOriginFetched: false,
      redirectsFollowed: false,
    },
    boundary: "This is a point-in-time discovery observation, not demand, conversion, reliability, or future-rank evidence. Runtime payment terms must still be preflighted before purchase.",
  };
}
