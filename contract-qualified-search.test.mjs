import test from "node:test";
import assert from "node:assert/strict";
import {
  ContractQualifiedSearchError,
  contractQualifiedSearch,
  normalizeContractQualifiedSearchInput,
} from "./contract-qualified-search.mjs";

const request = { query: "service domain ownership code provenance", requiredPaths: ["data.sourceRepository"], limit: 3 };

function response(value) {
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(value) };
}

const agent402 = { results: [
  { seller: "https://good.example", sellerName: "Good", url: "https://good.example/provenance", route: "/provenance", method: "GET", priceUsd: 0.01, payable: "x402", description: "source repository provenance", score: 20 },
  { seller: "https://unsafe.example", url: "https://unsafe.example/domain/{name}", route: "/domain/{name}", method: "GET", priceUsd: 0.005, payable: "x402", description: "domain provenance", score: 19 },
] };

const mpp = { services: [{
  status: "active", name: "Source proof", serviceUrl: "https://mpp.example", description: "service source provenance", tags: ["source", "repository"], docs: { apiReference: "https://mpp.example/spec.json" },
  endpoints: [{ method: "GET", path: "/proof", description: "source repository proof", payment: { amount: "5000", decimals: 6, currency: "USD" } }],
}] };

test("normalizes bounded search input without retaining duplicates", () => {
  assert.deepEqual(normalizeContractQualifiedSearchInput({ ...request, requiredPaths: "data.sourceRepository,data.sourceRepository" }), {
    query: request.query, requiredPaths: ["data.sourceRepository"], maxPriceDisplayUnits: 0.1, limit: 3,
  });
  assert.throws(() => normalizeContractQualifiedSearchInput({ ...request, token: "secret" }), ContractQualifiedSearchError);
  assert.throws(() => normalizeContractQualifiedSearchInput({ ...request, query: "api_key=secret-value" }), /credential/);
  assert.throws(() => normalizeContractQualifiedSearchInput({ ...request, requiredPaths: [] }), /1 to 16/);
});

test("searches both directories and returns only contract-qualified candidates", async () => {
  const calls = [];
  const audits = [];
  const result = await contractQualifiedSearch(request, {
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body });
      return response(String(url).includes("agent402") ? agent402 : mpp);
    },
    auditImpl: async (input) => {
      audits.push(input);
      return { ok: true, machineBuyable: true, routes: [{ protocols: ["x402"], runtimeChallengeVerified: true, findings: [], responseContract: { decision: "admissible", guaranteedPaths: ["data.sourceRepository"] } }] };
    },
    now: () => new Date("2026-08-12T12:00:00.000Z"),
  });
  assert.equal(result.decision, "qualified_candidates_found");
  assert.equal(result.qualified.length, 2);
  assert.equal(result.rejected.length, 0);
  assert.deepEqual(calls.map((item) => item.method), ["POST", "GET"]);
  assert.equal(JSON.parse(calls[0].body).query, request.query);
  assert.deepEqual(audits.map((item) => item.x402Path), ["/openapi.json", "/spec.json"]);
  assert.equal(result.request.query, undefined);
  assert.match(result.request.queryDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(result.boundary.sellerPostRequestSent, false);
  assert.equal(result.boundary.targetPaymentSent, false);
  assert.deepEqual(result.boundary.querySentTo, ["agent402"]);
});

test("discards colon-style unresolved routes and owned supply before auditing", async () => {
  let audits = 0;
  const payload = { results: [
    { seller: "https://unsafe.example", url: "https://unsafe.example/domain/:name", route: "/domain/:name", method: "GET", priceUsd: 0.005, payable: "x402", description: "source provenance", score: 20 },
    { seller: "https://agents.samedaydesk.com", url: "https://agents.samedaydesk.com/read", route: "/read", method: "GET", priceUsd: 0.005, payable: "x402", description: "source provenance", score: 19 },
  ] };
  const result = await contractQualifiedSearch(request, {
    fetchImpl: async (url) => response(String(url).includes("agent402") ? payload : { services: [] }),
    auditImpl: async () => { audits += 1; return {}; },
  });
  assert.equal(audits, 0);
  assert.equal(result.sources.agent402.discovered, 0);
});

test("rejects underconstrained contracts with controlled evidence", async () => {
  const result = await contractQualifiedSearch({ ...request, limit: 1 }, {
    fetchImpl: async (url) => response(String(url).includes("agent402") ? agent402 : { services: [] }),
    auditImpl: async () => ({ ok: false, machineBuyable: false, routes: [{ findings: ["seller_response_required_path_missing:data.sourceRepository"], responseContract: { decision: "underconstrained", guaranteedPaths: [] } }] }),
  });
  assert.equal(result.decision, "no_qualified_candidate");
  assert.equal(result.rejected[0].reason, "response_contract_incomplete");
  assert.deepEqual(result.rejected[0].findings, ["seller_response_required_path_missing:data.sourceRepository"]);
});

test("keeps one directory outage non-fatal and never audits template routes", async () => {
  let audits = 0;
  const result = await contractQualifiedSearch(request, {
    fetchImpl: async (url) => {
      if (String(url).includes("agent402")) return response(agent402);
      throw new Error("offline");
    },
    auditImpl: async () => { audits += 1; throw new Error("exact paid GET route was not declared"); },
  });
  assert.equal(result.sources.mpp.status, "unavailable");
  assert.equal(audits, 1);
  assert.equal(result.rejected[0].reason, "exact_route_not_declared");
});

test("contract-ready POST candidates are labeled separately without seller POST", async () => {
  const postPayload = { results: [{ seller: "https://post.example", sellerName: "Post", url: "https://post.example/analyze", route: "/analyze", method: "POST", priceUsd: 0.01, payable: "x402", description: "source repository provenance", score: 20 }] };
  const result = await contractQualifiedSearch({ ...request, limit: 1 }, {
    fetchImpl: async (url) => response(String(url).includes("agent402") ? postPayload : { services: [] }),
    auditImpl: async () => ({ ok: true, machineBuyable: false, routes: [{ protocols: ["x402"], runtimeChallengeVerified: false, findings: [], responseContract: { decision: "admissible", guaranteedPaths: ["data.sourceRepository"] } }] }),
  });
  assert.equal(result.qualified[0].decision, "contract_ready");
  assert.equal(result.boundary.sellerPostRequestSent, false);
});
