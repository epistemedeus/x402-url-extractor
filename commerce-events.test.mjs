import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { declareDiscoveryContract } from "./discovery-contract.mjs";

import {
  classifyAgentDiscoverySource,
  classifyDeclaredAgentDiscoverySource,
  classifyCommerceResult,
  classifyCommerceRoute,
  classifyPaymentFailureCode,
  createCommerceTelemetry,
  isSemanticUnmatched,
  normalizeCommercePayerClasses,
} from "./commerce-events.mjs";

declareDiscoveryContract({
  routeKey: "GET /extract",
  input: { url: "https://example.com" },
  inputSchema: {
    type: "object",
    properties: { url: { type: "string" } },
    required: ["url"],
  },
  output: { example: { ok: true } },
  outputSchema: {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
  },
});

test("agent discovery sources reduce user agents to controlled labels", () => {
  assert.equal(classifyAgentDiscoverySource("Agent402/1.0"), "agent402");
  assert.equal(classifyAgentDiscoverySource("Coinbase CDP x402 Bazaar Indexer"), "coinbase-bazaar");
  assert.equal(classifyAgentDiscoverySource("Circle x402 Agent Marketplace"), "circle-agent-marketplace");
  assert.equal(classifyAgentDiscoverySource("ModelContextProtocol MCP-Registry/1.0"), "mcp-registry");
  assert.equal(classifyAgentDiscoverySource("Smithery crawler"), "smithery");
  assert.equal(classifyAgentDiscoverySource("Glama MCP Connector Indexer"), "glama");
  assert.equal(classifyAgentDiscoverySource("compatible; OAI-SearchBot/1.4"), "openai-search");
  assert.equal(classifyAgentDiscoverySource("compatible; ChatGPT-User/1.0"), "openai-user");
  assert.equal(classifyAgentDiscoverySource("compatible; GPTBot/1.4"), "openai-training");
  assert.equal(classifyAgentDiscoverySource("Claude-SearchBot/1.0"), "anthropic-search");
  assert.equal(classifyAgentDiscoverySource("Claude-User/1.0"), "anthropic-user");
  assert.equal(classifyAgentDiscoverySource("ClaudeBot/1.0"), "anthropic-training");
  assert.equal(classifyAgentDiscoverySource("compatible; PerplexityBot/1.0"), "perplexity-search");
  assert.equal(classifyAgentDiscoverySource("compatible; Perplexity-User/1.0"), "perplexity-user");
  assert.equal(classifyAgentDiscoverySource("Google-CloudVertexBot/1.0"), "google-vertex-agent");
  assert.equal(classifyAgentDiscoverySource("Google-Extended"), null);
  assert.equal(classifyAgentDiscoverySource("OAI-AdsBot/1.0"), "generic-agent-indexer");
  assert.equal(classifyAgentDiscoverySource("myGPTBotClone/1.0"), "generic-agent-indexer");
  assert.equal(classifyAgentDiscoverySource("ExampleBot/1.0"), "generic-agent-indexer");
  assert.equal(classifyAgentDiscoverySource("Mozilla/5.0"), null);
  assert.equal(classifyDeclaredAgentDiscoverySource("agent-skills-v1"), "agent-skills");
  assert.equal(classifyDeclaredAgentDiscoverySource(" AGENT-SKILLS-V1 "), "agent-skills");
  assert.equal(classifyDeclaredAgentDiscoverySource("agentictrade-v1"), "agentictrade");
  assert.equal(classifyDeclaredAgentDiscoverySource(" AGENTICTRADE-V1 "), "agentictrade");
  assert.equal(classifyDeclaredAgentDiscoverySource("aws-agentcore-v1"), "aws-agentcore");
  assert.equal(classifyDeclaredAgentDiscoverySource(" AWS-AGENTCORE-V1 "), "aws-agentcore");
  assert.equal(classifyDeclaredAgentDiscoverySource("unknown-client"), null);
});

test("declared AgenticTrade handoff enters the paid-route funnel without exposing the source token", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-agentictrade-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
    agentSourceDetailSince: "2020-01-01T00:00:00.000Z",
  });
  const listeners = new Map();
  const req = {
    path: "/commerce/payment-offer-preflight",
    url: "/commerce/payment-offer-preflight?url=https%3A%2F%2Fexample.com",
    method: "GET",
    headers: {
      "user-agent": "curl/8.0",
      "x-samedaydesk-agent-source": "agentictrade-v1",
    },
    query: { url: "https://example.com" },
    ip: "203.0.113.90",
    socket: {},
  };
  const res = {
    statusCode: 402,
    once(name, listener) { listeners.set(name, listener); },
    getHeader() { return undefined; },
  };
  telemetry.middleware(req, res, () => {});
  listeners.get("finish")?.();
  await telemetry.flush();

  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.agentDiscoveryBySource.agentictrade, 1);
  assert.equal(snapshot.agentChallengeBySource.agentictrade, 1);
  assert.equal(snapshot.agentSourceFunnel.agentictrade.challengeActors, 1);
  assert.equal(JSON.stringify(snapshot).includes("agentictrade-v1"), false);
  await rm(dataDir, { recursive: true, force: true });
});

