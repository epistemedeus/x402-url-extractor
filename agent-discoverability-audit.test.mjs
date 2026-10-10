import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  agentDiscoverabilityAudit,
  auditCoinbaseMaterialization,
  auditTargetDiscoverySurfaces,
  CATALOG_RESPONSE_MAX_BYTES,
  fetchJson,
  fetchPinnedTargetJson,
  normalizeDiscoverabilityAuditInput,
} from "./agent-discoverability-audit.mjs";
import { SOURCE } from "task-discoverability";

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function market8004Response({ target = true, query = "extract a public website into structured JSON metadata" } = {}) {
  const cards = target
    ? `<a href="/agent/solana/mainnet-beta/1467"><h3>Target 8004</h3><p class="truncate mt-1">structured extraction</p></a>`
    : "";
  const data = target
    ? `agent_id:"solana:mainnet-beta:1467",endpoints:[{name:"OpenAPI",endpoint:"https://api.example.com/extract"}],featuredAgents:`
    : "";
  return new Response(`<input name="q" value="${query}"><span>${target ? 1 : 0}</span><span>Assets found</span>${cards}${data}`, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

test("requires a public origin and a brand-blind capability intent", () => {
  assert.throws(() => normalizeDiscoverabilityAuditInput({ origin: "http://example.com", intent: "extract a public website into structured JSON" }), /public HTTPS origin/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({ origin: "https://localhost", intent: "extract a public website into structured JSON" }), /public hostname/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({ origin: "https://api.example.com", intent: "find api.example.com for website extraction" }), /brand-blind/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({ origin: "https://api.example.com", intent: "too short" }), /20 to 500/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({ origin: "https://api.example.com", intent: "extract a public website into structured JSON", route: "/extract?x=1" }), /route/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({ origin: "https://api.example.com", intent: "extract a public website into structured JSON", expectedPriceUsd: "0.005" }), /requires an exact route/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({ origin: "https://api.example.com", intent: "extract a public website into structured JSON", route: "/extract", expectedPriceUsd: "0.0000001" }), /at most six fractional digits/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({ origin: "https://api.example.com", intent: "extract a public website into structured JSON", materializationAudit: true }), /requires an exact route/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({ origin: "https://api.example.com", intent: "extract a public website into structured JSON", route: "/extract", method: "PUT" }), /GET or POST/);
  assert.equal(normalizeDiscoverabilityAuditInput({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    payTo: `0x${"1".repeat(40)}`,
  }).origin, "https://api.example.com");
  assert.equal(normalizeDiscoverabilityAuditInput({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    surfaceAudit: "true",
  }).surfaceAudit, true);
  assert.deepEqual(normalizeDiscoverabilityAuditInput({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    expectedPriceUsd: "0.005000",
  }), {
    origin: "https://api.example.com",
    hostname: "api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    runtimeUrl: null,
    payTo: null,
    surfaceAudit: false,
    materializationAudit: false,
    method: "GET",
    expectedPriceUsd: 0.005,
    expectedPriceAtomic: "5000",
  });
  assert.throws(() => normalizeDiscoverabilityAuditInput({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    surfaceAudit: "yes",
  }), /surfaceAudit/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    runtimeUrl: "https://other.example/extract",
  }), /audited origin/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    runtimeUrl: "https://api.example.com/read",
  }), /match route exactly/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    runtimeUrl: "https://api.example.com/extract",
    method: "POST",
  }), /only when method is GET/);
});

test("distinguishes Coinbase eligibility from exact catalog materialization", async () => {
  const resource = "https://api.example.com/extract";
  const input = normalizeDiscoverabilityAuditInput({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    method: "POST",
    materializationAudit: true,
  });
  const run = (validation, resources, validationStatus = 200, catalogStatus = 200) => auditCoinbaseMaterialization(input, {
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith("/x402/validate")) {
        assert.equal(options.method, "POST");
        assert.deepEqual(JSON.parse(options.body), { resource, method: "POST" });
        return response(validation, validationStatus);
      }
      const parsed = new URL(target);
      assert.equal(parsed.searchParams.has("urlSubstring"), false);
      assert.equal(parsed.searchParams.has("curatedOnly"), false);
      assert.deepEqual([...parsed.searchParams.keys()].sort(), ["limit", "query"]);
      for (const key of parsed.searchParams.keys()) assert.ok(SOURCE.sdkSearchQuery.includes(key));
      return response({ resources }, catalogStatus);
    },
  });

  const accepted = await run({ valid: true, simulation: { outcome: "accepted" }, index: null }, []);
  assert.equal(accepted.state, "query_window_catalog_presence_unknown");
  assert.equal(accepted.validator.eligibility, "provider_reported_eligible");
  assert.equal(accepted.validator.indexReturned, false);
  assert.equal(accepted.catalog.catalogPresence, "unknown");
  assert.equal(accepted.catalog.exactMatchCount, 0);
  assert.equal(accepted.catalog.measuredZero, true);
  assert.equal(accepted.catalog.declaredReturnedCount, 0);
  assert.equal(accepted.catalog.inspectedCount, 0);
  assert.equal(JSON.stringify(accepted).includes("not_materialized"), false);
  assert.equal(JSON.stringify(accepted).includes("request_provider_ingestion"), false);

  const rejected = await run({ valid: false, simulation: { outcome: "rejected" }, index: null }, []);
  assert.equal(rejected.state, "query_window_catalog_presence_unknown");
  assert.equal(rejected.validator.eligibility, "provider_reported_not_eligible");
  assert.equal(rejected.catalog.catalogPresence, "unknown");

  const materialized = await run({ valid: false, simulation: { outcome: "rejected" } }, [{ resource }]);
  assert.equal(materialized.state, "observed_in_query_window");
  assert.equal(materialized.validator.eligibility, "provider_reported_not_eligible");
  assert.equal(materialized.catalog.exactMatchCount, 1);
  assert.equal(materialized.catalog.catalogPresence, "observed-in-inspected-rows");

  const unresolved = await run({}, [], 503, 503);
  assert.equal(unresolved.state, "unresolved");
  assert.equal(unresolved.validator.status, "error");
  assert.equal(unresolved.validator.eligibility, "unknown");
  assert.equal(unresolved.catalog.status, "error");

  const empty = await run({}, []);
  assert.equal(empty.validator.status, "ok");
  assert.equal(empty.validator.eligibility, "unknown");
  assert.equal(empty.validator.eligibilityReason, "malformed");
  assert.equal(empty.validator.valid, null);
  assert.equal(empty.state, "query_window_catalog_presence_unknown");

  const nonboolean = await run({ valid: "true", simulation: { outcome: "accepted" } }, []);
  assert.equal(nonboolean.validator.eligibility, "unknown");
  assert.equal(nonboolean.validator.eligibilityReason, "nonboolean-valid");

  const missingSimulation = await run({ valid: false }, []);
  assert.equal(missingSimulation.validator.eligibility, "unknown");
  assert.equal(missingSimulation.validator.eligibilityReason, "unknown-outcome");

  const unknownOutcome = await run({ valid: true, simulation: { outcome: "pending" } }, []);
  assert.equal(unknownOutcome.validator.eligibility, "unknown");
  assert.equal(unknownOutcome.validator.eligibilityReason, "unknown-outcome");

  const contradictory = await run({ valid: true, simulation: { outcome: "rejected" } }, []);
  assert.equal(contradictory.validator.eligibility, "unknown");
  assert.equal(contradictory.validator.eligibilityReason, "contradictory");
  const opposite = await run({ valid: false, simulation: { outcome: "accepted" } }, []);
  assert.equal(opposite.validator.eligibility, "unknown");
  assert.equal(opposite.validator.eligibilityReason, "contradictory");
});

