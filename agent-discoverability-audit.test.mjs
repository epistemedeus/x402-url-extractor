import assert from "node:assert/strict";
import test from "node:test";

import {
  agentDiscoverabilityAudit,
  normalizeDiscoverabilityAuditInput,
} from "./agent-discoverability-audit.mjs";

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("requires a public origin and a brand-blind capability intent", () => {
  assert.throws(() => normalizeDiscoverabilityAuditInput({ origin: "http://example.com", intent: "extract a public website into structured JSON" }), /public HTTPS origin/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({ origin: "https://localhost", intent: "extract a public website into structured JSON" }), /public hostname/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({ origin: "https://api.example.com", intent: "find api.example.com for website extraction" }), /brand-blind/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({ origin: "https://api.example.com", intent: "too short" }), /20 to 500/);
  assert.throws(() => normalizeDiscoverabilityAuditInput({ origin: "https://api.example.com", intent: "extract a public website into structured JSON", route: "/extract?x=1" }), /route/);
  assert.equal(normalizeDiscoverabilityAuditInput({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    payTo: `0x${"1".repeat(40)}`,
  }).origin, "https://api.example.com");
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
      endpoint: "https://api.example.com/api/actions",
      pricing: { price_per_call: "0.0" },
    }] });
    if (target.includes("mpp.dev")) return response({ services: [{
      name: "Target MPP",
      description: "Structured website extraction",
      serviceUrl: "https://api.example.com",
      tags: ["website", "json"],
      endpoints: [{ path: "/extract", description: "extract structured metadata", payment: { amount: "50000", decimals: 6, recipient: payTo } }],
    }] });
    throw new Error(`unexpected ${target}`);
  };
  const result = await agentDiscoverabilityAudit({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
    route: "/extract",
    payTo,
  }, { fetchImpl, now: 0 });
  assert.equal(result.summary.targetFoundSourceCount, 5);
  assert.equal(result.summary.targetFoundSourceFamilyCount, 4);
  assert.deepEqual(result.summary.foundSourceFamilies, ["coinbase", "agent402", "agentictrade", "mpp"]);
  assert.equal(result.sources["coinbase-bazaar"].bestTargetRank, 2);
  assert.equal(result.sources["coinbase-bazaar"].competitorsAboveTarget.length, 1);
  assert.equal(result.sources["coinbase-bazaar"].targetResults[0].rank, 2);
  assert.equal(result.sources["agent402-router"].bestTargetRank, 1);
  assert.equal(result.sources["official-mpp-catalog"].expectedRouteFound, true);
  assert.deepEqual(result.summary.missingSources, ["circle-marketplace"]);
  assert.equal(result.summary.topThreeSourceCount, 5);
  assert.ok(result.findings.some((finding) => finding.source === "circle-marketplace" && finding.finding === "target_absent_from_ranked_results"));
  assert.ok(result.nextActions.some((action) => action.source === "circle-marketplace"));
  assert.equal(result.safety.paymentSentToCatalogs, false);
  assert.equal(result.input.brandBlind, true);
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
    throw new Error(`unexpected ${target}`);
  };
  const result = await agentDiscoverabilityAudit({
    origin: "https://api.example.com",
    intent: "extract a public website into structured JSON metadata",
  }, { fetchImpl, now: 0 });
  assert.equal(result.summary.availableSourceCount, 5);
  assert.deepEqual(result.summary.unavailableSources, ["coinbase-bazaar"]);
  assert.equal(result.sources["coinbase-bazaar"].status, "error");
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