test("constructed request telemetry is prospective, contract-derived, aggregate, and value-free", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-constructed-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
    requestConstructionSince: "2020-01-01T00:00:00.000Z",
  });

  function run({ query, ip }) {
    const listeners = new Map();
    const req = {
      path: "/extract",
      url: "/extract",
      method: "GET",
      headers: {
        "user-agent": "Agent402/1.0",
      },
      query,
      ip,
      socket: {},
    };
    const res = {
      statusCode: 402,
      once(name, listener) { listeners.set(name, listener); },
      getHeader() { return undefined; },
    };
    telemetry.middleware(req, res, () => {});
    listeners.get("finish")?.();
  }

  run({ query: {}, ip: "203.0.113.91" });
  run({ query: { url: "https://private.example/path?secret=do-not-publish" }, ip: "203.0.113.92" });
  run({ query: { url: "https://private.example/other" }, ip: "203.0.113.93" });
  await telemetry.flush();

  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.constructedRequestEvents, 2);
  assert.equal(snapshot.constructedRequestActors, 2);
  assert.equal(snapshot.repeatConstructedRequestActors, 0);
  assert.deepEqual({ ...snapshot.constructedRequestBySource }, { agent402: 2 });
  assert.deepEqual(snapshot.constructedRequestActorsBySource, { agent402: 2 });
  assert.deepEqual(snapshot.repeatConstructedRequestActorsBySource, { agent402: 0 });
  assert.deepEqual({ ...snapshot.constructedRequestByRoute }, { "/extract": 2 });
  assert.deepEqual(
    Object.fromEntries(Object.entries(snapshot.constructedRequestBySourceRoute).map(([source, routes]) => [
      source,
      { ...routes },
    ])),
    { agent402: { "/extract": 2 } },
  );
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("private.example"), false);
  assert.equal(serialized.includes("do-not-publish"), false);
  assert.equal(serialized.includes("203.0.113.92"), false);
  assert.match(snapshot.requestConstructionPolicy, /key presence is inspected/);
  assert.match(snapshot.requestConstructionPolicy, /neither input validity, buyer intent, payment authorization, settlement, nor demand/);
  await rm(dataDir, { recursive: true, force: true });
});

test("provider user fetchers enter the prospective source-quality cohort", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-provider-sources-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
    agentSourceDetailSince: "2020-01-01T00:00:00.000Z",
  });

  function run({ userAgent, requestPath, status, ip }) {
    const listeners = new Map();
    const req = {
      path: requestPath,
      url: requestPath,
      method: "GET",
      headers: { "user-agent": userAgent },
      query: {},
      ip,
      socket: {},
    };
    const res = {
      statusCode: status,
      once(name, listener) { listeners.set(name, listener); },
      getHeader() { return undefined; },
    };
    telemetry.middleware(req, res, () => {});
    listeners.get("finish")?.();
  }

  run({
    userAgent: "Mozilla/5.0 compatible; ChatGPT-User/1.0",
    requestPath: "/openapi.json",
    status: 200,
    ip: "203.0.113.80",
  });
  run({
    userAgent: "Mozilla/5.0 compatible; ChatGPT-User/1.0",
    requestPath: "/extract",
    status: 402,
    ip: "203.0.113.80",
  });
  run({
    userAgent: "Claude-User/1.0",
    requestPath: "/openapi.json",
    status: 200,
    ip: "203.0.113.81",
  });
  run({
    userAgent: "Perplexity-User/1.0",
    requestPath: "/extract",
    status: 402,
    ip: "203.0.113.82",
  });
  await telemetry.flush();

  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.externalEvents, 0);
  assert.equal(snapshot.agentSourceDetailObservations, 4);
  assert.equal(snapshot.agentSourceDetailActors, 3);
  assert.equal(snapshot.agentSourceDetailFunnel["openai-user"].discoveryActors, 1);
  assert.equal(snapshot.agentSourceDetailFunnel["openai-user"].repeatDiscoveryActors, 1);
  assert.equal(snapshot.agentSourceDetailFunnel["openai-user"].challengeActors, 1);
  assert.equal(snapshot.agentSourceDetailFunnel["anthropic-user"].challengeActors, 0);
  assert.equal(snapshot.agentSourceDetailFunnel["perplexity-user"].challengeActors, 1);
  assert.equal(snapshot.agentSourceDetailFunnel["perplexity-user"].challengeActorRate, 1);
  assert.equal(JSON.stringify(snapshot).includes("ChatGPT-User/1.0"), false);

  await rm(dataDir, { recursive: true, force: true });
});