test("turns materialization evidence into a specific action without replacing the core audit", async () => {
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.endsWith("/x402/validate")) return response({ valid: true, simulation: { outcome: "accepted" }, index: null });
    if (target.includes("coinbase.com")) return response({ resources: [] });
    if (target.includes("agent402.tools")) return response({ results: [] });
    if (target.includes("agentic.market")) return response({ services: [] });
    if (target.includes("circle.com")) return response({ items: [] });
    if (target.includes("agentictrade.io")) return response({ services: [] });
    if (target.includes("mpp.dev")) return response({ services: [] });
    if (target.includes("mppscan.com")) return response({ result: { data: { json: [] } } });
    if (target.includes("payanagent.com")) return response({ offers: [] });
    if (target.includes("x402.jobs")) return response({ resources: [] });
    if (target.includes("8004market.io")) return market8004Response({ target: false });
    throw new Error(`unexpected ${target}`);
  };
  const input = {
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    materializationAudit: true,
  };
  const accepted = await agentDiscoverabilityAudit(input, { fetchImpl, now: 0 });
  assert.equal(accepted.summary.coinbaseMaterializationState, "query_window_catalog_presence_unknown");
  assert.equal(accepted.sources["coinbase-bazaar"].coverage.catalogPresence, "unknown");
  assert.equal(accepted.sources["coinbase-bazaar"].request.plane, "actual-transport");
  assert.equal(accepted.sources["coinbase-bazaar"].discovery.provenance.kind, "supplied-body");
  assert.equal(accepted.sources["coinbase-bazaar"].discovery.provenance.officialLiveRead, false);
  assert.equal(accepted.sources["coinbase-bazaar"].discovery.provenance.networkSent, false);
  assert.equal(accepted.sources["coinbase-bazaar"].requestConstruction, null);
  assert.equal(accepted.findings.some((item) => item.finding === "provider_accepted_exact_route_not_materialized"), false);
  assert.equal(accepted.nextActions.some((item) => item.action === "request_provider_ingestion_disposition_or_supported_reindex"), false);
  assert.ok(accepted.findings.some((item) => item.source === "coinbase-bazaar" && item.finding === "target_not_in_inspected_window"));
  assert.equal(accepted.nextActions.some((item) => item.source === "coinbase-bazaar"), false);
  assert.equal(accepted.nextActions.some((item) => item.action === "repair_seller_provider_eligibility"), false);

  const malformedValidator = await agentDiscoverabilityAudit(input, {
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.endsWith("/x402/validate")) return response({});
      return fetchImpl(url);
    },
    now: 0,
  });
  assert.equal(malformedValidator.sources["coinbase-bazaar"].materialization.validator.eligibility, "unknown");
  assert.equal(malformedValidator.nextActions.some((item) => item.action === "repair_seller_provider_eligibility"), false);

  const rejectedValidator = await agentDiscoverabilityAudit(input, {
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.endsWith("/x402/validate")) return response({ valid: false, simulation: { outcome: "rejected" }, index: null });
      return fetchImpl(url);
    },
    now: 0,
  });
  assert.equal(rejectedValidator.sources["coinbase-bazaar"].materialization.validator.eligibility, "provider_reported_not_eligible");
  assert.ok(rejectedValidator.nextActions.some((item) => item.action === "repair_seller_provider_eligibility"));
  assert.equal(rejectedValidator.sources["coinbase-bazaar"].coverage.catalogPresence, "unknown");
  assert.equal(JSON.stringify(rejectedValidator.nextActions).includes("unlisted"), false);

  const unresolved = await agentDiscoverabilityAudit(input, {
    fetchImpl,
    now: 0,
    coinbaseMaterializationImpl: async () => ({ requested: true, state: "unresolved" }),
  });
  assert.ok(unresolved.findings.some((item) => item.finding === "materialization_state_unresolved"));
  assert.ok(unresolved.findings.some((item) => item.source === "coinbase-bazaar" && item.finding === "target_not_in_inspected_window"));
});

