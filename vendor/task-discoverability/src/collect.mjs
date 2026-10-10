import { FROZEN_QUERY, SOURCE } from "./pins.mjs";

const SEARCH_KEYS = ["type", "payTo", "scheme", "network", "extensions"];

export function buildSearchUrl(params, base = SOURCE.searchUrl) {
  if (base !== SOURCE.searchUrl) {
    const error = new Error("unverified-search-route");
    error.code = "unverified-search-route";
    throw error;
  }
  if (!params || typeof params.query !== "string" || params.query.length === 0) {
    const error = new Error("query-required");
    error.code = "query-required";
    throw error;
  }
  const query = new URLSearchParams();
  query.set("query", params.query);
  for (const key of SEARCH_KEYS) {
    if (params[key] !== undefined && params[key] !== null) query.set(key, String(params[key]));
  }
  if (params.limit !== undefined && params.limit !== null) query.set("limit", String(params.limit));
  if (params.cursor !== undefined && params.cursor !== null) query.set("cursor", String(params.cursor));
  return `${base}?${query.toString()}`;
}

export function frozenSearchUrl() {
  return buildSearchUrl({ query: FROZEN_QUERY, type: "http", limit: 20 });
}

export function collectSearch(params, options = {}) {
  const url = buildSearchUrl(params, options.baseUrl);
  if (options.allowLive !== true) {
    return {
      state: "refused",
      reason: "live-query-not-requested",
      networkSent: false,
      method: "GET",
      url,
      credentialSent: false,
    };
  }
  if (typeof options.fetchImpl !== "function") {
    return {
      state: "unavailable",
      reason: "fetch-not-supplied",
      networkSent: false,
      method: "GET",
      url,
      credentialSent: false,
    };
  }
  return options.fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: options.signal,
  });
}