test("declared Agent Skills traffic enters the measured challenge funnel without storing the raw header", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-agent-skills-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
    agentSourceDetailSince: "2020-01-01T00:00:00.000Z",
  });

  function run({ requestPath, status, ip, declaredSource = "agent-skills-v1" }) {
    const listeners = new Map();
    const req = {
      path: requestPath,
      url: requestPath,
      method: "GET",
      headers: {
        "user-agent": "curl/8.0",
        "x-samedaydesk-agent-source": declaredSource,
      },
      query: {},
      ip,
      socket: {},
    };
    const res = {
      statusCode: status,
      once(name, listener) { listeners.set(name, listener); },
      getHeader() { return undefined; },
    };
    telemetry.middleware(req, res, () => {});
    listeners.get("finish")?.();
  }

  run({ requestPath: "/openapi.json", status: 200, ip: "203.0.113.70" });
  run({ requestPath: "/extract", status: 402, ip: "203.0.113.71" });
  run({ requestPath: "/skill.md", status: 200, ip: "203.0.113.70" });
  run({
    requestPath: "/wallet-enrich",
    status: 402,
    ip: "203.0.113.72",
    declaredSource: " AWS-AGENTCORE-V1 ",
  });
  await telemetry.flush();

  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.agentDiscoveryObservations, 4);
  assert.equal(snapshot.agentDiscoveryBySource["agent-skills"], 3);
  assert.equal(snapshot.agentDiscoveryBySource["aws-agentcore"], 1);
  assert.equal(snapshot.agentPaidRouteObservations, 2);
  assert.equal(snapshot.agentChallengeObservations, 2);
  assert.equal(snapshot.agentChallengeBySource["agent-skills"], 1);
  assert.equal(snapshot.agentChallengeBySource["aws-agentcore"], 1);
  assert.deepEqual(snapshot.agentSourceFunnel["agent-skills"], {
    discoveryObservations: 3,
    discoveryActors: 2,
    repeatDiscoveryActors: 1,
    paidRouteObservations: 1,
    paidRouteActors: 1,
    repeatPaidRouteActors: 0,
    challengeObservations: 1,
    challengeActors: 1,
    repeatChallengeActors: 0,
    challengeObservationRate: 1,
    challengeActorRate: 1,
    credentialAttemptEvents: 0,
    credentialAttemptActors: 0,
    repeatCredentialAttemptActors: 0,
    challengeConvertedPaidSuccesses: 0,
    challengeConvertedActors: 0,
    challengeActorConversionRate: 0,
    paidSuccesses: 0,
    paidSuccessActors: 0,
    repeatPaidSuccessActors: 0,
    independentPaidSuccesses: 0,
    independentPaidSuccessActors: 0,
  });
  assert.equal(snapshot.agentSourceTaxonomyVersion, "ai-provider-purpose-v1");
  assert.equal(snapshot.agentSourceTaxonomyLabels.length, 9);
  assert.equal(snapshot.agentSourceDetailObservations, 4);
  assert.equal(snapshot.agentSourceDetailActors, 3);
  assert.deepEqual(
    snapshot.agentSourceDetailFunnel["agent-skills"],
    snapshot.agentSourceFunnel["agent-skills"],
  );
  assert.deepEqual(snapshot.agentSourceFunnel["aws-agentcore"], {
    discoveryObservations: 1,
    discoveryActors: 1,
    repeatDiscoveryActors: 0,
    paidRouteObservations: 1,
    paidRouteActors: 1,
    repeatPaidRouteActors: 0,
    challengeObservations: 1,
    challengeActors: 1,
    repeatChallengeActors: 0,
    challengeObservationRate: 1,
    challengeActorRate: 1,
    credentialAttemptEvents: 0,
    credentialAttemptActors: 0,
    repeatCredentialAttemptActors: 0,
    challengeConvertedPaidSuccesses: 0,
    challengeConvertedActors: 0,
    challengeActorConversionRate: 0,
    paidSuccesses: 0,
    paidSuccessActors: 0,
    repeatPaidSuccessActors: 0,
    independentPaidSuccesses: 0,
    independentPaidSuccessActors: 0,
  });
  assert.equal(snapshot.externalEvents, 0);
  assert.equal(JSON.stringify(snapshot).includes("agent-skills-v1"), false);
  assert.equal(JSON.stringify(snapshot).includes("aws-agentcore-v1"), false);

  await rm(dataDir, { recursive: true, force: true });
});

test("payer classification policy validates controlled explicit labels", () => {
  const classes = normalizeCommercePayerClasses([
    { address: "0x1111111111111111111111111111111111111111", class: "validation" },
  ]);
  assert.equal(classes.get("0x1111111111111111111111111111111111111111"), "validation");
  assert.throws(() => normalizeCommercePayerClasses("not json"), /valid JSON/);
  assert.throws(() => normalizeCommercePayerClasses([{ address: "0x1234", class: "independent" }]), /address is invalid/);
  assert.throws(() => normalizeCommercePayerClasses([{ address: "0x1111111111111111111111111111111111111111", class: "organic" }]), /class is invalid/);
});

test("route classification preserves useful intent without recording opaque path values", () => {
  assert.deepEqual(classifyCommerceRoute("/defi/morpho-position"), {
    route: "/defi/morpho-position",
    kind: "paid",
    matched: true,
  });
  assert.deepEqual(classifyCommerceRoute("/platforms/gofrantic"), {
    route: "/platforms/:platformId",
    kind: "discovery",
    matched: true,
  });
  assert.equal(classifyCommerceRoute("/morpho/0x4352cc849b33a936ad93bb109afdec1c89653b4f").route, "/morpho/*");
  assert.equal(classifyCommerceRoute("/someone@example.com/private").route, "/:opaque/*");
  assert.equal(classifyCommerceRoute("/integrations/the402/webhook").kind, "excluded");
  assert.equal(classifyCommerceRoute("/.well-known/x402.json").route, "/.well-known/x402");
  assert.equal(classifyCommerceRoute("/api/x402").route, "/.well-known/x402");
  assert.equal(classifyCommerceRoute("/openapi.yaml").route, "/openapi.json");
  assert.equal(classifyCommerceRoute("/swagger.json").route, "/openapi.json");
  assert.equal(classifyCommerceRoute("/SKILL.md").route, "/skill.md");
  assert.equal(classifyCommerceRoute("/api/actions").route, "/api/actions");
  assert.equal(classifyCommerceRoute("/.well-known/agent.json").route, "/.well-known/agent-card.json");
  assert.equal(classifyCommerceRoute("/.well-known/glama.json").route, "/.well-known/glama.json");
  assert.equal(classifyCommerceRoute("/a2a/message:send").route, "/a2a/message:send");
  assert.deepEqual(classifyCommerceRoute("/schemas/wallet-policy-conformance-v1.json"), {
    route: "/schemas/wallet-policy-conformance-v1.json",
    kind: "discovery",
    matched: true,
  });
  assert.deepEqual(classifyCommerceRoute("/schemas/stateful-wallet-policy-conformance-v1.json"), {
    route: "/schemas/stateful-wallet-policy-conformance-v1.json",
    kind: "discovery",
    matched: true,
  });
  assert.equal(classifyCommerceRoute("/work/opportunity-preflight").kind, "paid");
  assert.equal(classifyCommerceRoute("/distribution/agent-discoverability-audit").kind, "paid");
  assert.equal(classifyCommerceRoute("/commerce/payment-offer-preflight").kind, "paid");
  assert.equal(classifyCommerceRoute("/commerce/seller-integrity-audit").kind, "paid");
  assert.equal(classifyCommerceRoute("/commerce/contract-qualified-search").kind, "paid");
  assert.deepEqual(classifyCommerceRoute("/commerce/settlement-proof"), {
    route: "/commerce/settlement-proof",
    kind: "paid",
    matched: true,
  });
  assert.deepEqual(classifyCommerceRoute("/chain/transaction-receipt"), {
    route: "/chain/transaction-receipt",
    kind: "paid",
    matched: true,
  });
  assert.equal(classifyCommerceRoute("/security/wallet-policy-conformance").kind, "paid");
  assert.equal(classifyCommerceRoute("/security/stateful-wallet-policy-conformance").kind, "paid");
  assert.deepEqual(classifyCommerceRoute("/mcp/sse"), {
    route: "/mcp/sse",
    kind: "unmatched",
    matched: false,
  });
  assert.equal(classifyCommerceRoute("/mcp/private-token").route, "/mcp/*");
});