test("audits three fixed target discovery documents only when explicitly requested", async () => {
  const input = normalizeDiscoverabilityAuditInput({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    surfaceAudit: true,
  });
  const calls = [];
  const result = await auditTargetDiscoverySurfaces(input, {
    surfaceFetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith("agent-card.json")) return { skills: [{ id: "discover-extract", description: "Discover /extract." }] };
      if (url.endsWith("agent-registration.json")) return { services: [{ name: "paid-action:extract", endpoint: "https://api.example.com/extract" }] };
      if (url.endsWith("/api/actions")) return { actions: [{ route: "/other", url: "https://api.example.com/other" }] };
      throw new Error("unexpected surface");
    },
  });
  assert.deepEqual(calls, [
    "https://api.example.com/.well-known/agent-card.json",
    "https://api.example.com/.well-known/agent-registration.json",
    "https://api.example.com/api/actions",
  ]);
  assert.equal(result.availableSurfaceCount, 3);
  assert.equal(result.expectedRouteFoundSurfaceCount, 2);
  assert.deepEqual(result.expectedRouteFoundSurfaces, ["agentCard", "agentRegistration"]);
  assert.equal(result.surfaces.actionCatalog.expectedRouteFound, false);

  const noPrefixMatch = await auditTargetDiscoverySurfaces(input, {
    surfaceFetchImpl: async (url) => url.endsWith("agent-card.json")
      ? { skills: [{ description: "Discover /extract-v2." }] }
      : {},
  });
  assert.equal(noPrefixMatch.surfaces.agentCard.expectedRouteFound, false);
});

function requestFixture({ status = 200, body = "{}" } = {}) {
  return (_target, options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = (error) => {
      if (error) queueMicrotask(() => request.emit("error", error));
    };
    request.end = () => queueMicrotask(() => {
      const response = Readable.from([Buffer.from(body)]);
      response.statusCode = status;
      callback(response);
    });
    assert.equal(typeof options.lookup, "function");
    return request;
  };
}

test("target-surface fetch pins public DNS and rejects mixed private answers", async () => {
  const result = await fetchPinnedTargetJson("https://api.example.com/.well-known/agent-card.json", {
    lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
    requestImpl: requestFixture({ body: JSON.stringify({ skills: [] }) }),
  });
  assert.deepEqual(result, { skills: [] });
  await assert.rejects(
    fetchPinnedTargetJson("https://api.example.com/.well-known/agent-card.json", {
      lookupImpl: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
      requestImpl: () => { throw new Error("request must not run"); },
    }),
    (error) => error?.code === "ssrf_rejected",
  );
});

test("target-surface fetch rejects redirects and oversized JSON", async () => {
  const lookupImpl = async () => [{ address: "8.8.8.8", family: 4 }];
  await assert.rejects(
    fetchPinnedTargetJson("https://api.example.com/.well-known/agent-card.json", {
      lookupImpl,
      requestImpl: requestFixture({ status: 302 }),
    }),
    (error) => error?.code === "redirect_rejected",
  );
  await assert.rejects(
    fetchPinnedTargetJson("https://api.example.com/.well-known/agent-card.json", {
      lookupImpl,
      requestImpl: requestFixture({ body: JSON.stringify({ value: "x".repeat(100) }) }),
      maxBytes: 32,
    }),
    (error) => error?.code === "surface_too_large",
  );
});

