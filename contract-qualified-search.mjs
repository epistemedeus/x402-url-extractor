import { createHash } from "node:crypto";
import { auditOrigin } from "agent-payment-integrity";

const AGENT402_ROUTE_URL = "https://agent402.tools/api/route";
const MPP_SERVICES_URL = "https://mpp.dev/api/services";
const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/;
const UNRESOLVED_ROUTE = /(?:^|\/)\:[A-Za-z][A-Za-z0-9_]*|\{[^}]+\}/;
const REQUIRED_PATH = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,7}$/;
const SECRET_VALUE = /(?:api[_ -]?key|password|secret|access[_ -]?token|authorization)\s*[:=]\s*\S+/i;

export class ContractQualifiedSearchError extends Error {
  constructor(message, { code = "invalid_request", statusCode = 400 } = {}) {
    super(message);
    this.name = "ContractQualifiedSearchError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function publicText(value, maximum = 500) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text ? text.slice(0, maximum) : null;
}

function exactHttps(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function decimal(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : NaN;
}

function integer(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) ? number : NaN;
}

function requiredPaths(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(",").filter(Boolean);
  const paths = [...new Set(raw.map((path) => String(path).trim()))].sort();
  if (!paths.length || paths.length > 16 || paths.some((path) => !REQUIRED_PATH.test(path))) {
    throw new ContractQualifiedSearchError("requiredPaths must contain 1 to 16 safe dotted JSON paths");
  }
  return paths;
}

export function normalizeContractQualifiedSearchInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ContractQualifiedSearchError("input must be an object");
  }
  const allowed = new Set(["query", "requiredPaths", "maxPriceDisplayUnits", "limit"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key)).sort();
  if (unknown.length) throw new ContractQualifiedSearchError(`unsupported input field: ${unknown[0]}`);
  const query = String(input.query || "").replace(/\s+/g, " ").trim();
  if (query.length < 10 || query.length > 300) {
    throw new ContractQualifiedSearchError("query must contain 10 to 300 characters");
  }
  if (SECRET_VALUE.test(query) || /\b0x[0-9a-fA-F]{64}\b/.test(query)) {
    throw new ContractQualifiedSearchError("query appears to contain a credential or private key");
  }
  const maxPriceDisplayUnits = decimal(input.maxPriceDisplayUnits, 0.1);
  if (!(maxPriceDisplayUnits > 0 && maxPriceDisplayUnits <= 10)) {
    throw new ContractQualifiedSearchError("maxPriceDisplayUnits must be greater than 0 and at most 10");
  }
  const limit = integer(input.limit, 5);
  if (!(limit >= 1 && limit <= 8)) {
    throw new ContractQualifiedSearchError("limit must be an integer from 1 to 8");
  }
  return Object.freeze({
    query,
    requiredPaths: Object.freeze(requiredPaths(input.requiredPaths)),
    maxPriceDisplayUnits,
    limit,
  });
}

async function fetchJson(url, init, { fetchImpl, label }) {
  const response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(8_000) });
  if (!response?.ok) throw new Error(`${label} returned HTTP ${response?.status}`);
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 2_000_000) throw new Error(`${label} response is too large`);
  const text = typeof response.text === "function"
    ? await response.text()
    : JSON.stringify(await response.json());
  if (Buffer.byteLength(text, "utf8") > 2_000_000) throw new Error(`${label} response is too large`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
}

function tokens(value) {
  return new Set(String(value || "").toLowerCase().match(/[a-z0-9]{2,}/g) || []);
}

function semanticScore(query, ...values) {
  const wanted = tokens(query);
  const available = tokens(values.join(" "));
  let score = 0;
  for (const token of wanted) if (available.has(token)) score += 1;
  return score;
}

function normalizeAgent402(payload, request, excludedOrigins) {
  if (!Array.isArray(payload?.results)) throw new Error("Agent402 response is missing results");
  return payload.results.flatMap((item) => {
    const origin = exactHttps(item?.seller);
    const target = exactHttps(item?.url);
    const method = publicText(item?.method, 12)?.toUpperCase();
    const route = publicText(item?.route, 1_000);
    const price = decimal(item?.priceUsd ?? item?.price, NaN);
    if (!origin || origin.pathname !== "/" || origin.search || excludedOrigins.has(origin.origin) || !target || target.origin !== origin.origin) return [];
    if (!["GET", "POST"].includes(method) || !SAFE_PATH.test(route || "") || UNRESOLVED_ROUTE.test(route) || target.pathname !== route || target.search) return [];
    if (item?.payable !== "x402" || !(price > 0 && price <= request.maxPriceDisplayUnits)) return [];
    return [{
      source: "agent402",
      serviceName: publicText(item?.sellerName, 120) || origin.hostname,
      description: publicText(item?.description || item?.name, 500) || "",
      origin: origin.origin,
      method,
      route,
      price: { amountDisplayUnits: price, currency: "USD", decimals: 6, amountAtomic: String(Math.round(price * 1_000_000)) },
      sourceScore: Number.isFinite(Number(item?.score)) ? Number(item.score) : 0,
      openApiPath: "/openapi.json",
    }];
  });
}