test("paid response classes separate challenge, validation, success, and failure", () => {
  assert.equal(classifyCommerceResult({ kind: "paid", matched: true, paymentPresent: false, status: 402 }), "challenge");
  assert.equal(classifyCommerceResult({ kind: "paid", matched: true, paymentPresent: true, status: 400 }), "validation_failure");
  assert.equal(classifyCommerceResult({ kind: "paid", matched: true, paymentPresent: true, status: 200 }), "paid_success");
  assert.equal(classifyCommerceResult({ kind: "paid", matched: true, paymentPresent: true, replayed: true, status: 200 }), "replay_success");
  assert.equal(classifyCommerceResult({ kind: "paid", matched: true, paymentPresent: true, status: 503 }), "service_failure");
  assert.equal(classifyCommerceResult({ kind: "unmatched", matched: false, paymentPresent: false, status: 404 }), "unmatched");
  assert.equal(classifyCommerceResult({ route: "/mcp", kind: "paid", matched: true, paymentPresent: false, status: 200 }), "protocol_discovery");
});

test("payment failure codes stay bounded and preserve required-input aliases", () => {
  assert.equal(classifyPaymentFailureCode({ route: "/extract", status: 402, queryKeys: [] }), "missing_required_input");
  assert.equal(classifyPaymentFailureCode({ route: "/enrich", status: 402, queryKeys: ["url"] }), "payment_verification_failed");
  assert.equal(classifyPaymentFailureCode({ route: "/wallet-enrich", status: 402, queryKeys: ["wallet"], error: "authorization signature mismatch" }), "signature_invalid");
  assert.equal(classifyPaymentFailureCode({ route: "/extract", status: 402, queryKeys: ["url"], error: "extension_echo_mismatch" }), "extension_mismatch");
  assert.equal(classifyPaymentFailureCode({ route: "/extract", status: 503, queryKeys: ["url"] }), "payment_service_unavailable");
  assert.equal(classifyPaymentFailureCode({ route: "/extract", status: 200, queryKeys: [] }), null);
});

test("unpaid paid-POST requests do not persist application telemetry", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-unpaid-post-"));
  const telemetry = createCommerceTelemetry({ dataDir, secret: "test-secret" });
  for (const statusCode of [400, 402]) {
    const listeners = new Map();
    telemetry.middleware({
      path: "/commerce/payment-offer-preflight",
      url: "/commerce/payment-offer-preflight",
      method: "POST",
      headers: {},
      query: {},
      ip: "203.0.113.91",
      socket: {},
    }, {
      statusCode,
      once(name, listener) { listeners.set(name, listener); },
      getHeader() { return undefined; },
    }, () => {});
    listeners.get("finish")?.();
  }
  await telemetry.flush();
  const contents = await readFile(telemetry.paths.currentPath, "utf8").catch((error) => (
    error?.code === "ENOENT" ? "" : Promise.reject(error)
  ));
  assert.equal(contents, "");
  await rm(dataDir, { recursive: true, force: true });
});

test("semantic unmatched classification is high precision and excludes technical misses", () => {
  assert.equal(isSemanticUnmatched({ route: "/morpho-risk/*", kind: "unmatched", matched: false, status: 404 }), true);
  assert.equal(isSemanticUnmatched({ route: "/repository-audit/*", kind: "unmatched", matched: false, status: 404 }), true);
  assert.equal(isSemanticUnmatched({ route: "/assets/*", kind: "unmatched", matched: false, status: 404 }), false);
  assert.equal(isSemanticUnmatched({ route: "/:opaque/*", kind: "unmatched", matched: false, status: 404 }), false);
  assert.equal(isSemanticUnmatched({ route: "/mcp/sse", kind: "unmatched", matched: false, status: 404 }), true);
  assert.equal(isSemanticUnmatched({ route: "/mcp/*", kind: "unmatched", matched: false, status: 404 }), false);
  assert.equal(isSemanticUnmatched({ route: "/schemas/*", kind: "unmatched", matched: false, status: 404 }), false);
  assert.equal(isSemanticUnmatched({ route: "/defi/morpho-position", kind: "paid", matched: true, status: 402 }), false);
});