test("preserves registry ranks and identifies the target by origin or payTo", async () => {
  const payTo = `0x${"1".repeat(40)}`;
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target.includes("coinbase.com")) return response({ resources: [
      { serviceName: "Other", resource: "https://other.test/extract", accepts: [{ amount: "10000", payTo: `0x${"2".repeat(40)}` }] },
      { serviceName: "Target", resource: "https://alias.example.net/extract", accepts: [{ amount: "50000", payTo }] },
    ] });
    if (target.includes("agent402.tools")) {
      assert.equal(options.method, "POST");
      assert.equal(JSON.parse(options.body).query, "extract a public website into structured JSON metadata");
      return response({ results: [{ name: "Target", seller: "https://api.example.com", route: "/extract", url: "https://api.example.com/extract", priceUsd: 0.05 }] });
    }
    if (target.includes("agentic.market")) return response({ services: [{
      name: "Target Agentic Market",
      description: "Structured website extraction",
      endpoints: [{ url: "https://api.example.com/extract", description: "extract structured metadata", pricing: { amount: "0.05" } }],
    }] });
    if (target.includes("circle.com")) return response({ items: [] });
    if (target.includes("agentictrade.io")) return response({ services: [{
      name: "Target Catalog",
      description: "extract a public website into structured JSON metadata",
      endpoint: "https://api.example.com/extract",
      pricing: { price_per_call: "0.0" },
    }] });
    if (target.includes("mpp.dev")) return response({ services: [{
      name: "Target MPP",
      description: "Structured website extraction",
      serviceUrl: "https://api.example.com",
      tags: ["website", "json"],
      endpoints: [{ path: "/extract", description: "extract structured metadata", payment: { amount: "50000", decimals: 6, recipient: payTo } }],
    }] });
    if (target.includes("mppscan.com")) return response({ result: { data: { json: [{
      origin: "https://api.example.com",
      title: "Target MPPScan",
      protocols: ["mpp", "x402"],
      endpoint: { method: "GET", path: "/extract", summary: "extract structured metadata", authMode: "paid", price: "0.050000 USD" },
    }] } } });
    if (target.includes("payanagent.com")) return response({ offers: [{
      _id: "kh736e0z6aw86kvtn28ert5na18c4kb1",
      title: "https://api.example.com/extract",
      description: "extract structured metadata",
      priceUsd: 0.05,
      buyUrl: "/x402/kh736e0z6aw86kvtn28ert5na18c4kb1",
    }] });
    if (target.includes("x402.jobs")) {
      assert.match(target, /search=extract%20public/);
      return response({ resources: [{
      id: "resource-target",
      name: "Target x402.jobs",
      resource_url: "https://api.example.com/extract?url=https%3A%2F%2Fexample.org",
      x402jobs_url: "https://x402.jobs/resources/api-example-com/extract",
      description: "extract structured metadata",
      max_amount_required: "50000",
      network: "base",
      pay_to: payTo,
      }] });
    }
    if (target.includes("8004market.io")) return market8004Response();
    throw new Error(`unexpected ${target}`);
  };
  const result = await agentDiscoverabilityAudit({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    payTo,
    expectedPriceUsd: "0.05",
  }, { fetchImpl, now: 0 });
  assert.equal(result.summary.targetFoundSourceCount, 9);
  assert.equal(result.summary.targetFoundSourceFamilyCount, 8);
  assert.deepEqual(result.summary.foundSourceFamilies, ["coinbase", "agent402", "agentictrade", "mpp", "mppscan", "payanagent", "x402jobs", "market8004"]);
  assert.equal(result.sources["coinbase-bazaar"].bestTargetRank, 2);
  assert.equal(result.sources["coinbase-bazaar"].competitorsAboveTarget.length, 1);
  assert.equal(result.sources["coinbase-bazaar"].targetResults[0].rank, 2);
  assert.equal(result.sources["agent402-router"].bestTargetRank, 1);
  assert.equal(result.sources["official-mpp-catalog"].expectedRouteFound, true);
  assert.equal(result.sources["x402jobs-public-search"].queryUsed, "extract public");
  assert.equal(result.sources["x402jobs-public-search"].queryAdapted, true);
  assert.deepEqual(result.summary.missingSources, ["circle-marketplace"]);
  assert.equal(result.summary.topThreeSourceCount, 9);
  assert.deepEqual(result.summary.dependentSources, ["payanagent-public-search", "8004market-public-search"]);
  assert.equal(result.summary.independentTargetFoundSourceCount, 7);
  assert.match(result.sourceDependencies["payanagent-public-search"], /not independent underlying supply/);
  assert.match(result.sourceDependencies["8004market-public-search"], /identity propagation/);
  assert.ok(result.findings.some((finding) => finding.source === "circle-marketplace" && finding.finding === "target_not_in_inspected_window"));
  assert.equal(result.sources["circle-marketplace"].coverage.catalogPresence, "unknown");
  assert.equal(result.sources["circle-marketplace"].coverage.declaredReturnedCount, "unknown");
  assert.equal(result.sources["circle-marketplace"].coverage.inspectedCount, 0);
  assert.equal(result.sources["circle-marketplace"].coverage.measuredZero, false);
  assert.equal(result.sources["circle-marketplace"].requestConstruction, null);
  assert.equal(result.nextActions.some((action) => action.source === "circle-marketplace"), false);
  assert.equal(result.sources["coinbase-bazaar"].targetFound, true);
  assert.equal(result.sources["coinbase-bazaar"].coverage.catalogPresence, "unknown");
  assert.equal(result.sources["coinbase-bazaar"].coverage.exactTargetCount, 0);
  assert.equal(result.sources["coinbase-bazaar"].request.suppliedBodyPlane, "supplied-body");
  assert.equal(result.sources["coinbase-bazaar"].request.plane, "actual-transport");
  assert.equal(result.safety.paymentSentToCatalogs, false);
  assert.equal(result.input.brandBlind, true);
  assert.equal(result.input.expectedPriceAtomic, "50000");
  assert.equal(result.summary.matchedPriceSourceCount, 7);
  assert.equal(result.summary.driftedPriceSourceCount, 1);
  assert.equal(result.summary.unknownPriceSourceCount, 2);
  assert.deepEqual(result.summary.driftedPriceSources, ["agentictrade-catalog"]);
  assert.equal(result.sources["coinbase-bazaar"].priceObservation.status, "matched");
  assert.equal(result.sources["agentictrade-catalog"].priceObservation.status, "drift");
  assert.equal(result.sources["8004market-public-search"].priceObservation.status, "price_unknown");
  assert.ok(result.findings.some((finding) => finding.source === "agentictrade-catalog" && finding.finding === "expected_route_price_drift"));
  assert.ok(result.nextActions.some((action) => action.source === "agentictrade-catalog" && action.action === "reconcile_stale_catalog_price"));
  assert.match(result.boundary, /caller-supplied expectation/);
});

test("contains one source failure while preserving the other observations", async () => {
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("coinbase.com")) return response({}, 503);
    if (target.includes("agent402.tools")) return response({ results: [] });
    if (target.includes("agentic.market")) return response({ services: [] });
    if (target.includes("circle.com")) return response({ items: [] });
    if (target.includes("agentictrade.io")) return response({ services: [] });
    if (target.includes("mpp.dev")) return response({ services: [] });
    if (target.includes("mppscan.com")) return response({ result: { data: { json: [] } } });
    if (target.includes("payanagent.com")) return response({ offers: [] });
    if (target.includes("x402.jobs")) return response({ resources: [] });
    if (target.includes("8004market.io")) return market8004Response({ target: false });
    throw new Error(`unexpected ${target}`);
  };
  const result = await agentDiscoverabilityAudit({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
  }, { fetchImpl, now: 0 });
  assert.equal(result.summary.availableSourceCount, 9);
  assert.deepEqual(result.summary.unavailableSources, ["coinbase-bazaar"]);
  assert.equal(result.sources["coinbase-bazaar"].status, "error");
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("uses one coherent live unsigned offer as the catalog price reference", async () => {
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target.includes("coinbase.com")) return response({ resources: [{
      serviceName: "Target",
      resource: "https://api.example.com/extract",
      accepts: [{ amount: "50000", payTo: `0x${"1".repeat(40)}` }],
    }] });
    if (target.includes("agent402.tools")) {
      assert.equal(options.method, "POST");
      return response({ results: [] });
    }
    if (target.includes("agentic.market")) return response({ services: [] });
    if (target.includes("circle.com")) return response({ items: [] });
    if (target.includes("agentictrade.io")) return response({ services: [] });
    if (target.includes("mpp.dev")) return response({ services: [] });
    if (target.includes("mppscan.com")) return response({ result: { data: { json: [] } } });
    if (target.includes("payanagent.com")) return response({ offers: [] });
    if (target.includes("x402.jobs")) return response({ resources: [] });
    if (target.includes("8004market.io")) return market8004Response({ target: false });
    throw new Error(`unexpected ${target}`);
  };
  const paymentPreflightImpl = async ({ url }) => ({
    target: { method: "GET", url, httpStatus: 402 },
    decision: "parseable_offer",
    protocols: ["mpp", "x402"],
    offerCount: 2,
    offers: [
      { protocol: "mpp", network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amountAtomic: "5000", valid: true },
      { protocol: "x402", network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amountAtomic: "5000", valid: true },
    ],
    parity: { compared: true, consistent: true, driftFields: [] },
    findings: [],
    boundary: { credentialsUsed: false, paymentSigned: false, paymentSent: false, responseBodyRead: false },
  });
  const result = await agentDiscoverabilityAudit({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    runtimeUrl: "https://api.example.com/extract?url=https%3A%2F%2Fexample.org",
    payTo: `0x${"1".repeat(40)}`,
    expectedPriceUsd: "0.05",
  }, { fetchImpl, paymentPreflightImpl, now: 0 });
  assert.equal(result.version, "1.13.0");
  assert.deepEqual(result.summary.priceReference, {
    basis: "live_unsigned_offer",
    amountAtomic: "5000",
    amountUsd: 0.005,
    protocols: ["mpp", "x402"],
  });
  assert.equal(result.sources["coinbase-bazaar"].priceObservation.status, "drift");
  assert.ok(result.findings.some((finding) => finding.finding === "caller_expected_price_runtime_drift"));
  assert.equal(result.safety.runtimeCredentialUsed, false);
  assert.equal(result.safety.runtimePaymentSent, false);
  assert.equal(result.safety.runtimeResponseBodyRead, false);
  assert.match(result.method, /live offer/);
});