function normalizeMpp(payload, request, excludedOrigins) {
  if (!Array.isArray(payload?.services)) throw new Error("MPP response is missing services");
  const candidates = [];
  for (const service of payload.services) {
    if (service?.status !== "active") continue;
    const serviceUrl = exactHttps(service?.serviceUrl);
    if (!serviceUrl || excludedOrigins.has(serviceUrl.origin)) continue;
    const origin = serviceUrl.origin;
    const apiReference = exactHttps(service?.docs?.apiReference);
    const openApiPath = apiReference?.origin === origin && !apiReference.search ? apiReference.pathname : "/openapi.json";
    for (const endpoint of Array.isArray(service?.endpoints) ? service.endpoints : []) {
      const method = publicText(endpoint?.method, 12)?.toUpperCase();
      const route = publicText(endpoint?.path, 1_000);
      const payment = endpoint?.payment;
      const amount = String(payment?.amount ?? "");
      const decimals = integer(payment?.decimals, NaN);
      if (method !== "GET" || !SAFE_PATH.test(route || "") || UNRESOLVED_ROUTE.test(route) || !/^\d+$/.test(amount) || !(decimals >= 0 && decimals <= 30)) continue;
      const amountDisplayUnits = Number(amount) / (10 ** decimals);
      if (!(amountDisplayUnits > 0 && amountDisplayUnits <= request.maxPriceDisplayUnits)) continue;
      const score = semanticScore(request.query, service?.name, service?.description, endpoint?.description, ...(service?.tags || []), ...(service?.categories || []), route);
      if (!score) continue;
      candidates.push({
        source: "mpp",
        serviceName: publicText(service?.name, 120) || serviceUrl.hostname,
        description: publicText(endpoint?.description || service?.description, 500) || "",
        origin,
        method,
        route,
        price: { amountDisplayUnits, currency: publicText(payment?.currency, 200) || "unknown", decimals, amountAtomic: amount },
        sourceScore: score,
        openApiPath,
      });
    }
  }
  return candidates;
}