test("aggregate snapshot excludes internal and crawler events and exposes no actor IDs", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-events-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    internalToken: "owner-canary",
    settlementEvidenceSince: "2020-01-01T00:00:00.000Z",
    mcpTransportProbeSince: "2020-01-01T00:00:00.000Z",
    payerClasses: [{ address: "0x1111111111111111111111111111111111111111", class: "validation" }],
    maxBytes: 1024 * 1024,
  });

  function run({ path: requestPath, status = 200, headers = {}, responseHeaders = {}, query = {}, ip = "203.0.113.10" }) {
    const listeners = new Map();
    const req = {
      path: requestPath,
      url: requestPath,
      method: "GET",
      headers,
      query,
      ip,
      socket: {},
    };
    const res = {
      statusCode: status,
      once(name, listener) {
        listeners.set(name, listener);
      },
      getHeader(name) {
        return responseHeaders[String(name).toLowerCase()];
      },
    };
    telemetry.middleware(req, res, () => {});
    listeners.get("finish")?.();
  }

  run({ path: "/.well-known/x402", status: 200 });
  run({
    path: "/defi/morpho-position",
    status: 402,
    query: { address: "secret-value" },
    responseHeaders: {
      "payment-required": "opaque-x402-challenge",
      "www-authenticate": "Payment id=opaque",
    },
  });
  const paymentSignature = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: { scheme: "exact", network: "eip155:8453", amount: "20000", asset: "0x2222222222222222222222222222222222222222", payTo: "0x3333333333333333333333333333333333333333" },
    payload: { authorization: { from: "0x1111111111111111111111111111111111111111" } },
    extensions: { "payment-identifier": { info: { id: "order_1234567890abcdef" } } },
  })).toString("base64");
  const settlementReference = `0x${"3".repeat(64)}`;
  const paymentResponse = Buffer.from(JSON.stringify({
    success: true,
    transaction: settlementReference,
    amount: "20000",
    network: "eip155:8453",
  })).toString("base64");
  run({ path: "/defi/morpho-position", status: 200, headers: { "payment-signature": paymentSignature }, responseHeaders: { "payment-response": paymentResponse } });
  run({ path: "/defi/morpho-position", status: 200, headers: { "payment-signature": paymentSignature }, responseHeaders: { "payment-response": paymentResponse, "x-payment-replay": "hit" } });
  run({ path: "/mcp", status: 200 });
  run({ path: "/owner", status: 404, headers: { "x-samedaydesk-internal": "owner-canary" } });
  run({ path: "/crawler", status: 404, headers: { "user-agent": "ExampleBot/1.0" } });
  run({ path: "/mcp", status: 200, headers: { "user-agent": "SentinelOracle/0.1 liveness-only" } });
  run({ path: "/extract", status: 402, headers: { "user-agent": "AgentReeve/5.1" } });
  run({ path: "/openapi.json", status: 200, headers: { "user-agent": "Agent402/1.0" } });
  run({ path: "/defi/morpho-position", status: 402, headers: { "user-agent": "entropy-daemon-trust-oracle/2.0" } });
  run({ path: "/.env.production", status: 404, headers: { "user-agent": "Mozilla/5.0" } });
  run({ path: "/.git/HEAD", status: 404, headers: { "user-agent": "Mozilla/5.0" } });
  run({ path: "/wp-json/", status: 404, headers: { "user-agent": "Mozilla/5.0" } });
  run({ path: "/api/config", status: 404, headers: { "user-agent": "Mozilla/5.0" } });
  run({ path: "/js/env.js", status: 404, headers: { "user-agent": "Mozilla/5.0" } });
  run({ path: "/deep-audit", status: 402, headers: { "user-agent": "litebeam-probe/1.0" } });
  run({ path: "/openapi.json", status: 200, headers: { "user-agent": "SameDayDesk-Agent402-Integrity/0.1" } });
  run({ path: "/morpho-risk/quote", status: 404 });
  run({ path: "/mcp/sse", status: 404 });
  run({ path: "/assets/logo.svg", status: 404 });
  run({ path: "/someone@example.com/private", status: 404 });
  run({ path: "/schemas/wallet-policy-conformance-v1.json", status: 200 });
  run({ path: "/security/wallet-policy-conformance", status: 402 });

  await telemetry.flush();
  const storage = await telemetry.storageStatus();
  assert.equal(storage.ready, true);
  assert.ok(storage.currentBytes > 0);
  assert.equal(storage.boundedBytes, 2 * 1024 * 1024);
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.externalEvents, 11);
  assert.equal(snapshot.externalActors, 1);
  assert.equal(snapshot.repeatExternalActors, 1);
  assert.equal(snapshot.byResult.discovery, 2);
  assert.equal(snapshot.byResult.challenge, 2);
  assert.equal(snapshot.byResult.paid_success, 1);
  assert.equal(snapshot.byResult.replay_success, 1);
  assert.equal(snapshot.replaySuccessEvents, 1);
  assert.equal(snapshot.paidSuccessActors, 1);
  assert.equal(snapshot.repeatPaidSuccessActors, 0);
  assert.equal(snapshot.independentPaidSuccessActors, 0);
  assert.equal(snapshot.repeatIndependentPaidSuccessActors, 0);
  assert.equal(snapshot.agentDiscoveryObservations, 5);
  assert.equal(snapshot.agentDiscoveryActors, 5);
  assert.equal(snapshot.repeatAgentDiscoveryActors, 0);
  assert.equal(snapshot.agentDiscoveryBySource.agent402, 1);
  assert.equal(snapshot.agentDiscoveryBySource["generic-agent-indexer"], 4);
  assert.equal(snapshot.agentDiscoveryByRoute["/openapi.json"], 1);
  assert.equal(snapshot.agentDiscoveryBySourceRoute.agent402["/openapi.json"], 1);
  assert.equal(snapshot.agentPaidRouteObservations, 4);
  assert.equal(snapshot.agentChallengeObservations, 3);
  assert.equal(snapshot.agentChallengeActors, 3);
  assert.equal(snapshot.repeatAgentChallengeActors, 0);
  assert.equal(snapshot.agentChallengeRate, 0.75);
  assert.equal(snapshot.agentChallengeBySource["generic-agent-indexer"], 3);
  assert.equal(snapshot.agentChallengeByRoute["/extract"], 1);
  assert.equal(snapshot.agentChallengeByRoute["/defi/morpho-position"], 1);
  assert.equal(snapshot.agentChallengeByRoute["/deep-audit"], 1);
  assert.equal(snapshot.agentChallengeBySourceRoute["generic-agent-indexer"]["/extract"], 1);
  assert.equal(snapshot.agentChallengeConvertedPaidSuccesses, 0);
  assert.equal(snapshot.agentChallengeConvertedActors, 0);
  assert.equal(snapshot.independentAgentChallengeConvertedActors, 0);
  assert.equal(snapshot.agentChallengeActorConversionRate, 0);
  assert.equal(snapshot.paymentHeaderEvents, 2);
  assert.equal(snapshot.parseableCredentialAttemptEvents, 2);
  assert.equal(snapshot.unparseablePaymentHeaderEvents, 0);
  assert.equal(snapshot.parseableCredentialAttemptActors, 1);
  assert.equal(snapshot.repeatParseableCredentialAttemptActors, 1);
  assert.equal(snapshot.credentialAttemptByProtocol.x402, 2);
  assert.equal(snapshot.credentialAttemptByResult.paid_success, 1);
  assert.equal(snapshot.credentialAttemptByResult.replay_success, 1);
  assert.equal(snapshot.credentialAttemptByClass.validation, 2);
  assert.equal(snapshot.paidSuccessByClass.validation, 1);
  assert.equal(snapshot.paidSuccessByClassRoute.validation["/defi/morpho-position"], 1);
  assert.equal(snapshot.settlementReferenceEligiblePaidSuccesses, 1);
  assert.equal(snapshot.settlementReferencePaidSuccesses, 1);
  assert.equal(snapshot.missingSettlementReferencePaidSuccesses, 0);
  assert.equal(snapshot.distinctSettlementReferences, 1);
  assert.equal(snapshot.settlementReferenceCoverage, 1);
  assert.deepEqual({ ...snapshot.settlementEvidenceByClass.validation }, {
    paidSuccesses: 1,
    withReference: 1,
    missingReference: 0,
  });
  assert.equal(snapshot.paidSuccessByRoute["/defi/morpho-position"], 1);
  assert.equal(snapshot.paidSuccessByProtocol.x402, 1);
  assert.equal(snapshot.byProtocolResult.mpp_challenge, 1);
  assert.equal(snapshot.byProtocolResult.x402_challenge, 1);
  assert.equal(snapshot.byProtocolResult.x402_paid_success, 1);
  assert.equal(snapshot.paymentIdentifierEvents, 2);
  assert.equal(snapshot.byResult.protocol_discovery, 1);
  assert.equal(snapshot.byResult.unmatched, 4);
  assert.equal(snapshot.unmatchedRequests["/morpho-risk/*"], 1);
  assert.equal(snapshot.unmatchedRequests["/mcp/sse"], 1);
  assert.equal(snapshot.unmatchedRequests["/assets/*"], 1);
  assert.equal(snapshot.unmatchedRequests["/:opaque/*"], 1);
  assert.equal(snapshot.mcpTransportProbeEvents, 1);
  assert.equal(snapshot.mcpTransportProbeActors, 1);
  assert.equal(snapshot.repeatMcpTransportProbeActors, 0);
  assert.deepEqual({ ...snapshot.mcpTransportProbeByRoute }, { "/mcp/sse": 1 });
  assert.equal(snapshot.semanticUnmatchedEvents, 2);
  assert.equal(snapshot.semanticUnmatchedActors, 1);
  assert.equal(snapshot.repeatSemanticUnmatchedActors, 1);
  assert.deepEqual({ ...snapshot.semanticUnmatched }, { "/morpho-risk/*": 1, "/mcp/sse": 1 });
  assert.deepEqual(snapshot.policyContractFunnel.exactAction, {
    contractRoute: "/schemas/wallet-policy-conformance-v1.json",
    paidRoute: "/security/wallet-policy-conformance",
    contractReads: 1,
    contractActors: 1,
    challengeContinuationActors: 1,
    credentialContinuationActors: 0,
    paidDeliveryContinuationActors: 0,
  });
  assert.equal(snapshot.policyContractFunnel.stateful.contractReads, 0);
  assert.match(snapshot.policyContractFunnelPolicy, /Historical \/schemas\/\*/);
  assert.equal(JSON.stringify(snapshot).includes("secret-value"), false);
  assert.equal(JSON.stringify(snapshot).includes("0x1111111111111111111111111111111111111111"), false);
  assert.equal(JSON.stringify(snapshot).includes(settlementReference), false);
  assert.equal(JSON.stringify(snapshot).includes("order_1234567890abcdef"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "actors"), false);
  assert.equal(JSON.stringify(snapshot).includes("0x1111111111111111111111111111111111111111"), false);

  await rm(dataDir, { recursive: true, force: true });
});