test("reports duplicate and alias-only identities without treating them as demand", async () => {
  const payTo = `0x${"1".repeat(40)}`;
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("coinbase.com")) return response({ resources: [
      { serviceName: "Canonical", resource: "https://api.example.com/extract", accepts: [{ amount: "5000", payTo }] },
      { serviceName: "Alias", resource: "https://legacy.example.net/extract", accepts: [{ amount: "5000", payTo }] },
    ] });
    if (target.includes("agent402.tools")) return response({ results: [
      { name: "Alias only", seller: "https://legacy.example.net", route: "/extract", url: "https://legacy.example.net/extract", priceUsd: 0.005, payTo },
    ] });
    if (target.includes("agentic.market")) return response({ services: [] });
    if (target.includes("circle.com")) return response({ items: [] });
    if (target.includes("agentictrade.io")) return response({ services: [] });
    if (target.includes("mpp.dev")) return response({ services: [] });
    if (target.includes("mppscan.com")) return response({ result: { data: { json: [] } } });
    if (target.includes("payanagent.com")) return response({ offers: [] });
    if (target.includes("x402.jobs")) return response({ resources: [] });
    if (target.includes("8004market.io")) return market8004Response({ target: false });
    throw new Error(`unexpected ${target}`);
  };
  const result = await agentDiscoverabilityAudit({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    payTo,
    expectedPriceUsd: "0.005",
  }, { fetchImpl, now: 0 });
  assert.equal(result.sources["coinbase-bazaar"].identityObservation.status, "alias_collision");
  assert.equal(result.sources["coinbase-bazaar"].identityObservation.exactRouteRecordCount, 2);
  assert.deepEqual(result.sources["coinbase-bazaar"].identityObservation.aliasOrigins, ["https://legacy.example.net"]);
  assert.equal(result.sources["coinbase-bazaar"].identityObservation.schemaVersion, "agent-payment-policy.listing-identity-report.v1");
  assert.equal(result.sources["coinbase-bazaar"].identityObservation.decision, "review_required");
  assert.equal(result.sources["coinbase-bazaar"].identityObservation.identityBasis, "agent-payment-policy@0.8.0");
  assert.equal(result.sources["coinbase-bazaar"].identityObservation.ownershipProven, false);
  assert.match(result.sources["coinbase-bazaar"].identityObservation.evidenceBoundary, /does not prove hostname ownership/);
  assert.equal(result.sources["agent402-router"].identityObservation.status, "alias_only");
  assert.equal(result.sources["x402jobs-public-search"].identityObservation.status, "route_absent");
  assert.deepEqual(result.summary.identityConflictSources, ["coinbase-bazaar", "agent402-router"]);
  assert.equal(result.summary.identityConflictSourceCount, 2);
  assert.ok(result.findings.some((finding) => finding.source === "agent402-router" && finding.finding === "route_listing_identity_conflict"));
  assert.ok(result.nextActions.some((action) => action.action === "preserve_canonical_listing_and_reconcile_aliases"));
  assert.equal(result.safety.paymentSentToCatalogs, false);
  assert.match(result.boundary, /not demand/);
  assert.match(result.method, /alias candidate/);
});

test("keeps dynamic or absent MPPScan prices unknown rather than free", async () => {
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("mppscan.com")) return response({ result: { data: { json: [{
      origin: "https://other.example",
      title: "Dynamic",
      endpoint: { method: "GET", path: "/route", summary: "dynamic priced service", price: "0.10-1000.00 USD" },
    }] } } });
    if (target.includes("payanagent.com")) return response({ offers: [] });
    if (target.includes("x402.jobs")) return response({ resources: [] });
    if (target.includes("8004market.io")) return market8004Response({ target: false, query: "find a dynamically priced machine service for agents" });
    if (target.includes("coinbase.com")) return response({ resources: [] });
    if (target.includes("agent402.tools")) return response({ results: [] });
    if (target.includes("agentic.market")) return response({ services: [] });
    if (target.includes("circle.com")) return response({ items: [] });
    if (target.includes("agentictrade.io")) return response({ services: [] });
    if (target.includes("mpp.dev")) return response({ services: [] });
    throw new Error(`unexpected ${target}`);
  };
  const result = await agentDiscoverabilityAudit({
    origin: "https://api.example.com",
    intent: "find a dynamically priced machine service for agents",
  }, { fetchImpl, now: 0 });
  assert.equal(result.sources["mppscan-public-search"].topResults[0].priceUsd, null);
  assert.equal(result.sources["mppscan-public-search"].topResults[0].score, null);
});

