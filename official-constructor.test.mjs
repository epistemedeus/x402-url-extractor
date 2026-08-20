import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCommerceTelemetry } from "./commerce-events.mjs";
import {
  classifyConstructor,
  classifyEvent,
  isConstructedChallenge,
  matchesPublishedExample,
} from "./official-constructor.mjs";

test("FX-01 official constructor families stay exactly three", () => {
  assert.deepEqual(classifyConstructor({ userAgent: "SameDayDesk-Monitor/0.1" }), {
    source: null,
    officialConstructor: false,
    excludedFromPublic: true,
  });
  assert.deepEqual(classifyConstructor({ userAgent: "Pilot-Canary/0.1" }), {
    source: null,
    officialConstructor: false,
    excludedFromPublic: true,
  });
  assert.deepEqual(classifyConstructor({ userAgent: "mppx/0.8.15", originClass: "owner_monitor" }), {
    source: null,
    officialConstructor: false,
    excludedFromPublic: true,
  });
  assert.deepEqual(classifyConstructor({ userAgent: "mppx/0.8.15", paymentClass: "internal" }), {
    source: null,
    officialConstructor: false,
    excludedFromPublic: true,
  });
  assert.deepEqual(classifyConstructor({ userAgent: "mppx/0.8.15", paymentClass: "validation" }), {
    source: null,
    officialConstructor: false,
    excludedFromPublic: true,
  });
  assert.deepEqual(classifyConstructor({ userAgent: "mppx/0.8.15" }), {
    source: "mppx",
    officialConstructor: true,
    excludedFromPublic: false,
  });
  assert.deepEqual(classifyConstructor({ userAgent: "pay/cli/1.0" }), {
    source: "solana-pay",
    officialConstructor: true,
    excludedFromPublic: false,
  });
  assert.deepEqual(classifyConstructor({ userAgent: "pay/mcp/1.0" }), {
    source: "solana-pay",
    officialConstructor: true,
    excludedFromPublic: false,
  });
  assert.deepEqual(classifyConstructor({ mcpClientInfoName: "mcpc" }), {
    source: "apify-mcpc",
    officialConstructor: true,
    excludedFromPublic: false,
  });
  assert.deepEqual(classifyConstructor({ userAgent: "Mozilla/5.0 Google-Agent" }), {
    source: "google-agent",
    officialConstructor: false,
    excludedFromPublic: false,
  });
  assert.deepEqual(classifyConstructor({ userAgent: "Agent402/1.0" }), {
    source: "agent402",
    officialConstructor: false,
    excludedFromPublic: false,
  });
  assert.deepEqual(classifyConstructor({ userAgent: "axios/1.7.0" }), {
    source: "generic-or-unattributed",
    officialConstructor: false,
    excludedFromPublic: false,
  });
  assert.deepEqual(classifyConstructor({ userAgent: "curl/8.0.0" }), {
    source: "generic-or-unattributed",
    officialConstructor: false,
    excludedFromPublic: false,
  });
  assert.deepEqual(classifyConstructor({ userAgent: "got/11.8.6" }), {
    source: "generic-or-unattributed",
    officialConstructor: false,
    excludedFromPublic: false,
  });
  assert.deepEqual(classifyConstructor({ userAgent: "Mozilla/5.0 Chrome/120.0.0.0" }), {
    source: "generic-or-unattributed",
    officialConstructor: false,
    excludedFromPublic: false,
  });
  assert.deepEqual(classifyConstructor({ declaredHeader: "agent-skills-v1" }), {
    source: "agent-skills",
    officialConstructor: false,
    excludedFromPublic: false,
  });
  assert.deepEqual(classifyConstructor({ declaredHeader: "agentictrade-v1" }), {
    source: "agentictrade",
    officialConstructor: false,
    excludedFromPublic: false,
  });
  assert.deepEqual(classifyConstructor({ declaredHeader: "aws-agentcore-v1" }), {
    source: "aws-agentcore",
    officialConstructor: false,
    excludedFromPublic: false,
  });
  assert.deepEqual([
    classifyConstructor({ declaredHeader: "glama-v1" }).source,
    classifyConstructor({ declaredHeader: "coinbase-bazaar" }).source,
    classifyConstructor({}).source,
  ], [
    "direct-or-unattributed",
    "direct-or-unattributed",
    "direct-or-unattributed",
  ]);
  assert.deepEqual([
    ...new Set([
      classifyConstructor({ userAgent: "mppx/0.8.15" }).source,
      classifyConstructor({ userAgent: "pay/cli/1.0" }).source,
      classifyConstructor({ userAgent: "pay/mcp/1.0" }).source,
      classifyConstructor({ mcpClientInfoName: "mcpc" }).source,
    ]),
  ].sort(), ["apify-mcpc", "mppx", "solana-pay"], "exactly three families");
});