test("only explicitly classified independent payers enter independent demand", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-independent-"));
  const payer = "0x2222222222222222222222222222222222222222";
  const signature = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: { scheme: "exact", network: "eip155:8453", amount: "50000", asset: "0x4444444444444444444444444444444444444444", payTo: "0x5555555555555555555555555555555555555555" },
    payload: { authorization: { from: payer } },
  })).toString("base64");
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    settlementEvidenceSince: "2020-01-01T00:00:00.000Z",
    payerClasses: [{ address: payer, class: "independent" }],
  });

  function paidSuccess() {
    const listeners = new Map();
    const req = {
      path: "/extract", url: "/extract", method: "GET",
      headers: { "payment-signature": signature, "user-agent": "Agent402/1.0" }, query: {}, ip: "203.0.113.30", socket: {},
    };
    const res = {
      statusCode: 200,
      once(name, listener) { listeners.set(name, listener); },
      getHeader() { return undefined; },
    };
    telemetry.middleware(req, res, () => {});
    listeners.get("finish")?.();
  }

  paidSuccess();
  paidSuccess();
  await telemetry.flush();
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.paidSuccessByClass.independent, 2);
  assert.equal(snapshot.paidSuccessByClassRoute.independent["/extract"], 2);
  assert.equal(snapshot.paidSuccessByDiscoverySource.agent402, 2);
  assert.equal(snapshot.paidSuccessByDiscoverySourceRoute.agent402["/extract"], 2);
  assert.equal(snapshot.independentPaidSuccessByDiscoverySource.agent402, 2);
  assert.equal(snapshot.agentDiscoveryObservations, 0);
  assert.equal(snapshot.agentPaidRouteObservations, 0);
  assert.equal(snapshot.agentChallengeObservations, 0);
  assert.equal(snapshot.agentChallengeRate, null);
  assert.equal(snapshot.agentChallengeConvertedPaidSuccesses, 0);
  assert.equal(snapshot.agentChallengeConvertedActors, 0);
  assert.equal(snapshot.agentChallengeActorConversionRate, null);
  assert.equal(snapshot.parseableCredentialAttemptEvents, 2);
  assert.equal(snapshot.credentialAttemptByClass.independent, 2);
  assert.equal(snapshot.independentPaidSuccessActors, 1);
  assert.equal(snapshot.repeatIndependentPaidSuccessActors, 1);
  assert.equal(snapshot.settlementReferenceEligiblePaidSuccesses, 2);
  assert.equal(snapshot.missingSettlementReferencePaidSuccesses, 2);
  assert.equal(snapshot.settlementReferenceCoverage, 0);
  assert.equal(snapshot.settlementEvidenceByClass.independent.missingReference, 2);
  assert.equal(JSON.stringify(snapshot).includes(payer), false);
  await rm(dataDir, { recursive: true, force: true });
});