for (const [route, expectedQuery] of [
  ["/data/careers-board", "careers board"],
  ["/api/v1/catalog/products", "catalog products"],
  ["/reports/monthly-payments", "reports monthly"],
]) {
  test(`x402.jobs keeps a bounded task query for ${route}`, async () => {
    const result = await agentDiscoverabilityAudit({
      origin: "https://api.example.com",
      route,
      intent: "Fetch current public jobs from a company careers board with explicit source and completeness coverage",
    }, {
      fetchImpl: async () => response({ resources: [], services: [], data: [], results: [] }),
    });
    const source = result.sources["x402jobs-public-search"];
    assert.equal(source.status, "ok");
    assert.equal(source.queryUsed, expectedQuery);
    assert.equal(source.queryUsed.split(/\s+/).length, 2);
    assert.equal(source.queryUsed.includes("api.example.com"), false);
  });
}

function constructibleResource(resource = "https://api.example.com/extract") {
  return {
    resource,
    type: "http",
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount: "5000",
      payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
    }],
    extensions: {
      bazaar: {
        info: { input: { type: "http", method: "GET", queryParams: { url: "https://example.com" } }, output: { example: { title: "Example" } } },
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            input: {
              type: "object",
              properties: {
                type: { const: "http" },
                method: { enum: ["GET", "HEAD", "DELETE"] },
                queryParams: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
              },
              required: ["type", "method"],
            },
          },
          required: ["input"],
        },
      },
    },
  };
}

function catalogFetch(coinbaseBody, { circle = { items: [] }, validation = { valid: true, simulation: { outcome: "accepted" }, index: null } } = {}) {
  return async (url) => {
    const target = String(url);
    if (target.endsWith("/x402/validate")) return response(validation);
    if (target.includes("coinbase.com")) return response(coinbaseBody);
    if (target.includes("agent402.tools")) return response({ results: [] });
    if (target.includes("agentic.market")) return response({ services: [] });
    if (target.includes("circle.com")) return response(circle);
    if (target.includes("agentictrade.io")) return response({ services: [] });
    if (target.includes("mpp.dev")) return response({ services: [] });
    if (target.includes("mppscan.com")) return response({ result: { data: { json: [] } } });
    if (target.includes("payanagent.com")) return response({ offers: [] });
    if (target.includes("x402.jobs")) return response({ resources: [] });
    if (target.includes("8004market.io")) return market8004Response({ target: false });
    throw new Error(`unexpected ${target}`);
  };
}

test("consumes the pinned interpretation for a constructible row and an insufficient window", async () => {
  const input = {
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    materializationAudit: true,
  };
  const useful = await agentDiscoverabilityAudit(input, {
    fetchImpl: catalogFetch({ resources: [constructibleResource()], partialResults: false }),
    now: 0,
  });
  const bazaar = useful.sources["coinbase-bazaar"];
  assert.equal(useful.version, "1.13.0");
  assert.equal(useful.discoveryInterpretation.version, "0.3.0");
  assert.equal(useful.discoveryInterpretation.implementation, "0cf1e465c714991ab70fbde349ed51baddf64c12");
  assert.equal(bazaar.coverage.catalogPresence, "observed-in-inspected-rows");
  assert.equal(bazaar.coverage.exactTargetCount, 1);
  assert.equal(bazaar.coverage.inspectedCount, 1);
  assert.equal(bazaar.requestConstruction.method, "GET");
  assert.equal(bazaar.requestConstruction.invoked, false);
  assert.equal(bazaar.requestConstruction.paid, false);
  assert.equal(bazaar.request.plane, "actual-transport");
  assert.equal(bazaar.discovery.provenance.kind, "supplied-body");
  assert.equal(bazaar.discovery.provenance.networkSent, false);
  assert.equal(bazaar.discovery.provenance.officialLiveRead, false);
  assert.ok(useful.findings.some((item) => item.finding === "exact_target_request_constructible" && item.invoked === false && item.paid === false));
  assert.ok(useful.nextActions.some((item) => item.action === "inspect_constructed_request" && item.invoked === false && item.paid === false));
  assert.equal(JSON.stringify(useful.nextActions).includes("visitor"), false);
  assert.equal(JSON.stringify(useful.nextActions).includes("revenue"), false);
  assert.equal(JSON.stringify(useful.nextActions).includes("reindex"), false);

  const missing = await agentDiscoverabilityAudit(input, {
    fetchImpl: catalogFetch({
      resources: [{ resource: "https://other.example/extract", accepts: [{ amount: "1000", payTo: `0x${"2".repeat(40)}` }] }],
      itemCount: 11,
      partialResults: false,
    }),
    now: 0,
  });
  const window = missing.sources["coinbase-bazaar"];
  assert.equal(missing.summary.coinbaseMaterializationState, "query_window_catalog_presence_unknown");
  assert.equal(window.coverage.declaredReturnedCount, 11);
  assert.equal(window.coverage.inspectedCount, 1);
  assert.equal(window.coverage.exactTargetCount, 0);
  assert.equal(window.coverage.countConflict, true);
  assert.equal(window.coverage.catalogPresence, "unknown");
  assert.equal(window.coverage.partialResults, false);
  assert.notEqual(window.coverage.declaredReturnedCount, window.coverage.exactTargetCount);
  assert.equal(window.requestConstruction, null);
  assert.equal(missing.nextActions.some((item) => item.action === "request_provider_ingestion_disposition_or_supported_reindex"), false);
  assert.equal(missing.nextActions.some((item) => item.source === "coinbase-bazaar"), false);
  assert.ok(missing.findings.some((item) => item.finding === "count_contract_not_usable" && item.declaredReturnedCount === 11 && item.inspectedCount === 1 && item.exactTargetCount === 0));
});