test("FX-02 constructed challenge and public deltas", () => {
  const constructed = {
    method: "GET",
    kind: "paid",
    matched: true,
    status: 402,
    protocolsOffered: ["x402"],
    route: "/extract",
    query: { url: "https://other.example/resource" },
  };

  assert.equal(isConstructedChallenge(constructed), true);
  assert.equal(isConstructedChallenge({ ...constructed, protocolsOffered: ["mpp"] }), true);
  assert.equal(isConstructedChallenge({
    ...constructed,
    route: "/commerce/payment-offer-preflight",
  }), true);
  assert.equal(isConstructedChallenge({
    ...constructed,
    route: "/enrich",
    query: { domain: "other.example" },
  }), true);
  assert.equal(isConstructedChallenge({ ...constructed, query: {} }), false);
  assert.equal(isConstructedChallenge({ ...constructed, method: "HEAD" }), false);
  assert.equal(isConstructedChallenge({ ...constructed, method: "OPTIONS" }), false);
  assert.equal(isConstructedChallenge({
    method: "POST",
    kind: "paid",
    matched: true,
    status: 200,
    protocolsOffered: ["x402"],
    route: "/mcp",
    query: {},
  }), false);
  assert.equal(isConstructedChallenge({
    method: "GET",
    kind: "unmatched",
    matched: false,
    status: 404,
    protocolsOffered: ["x402"],
    route: "/missing",
    query: { url: "https://other.example/resource" },
  }), false);
  assert.equal(isConstructedChallenge({ ...constructed, status: 200 }), false);
  assert.equal(isConstructedChallenge({ ...constructed, query: { url: "" } }), false);
  assert.equal(isConstructedChallenge({ ...constructed, route: "/unknown" }), false);
  assert.equal(matchesPublishedExample({
    constructed: true,
    route: "/extract",
    query: { url: "https://example.com" },
  }), true);
  assert.equal(matchesPublishedExample({
    constructed: true,
    route: "/extract",
    query: { url: "https%3A%2F%2Fexample.com" },
  }), true);
  assert.deepEqual(classifyEvent({
    ...constructed,
    userAgent: "Agent402/1.0",
    originClass: "crawler",
  }), {
    source: "agent402",
    officialConstructor: false,
    excludedFromPublic: false,
    constructed: true,
    matchesPublishedExample: false,
    independentPaidSuccessActors: 0,
    agentConstructedObservations: 1,
    agentConstructedActors: 1,
    externalConstructedActors: 0,
    officialConstructorCoverage: [],
  });
  assert.deepEqual(classifyEvent({
    ...constructed,
    userAgent: "mppx/0.8.15",
    originClass: "external",
  }), {
    source: "mppx",
    officialConstructor: true,
    excludedFromPublic: false,
    constructed: true,
    matchesPublishedExample: false,
    independentPaidSuccessActors: 0,
    agentConstructedObservations: 0,
    agentConstructedActors: 0,
    externalConstructedActors: 1,
    officialConstructorCoverage: ["mppx"],
  });
  assert.deepEqual(classifyEvent({
    ...constructed,
    userAgent: "mppx/0.8.15",
    originClass: "external",
    query: { url: "https://example.com" },
  }), {
    source: "mppx",
    officialConstructor: true,
    excludedFromPublic: false,
    constructed: true,
    matchesPublishedExample: true,
    independentPaidSuccessActors: 0,
    agentConstructedObservations: 0,
    agentConstructedActors: 0,
    externalConstructedActors: 0,
    officialConstructorCoverage: [],
  });
  assert.equal(classifyEvent({
    userAgent: "mppx/0.8.15",
    originClass: "external",
    method: "GET",
    kind: "paid",
    matched: true,
    status: 200,
    protocolsOffered: ["x402"],
    route: "/extract",
    query: { url: "https://other.example/resource" },
  }).independentPaidSuccessActors, 0);
});

test("live demand snapshot emits official-constructor join without secrets", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "official-constructor-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    officialConstructorSince: "2020-01-01T00:00:00.000Z",
    requestConstructionSince: "2020-01-01T00:00:00.000Z",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
  });

  function run({ userAgent, query, status = 402, requestPath = "/extract", headers = {}, body, method = "GET" }) {
    const listeners = new Map();
    const req = {
      path: requestPath,
      url: requestPath,
      method,
      headers: { "user-agent": userAgent, ...headers },
      query,
      body,
      ip: `203.0.113.${Math.floor(Math.random() * 80) + 10}`,
      socket: {},
    };
    const res = {
      statusCode: status,
      once(name, listener) { listeners.set(name, listener); },
      getHeader(name) {
        if (String(name).toLowerCase() === "payment-required") return "opaque-x402-challenge";
        return undefined;
      },
    };
    telemetry.middleware(req, res, () => {});
    listeners.get("finish")?.();
  }

  run({
    userAgent: "mppx/0.8.15",
    query: { url: "https://other.example/private-resource" },
  });
  run({
    userAgent: "mppx/0.8.15",
    query: { url: "https://example.com" },
  });
  run({
    userAgent: "Agent402/1.0",
    query: { url: "https://other.example/crawler-resource" },
  });
  run({
    userAgent: "curl/8.0",
    query: {},
    requestPath: "/mcp",
    method: "POST",
    status: 200,
    body: { method: "initialize", params: { clientInfo: { name: "mcpc", version: "do-not-publish" } } },
  });
  await telemetry.flush();

  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.externalConstructedActors, 1);
  assert.deepEqual(snapshot.officialConstructorCoverage, ["mppx"]);
  assert.equal(snapshot.agentConstructedObservations, 1);
  assert.equal(snapshot.agentConstructedActors, 1);
  assert.equal(typeof snapshot.officialConstructorSince, "string");
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("other.example"), false);
  assert.equal(serialized.includes("private-resource"), false);
  assert.equal(serialized.includes("mppx/0.8.15"), false);
  assert.equal(serialized.includes("do-not-publish"), false);
  assert.equal(serialized.includes("constructedBySourceRoute"), false);
  assert.equal(Object.hasOwn(snapshot, "constructedBySourceRoute"), false);
  assert.ok(Object.hasOwn(snapshot, "constructedRequestEvents"));
  await rm(dataDir, { recursive: true, force: true });
});