test("challenge conversion requires conservative same-actor continuity", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-challenge-conversion-"));
  const payer = "0x3333333333333333333333333333333333333333";
  const signature = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: { scheme: "exact", network: "eip155:8453", amount: "50000", asset: "0x6666666666666666666666666666666666666666", payTo: "0x7777777777777777777777777777777777777777" },
    payload: { authorization: { from: payer } },
  })).toString("base64");
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
    payerClasses: [{ address: payer, class: "independent" }],
  });

  function run({ headers, ip, status }) {
    const listeners = new Map();
    const req = {
      path: "/extract", url: "/extract", method: "GET",
      headers, query: { url: "not-stored" }, ip, socket: {},
    };
    const res = {
      statusCode: status,
      once(name, listener) { listeners.set(name, listener); },
      getHeader() { return undefined; },
    };
    telemetry.middleware(req, res, () => {});
    listeners.get("finish")?.();
  }

  const userAgent = "Agent402/2.0";
  run({ headers: { "user-agent": userAgent }, ip: "203.0.113.60", status: 402 });
  run({ headers: { "user-agent": userAgent, "payment-signature": signature }, ip: "203.0.113.60", status: 200 });
  run({ headers: { "user-agent": "DifferentBuyer/1.0", "payment-signature": signature }, ip: "203.0.113.61", status: 200 });

  await telemetry.flush();
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.agentChallengeObservations, 1);
  assert.equal(snapshot.agentChallengeActors, 1);
  assert.equal(snapshot.agentChallengeConvertedPaidSuccesses, 1);
  assert.equal(snapshot.agentChallengeConvertedActors, 1);
  assert.equal(snapshot.independentAgentChallengeConvertedActors, 1);
  assert.equal(snapshot.agentChallengeActorConversionRate, 1);
  assert.equal(snapshot.agentChallengeConvertedBySource.agent402, 1);
  assert.equal(snapshot.agentChallengeConvertedByClass.independent, 1);
  assert.deepEqual(snapshot.agentSourceFunnel.agent402, {
    discoveryObservations: 1,
    discoveryActors: 1,
    repeatDiscoveryActors: 0,
    paidRouteObservations: 1,
    paidRouteActors: 1,
    repeatPaidRouteActors: 0,
    challengeObservations: 1,
    challengeActors: 1,
    repeatChallengeActors: 0,
    challengeObservationRate: 1,
    challengeActorRate: 1,
    credentialAttemptEvents: 1,
    credentialAttemptActors: 1,
    repeatCredentialAttemptActors: 0,
    challengeConvertedPaidSuccesses: 1,
    challengeConvertedActors: 1,
    challengeActorConversionRate: 1,
    paidSuccesses: 1,
    paidSuccessActors: 1,
    repeatPaidSuccessActors: 0,
    independentPaidSuccesses: 1,
    independentPaidSuccessActors: 1,
  });
  assert.equal(snapshot.agentSourceFunnel["direct-or-unattributed"].credentialAttemptActors, 1);
  assert.equal(snapshot.agentSourceFunnel["direct-or-unattributed"].paidSuccessActors, 1);
  assert.equal(snapshot.agentSourceFunnel["direct-or-unattributed"].challengeActors, 0);
  assert.equal(snapshot.paidSuccessByClass.independent, 2);
  assert.equal(snapshot.paymentHeaderEvents, 2);
  assert.equal(snapshot.parseableCredentialAttemptEvents, 2);
  assert.equal(snapshot.unparseablePaymentHeaderEvents, 0);
  assert.equal(snapshot.parseableCredentialAttemptActors, 1);
  assert.equal(snapshot.repeatParseableCredentialAttemptActors, 1);
  assert.equal(snapshot.credentialAttemptByProtocol.x402, 2);
  assert.equal(snapshot.credentialAttemptByResult.paid_success, 2);
  assert.equal(snapshot.credentialAttemptByClass.independent, 2);
  assert.equal(JSON.stringify(snapshot).includes(payer), false);
  assert.equal(JSON.stringify(snapshot).includes("not-stored"), false);
  await rm(dataDir, { recursive: true, force: true });
});