test("keeps malformed, contradictory, and incomplete discovery evidence from becoming an absence claim", async () => {
  const input = {
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
  };
  const malformed = await agentDiscoverabilityAudit(input, {
    fetchImpl: catalogFetch({ ok: true }),
    now: 0,
  });
  assert.equal(malformed.sources["coinbase-bazaar"].status, "error");
  assert.equal(malformed.nextActions.some((item) => item.action === "request_provider_ingestion_disposition_or_supported_reindex"), false);

  const contradictory = await agentDiscoverabilityAudit(input, {
    fetchImpl: catalogFetch({
      resources: [
        constructibleResource(),
        constructibleResource(),
      ].map((item, index) => ({
        ...item,
        accepts: [{ ...item.accepts[0], amount: index === 0 ? "5000" : "9000" }],
      })),
    }),
    now: 0,
  });
  assert.equal(contradictory.sources["coinbase-bazaar"].coverage.exactTargetCount, 2);
  assert.equal(contradictory.sources["coinbase-bazaar"].requestConstruction, null);
  assert.equal(contradictory.nextActions.some((item) => item.action === "inspect_constructed_request"), false);

  const incomplete = constructibleResource();
  delete incomplete.extensions;
  const schemaShort = await agentDiscoverabilityAudit(input, {
    fetchImpl: catalogFetch({ resources: [incomplete] }),
    now: 0,
  });
  assert.equal(schemaShort.sources["coinbase-bazaar"].coverage.catalogPresence, "observed-in-inspected-rows");
  assert.equal(schemaShort.sources["coinbase-bazaar"].requestConstruction, null);
  assert.equal(schemaShort.nextActions.some((item) => item.action === "inspect_constructed_request"), false);

  const counted = await agentDiscoverabilityAudit(input, {
    fetchImpl: catalogFetch({ resources: [], itemCount: 0, pagination: { total: 9 } }, {
      circle: {
        itemCount: "0",
        pagination: { total: 40 },
        items: [
          { resource: "https://other.example/a" },
          { resource: "https://other.example/b" },
        ],
      },
    }),
    now: 0,
  });
  const circle = counted.sources["circle-marketplace"].coverage;
  assert.equal(circle.declaredReturnedCount, "unknown");
  assert.equal(circle.rawReturnedCount, 2);
  assert.equal(circle.inspectedCount, 2);
  assert.equal(circle.reportedPageTotal, "unknown");
  assert.equal(circle.countConflict, false);
  assert.equal(circle.adapterReduced, false);
  assert.equal(circle.measuredZero, false);
  assert.equal(circle.catalogPresence, "unknown");
  assert.deepEqual(circle.providerCounts, [
    { field: "itemCount", semantic: "unknown", state: "measured", value: 0 },
    { field: "pagination.total", semantic: "unknown", state: "measured", value: 40 },
  ]);
  assert.equal(counted.sources["coinbase-bazaar"].coverage.declaredReturnedCount, 0);
  assert.equal(counted.sources["coinbase-bazaar"].coverage.reportedPageTotal, 9);
  assert.equal(counted.sources["coinbase-bazaar"].coverage.countConflict, false);
  assert.equal(counted.findings.some((item) => item.finding === "count_contract_not_usable"), false);
  assert.equal(counted.nextActions.some((item) => item.source === "circle-marketplace"), false);

  const invalidCount = await agentDiscoverabilityAudit(input, {
    fetchImpl: catalogFetch({ resources: [] }, { circle: { itemCount: "01", pagination: { total: true }, items: [] } }),
    now: 0,
  });
  const invalidCircle = invalidCount.sources["circle-marketplace"].coverage;
  assert.equal(invalidCircle.countState, "unknown");
  assert.equal(invalidCircle.declaredReturnedCount, "unknown");
  assert.equal(invalidCircle.countConflict, false);
  assert.equal(invalidCircle.catalogPresence, "unknown");
  assert.deepEqual(invalidCircle.providerCounts, [
    { field: "itemCount", semantic: "unknown", state: "invalid", value: null },
    { field: "pagination.total", semantic: "unknown", state: "invalid", value: null },
  ]);
  assert.equal(invalidCount.findings.some((item) => item.source === "circle-marketplace" && item.finding === "count_contract_not_usable"), false);
  assert.equal(invalidCount.nextActions.some((item) => item.source === "circle-marketplace"), false);
});

test("keeps a provider total and an adapter slice separate from inspected rows", async () => {
  const input = {
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
  };
  const row = (path) => ({
    origin: "https://other.example",
    title: `Row ${path}`,
    endpoint: { method: "GET", path, summary: "other route", price: "1 USD" },
  });
  const result = await agentDiscoverabilityAudit(input, {
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes("mppscan.com")) {
        return response({
          pagination: { total: 80 },
          result: { data: { json: [row("/a"), row("/b"), row("/c")] } },
        });
      }
      return catalogFetch({ resources: [{ resource: "https://other.example/extract" }], pagination: { total: 80 } })(url);
    },
    limit: 1,
    now: 0,
  });
  const scanned = result.sources["mppscan-public-search"].coverage;
  assert.equal(scanned.rawReturnedCount, 3);
  assert.equal(scanned.inspectedCount, 1);
  assert.equal(scanned.adapterReduced, true);
  assert.equal(scanned.declaredReturnedCount, "unknown");
  assert.equal(scanned.reportedPageTotal, "unknown");
  assert.equal(scanned.countConflict, false);
  assert.deepEqual(scanned.providerCounts, [
    { field: "pagination.total", semantic: "unknown", state: "measured", value: 80 },
  ]);
  assert.equal(result.findings.some((item) => item.source === "mppscan-public-search" && item.finding === "count_contract_not_usable"), false);
  const bazaar = result.sources["coinbase-bazaar"].coverage;
  assert.equal(bazaar.reportedPageTotal, 80);
  assert.notEqual(bazaar.declaredReturnedCount, 80);
  assert.equal(bazaar.rawReturnedCount, 1);
  assert.equal(bazaar.inspectedCount, 1);
});