function uniqueRanked(candidates) {
  const seen = new Set();
  return candidates
    .sort((left, right) => right.sourceScore - left.sourceScore || left.price.amountDisplayUnits - right.price.amountDisplayUnits || `${left.origin}${left.route}`.localeCompare(`${right.origin}${right.route}`))
    .filter((candidate) => {
      const key = `${candidate.method} ${candidate.origin}${candidate.route}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function safeFailure(error) {
  const message = String(error?.message || error);
  if (/not declared/.test(message)) return "exact_route_not_declared";
  if (/document returned HTTP|document did not return JSON/.test(message)) return "openapi_unavailable";
  if (/route count exceeds/.test(message)) return "route_ceiling_exceeded";
  return "bounded_audit_failure";
}

function publicCandidate(candidate, routeReport, decision) {
  return {
    source: candidate.source,
    serviceName: candidate.serviceName,
    description: candidate.description,
    origin: candidate.origin,
    method: candidate.method,
    route: candidate.route,
    price: candidate.price,
    decision,
    protocols: Array.isArray(routeReport?.protocols) ? routeReport.protocols.slice(0, 4) : [],
    runtimeChallengeVerified: routeReport?.runtimeChallengeVerified === true,
    guaranteedPaths: Array.isArray(routeReport?.responseContract?.guaranteedPaths)
      ? routeReport.responseContract.guaranteedPaths.slice(0, 16)
      : [],
  };
}

export async function contractQualifiedSearch(input, {
  fetchImpl = fetch,
  auditImpl = auditOrigin,
  now = () => new Date(),
  agent402Url = AGENT402_ROUTE_URL,
  mppUrl = MPP_SERVICES_URL,
  excludedOrigins = ["https://agents.samedaydesk.com"],
} = {}) {
  const request = normalizeContractQualifiedSearchInput(input);
  const queryDigest = `sha256:${createHash("sha256").update(request.query).digest("hex")}`;
  const sourceCalls = [
    ["agent402", async () => normalizeAgent402(await fetchJson(agent402Url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": "SameDayDesk-Contract-Qualified-Search/1.0" },
      body: JSON.stringify({ query: request.query, top: request.limit, include: "external" }),
    }, { fetchImpl, label: "Agent402" }), request, new Set(excludedOrigins))],
    ["mpp", async () => normalizeMpp(await fetchJson(mppUrl, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": "SameDayDesk-Contract-Qualified-Search/1.0" },
    }, { fetchImpl, label: "MPP" }), request, new Set(excludedOrigins))],
  ];
  const settled = await Promise.allSettled(sourceCalls.map(([, call]) => call()));
  const sources = {};
  const sourceCandidates = {};
  for (let index = 0; index < sourceCalls.length; index += 1) {
    const name = sourceCalls[index][0];
    const result = settled[index];
    if (result.status === "rejected") {
      sources[name] = { status: "unavailable", discovered: 0, audited: 0 };
      sourceCandidates[name] = [];
    } else {
      const candidates = uniqueRanked(result.value).slice(0, request.limit);
      sources[name] = { status: "ok", discovered: result.value.length, audited: 0 };
      sourceCandidates[name] = candidates;
    }
  }
  const queue = [];
  for (let index = 0; queue.length < request.limit; index += 1) {
    let added = false;
    for (const name of ["agent402", "mpp"]) {
      if (sourceCandidates[name][index]) {
        queue.push(sourceCandidates[name][index]);
        added = true;
        if (queue.length >= request.limit) break;
      }
    }
    if (!added) break;
  }

  const qualified = [];
  const rejected = [];
  for (const candidate of queue) {
    sources[candidate.source].audited += 1;
    try {
      const report = await auditImpl({
        origin: candidate.origin,
        x402Path: candidate.openApiPath,
        route: candidate.route,
        method: candidate.method,
        requiredPaths: request.requiredPaths,
        maxRoutes: 1,
        publicDns: true,
      });
      const routeReport = report?.routes?.[0];
      const contractAdmissible = routeReport?.responseContract?.decision === "admissible";
      const decision = candidate.method === "GET" && report?.machineBuyable === true
        ? "machine_buyable"
        : report?.ok === true && contractAdmissible
          ? "contract_ready"
          : null;
      if (decision) qualified.push(publicCandidate(candidate, routeReport, decision));
      else rejected.push({
        source: candidate.source,
        serviceName: candidate.serviceName,
        origin: candidate.origin,
        method: candidate.method,
        route: candidate.route,
        price: candidate.price,
        reason: contractAdmissible ? "runtime_not_machine_buyable" : "response_contract_incomplete",
        findings: Array.isArray(routeReport?.findings) ? routeReport.findings.slice(0, 12) : [],
      });
    } catch (error) {
      rejected.push({
        source: candidate.source,
        serviceName: candidate.serviceName,
        origin: candidate.origin,
        method: candidate.method,
        route: candidate.route,
        price: candidate.price,
        reason: safeFailure(error),
        findings: [],
      });
    }
  }
  return {
    ok: true,
    product: "samedaydesk-contract-qualified-search",
    version: "1.0.0",
    checkedAt: now().toISOString(),
    decision: qualified.length ? "qualified_candidates_found" : "no_qualified_candidate",
    request: {
      queryDigest,
      requiredPaths: request.requiredPaths,
      maxPriceDisplayUnits: request.maxPriceDisplayUnits,
      limit: request.limit,
    },
    sources,
    qualified,
    rejected,
    boundary: {
      credentialsUsed: false,
      walletAccessed: false,
      targetPaymentSigned: false,
      targetPaymentSent: false,
      sellerPostRequestSent: false,
      paidResponseBodyRead: false,
      queryRetained: false,
      querySentTo: ["agent402"],
      directoryRequests: 2,
      sellerAudits: queue.length,
    },
  };
}

export function contractQualifiedSearchOutputSchema() {
  const price = {
    type: "object", additionalProperties: false,
    properties: { amountDisplayUnits: { type: "number" }, currency: { type: "string" }, decimals: { type: "integer" }, amountAtomic: { type: "string" } },
    required: ["amountDisplayUnits", "currency", "decimals", "amountAtomic"],
  };
  const identity = {
    source: { type: "string", enum: ["agent402", "mpp"] }, serviceName: { type: "string" }, origin: { type: "string", format: "uri" }, method: { type: "string", enum: ["GET", "POST"] }, route: { type: "string" }, price,
  };
  const source = {
    type: "object", additionalProperties: false,
    properties: { status: { type: "string", enum: ["ok", "unavailable"] }, discovered: { type: "integer" }, audited: { type: "integer" } },
    required: ["status", "discovered", "audited"],
  };
  return {
    type: "object", additionalProperties: false,
    properties: {
      ok: { type: "boolean", const: true }, product: { type: "string", const: "samedaydesk-contract-qualified-search" }, version: { type: "string", const: "1.0.0" }, checkedAt: { type: "string", format: "date-time" }, decision: { type: "string", enum: ["qualified_candidates_found", "no_qualified_candidate"] },
      request: { type: "object", additionalProperties: false, properties: { queryDigest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, requiredPaths: { type: "array", minItems: 1, maxItems: 16, items: { type: "string" } }, maxPriceDisplayUnits: { type: "number" }, limit: { type: "integer" } }, required: ["queryDigest", "requiredPaths", "maxPriceDisplayUnits", "limit"] },
      sources: { type: "object", additionalProperties: false, properties: { agent402: source, mpp: source }, required: ["agent402", "mpp"] },
      qualified: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, properties: { ...identity, description: { type: "string" }, decision: { type: "string", enum: ["machine_buyable", "contract_ready"] }, protocols: { type: "array", items: { type: "string" } }, runtimeChallengeVerified: { type: "boolean" }, guaranteedPaths: { type: "array", maxItems: 16, items: { type: "string" } } }, required: [...Object.keys(identity), "description", "decision", "protocols", "runtimeChallengeVerified", "guaranteedPaths"] } },
      rejected: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, properties: { ...identity, reason: { type: "string" }, findings: { type: "array", maxItems: 12, items: { type: "string" } } }, required: [...Object.keys(identity), "reason", "findings"] } },
      boundary: { type: "object", additionalProperties: false, properties: { credentialsUsed: { type: "boolean", const: false }, walletAccessed: { type: "boolean", const: false }, targetPaymentSigned: { type: "boolean", const: false }, targetPaymentSent: { type: "boolean", const: false }, sellerPostRequestSent: { type: "boolean", const: false }, paidResponseBodyRead: { type: "boolean", const: false }, queryRetained: { type: "boolean", const: false }, querySentTo: { type: "array", items: { type: "string", enum: ["agent402"] } }, directoryRequests: { type: "integer" }, sellerAudits: { type: "integer" } }, required: ["credentialsUsed", "walletAccessed", "targetPaymentSigned", "targetPaymentSent", "sellerPostRequestSent", "paidResponseBodyRead", "queryRetained", "querySentTo", "directoryRequests", "sellerAudits"] },
    },
    required: ["ok", "product", "version", "checkedAt", "decision", "request", "sources", "qualified", "rejected", "boundary"],
  };
}

export const CONTRACT_QUALIFIED_SEARCH_EXAMPLE = Object.freeze({
  ok: true,
  product: "samedaydesk-contract-qualified-search",
  version: "1.0.0",
  checkedAt: "2026-08-12T12:00:00.000Z",
  decision: "qualified_candidates_found",
  request: {
    queryDigest: "sha256:64f12b41f9a391176291881e042659376376348e5373e18a3b1bf9557caa411c",
    requiredPaths: ["data.sourceRepository"],
    maxPriceDisplayUnits: 0.1,
    limit: 5,
  },
  sources: {
    agent402: { status: "ok", discovered: 3, audited: 2 },
    mpp: { status: "ok", discovered: 2, audited: 1 },
  },
  qualified: [{
    source: "agent402",
    serviceName: "Example source proof",
    description: "Return source repository provenance for a public service.",
    origin: "https://service.example",
    method: "GET",
    route: "/source-proof",
    price: { amountDisplayUnits: 0.01, currency: "USD", decimals: 6, amountAtomic: "10000" },
    decision: "machine_buyable",
    protocols: ["x402"],
    runtimeChallengeVerified: true,
    guaranteedPaths: ["data.sourceRepository"],
  }],
  rejected: [],
  boundary: {
    credentialsUsed: false,
    walletAccessed: false,
    targetPaymentSigned: false,
    targetPaymentSent: false,
    sellerPostRequestSent: false,
    paidResponseBodyRead: false,
    queryRetained: false,
    querySentTo: ["agent402"],
    directoryRequests: 2,
    sellerAudits: 3,
  },
});

export { AGENT402_ROUTE_URL, MPP_SERVICES_URL };