test("aggregate snapshot honors a declared external experiment baseline", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-baseline-"));
  const externalSince = new Date(Date.now() + 60_000).toISOString();
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    externalSince,
  });
  const listeners = new Map();
  const req = {
    path: "/extract",
    url: "/extract",
    method: "GET",
    headers: {},
    query: { url: "not-stored" },
    ip: "203.0.113.20",
    socket: {},
  };
  const res = {
    statusCode: 402,
    once(name, listener) {
      listeners.set(name, listener);
    },
  };
  telemetry.middleware(req, res, () => {});
  listeners.get("finish")?.();
  await telemetry.flush();

  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.externalSince, externalSince);
  assert.equal(snapshot.externalEvents, 0);
  assert.equal(JSON.stringify(snapshot).includes("not-stored"), false);

  await rm(dataDir, { recursive: true, force: true });
});

test("machine discovery uses an independent baseline and excludes owned monitors", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-discovery-baseline-"));
  const baseline = new Date(Date.now() + 60_000).toISOString();
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    agentDiscoverySince: baseline,
  });

  function run(userAgent) {
    const listeners = new Map();
    const req = {
      path: "/openapi.json", url: "/openapi.json", method: "GET",
      headers: { "user-agent": userAgent }, query: {}, ip: "203.0.113.40", socket: {},
    };
    const res = {
      statusCode: 200,
      once(name, listener) { listeners.set(name, listener); },
      getHeader() { return undefined; },
    };
    telemetry.middleware(req, res, () => {});
    listeners.get("finish")?.();
  }

  run("Agent402/1.0");
  run("SameDayDesk-Agent402-Integrity/0.1");
  await telemetry.flush();
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.agentDiscoverySince, baseline);
  assert.equal(snapshot.agentDiscoveryObservations, 0);
  assert.equal(snapshot.agentPaidRouteObservations, 0);
  assert.equal(snapshot.agentChallengeObservations, 0);
  assert.equal(snapshot.agentChallengeRate, null);
  assert.equal(snapshot.agentChallengeConvertedPaidSuccesses, 0);
  assert.equal(snapshot.agentChallengeConvertedActors, 0);
  assert.equal(snapshot.agentChallengeActorConversionRate, null);
  assert.equal(snapshot.parseableCredentialAttemptEvents, 0);
  assert.equal(snapshot.unparseablePaymentHeaderEvents, 0);
  assert.equal(snapshot.externalEvents, 0);
  await rm(dataDir, { recursive: true, force: true });
});

test("provider source detail starts prospectively without reclassifying earlier events", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-source-detail-baseline-"));
  const detailBaseline = new Date(Date.now() + 60_000).toISOString();
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
    agentSourceDetailSince: detailBaseline,
  });
  const listeners = new Map();
  const req = {
    path: "/openapi.json",
    url: "/openapi.json",
    method: "GET",
    headers: { "user-agent": "OAI-SearchBot/1.4" },
    query: {},
    ip: "203.0.113.90",
    socket: {},
  };
  const res = {
    statusCode: 200,
    once(name, listener) { listeners.set(name, listener); },
    getHeader() { return undefined; },
  };
  telemetry.middleware(req, res, () => {});
  listeners.get("finish")?.();
  await telemetry.flush();

  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.agentDiscoveryBySource["openai-search"], 1);
  assert.equal(snapshot.agentSourceDetailSince, detailBaseline);
  assert.equal(snapshot.agentSourceDetailObservations, 0);
  assert.equal(snapshot.agentSourceDetailActors, 0);
  assert.equal(Object.keys(snapshot.agentSourceDetailFunnel).length, 0);

  await rm(dataDir, { recursive: true, force: true });
});