test("bounds catalog bodies by streamed bytes and cancels the unread remainder", async () => {
  assert.equal(CATALOG_RESPONSE_MAX_BYTES, 10_000_000);
  const url = "https://catalog.example/search";
  const streamOf = (chunks, init = {}) => {
    const state = { pulls: 0, cancelled: false };
    const stream = new ReadableStream({
      pull(controller) {
        if (state.pulls >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(chunks[state.pulls]);
        state.pulls += 1;
      },
      cancel() {
        state.cancelled = true;
      },
    }, new CountQueuingStrategy({ highWaterMark: 0 }));
    return { response: new Response(stream, init), state };
  };

  const capped = streamOf([new Uint8Array(3), new Uint8Array(3), new Uint8Array([1])]);
  await assert.rejects(fetchJson(url, {
    fetchImpl: async (_target, options) => {
      assert.equal(options.redirect, "error");
      return capped.response;
    },
    maxBytes: 4,
  }), (error) => error?.code === "body-cap" && /exceeded 4 bytes/.test(error.message));
  assert.equal(capped.state.pulls, 2);
  assert.equal(capped.state.cancelled, true);

  const huge = streamOf([new Uint8Array(CATALOG_RESPONSE_MAX_BYTES + 1)]);
  await assert.rejects(fetchJson(url, {
    fetchImpl: async () => huge.response,
  }), /catalog response exceeded 10 MB/);
  assert.equal(huge.state.cancelled, true);

  const multibyte = streamOf([Buffer.from("éé")]);
  await assert.rejects(fetchJson(url, {
    fetchImpl: async () => multibyte.response,
    maxBytes: 3,
  }), (error) => error?.code === "body-cap");

  const missingLength = streamOf([Buffer.from('{"ok":true}')]);
  const read = await fetchJson(url, { fetchImpl: async () => missingLength.response });
  assert.equal(read.transport.bodyBound, "stream");
  assert.equal(read.transport.contentLength, null);
  assert.equal(read.transport.contentLengthHonored, false);
  assert.equal(read.transport.bytes, Buffer.byteLength('{"ok":true}'));
  assert.deepEqual(read.body, { ok: true });

  const lying = streamOf([Buffer.from('{"ok":true,"extra":"0123456789"}')], {
    headers: { "content-length": "1" },
  });
  await assert.rejects(fetchJson(url, {
    fetchImpl: async () => lying.response,
    maxBytes: 8,
  }), (error) => error?.code === "body-cap");

  let errorPulls = 0;
  let errorCancelled = false;
  await assert.rejects(fetchJson(url, {
    fetchImpl: async () => new Response(new ReadableStream({
      pull(controller) {
        errorPulls += 1;
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        errorCancelled = true;
      },
    }), { status: 500 }),
  }), /catalog returned HTTP 500/);
  assert.equal(errorCancelled, true);
  assert.equal(errorPulls, 1);

  let redirectPulls = 0;
  let redirectCancelled = false;
  await assert.rejects(fetchJson(url, {
    fetchImpl: async (_target, options) => {
      assert.equal(options.redirect, "error");
      return new Response(new ReadableStream({
        pull(controller) {
          redirectPulls += 1;
          controller.enqueue(new Uint8Array([1]));
        },
        cancel() {
          redirectCancelled = true;
        },
      }), { status: 302, headers: { location: "https://evil.example/next" } });
    },
  }), /catalog redirect was rejected/);
  assert.equal(redirectCancelled, true);
  assert.equal(redirectPulls, 1);

  await assert.rejects(fetchJson(url, {
    fetchImpl: async (_target, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
    timeoutMs: 20,
  }), /catalog request timed out/);

  await assert.rejects(fetchJson(url, {
    fetchImpl: async () => new Response(new ReadableStream({
      pull() {
        return new Promise(() => {});
      },
    })),
    timeoutMs: 20,
  }), /catalog request timed out/);

  await assert.rejects(fetchJson(url, {
    fetchImpl: async () => new Response(new ReadableStream({
      pull(controller) {
        controller.enqueue("not-bytes");
      },
    })),
  }), (error) => error?.code === "stream-failed");
});

test("replays the pinned discoverability package from a cold install", { timeout: 120_000 }, () => {
  const archive = readFileSync(new URL("./vendor/task-discoverability-0.3.0.tar.gz", import.meta.url));
  assert.equal(archive.byteLength, 36215);
  assert.equal(createHash("sha256").update(archive).digest("hex"), "1c999d1144c39bc4283a8dc8a6f6149788fd91c438f738fe63ea7c64e9162f57");
  const root = mkdtempSync(join(tmpdir(), "task-discoverability-"));
  try {
    cpSync(new URL("./vendor/task-discoverability", import.meta.url), root, { recursive: true });
    const installed = spawnSync("npm", ["ci", "--ignore-scripts"], { cwd: root, encoding: "utf8" });
    assert.equal(installed.status, 0, installed.stderr);
    const replay = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { measure, PACKAGE } from "./src/index.mjs";
      const body = { resources: [], itemCount: 2 };
      const missing = await measure({ serviceUrl: "https://api.example.com/extract", body });
      if (missing.provenance.kind !== "supplied-body") throw new Error("supplied plane missing");
      if (missing.provenance.networkSent !== false) throw new Error("supplied body was treated as transport");
      if (missing.service.catalogMembership !== "unknown") throw new Error("catalog membership was closed");
      if (missing.coverage.declaredReturnedCount !== 2) throw new Error("declared count changed");
      if (missing.coverage.inspectedCount !== 0) throw new Error("inspected count changed");
      if (missing.service.inInspectedRows !== false) throw new Error("exact observation changed");
      const seen = await measure({
        serviceUrl: "https://api.example.com/extract",
        body: { resources: [{ resource: "https://api.example.com/extract" }] },
      });
      if (seen.service.inInspectedRows !== true) throw new Error("exact row was not observed");
      if (seen.service.catalogMembership !== "unknown") throw new Error("one row became catalog membership");
      if (seen.requestConstructibility.fromThisResponse !== false) throw new Error("incomplete row was constructible");
      if (PACKAGE.version !== "0.3.0") throw new Error("package version drifted");
      console.log("cold-replay-ok");
    `], { cwd: root, encoding: "utf8" });
    assert.equal(replay.status, 0, replay.stderr);
    assert.match(replay.stdout, /cold-replay-ok/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("served machine copy withdraws the unsupported reindex state", () => {
  const server = readFileSync(new URL("./server.js", import.meta.url), "utf8");
  const skill = readFileSync(new URL("./skill-contract.mjs", import.meta.url), "utf8");
  assert.equal(server.includes("provider_accepted_not_materialized"), false);
  assert.equal(server.includes("request_provider_ingestion_disposition_or_supported_reindex"), false);
  assert.match(server, /version: "1\.13\.0"/);
  assert.match(server, /unknown catalog presence/);
  assert.match(skill, /unknown catalog presence/);
});
