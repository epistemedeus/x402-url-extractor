import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { declareDiscoveryContract } from "./discovery-contract.mjs";

import { evaluateMcpTypedTelemetryOutcome } from "./mcp-typed-telemetry-producer.mjs";
import {
  adaptMcpTypedDecisionToCommerceEvent,
  classifyAgentDiscoverySource,
  classifyDeclaredAgentDiscoverySource,
  classifyCommerceResult,
  classifyCommerceRoute,
  classifyPaymentFailureCode,
  COMMERCE_COVERAGE_COMPLETE,
  COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW,
  COMMERCE_INTEGRITY_OK,
  COMMERCE_INTEGRITY_SOURCE_LOCAL_DRIFT,
  COMMERCE_INTEGRITY_UNUSABLE_RECORDS,
  conservativeRetainedUtcBounds,
  createCommerceTelemetry,
  describeRetentionCoverage,
  drainCommerceTelemetryForShutdown,
  isCanonicalMcpTypedCommerceEvent,
  isSemanticUnmatched,
  metricCoverageStatus,
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

declareDiscoveryContract({
  routeKey: "GET /deep-audit",
  input: { api_token: "example-placeholder" },
  inputSchema: {
    type: "object",
    properties: { api_token: { type: "string" } },
    required: ["api_token"],
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
  run({ query: { url: "" }, ip: "203.0.113.94" });
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
  assert.equal(Object.hasOwn(snapshot, "constructedRequestBySourceRoute"), false);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("private.example"), false);
  assert.equal(serialized.includes("do-not-publish"), false);
  assert.equal(serialized.includes("203.0.113.92"), false);
  assert.match(snapshot.requestConstructionPolicy, /non-empty scalar/);
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

function privacySafeEvent({
  ts,
  actor = "aaaaaaaaaaaaaaaaaaaaaaaa",
  originClass = "crawler",
  agentDiscoverySource = "agent402",
  method = "GET",
  route = "/extract",
  kind = "paid",
  matched = true,
  queryKeys = ["url"],
  requestConstruction = "constructed",
  status = 402,
  result = "challenge",
  ...rest
} = {}) {
  return {
    v: 3,
    id: "00000000-0000-4000-8000-000000000001",
    ts,
    actor,
    originClass,
    agentDiscoverySource,
    method,
    route,
    matched,
    kind,
    queryKeys,
    requestConstruction,
    requestConstructionRequiredKeyCount:
      requestConstruction === "constructed" || requestConstruction === "missing_required_input" ? 1 : 0,
    paymentPresent: false,
    paymentCredentialParsed: false,
    paymentProtocol: null,
    paymentFailureCode: null,
    protocolsOffered: ["x402"],
    replayed: false,
    paymentActor: null,
    paymentIdentifier: null,
    settlementReference: null,
    settlementAmountAtomic: null,
    settlementNetwork: null,
    settlementCurrency: null,
    status,
    result,
    durationMs: 1,
    ...rest,
  };
}

function discoveryEvent(ts, actor = "aaaaaaaaaaaaaaaaaaaaaaaa") {
  return privacySafeEvent({
    ts,
    actor,
    requestConstruction: "not_measured",
    route: "/openapi.json",
    kind: "discovery",
    matched: true,
    queryKeys: [],
    status: 200,
    result: "discovery",
  });
}

function constructedCrawlerEvent(ts, actor = "cccccccccccccccccccccccc") {
  return privacySafeEvent({
    ts,
    actor,
    originClass: "crawler",
    agentDiscoverySource: "agent402",
    route: "/extract",
    kind: "paid",
    matched: true,
    queryKeys: ["url"],
    requestConstruction: "constructed",
    status: 402,
    result: "challenge",
  });
}

function omitField(event, key) {
  const next = { ...event };
  delete next[key];
  return next;
}

function settledPaidSuccessEvent(ts, actor = "fedcbafedcbafedcbafedcba") {
  return {
    ...paidSuccessEvent(ts, actor),
    settlementReference: `0x${"ab".repeat(32)}`,
    settlementAmountAtomic: "10000",
    settlementNetwork: "eip155:8453",
    settlementCurrency: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  };
}

function sourcedPaidSuccessEvent(ts, actor = "aaaaaaaaaaaaaaaaaaaaaaaa") {
  return {
    ...settledPaidSuccessEvent(ts, actor),
    paymentActor: "abababababababababababab",
    paymentIdentifier: "cdcdcdcdcdcdcdcdcdcdcdcd",
  };
}

function mcpProbeEvent(ts, actor = "eeeeeeeeeeeeeeeeeeeeeeee") {
  return privacySafeEvent({
    ts,
    actor,
    originClass: "external",
    agentDiscoverySource: null,
    route: "/mcp/sse",
    kind: "unmatched",
    matched: false,
    queryKeys: [],
    requestConstruction: "not_measured",
    status: 404,
    result: "unmatched",
  });
}

function paidSuccessEvent(ts, actor = "abcdefabcdefabcdefabcdef") {
  return privacySafeEvent({
    ts,
    actor,
    originClass: "external",
    agentDiscoverySource: "openai-user",
    route: "/extract",
    kind: "paid",
    matched: true,
    queryKeys: ["url"],
    requestConstruction: "not_measured",
    paymentPresent: true,
    paymentCredentialParsed: true,
    paymentProtocol: "x402",
    paymentActor: "abababababababababababab",
    status: 200,
    result: "paid_success",
  });
}

function sourceDetailDiscoveryEvent(ts, actor = "bbbbbbbbbbbbbbbbbbbbbbbb") {
  return privacySafeEvent({
    ts,
    actor,
    originClass: "crawler",
    agentDiscoverySource: "openai-user",
    requestConstruction: "not_measured",
    route: "/openapi.json",
    kind: "discovery",
    matched: true,
    queryKeys: [],
    status: 200,
    result: "discovery",
  });
}

function assertCompleteIntervalIncludesCounted(label, coverage, observationStart, countedTimestamps, candidateTimestamps) {
  if (coverage !== COMMERCE_COVERAGE_COMPLETE) return;
  const startMs = Date.parse(observationStart);
  assert.equal(Number.isFinite(startMs), true, `${label} complete observationStart must be finite`);
  for (const ts of countedTimestamps) {
    assert.ok(
      Date.parse(ts) >= startMs,
      `${label} complete interval starts at ${observationStart} but counted ${ts}`,
    );
  }
  for (const ts of candidateTimestamps) {
    if (Date.parse(ts) >= startMs) {
      assert.ok(
        countedTimestamps.includes(ts),
        `${label} complete interval omitted counted component ${ts}`,
      );
    }
  }
}

function assertPublicOutputHidesExactTiming(snapshot, exactValues) {
  const serialized = JSON.stringify(snapshot);
  assert.equal(Object.hasOwn(snapshot, "retainedObservationStart"), false);
  assert.equal(Object.hasOwn(snapshot, "retainedObservationEnd"), false);
  assert.equal(Object.hasOwn(snapshot, "retainedDurationMs"), false);
  assert.equal(Object.hasOwn(snapshot, "retainedDurationDays"), false);
  assert.equal(snapshot.coverage.retainedObservationStart, undefined);
  assert.equal(snapshot.coverage.retainedObservationEnd, undefined);
  assert.equal(snapshot.coverage.retainedDurationMs, undefined);
  assert.equal(snapshot.coverage.retainedDurationDays, undefined);
  for (const value of exactValues) {
    if (value === null || value === undefined || value === "") continue;
    assert.equal(
      serialized.includes(String(value)),
      false,
      `public output leaked ${String(value)}`,
    );
  }
}

function assertIntegrityUnknown(snapshot) {
  assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_UNUSABLE_RECORDS);
  assert.equal(snapshot.coverage.integrity.status, COMMERCE_INTEGRITY_UNUSABLE_RECORDS);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(snapshot.requestedWindowComplete, false);
  for (const metric of Object.values(snapshot.coverage.metrics)) {
    assert.equal(metric.coverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
    assert.equal(metric.complete, false);
    if (!metric.components) continue;
    for (const component of Object.values(metric.components)) {
      assert.equal(component.coverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
      assert.equal(component.complete, false);
    }
  }
}

function assertCannotUndercountWhileClaimingComplete(snapshot, label) {
  assertIntegrityUnknown(snapshot);
  assert.ok(snapshot.coverage.integrity.currentFile.unusableRecordCount >= 1, `${label} must be unusable`);
  const claimedCompleteZero = snapshot.requestedWindowCoverage === COMMERCE_COVERAGE_COMPLETE
    && (snapshot.byResult?.paid_success || 0) === 0
    && (snapshot.constructedRequestEvents || 0) === 0;
  assert.equal(claimedCompleteZero, false, `${label} claimed complete while undercounting`);
}

async function snapshotCompleteWindowWith(event, extraOptions = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-v3-shape-"));
  const now = Date.now();
  const start = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  const end = new Date(now - 1000).toISOString();
  await seedEventFiles(dataDir, {
    current: [discoveryEvent(start), typeof event === "function" ? event(end) : event],
  });
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    requestConstructionSince: start,
    agentDiscoverySince: start,
    credentialAttemptSince: start,
    settlementEvidenceSince: start,
    ...extraOptions,
  });
  const snapshot = await telemetry.snapshot({ days: 1 });
  return { snapshot, dataDir, start, end };
}

async function seedEventFiles(dataDir, { rotated = [], current = [] } = {}) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  if (rotated.length) {
    await writeFile(
      path.join(dataDir, "commerce-events.1.ndjson"),
      `${rotated.map((event) => JSON.stringify(event)).join("\n")}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }
  if (current.length) {
    await writeFile(
      path.join(dataDir, "commerce-events.ndjson"),
      `${current.map((event) => JSON.stringify(event)).join("\n")}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }
}

test("coverage helper classifies incomplete windows as unknown_for_full_window", () => {
  const generatedAtMs = Date.parse("2026-08-21T00:21:21.579Z");
  const retainedStart = Date.parse("2026-08-20T21:53:22.761Z");
  const retainedEnd = generatedAtMs;
  const coverage = describeRetentionCoverage({
    generatedAtMs,
    requestedWindowDays: 90,
    retainedObservationStartMs: retainedStart,
    retainedObservationEndMs: retainedEnd,
    retainedParseableEventCount: 15181,
    baselines: {
      requestConstruction: Date.parse("2026-08-13T16:25:03.766Z"),
      external: Date.parse("2026-08-09T00:46:22.000Z"),
    },
  });
  assert.equal(coverage.requestedWindowDays, 90);
  assert.equal(coverage.requestedWindowComplete, false);
  assert.equal(coverage.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(coverage.metrics.requestConstruction.complete, false);
  assert.equal(coverage.metrics.requestConstruction.coverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(coverage.integrityStatus, COMMERCE_INTEGRITY_OK);
  assert.equal(coverage.retainedObservationStart, undefined);
  assert.equal(coverage.retainedObservationEnd, undefined);
  assert.equal(coverage.retainedDurationMs, undefined);
  assert.equal(coverage.retainedDurationDays, undefined);
  assert.equal(coverage.retainedObservationStartUtcDay, null);
  assert.equal(coverage.retainedObservationEndUtcDay, null);
  assert.equal(coverage.retainedDurationWholeDays, 0);
  assert.equal(JSON.stringify(coverage).includes("2026-08-20T21:53:22.761Z"), false);

  const laterBaseline = metricCoverageStatus({
    generatedAtMs,
    requestedWindowStartMs: generatedAtMs - 90 * 86_400_000,
    retainedObservationStartMs: retainedStart,
    baselineMs: Date.parse("2026-08-20T22:00:00.000Z"),
  });
  assert.equal(laterBaseline.complete, true);
  assert.equal(laterBaseline.coverage, COMMERCE_COVERAGE_COMPLETE);

  const unusable = describeRetentionCoverage({
    generatedAtMs,
    requestedWindowDays: 1,
    retainedObservationStartMs: generatedAtMs - 26 * 86_400_000,
    retainedObservationEndMs: generatedAtMs,
    retainedParseableEventCount: 2,
    integrity: {
      currentFile: { filePresent: true, parseableRecordCount: 1, unusableRecordCount: 1 },
      rotatedFile: { filePresent: true, parseableRecordCount: 1, unusableRecordCount: 0 },
    },
    baselines: {
      requestConstruction: generatedAtMs - 60_000,
    },
  });
  assert.equal(unusable.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(unusable.metrics.requestConstruction.coverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(unusable.integrityStatus, COMMERCE_INTEGRITY_UNUSABLE_RECORDS);
  assert.equal(unusable.integrity.currentFile.unusableRecordCount, 1);
  assert.equal(unusable.integrity.rotatedFile.unusableRecordCount, 0);
});

test("conservative UTC day bounds never overstate retained coverage", () => {
  assert.deepEqual(conservativeRetainedUtcBounds({
    retainedObservationStartMs: Date.parse("2026-08-20T21:53:22.761Z"),
    retainedObservationEndMs: Date.parse("2026-08-21T00:21:21.579Z"),
  }), {
    retainedObservationStartUtcDay: null,
    retainedObservationEndUtcDay: null,
    retainedDurationWholeDays: 0,
  });
  assert.deepEqual(conservativeRetainedUtcBounds({
    retainedObservationStartMs: Date.parse("2026-08-01T00:00:00.000Z"),
    retainedObservationEndMs: Date.parse("2026-08-21T00:00:00.000Z"),
  }), {
    retainedObservationStartUtcDay: "2026-08-01",
    retainedObservationEndUtcDay: "2026-08-20",
    retainedDurationWholeDays: 20,
  });
  assert.deepEqual(conservativeRetainedUtcBounds({
    retainedObservationStartMs: Date.parse("2026-08-01T00:00:00.001Z"),
    retainedObservationEndMs: Date.parse("2026-08-21T00:00:00.000Z"),
  }), {
    retainedObservationStartUtcDay: "2026-08-02",
    retainedObservationEndUtcDay: "2026-08-20",
    retainedDurationWholeDays: 19,
  });
});

test("two rotations erase an older construction event and keep the 90-day zero unknown", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-rotation-erase-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    maxBytes: 1,
    requestConstructionSince: "2020-01-01T00:00:00.000Z",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
  });

  function emit({ requestPath, query = {}, status, ip, userAgent = "Agent402/1.0" }) {
    const listeners = new Map();
    telemetry.middleware({
      path: requestPath,
      url: requestPath,
      method: "GET",
      headers: { "user-agent": userAgent },
      query,
      ip,
      socket: {},
    }, {
      statusCode: status,
      once(name, listener) { listeners.set(name, listener); },
      getHeader() { return undefined; },
    }, () => {});
    listeners.get("finish")?.();
  }

  emit({
    requestPath: "/extract",
    query: { url: "https://example.com" },
    status: 402,
    ip: "203.0.113.101",
  });
  await telemetry.flush();
  const afterFirst = await readFile(telemetry.paths.currentPath, "utf8");
  assert.match(afterFirst, /"requestConstruction":"constructed"/);

  emit({
    requestPath: "/openapi.json",
    status: 200,
    ip: "203.0.113.102",
  });
  await telemetry.flush();
  emit({
    requestPath: "/openapi.json",
    status: 200,
    ip: "203.0.113.103",
  });
  await telemetry.flush();

  const current = await readFile(telemetry.paths.currentPath, "utf8");
  const rotated = await readFile(telemetry.paths.rotatedPath, "utf8");
  assert.equal(current.includes('"requestConstruction":"constructed"'), false);
  assert.equal(rotated.includes('"requestConstruction":"constructed"'), false);

  const snapshot = await telemetry.snapshot({ days: 90 });
  assert.equal(snapshot.constructedRequestEvents, 0);
  assert.equal(snapshot.constructedRequestActors, 0);
  assert.equal(snapshot.windowDays, 90);
  assert.equal(snapshot.requestedWindowDays, 90);
  assert.equal(snapshot.requestedWindowComplete, false);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(snapshot.requestConstructionCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(snapshot.coverage.metrics.requestConstruction.coverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
  assert.ok(snapshot.retainedParseableEventCount >= 1);
  assert.equal(JSON.stringify(snapshot).includes("203.0.113."), false);
  await rm(dataDir, { recursive: true, force: true });
});

test("incomplete 90-day coverage reports retained bounds and does not treat a zero as a full-window result", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-incomplete-90d-"));
  const start = "2026-08-20T21:53:22.761Z";
  const end = "2026-08-21T00:21:21.579Z";
  await seedEventFiles(dataDir, {
    rotated: [privacySafeEvent({
      ts: start,
      requestConstruction: "not_measured",
      route: "/openapi.json",
      kind: "discovery",
      matched: true,
      queryKeys: [],
      status: 200,
      result: "discovery",
    })],
    current: [privacySafeEvent({
      ts: end,
      actor: "bbbbbbbbbbbbbbbbbbbbbbbb",
      requestConstruction: "not_measured",
      route: "/openapi.json",
      kind: "discovery",
      matched: true,
      queryKeys: [],
      status: 200,
      result: "discovery",
    })],
  });
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    requestConstructionSince: "2026-08-13T16:25:03.766Z",
  });
  const snapshot = await telemetry.snapshot({ days: 90 });
  assert.equal(snapshot.windowDays, 90);
  assert.equal(snapshot.constructedRequestEvents, 0);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(snapshot.requestConstructionCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(snapshot.requestedWindowComplete, false);
  assert.equal(snapshot.coverage.retainedParseableEventCount, 2);
  assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
  assertPublicOutputHidesExactTiming(snapshot, [
    start,
    end,
    Date.parse(start),
    Date.parse(end),
    "21:53:22.761",
    "00:21:21.579",
  ]);
  await rm(dataDir, { recursive: true, force: true });
});

test("complete short-window coverage can honestly report a retained zero", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-complete-short-"));
  const now = Date.now();
  const start = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  const end = new Date(now - 1000).toISOString();
  await seedEventFiles(dataDir, {
    rotated: [privacySafeEvent({
      ts: start,
      requestConstruction: "not_measured",
      route: "/openapi.json",
      kind: "discovery",
      matched: true,
      queryKeys: [],
      status: 200,
      result: "discovery",
    })],
    current: [privacySafeEvent({
      ts: end,
      actor: "bbbbbbbbbbbbbbbbbbbbbbbb",
      requestConstruction: "not_measured",
      route: "/skill.md",
      kind: "discovery",
      matched: true,
      queryKeys: [],
      status: 200,
      result: "discovery",
    })],
  });
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    requestConstructionSince: start,
    agentDiscoverySince: start,
  });
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.windowDays, 1);
  assert.equal(snapshot.requestedWindowComplete, true);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.requestConstructionCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.constructedRequestEvents, 0);
  assert.equal(snapshot.coverage.metrics.requestConstruction.complete, true);
  assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
  assert.equal(Object.hasOwn(snapshot, "retainedObservationStart"), false);
  await rm(dataDir, { recursive: true, force: true });
});

test("a metric baseline later than retained start can be complete while the requested window is not", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-metric-baseline-"));
  const now = Date.now();
  const retainedStart = new Date(now - 3 * 60 * 60 * 1000).toISOString();
  const constructionSince = new Date(now - 60 * 60 * 1000).toISOString();
  const retainedEnd = new Date(now - 1000).toISOString();
  await seedEventFiles(dataDir, {
    current: [
      privacySafeEvent({
        ts: retainedStart,
        requestConstruction: "not_measured",
        route: "/openapi.json",
        kind: "discovery",
        matched: true,
        queryKeys: [],
        status: 200,
        result: "discovery",
      }),
      privacySafeEvent({
        ts: retainedEnd,
        actor: "bbbbbbbbbbbbbbbbbbbbbbbb",
        requestConstruction: "not_measured",
        route: "/openapi.json",
        kind: "discovery",
        matched: true,
        queryKeys: [],
        status: 200,
        result: "discovery",
      }),
    ],
  });
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    requestConstructionSince: constructionSince,
  });
  const snapshot = await telemetry.snapshot({ days: 90 });
  assert.equal(snapshot.requestedWindowComplete, false);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(snapshot.requestConstructionCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.coverage.metrics.requestConstruction.complete, true);
  assert.equal(snapshot.coverage.metrics.requestConstruction.baseline, constructionSince);
  assert.equal(snapshot.constructedRequestEvents, 0);
  assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
  await rm(dataDir, { recursive: true, force: true });
});

test("empty retained files are unknown_for_full_window rather than a complete-window zero", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-empty-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    requestConstructionSince: "2026-08-13T16:25:03.766Z",
  });
  const snapshot = await telemetry.snapshot({ days: 90 });
  assert.equal(snapshot.constructedRequestEvents, 0);
  assert.equal(snapshot.externalEvents, 0);
  assert.equal(snapshot.requestedWindowComplete, false);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(snapshot.requestConstructionCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(snapshot.coverage.retainedParseableEventCount, 0);
  assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
  assert.equal(snapshot.coverage.integrity.currentFile.present, false);
  assert.equal(snapshot.coverage.integrity.rotatedFile.present, false);
  assert.equal(snapshot.coverage.retainedDurationWholeDays, null);
  assertPublicOutputHidesExactTiming(snapshot, []);
  await rm(dataDir, { recursive: true, force: true });
});

test("corrupt lines in an otherwise complete window force unknown coverage without exposing payloads", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-integrity-straddle-"));
  const now = Date.now();
  const beforeBoundary = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  const afterBoundary = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const nearNow = new Date(now - 1000).toISOString();
  const badTimestamp = "not-a-timestamp-ZZZ-1919";
  const malformed = "{not-json-integrity-canary";
  const missingTs = { ...discoveryEvent(afterBoundary, "bbbbbbbbbbbbbbbbbbbbbbbb") };
  delete missingTs.ts;
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(dataDir, "commerce-events.1.ndjson"),
    [
      JSON.stringify(discoveryEvent(beforeBoundary)),
      malformed,
      "[]",
      JSON.stringify(constructedCrawlerEvent(afterBoundary)),
    ].join("\n") + "\n",
    { encoding: "utf8", mode: 0o600 },
  );
  await writeFile(
    path.join(dataDir, "commerce-events.ndjson"),
    [
      JSON.stringify(discoveryEvent(nearNow, "dddddddddddddddddddddddd")),
      JSON.stringify({ ...discoveryEvent(nearNow), ts: badTimestamp }),
      JSON.stringify(null),
      "42",
      JSON.stringify(missingTs),
      `"plain-string-record"`,
    ].join("\n") + "\n",
    { encoding: "utf8", mode: 0o600 },
  );
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    requestConstructionSince: "2020-01-01T00:00:00.000Z",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
  });
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.coverage.retainedParseableEventCount, 3);
  assert.equal(snapshot.constructedRequestEvents, 1);
  assert.equal(snapshot.agentDiscoveryObservations, 2);
  assert.equal(snapshot.coverage.integrity.rotatedFile.unusableRecordCount, 2);
  assert.equal(snapshot.coverage.integrity.currentFile.unusableRecordCount, 5);
  assertIntegrityUnknown(snapshot);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes(malformed), false);
  assert.equal(serialized.includes(badTimestamp), false);
  assert.equal(serialized.includes("ZZZ-1919"), false);
  assert.equal(serialized.includes("plain-string-record"), false);
  assert.equal(serialized.includes("Unexpected"), false);
  assert.equal(serialized.includes("{not-json"), false);
  assertPublicOutputHidesExactTiming(snapshot, [
    beforeBoundary,
    afterBoundary,
    nearNow,
    Date.parse(beforeBoundary),
    Date.parse(afterBoundary),
    Date.parse(nearNow),
  ]);
  await rm(dataDir, { recursive: true, force: true });
});

test("invalid timestamps and non-object records cannot support a complete window", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-invalid-ts-"));
  const now = Date.now();
  const start = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  const end = new Date(now - 1000).toISOString();
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(dataDir, "commerce-events.ndjson"),
    [
      JSON.stringify(discoveryEvent(start)),
      JSON.stringify({ ...discoveryEvent(end), ts: "" }),
      JSON.stringify({ ...discoveryEvent(end), ts: null }),
      "true",
      JSON.stringify(discoveryEvent(end, "bbbbbbbbbbbbbbbbbbbbbbbb")),
    ].join("\n") + "\n",
    { encoding: "utf8", mode: 0o600 },
  );
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    requestConstructionSince: start,
    agentDiscoverySince: start,
  });
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.coverage.retainedParseableEventCount, 2);
  assert.ok(snapshot.coverage.integrity.currentFile.unusableRecordCount >= 3);
  assertIntegrityUnknown(snapshot);
  await rm(dataDir, { recursive: true, force: true });
});

test("construction and discovery counts match coverage across the externalSince cutoff", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-cross-baseline-"));
  const now = Date.now();
  const retainedStart = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  const constructionSince = new Date(now - 4 * 60 * 60 * 1000).toISOString();
  const discoveryTs = new Date(now - 3 * 60 * 60 * 1000).toISOString();
  const constructionBeforeExternal = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const externalSince = new Date(now - 60 * 60 * 1000).toISOString();
  const constructionAfterExternal = new Date(now - 30 * 60 * 1000).toISOString();
  await seedEventFiles(dataDir, {
    rotated: [
      discoveryEvent(retainedStart),
      discoveryEvent(discoveryTs, "bbbbbbbbbbbbbbbbbbbbbbbb"),
    ],
    current: [
      constructedCrawlerEvent(constructionBeforeExternal),
      constructedCrawlerEvent(constructionAfterExternal, "ffffffffffffffffffffffff"),
    ],
  });
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    externalSince,
    requestConstructionSince: constructionSince,
    agentDiscoverySince: retainedStart,
  });
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.constructedRequestEvents, 2);
  assert.equal(snapshot.constructedRequestActors, 2);
  assert.equal(snapshot.requestConstructionCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.coverage.metrics.requestConstruction.complete, true);
  assert.equal(snapshot.coverage.metrics.requestConstruction.baseline, constructionSince);
  assert.equal(snapshot.coverage.metrics.requestConstruction.observationStart, constructionSince);
  assert.equal(snapshot.agentDiscoveryObservations, 3);
  assert.equal(snapshot.coverage.metrics.agentDiscovery.coverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.externalEvents, 0);
  assert.equal(snapshot.requestedWindowComplete, true);
  assert.equal(snapshot.coverage.metrics.external.observationStart, externalSince);
  assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
  await rm(dataDir, { recursive: true, force: true });
});

test("metrics still clipped by externalSince include that cutoff in coverage", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-mcp-cutoff-"));
  const now = Date.now();
  const retainedStart = new Date(now - 4 * 60 * 60 * 1000).toISOString();
  const mcpSince = retainedStart;
  const probeBeforeExternal = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const externalSince = new Date(now - 60 * 60 * 1000).toISOString();
  await seedEventFiles(dataDir, {
    current: [
      discoveryEvent(retainedStart),
      mcpProbeEvent(probeBeforeExternal),
    ],
  });
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    externalSince,
    mcpTransportProbeSince: mcpSince,
    agentDiscoverySince: retainedStart,
    requestConstructionSince: retainedStart,
  });
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.mcpTransportProbeEvents, 0);
  assert.equal(snapshot.coverage.metrics.mcpTransportProbe.baseline, mcpSince);
  assert.equal(snapshot.coverage.metrics.mcpTransportProbe.observationStart, externalSince);
  assert.equal(snapshot.coverage.metrics.mcpTransportProbe.coverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.agentDiscoveryObservations, 1);
  assert.equal(snapshot.requestConstructionCoverage, COMMERCE_COVERAGE_COMPLETE);
  await rm(dataDir, { recursive: true, force: true });
});

test("one retained event does not expose exact timestamps or millisecond values", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-one-event-privacy-"));
  const ts = "2026-08-19T13:07:41.319Z";
  const tsMs = Date.parse(ts);
  await seedEventFiles(dataDir, {
    current: [discoveryEvent(ts)],
  });
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    requestConstructionSince: "2026-08-13T16:25:03.766Z",
    agentDiscoverySince: "2026-08-13T16:25:03.766Z",
  });
  const snapshot = await telemetry.snapshot({ days: 90 });
  assert.equal(snapshot.coverage.retainedParseableEventCount, 1);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(snapshot.coverage.retainedDurationWholeDays, 0);
  assertPublicOutputHidesExactTiming(snapshot, [
    ts,
    tsMs,
    "13:07:41.319",
    "13:07:41",
  ]);
  await rm(dataDir, { recursive: true, force: true });
});

test("sparse retained events omit exact timing from serialized public output", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-sparse-privacy-"));
  const first = "2026-08-18T09:14:03.447Z";
  const second = "2026-08-20T04:11:08.002Z";
  await seedEventFiles(dataDir, {
    rotated: [discoveryEvent(first)],
    current: [discoveryEvent(second, "bbbbbbbbbbbbbbbbbbbbbbbb")],
  });
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    requestConstructionSince: "2026-08-13T16:25:03.766Z",
    agentDiscoverySince: "2026-08-13T16:25:03.766Z",
  });
  const snapshot = await telemetry.snapshot({ days: 90 });
  assert.equal(snapshot.coverage.retainedParseableEventCount, 2);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assertPublicOutputHidesExactTiming(snapshot, [
    first,
    second,
    Date.parse(first),
    Date.parse(second),
    "09:14:03.447",
    "04:11:08.002",
  ]);
  await rm(dataDir, { recursive: true, force: true });
});

test("February 30 and timestamp-only objects cannot establish coverage", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-feb30-shape-"));
  const now = Date.now();
  const start = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  const end = new Date(now - 1000).toISOString();
  const february30 = "2026-02-30T00:00:00.000Z";
  assert.equal(Number.isFinite(Date.parse(february30)), true);
  assert.notEqual(new Date(february30).toISOString(), february30);
  const timestampOnly = { ts: end };
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(dataDir, "commerce-events.ndjson"),
    [
      JSON.stringify(discoveryEvent(start)),
      JSON.stringify({ ...discoveryEvent(end, "ffffffffffffffffffffffff"), ts: february30 }),
      JSON.stringify(timestampOnly),
      JSON.stringify({ ts: start, v: 3 }),
      JSON.stringify(discoveryEvent(end, "bbbbbbbbbbbbbbbbbbbbbbbb")),
    ].join("\n") + "\n",
    { encoding: "utf8", mode: 0o600 },
  );
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    requestConstructionSince: start,
    agentDiscoverySince: start,
  });
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.coverage.retainedParseableEventCount, 2);
  assert.ok(snapshot.coverage.integrity.currentFile.unusableRecordCount >= 3);
  assertIntegrityUnknown(snapshot);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes(february30), false);
  assert.equal(serialized.includes("2026-03-02"), false);
  await rm(dataDir, { recursive: true, force: true });
});

test("snapshot capture is atomic against a response-triggered 5 MiB rotation", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-atomic-cap-"));
  const now = Date.now();
  const retainedStart = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  const constructedTs = new Date(now - 30 * 60 * 1000).toISOString();
  const maxBytes = 5 * 1024 * 1024;
  const constructed = constructedCrawlerEvent(constructedTs);
  const currentPayload = `${JSON.stringify(constructed)}\n`;
  const padBytes = Math.max(0, maxBytes - Buffer.byteLength(currentPayload));
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(dataDir, "commerce-events.1.ndjson"),
    `${JSON.stringify(discoveryEvent(retainedStart))}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await writeFile(
    path.join(dataDir, "commerce-events.ndjson"),
    `${currentPayload}${" ".repeat(padBytes)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  const currentStat = await stat(path.join(dataDir, "commerce-events.ndjson"));
  assert.ok(currentStat.size >= maxBytes);
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    maxBytes,
    requestConstructionSince: "2020-01-01T00:00:00.000Z",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
  });
  const snapshotPromise = telemetry.snapshot({ days: 1 });
  const listeners = new Map();
  telemetry.middleware({
    path: "/openapi.json",
    url: "/openapi.json",
    method: "GET",
    headers: { "user-agent": "Agent402/1.0" },
    query: {},
    ip: "203.0.113.201",
    socket: {},
  }, {
    statusCode: 200,
    once(name, listener) { listeners.set(name, listener); },
    getHeader() { return undefined; },
  }, () => {});
  listeners.get("finish")?.();
  const snapshot = await snapshotPromise;
  await telemetry.flush();
  const storage = await telemetry.storageStatus();
  assert.equal(storage.boundedBytes, maxBytes * 2);
  assert.ok(storage.currentBytes >= 0);
  assert.ok(storage.rotatedBytes >= 0);
  if (
    snapshot.requestConstructionCoverage === COMMERCE_COVERAGE_COMPLETE
    || snapshot.requestedWindowCoverage === COMMERCE_COVERAGE_COMPLETE
  ) {
    assert.ok(
      snapshot.constructedRequestEvents >= 1,
      "complete coverage omitted the constructed event during rotation",
    );
  }
  assert.equal(snapshot.constructedRequestEvents, 1);
  assert.equal(snapshot.requestConstructionCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
  await rm(dataDir, { recursive: true, force: true });
});

test("agentSourceDetail count inputs and coverage agree across mixed cutoffs", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-detail-cutoff-"));
  const now = Date.now();
  const retainedStart = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  const detailSince = new Date(now - 4 * 60 * 60 * 1000).toISOString();
  const discoveryInDetail = new Date(now - 3 * 60 * 60 * 1000).toISOString();
  const paidBeforeExternal = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const externalSince = new Date(now - 60 * 60 * 1000).toISOString();
  const paidAfterExternal = new Date(now - 30 * 60 * 1000).toISOString();
  await seedEventFiles(dataDir, {
    rotated: [discoveryEvent(retainedStart)],
    current: [
      sourceDetailDiscoveryEvent(discoveryInDetail),
      paidSuccessEvent(paidBeforeExternal, "cccccccccccccccccccccccc"),
      paidSuccessEvent(paidAfterExternal, "dddddddddddddddddddddddd"),
    ],
  });
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    externalSince,
    agentDiscoverySince: retainedStart,
    agentSourceDetailSince: detailSince,
    requestConstructionSince: retainedStart,
    credentialAttemptSince: retainedStart,
  });
  const snapshot = await telemetry.snapshot({ days: 1 });
  const detail = snapshot.coverage.metrics.agentSourceDetail;
  const discoveryComponent = detail.components.discovery;
  const credentialComponent = detail.components.credentialAttempt;
  const paidComponent = detail.components.paidSuccess;
  const countedPaid = Object.values(snapshot.agentSourceDetailFunnel)
    .reduce((sum, row) => sum + Number(row.paidSuccesses || 0), 0);
  const countedCredential = Object.values(snapshot.agentSourceDetailFunnel)
    .reduce((sum, row) => sum + Number(row.credentialAttemptEvents || 0), 0);
  assert.equal(snapshot.agentSourceDetailObservations, 1);
  assert.equal(countedPaid, 1);
  assert.equal(countedCredential, 1);
  assert.equal(snapshot.agentSourceDetailFunnel["openai-user"].paidSuccesses, 1);
  assert.equal(snapshot.agentSourceDetailFunnel["openai-user"].discoveryObservations, 1);
  assert.equal(detail.coverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(detail.complete, false);
  assert.equal(discoveryComponent.coverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(paidComponent.coverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(credentialComponent.coverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(discoveryComponent.observationStart, detailSince);
  assert.equal(paidComponent.observationStart, externalSince);
  assert.equal(credentialComponent.observationStart, externalSince);
  assertCompleteIntervalIncludesCounted(
    "agentSourceDetail",
    detail.coverage,
    detail.observationStart,
    [paidAfterExternal],
    [paidBeforeExternal, paidAfterExternal],
  );
  assertCompleteIntervalIncludesCounted(
    "agentSourceDetail.paidSuccess",
    paidComponent.coverage,
    paidComponent.observationStart,
    [paidAfterExternal],
    [paidBeforeExternal, paidAfterExternal],
  );
  assertCompleteIntervalIncludesCounted(
    "agentSourceDetail.credentialAttempt",
    credentialComponent.coverage,
    credentialComponent.observationStart,
    [paidAfterExternal],
    [paidBeforeExternal, paidAfterExternal],
  );
  assertCompleteIntervalIncludesCounted(
    "agentSourceDetail.discovery",
    discoveryComponent.coverage,
    discoveryComponent.observationStart,
    [discoveryInDetail],
    [retainedStart, discoveryInDetail],
  );
  assertPublicOutputHidesExactTiming(snapshot, [
    paidBeforeExternal,
    paidAfterExternal,
    discoveryInDetail,
    "21:53:22",
  ]);
  await rm(dataDir, { recursive: true, force: true });
});

test("complete writer-emitted v3 paid-success rows can still establish coverage", async () => {
  const { snapshot, dataDir } = await snapshotCompleteWindowWith((end) => sourcedPaidSuccessEvent(end));
  assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.requestedWindowComplete, true);
  assert.equal(snapshot.byResult.paid_success, 1);
  assert.equal(snapshot.paidSuccessByProtocol.x402, 1);
  assert.equal(snapshot.paidSuccessByDiscoverySource["openai-user"], 1);
  assert.equal(snapshot.parseableCredentialAttemptEvents, 1);
  assert.equal(snapshot.settlementReferencePaidSuccesses, 1);
  assert.equal(snapshot.coverage.integrity.currentFile.unusableRecordCount, 0);
  await rm(dataDir, { recursive: true, force: true });
});

test("near-complete paid-success missing payment fields cannot undercount while claiming complete", async () => {
  const { snapshot, dataDir } = await snapshotCompleteWindowWith((end) => {
    const row = sourcedPaidSuccessEvent(end);
    delete row.paymentPresent;
    delete row.paymentCredentialParsed;
    delete row.paymentProtocol;
    return row;
  });
  assert.equal(snapshot.coverage.retainedParseableEventCount, 1);
  assertCannotUndercountWhileClaimingComplete(snapshot, "missing paymentPresent/credential/protocol");
  assert.equal(snapshot.byResult?.paid_success || 0, 0);
  await rm(dataDir, { recursive: true, force: true });
});

const PAYMENT_SHAPE_MUTATIONS = [
  ["missing paymentPresent", (row) => omitField(row, "paymentPresent")],
  ["wrong-type paymentPresent string", (row) => ({ ...row, paymentPresent: "true" })],
  ["wrong-type paymentPresent number", (row) => ({ ...row, paymentPresent: 1 })],
  ["falsy wrong-type paymentPresent", (row) => ({ ...row, paymentPresent: 0 })],
  ["missing paymentCredentialParsed", (row) => omitField(row, "paymentCredentialParsed")],
  ["wrong-type paymentCredentialParsed", (row) => ({ ...row, paymentCredentialParsed: "true" })],
  ["missing paymentProtocol", (row) => omitField(row, "paymentProtocol")],
  ["wrong-type paymentProtocol", (row) => ({ ...row, paymentProtocol: 1 })],
  ["invalid paymentProtocol token", (row) => ({ ...row, paymentProtocol: "http" })],
  ["missing protocolsOffered", (row) => omitField(row, "protocolsOffered")],
  ["wrong-type protocolsOffered", (row) => ({ ...row, protocolsOffered: "x402" })],
  ["missing replayed", (row) => omitField(row, "replayed")],
  ["wrong-type replayed", (row) => ({ ...row, replayed: 1 })],
  ["missing paymentFailureCode", (row) => omitField(row, "paymentFailureCode")],
  ["wrong-type paymentFailureCode", (row) => ({ ...row, paymentFailureCode: 1 })],
];

test("missing or mistyped payment classification fields cannot claim complete", async () => {
  for (const [label, mutate] of PAYMENT_SHAPE_MUTATIONS) {
    const { snapshot, dataDir } = await snapshotCompleteWindowWith((end) => mutate(sourcedPaidSuccessEvent(end)));
    assertCannotUndercountWhileClaimingComplete(snapshot, label);
    await rm(dataDir, { recursive: true, force: true });
  }
});

const CONSTRUCTION_SHAPE_MUTATIONS = [
  ["missing requestConstruction", (row) => omitField(row, "requestConstruction")],
  ["wrong-type requestConstruction", (row) => ({ ...row, requestConstruction: true })],
  ["invalid requestConstruction token", (row) => ({ ...row, requestConstruction: "Constructed" })],
  ["missing requestConstructionRequiredKeyCount", (row) => omitField(row, "requestConstructionRequiredKeyCount")],
  ["wrong-type requestConstructionRequiredKeyCount", (row) => ({ ...row, requestConstructionRequiredKeyCount: "1" })],
  ["missing queryKeys", (row) => omitField(row, "queryKeys")],
  ["wrong-type queryKeys", (row) => ({ ...row, queryKeys: "url" })],
];

test("missing or mistyped construction inputs cannot undercount while claiming complete", async () => {
  for (const [label, mutate] of CONSTRUCTION_SHAPE_MUTATIONS) {
    const { snapshot, dataDir } = await snapshotCompleteWindowWith((end) => mutate(constructedCrawlerEvent(end)));
    assertCannotUndercountWhileClaimingComplete(snapshot, label);
    assert.equal(snapshot.constructedRequestEvents, 0, `${label} must not count as constructed`);
    await rm(dataDir, { recursive: true, force: true });
  }
});

const SETTLEMENT_SHAPE_MUTATIONS = [
  ["missing settlementReference", (row) => omitField(row, "settlementReference")],
  ["wrong-type settlementReference", (row) => ({ ...row, settlementReference: 1 })],
  ["missing settlementAmountAtomic", (row) => omitField(row, "settlementAmountAtomic")],
  ["wrong-type settlementAmountAtomic", (row) => ({ ...row, settlementAmountAtomic: 10000 })],
  ["missing settlementNetwork", (row) => omitField(row, "settlementNetwork")],
  ["wrong-type settlementNetwork", (row) => ({ ...row, settlementNetwork: ["eip155:8453"] })],
  ["missing settlementCurrency", (row) => omitField(row, "settlementCurrency")],
  ["wrong-type settlementCurrency", (row) => ({ ...row, settlementCurrency: true })],
];

test("missing or mistyped settlement inputs cannot undercount while claiming complete", async () => {
  for (const [label, mutate] of SETTLEMENT_SHAPE_MUTATIONS) {
    const { snapshot, dataDir } = await snapshotCompleteWindowWith((end) => mutate(settledPaidSuccessEvent(end)));
    assertCannotUndercountWhileClaimingComplete(snapshot, label);
    assert.equal(snapshot.settlementReferencePaidSuccesses, 0, `${label} must not count settlement`);
    await rm(dataDir, { recursive: true, force: true });
  }
});

const ACTOR_SOURCE_SHAPE_MUTATIONS = [
  ["missing actor", (row) => omitField(row, "actor")],
  ["wrong-type actor", (row) => ({ ...row, actor: 1 })],
  ["missing originClass", (row) => omitField(row, "originClass")],
  ["wrong-type originClass", (row) => ({ ...row, originClass: 1 })],
  ["missing agentDiscoverySource", (row) => omitField(row, "agentDiscoverySource")],
  ["wrong-type agentDiscoverySource", (row) => ({ ...row, agentDiscoverySource: 1 })],
  ["missing paymentActor", (row) => omitField(row, "paymentActor")],
  ["wrong-type paymentActor", (row) => ({ ...row, paymentActor: 1 })],
  ["missing paymentIdentifier", (row) => omitField(row, "paymentIdentifier")],
  ["wrong-type paymentIdentifier", (row) => ({ ...row, paymentIdentifier: true })],
];

test("missing or mistyped actor and source fields cannot undercount while claiming complete", async () => {
  for (const [label, mutate] of ACTOR_SOURCE_SHAPE_MUTATIONS) {
    const { snapshot, dataDir } = await snapshotCompleteWindowWith((end) => mutate(sourcedPaidSuccessEvent(end)));
    assertCannotUndercountWhileClaimingComplete(snapshot, label);
    await rm(dataDir, { recursive: true, force: true });
  }
});

const WRITER_AGENT_DISCOVERY_SOURCES = [
  "agent402",
  "coinbase-bazaar",
  "circle-agent-marketplace",
  "mcp-registry",
  "smithery",
  "glama",
  "mppscan",
  "mpp-ecosystem",
  "agentcash",
  "a2a-ecosystem",
  "openai-search",
  "openai-user",
  "openai-training",
  "anthropic-search",
  "anthropic-user",
  "anthropic-training",
  "perplexity-search",
  "perplexity-user",
  "google-vertex-agent",
  "generic-agent-indexer",
  "agent-skills",
  "agentictrade",
  "aws-agentcore",
];

const WRITER_PAYMENT_FAILURE_CODES = [
  "missing_required_input",
  "extension_mismatch",
  "payment_terms_mismatch",
  "signature_invalid",
  "payment_expired",
  "payment_replay_rejected",
  "insufficient_funds",
  "payment_service_unavailable",
  "payment_verification_failed",
  "request_binding_conflict",
  "application_validation_failed",
  "unknown_failure",
];

const WRITER_ROUTE_PATHS = [
  "/",
  "/healthz",
  "/.well-known/x402",
  "/.well-known/x402.json",
  "/x402.json",
  "/api/x402",
  "/.well-known/402index-verify.txt",
  "/.well-known/glama.json",
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/llms.txt",
  "/skill.md",
  "/SKILL.md",
  "/robots.txt",
  "/sitemap.xml",
  "/openapi.json",
  "/openapi.yaml",
  "/swagger.json",
  "/v0/cards.json",
  "/api/actions",
  "/a2a",
  "/a2a/message:send",
  "/v0/commerce-demand.json",
  "/schemas/platform-health-card-v0.json",
  "/schemas/wallet-policy-conformance-v1.json",
  "/schemas/stateful-wallet-policy-conformance-v1.json",
  "/radar",
  "/platforms",
  "/platforms/methodology",
  "/alerts",
  "/extract",
  "/read",
  "/scan",
  "/schemaforge",
  "/enrich",
  "/wallet-enrich",
  "/deep-audit",
  "/defi/morpho-position",
  "/defi/morpho-protection",
  "/defi/morpho-market-underwrite",
  "/defi/morpho-preliquidation-replay",
  "/work/opportunity-preflight",
  "/distribution/agent-discoverability-audit",
  "/commerce/payment-offer-preflight",
  "/commerce/seller-integrity-audit",
  "/commerce/contract-qualified-search",
  "/commerce/settlement-proof",
  "/chain/transaction-receipt",
  "/chain/solana-transaction-receipt",
  "/security/wallet-policy-conformance",
  "/security/stateful-wallet-policy-conformance",
  "/gateway/commerce/payment-offer-preflight",
  "/mcp",
  "/platforms/gofrantic",
  "/go/topify",
  "/go/manychat",
  "/go/other",
  "/mcp/sse",
  "/mcp/messages",
  "/mcp/tools",
  "/mcp/events",
  "/mcp/private-token",
  "/morpho/0x4352cc849b33a936ad93bb109afdec1c89653b4f",
  "/someone@example.com/private",
  "/integrations/the402/webhook",
  "//",
  `/${"a".repeat(40)}/extra`,
];

const PUBLIC_SNAPSHOT_MAX_CHARS = 65_536;

function challengeWithFailureCode(ts, paymentFailureCode, actor = "eeeeeeeeeeeeeeeeeeeeeeee") {
  return {
    ...constructedCrawlerEvent(ts, actor),
    originClass: "external",
    paymentPresent: true,
    paymentCredentialParsed: true,
    paymentProtocol: "x402",
    paymentActor: "abababababababababababab",
    paymentFailureCode,
  };
}

function eventForClassifiedRoute(classified, ts, actor = "dddddddddddddddddddddddd") {
  const unmatched = classified.kind === "unmatched";
  const paid = classified.kind === "paid";
  const status = paid ? 402 : unmatched ? 404 : 200;
  return privacySafeEvent({
    ts,
    actor,
    originClass: "external",
    agentDiscoverySource: null,
    route: classified.route,
    kind: classified.kind,
    matched: classified.matched,
    queryKeys: [],
    requestConstruction: "not_measured",
    status,
    result: classifyCommerceResult({
      route: classified.route,
      kind: classified.kind,
      matched: classified.matched,
      paymentPresent: false,
      status,
    }),
  });
}

async function assertAdversarialLabelUnusable(label, mutate, leakedValues) {
  const { snapshot, dataDir } = await snapshotCompleteWindowWith((end) => mutate(end));
  const serialized = JSON.stringify(snapshot);
  assertCannotUndercountWhileClaimingComplete(snapshot, label);
  assert.ok(serialized.length < PUBLIC_SNAPSHOT_MAX_CHARS, `${label} inflated public snapshot to ${serialized.length}`);
  for (const value of leakedValues) {
    assert.equal(serialized.includes(value), false, `${label} leaked into public output`);
  }
  await rm(dataDir, { recursive: true, force: true });
  return serialized.length;
}

test("legacy and partial rows cannot establish full-window completeness", async () => {
  const cases = [
    ["v2 row", (end) => ({ ...sourcedPaidSuccessEvent(end), v: 2 })],
    ["v1 row", (end) => ({ ...sourcedPaidSuccessEvent(end), v: 1 })],
    ["unversioned row", (end) => omitField(sourcedPaidSuccessEvent(end), "v")],
    ["old minimal v3 subset", (end) => {
      const full = sourcedPaidSuccessEvent(end);
      return {
        v: 3,
        id: full.id,
        ts: full.ts,
        actor: full.actor,
        originClass: full.originClass,
        method: full.method,
        route: full.route,
        kind: full.kind,
        matched: full.matched,
        status: full.status,
        result: full.result,
      };
    }],
    ["missing durationMs", (end) => omitField(sourcedPaidSuccessEvent(end), "durationMs")],
    ["wrong-type durationMs", (end) => ({ ...sourcedPaidSuccessEvent(end), durationMs: "1" })],
  ];
  for (const [label, mutate] of cases) {
    const { snapshot, dataDir } = await snapshotCompleteWindowWith(mutate);
    assertCannotUndercountWhileClaimingComplete(snapshot, label);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("arbitrary private route, source, and failure labels cannot become public keys", async () => {
  const privateRoute = "/internal/private-ledger/employees";
  const privateSource = "private-customer-index";
  const privateFailure = "raw_facilitator_stderr";
  await assertAdversarialLabelUnusable(
    "arbitrary private route",
    (end) => ({ ...discoveryEvent(end), route: privateRoute }),
    [privateRoute, "private-ledger", "employees"],
  );
  await assertAdversarialLabelUnusable(
    "arbitrary private source",
    (end) => ({ ...discoveryEvent(end), agentDiscoverySource: privateSource }),
    [privateSource],
  );
  await assertAdversarialLabelUnusable(
    "arbitrary private failure code",
    (end) => challengeWithFailureCode(end, privateFailure),
    [privateFailure],
  );
});

test("100000-character route, source, and failure values cannot establish coverage or inflate output", async () => {
  const hugeRoute = `/${"a".repeat(100_000)}`;
  const hugeSource = "x".repeat(100_000);
  const hugeFailure = "f".repeat(100_000);
  const hugeQueryKey = "q".repeat(100_000);
  const sizes = [];
  sizes.push(await assertAdversarialLabelUnusable(
    "100000-character route",
    (end) => ({ ...discoveryEvent(end), route: hugeRoute }),
    [hugeRoute, "a".repeat(64), `/${"a".repeat(40)}/*`],
  ));
  sizes.push(await assertAdversarialLabelUnusable(
    "100000-character source",
    (end) => ({ ...discoveryEvent(end), agentDiscoverySource: hugeSource }),
    [hugeSource, "x".repeat(40)],
  ));
  sizes.push(await assertAdversarialLabelUnusable(
    "100000-character failure code",
    (end) => challengeWithFailureCode(end, hugeFailure),
    [hugeFailure, "f".repeat(40)],
  ));
  sizes.push(await assertAdversarialLabelUnusable(
    "100000-character query key",
    (end) => ({ ...discoveryEvent(end), queryKeys: [hugeQueryKey] }),
    [hugeQueryKey, "q".repeat(40)],
  ));
  assert.ok(Math.max(...sizes) < PUBLIC_SNAPSHOT_MAX_CHARS);
});

test("every legitimate writer-emitted vocabulary value still passes", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-writer-vocab-"));
  const now = Date.now();
  const start = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  const end = new Date(now - 1000).toISOString();
  const events = [discoveryEvent(start)];
  const acceptedRoutes = new Set();

  events.push(privacySafeEvent({
    ts: end,
    actor: "bbbbbbbbbbbbbbbbbbbbbbbb",
    originClass: "external",
    agentDiscoverySource: null,
    route: "/openapi.json",
    kind: "discovery",
    matched: true,
    queryKeys: [],
    requestConstruction: "not_measured",
    status: 200,
    result: "discovery",
  }));
  for (const source of WRITER_AGENT_DISCOVERY_SOURCES) {
    events.push(privacySafeEvent({
      ts: end,
      actor: "cccccccccccccccccccccccc",
      originClass: "crawler",
      agentDiscoverySource: source,
      route: "/openapi.json",
      kind: "discovery",
      matched: true,
      queryKeys: [],
      requestConstruction: "not_measured",
      status: 200,
      result: "discovery",
    }));
  }

  for (const requestPath of WRITER_ROUTE_PATHS) {
    const classified = classifyCommerceRoute(requestPath);
    if (classified.kind === "excluded") continue;
    acceptedRoutes.add(classified.route);
    events.push(eventForClassifiedRoute(classified, end));
  }

  for (const code of WRITER_PAYMENT_FAILURE_CODES) {
    events.push(challengeWithFailureCode(end, code));
  }

  await seedEventFiles(dataDir, { current: events });
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    requestConstructionSince: start,
    agentDiscoverySince: start,
    credentialAttemptSince: start,
    settlementEvidenceSince: start,
  });
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
  assert.equal(snapshot.coverage.integrity.currentFile.unusableRecordCount, 0);
  assert.equal(snapshot.coverage.retainedParseableEventCount, events.length);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.requestedWindowComplete, true);
  for (const source of WRITER_AGENT_DISCOVERY_SOURCES) {
    assert.ok(
      Number(snapshot.agentDiscoveryBySource[source] || 0) >= 1,
      `writer source ${source} missing from snapshot`,
    );
  }
  for (const route of acceptedRoutes) {
    const present = snapshot.byRoute[route]
      || snapshot.agentDiscoveryByRoute[route]
      || snapshot.unmatchedRequests[route]
      || snapshot.mcpTransportProbeByRoute[route];
    assert.ok(Number(present || 0) >= 1, `writer route ${route} missing from snapshot`);
  }
  for (const code of WRITER_PAYMENT_FAILURE_CODES) {
    assert.equal(snapshot.credentialAttemptByFailureCode[code], 1, `writer failure ${code} missing`);
  }
  const serialized = JSON.stringify(snapshot);
  assert.ok(serialized.length < PUBLIC_SNAPSHOT_MAX_CHARS * 4);
  await rm(dataDir, { recursive: true, force: true });
});

test("classifier outputs are exactly the retained writer vocabularies", () => {
  const classifierSources = [
    classifyAgentDiscoverySource("Agent402/1.0"),
    classifyAgentDiscoverySource("Coinbase CDP x402 Bazaar Indexer"),
    classifyAgentDiscoverySource("Circle x402 Agent Marketplace"),
    classifyAgentDiscoverySource("ModelContextProtocol MCP-Registry/1.0"),
    classifyAgentDiscoverySource("Smithery crawler"),
    classifyAgentDiscoverySource("Glama MCP Connector Indexer"),
    classifyAgentDiscoverySource("mppscan"),
    classifyAgentDiscoverySource("Tempo payment mpp client"),
    classifyAgentDiscoverySource("AgentCash/1.0"),
    classifyAgentDiscoverySource("A2A Agent-Card fetcher"),
    classifyAgentDiscoverySource("compatible; OAI-SearchBot/1.4"),
    classifyAgentDiscoverySource("compatible; ChatGPT-User/1.0"),
    classifyAgentDiscoverySource("compatible; GPTBot/1.4"),
    classifyAgentDiscoverySource("Claude-SearchBot/1.0"),
    classifyAgentDiscoverySource("Claude-User/1.0"),
    classifyAgentDiscoverySource("ClaudeBot/1.0"),
    classifyAgentDiscoverySource("compatible; PerplexityBot/1.0"),
    classifyAgentDiscoverySource("compatible; Perplexity-User/1.0"),
    classifyAgentDiscoverySource("Google-CloudVertexBot/1.0"),
    classifyAgentDiscoverySource("ExampleBot/1.0"),
    classifyDeclaredAgentDiscoverySource("agent-skills-v1"),
    classifyDeclaredAgentDiscoverySource("agentictrade-v1"),
    classifyDeclaredAgentDiscoverySource("aws-agentcore-v1"),
  ];
  for (const source of classifierSources) {
    assert.equal(WRITER_AGENT_DISCOVERY_SOURCES.includes(source), true, source);
  }
  assert.equal(classifyAgentDiscoverySource("Mozilla/5.0"), null);
  assert.equal(classifyDeclaredAgentDiscoverySource("unknown-client"), null);

  const classifierFailureCodes = [
    classifyPaymentFailureCode({ route: "/extract", status: 402, queryKeys: [] }),
    classifyPaymentFailureCode({ route: "/enrich", status: 402, queryKeys: ["url"] }),
    classifyPaymentFailureCode({ route: "/extract", status: 402, queryKeys: ["url"], error: "extension_echo_mismatch" }),
    classifyPaymentFailureCode({ route: "/extract", status: 402, queryKeys: ["url"], error: "no matching payment requirements" }),
    classifyPaymentFailureCode({ route: "/wallet-enrich", status: 402, queryKeys: ["wallet"], error: "authorization signature mismatch" }),
    classifyPaymentFailureCode({ route: "/extract", status: 402, queryKeys: ["url"], error: "expired" }),
    classifyPaymentFailureCode({ route: "/extract", status: 402, queryKeys: ["url"], error: "already used nonce" }),
    classifyPaymentFailureCode({ route: "/extract", status: 402, queryKeys: ["url"], error: "insufficient funds" }),
    classifyPaymentFailureCode({ route: "/extract", status: 503, queryKeys: ["url"] }),
    classifyPaymentFailureCode({ route: "/extract", status: 409, queryKeys: ["url"] }),
    classifyPaymentFailureCode({ route: "/extract", status: 400, queryKeys: ["url"] }),
    classifyPaymentFailureCode({ route: "/extract", status: 200, queryKeys: [] }),
  ];
  for (const code of classifierFailureCodes) {
    assert.equal(code === null || WRITER_PAYMENT_FAILURE_CODES.includes(code), true, code);
  }

  assert.equal(classifyCommerceRoute("/internal/private-ledger/employees").route, "/internal/*");
  assert.notEqual(
    classifyCommerceRoute("/internal/private-ledger/employees").route,
    "/internal/private-ledger/employees",
  );
  for (const requestPath of WRITER_ROUTE_PATHS) {
    const classified = classifyCommerceRoute(requestPath);
    assert.ok(classified.route.length <= 64, classified.route);
    assert.equal(classified.route.startsWith("/"), true);
  }
});

test("middleware query-key names stay canonical, bounded, and coverage-comparable", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-query-key-write-"));
  const now = Date.now();
  const start = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  await seedEventFiles(dataDir, { current: [discoveryEvent(start)] });
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    requestConstructionSince: start,
    agentDiscoverySince: start,
    credentialAttemptSince: start,
    settlementEvidenceSince: start,
  });

  const legitimate64 = "a".repeat(64);
  const collidingOverlong = `${legitimate64}b`;
  const otherOverlong = "z".repeat(65);
  const secretValue = "do-not-publish-query-value";
  const listeners = new Map();
  telemetry.middleware({
    path: "/extract",
    url: "/extract",
    method: "GET",
    headers: { "user-agent": "Agent402/1.0" },
    query: {
      "": secretValue,
      [collidingOverlong]: secretValue,
      [otherOverlong]: secretValue,
      [legitimate64]: "keep",
      url: "https://example.com/path?secret=do-not-publish",
    },
    ip: "203.0.113.77",
    socket: {},
  }, {
    statusCode: 402,
    once(name, listener) { listeners.set(name, listener); },
    getHeader() { return undefined; },
  }, () => {});
  listeners.get("finish")?.();
  await telemetry.flush();

  const raw = await readFile(telemetry.paths.currentPath, "utf8");
  const written = raw.trim().split("\n").map((line) => JSON.parse(line)).at(-1);
  assert.equal(written.requestConstruction, "constructed");
  assert.equal(written.requestConstructionRequiredKeyCount, 1);
  assert.deepEqual(written.queryKeys, [legitimate64, "url"]);
  assert.equal(written.queryKeys.includes(""), false);
  assert.equal(written.queryKeys.includes(collidingOverlong), false);
  assert.equal(written.queryKeys.includes(otherOverlong), false);
  assert.equal(written.queryKeys.includes("z".repeat(64)), false);
  assert.equal(new Set(written.queryKeys).size, written.queryKeys.length);
  assert.ok(written.queryKeys.length <= 20);
  assert.equal(raw.includes(collidingOverlong), false);
  assert.equal(raw.includes(otherOverlong), false);
  assert.equal(raw.includes(secretValue), false);
  assert.equal(raw.includes("do-not-publish"), false);

  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
  assert.equal(snapshot.coverage.integrity.currentFile.unusableRecordCount, 0);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.requestedWindowComplete, true);
  assert.equal(snapshot.requestConstructionCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.constructedRequestEvents, 1);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes(collidingOverlong), false);
  assert.equal(serialized.includes(otherOverlong), false);
  assert.equal(serialized.includes(secretValue), false);
  assert.equal(serialized.includes("do-not-publish"), false);
  assert.ok(serialized.length < PUBLIC_SNAPSHOT_MAX_CHARS);
  await rm(dataDir, { recursive: true, force: true });
});

test("middleware query-key normalization never exceeds its retained cap", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-query-key-cap-"));
  const now = Date.now();
  const start = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  await seedEventFiles(dataDir, { current: [discoveryEvent(start)] });
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    requestConstructionSince: start,
    agentDiscoverySince: start,
    credentialAttemptSince: start,
    settlementEvidenceSince: start,
  });

  const validQuery = Object.fromEntries([
    ["url", "https://example.com/resource"],
    ...Array.from({ length: 20 }, (_, index) => [`key${String(index).padStart(2, "0")}`, "value"]),
  ]);
  const overlong = "x".repeat(65);
  const listeners = new Map();
  telemetry.middleware({
    path: "/extract",
    url: "/extract",
    method: "GET",
    headers: { "user-agent": "Agent402/1.0" },
    query: { "": "invalid", [overlong]: "invalid", ...validQuery },
    ip: "203.0.113.78",
    socket: {},
  }, {
    statusCode: 402,
    once(name, listener) { listeners.set(name, listener); },
    getHeader() { return undefined; },
  }, () => {});
  listeners.get("finish")?.();
  await telemetry.flush();

  const raw = await readFile(telemetry.paths.currentPath, "utf8");
  const written = raw.trim().split("\n").map((line) => JSON.parse(line)).at(-1);
  assert.equal(written.queryKeys.length, 20);
  assert.equal(written.queryKeys.includes(""), false);
  assert.equal(written.queryKeys.includes(overlong), false);
  assert.equal(written.queryKeys.includes("url"), false);
  assert.equal(new Set(written.queryKeys).size, 20);

  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
  assert.equal(snapshot.coverage.integrity.currentFile.unusableRecordCount, 0);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.requestConstructionCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.constructedRequestEvents, 1);
  assert.equal(JSON.stringify(snapshot).includes(overlong), false);
  await rm(dataDir, { recursive: true, force: true });
});

test("nonhex, uppercase, wrong-version, and extreme identifiers cannot establish coverage", async () => {
  const cases = [
    ["nonhex actor", (end) => ({ ...sourcedPaidSuccessEvent(end), actor: "gggggggggggggggggggggggg" }), ["gggggggggggggggggggggggg"]],
    ["uppercase actor", (end) => ({ ...sourcedPaidSuccessEvent(end), actor: "AAAAAAAAAAAAAAAAAAAAAAAA" }), ["AAAAAAAAAAAAAAAAAAAAAAAA"]],
    ["short actor", (end) => ({ ...sourcedPaidSuccessEvent(end), actor: "aaaaaaaaaaaaaaaaaaaaaaa" }), []],
    ["long actor", (end) => ({ ...sourcedPaidSuccessEvent(end), actor: "aaaaaaaaaaaaaaaaaaaaaaaaa" }), ["aaaaaaaaaaaaaaaaaaaaaaaaa"]],
    ["nonhex paymentActor", (end) => ({ ...sourcedPaidSuccessEvent(end), paymentActor: "xyzxyzxyzxyzxyzxyzxyzxyz" }), ["xyzxyzxyzxyzxyzxyzxyzxyz"]],
    ["uppercase paymentActor", (end) => ({ ...sourcedPaidSuccessEvent(end), paymentActor: "ABABABABABABABABABABABAB" }), ["ABABABABABABABABABABABAB"]],
    ["nonhex paymentIdentifier", (end) => ({ ...sourcedPaidSuccessEvent(end), paymentIdentifier: "zzzzzzzzzzzzzzzzzzzzzzzz" }), ["zzzzzzzzzzzzzzzzzzzzzzzz"]],
    ["uppercase paymentIdentifier", (end) => ({ ...sourcedPaidSuccessEvent(end), paymentIdentifier: "CDCDCDCDCDCDCDCDCDCDCDCD" }), ["CDCDCDCDCDCDCDCDCDCDCDCD"]],
    ["uppercase event id", (end) => ({ ...sourcedPaidSuccessEvent(end), id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }), ["AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"]],
    ["uuid v1 event id", (end) => ({ ...sourcedPaidSuccessEvent(end), id: "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa" }), ["aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa"]],
    ["uuid v3 event id", (end) => ({ ...sourcedPaidSuccessEvent(end), id: "aaaaaaaa-aaaa-3aaa-8aaa-aaaaaaaaaaaa" }), ["aaaaaaaa-aaaa-3aaa-8aaa-aaaaaaaaaaaa"]],
    ["uuid v5 event id", (end) => ({ ...sourcedPaidSuccessEvent(end), id: "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa" }), ["aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa"]],
    ["wrong-variant event id", (end) => ({ ...sourcedPaidSuccessEvent(end), id: "aaaaaaaa-aaaa-4aaa-0aaa-aaaaaaaaaaaa" }), ["aaaaaaaa-aaaa-4aaa-0aaa-aaaaaaaaaaaa"]],
    ["nil event id", (end) => ({ ...sourcedPaidSuccessEvent(end), id: "00000000-0000-0000-0000-000000000000" }), []],
    ["empty actor", (end) => ({ ...sourcedPaidSuccessEvent(end), actor: "" }), []],
    ["100000-character actor", (end) => ({ ...sourcedPaidSuccessEvent(end), actor: "n".repeat(100_000) }), ["n".repeat(100_000), "n".repeat(40)]],
    ["100000-character event id", (end) => ({ ...sourcedPaidSuccessEvent(end), id: "i".repeat(100_000) }), ["i".repeat(100_000), "i".repeat(40)]],
  ];
  for (const [label, mutate, leaked] of cases) {
    const { snapshot, dataDir } = await snapshotCompleteWindowWith((end) => mutate(end));
    assertCannotUndercountWhileClaimingComplete(snapshot, label);
    assert.equal(snapshot.byResult?.paid_success || 0, 0, `${label} counted paid success`);
    assert.equal(snapshot.paidSuccessActors || 0, 0, `${label} counted paid actor`);
    assert.equal(snapshot.externalActors || 0, 0, `${label} counted external actor`);
    assert.equal(snapshot.parseableCredentialAttemptActors || 0, 0, `${label} counted credential actor`);
    const serialized = JSON.stringify(snapshot);
    for (const value of leaked) {
      assert.equal(serialized.includes(value), false, `${label} leaked into public output`);
    }
    assert.ok(serialized.length < PUBLIC_SNAPSHOT_MAX_CHARS, `${label} inflated public snapshot to ${serialized.length}`);
    await rm(dataDir, { recursive: true, force: true });
  }
});

const SATURATED_QUERY_KEYS = Object.freeze(
  Array.from({ length: 20 }, (_, index) => `key${String(index).padStart(2, "0")}`),
);

const CROSS_FIELD_MISMATCHES = [
  ["paymentPresent=false with paymentIdentifier", (end) => ({
    ...discoveryEvent(end),
    paymentIdentifier: "cdcdcdcdcdcdcdcdcdcdcdcd",
  })],
  ["POST constructed request", (end) => ({
    ...constructedCrawlerEvent(end),
    method: "POST",
  })],
  ["parsed credential without paymentActor", (end) => ({
    ...sourcedPaidSuccessEvent(end),
    paymentActor: null,
    paymentIdentifier: null,
  })],
  ["unparsed credential with paymentActor", (end) => ({
    ...sourcedPaidSuccessEvent(end),
    paymentCredentialParsed: false,
    paymentIdentifier: null,
  })],
  ["paymentPresent=false with paymentProtocol", (end) => ({
    ...discoveryEvent(end),
    paymentProtocol: "x402",
  })],
  ["paymentPresent=false with parsed credential", (end) => ({
    ...discoveryEvent(end),
    paymentCredentialParsed: true,
    paymentActor: "abababababababababababab",
  })],
  ["paymentIdentifier on parsed mpp credential", (end) => ({
    ...sourcedPaidSuccessEvent(end),
    paymentProtocol: "mpp",
  })],
  ["paymentIdentifier without parsed credential", (end) => ({
    ...sourcedPaidSuccessEvent(end),
    paymentCredentialParsed: false,
    paymentActor: null,
  })],
  ["constructed with zero required keys", (end) => ({
    ...constructedCrawlerEvent(end),
    requestConstructionRequiredKeyCount: 0,
  })],
  ["constructed without the declared required query key", (end) => ({
    ...constructedCrawlerEvent(end),
    queryKeys: [],
  })],
  ["constructed above writer required-key limit", (end) => ({
    ...constructedCrawlerEvent(end),
    requestConstructionRequiredKeyCount: 21,
  })],
  ["constructed on saturated undeclared route", (end) => privacySafeEvent({
    ts: end,
    route: "/mcp",
    kind: "paid",
    matched: true,
    queryKeys: SATURATED_QUERY_KEYS,
    requestConstruction: "constructed",
    requestConstructionRequiredKeyCount: 0,
    status: 402,
    result: "challenge",
  })],
  ["constructed on saturated not-measured route", (end) => privacySafeEvent({
    ts: end,
    route: "/deep-audit",
    kind: "paid",
    matched: true,
    queryKeys: SATURATED_QUERY_KEYS,
    requestConstruction: "constructed",
    requestConstructionRequiredKeyCount: 0,
    status: 402,
    result: "challenge",
  })],
  ["undeclared with positive required keys", (end) => ({
    ...constructedCrawlerEvent(end),
    requestConstruction: "undeclared",
    requestConstructionRequiredKeyCount: 1,
  })],
  ["not_measured with positive required keys", (end) => ({
    ...discoveryEvent(end),
    requestConstructionRequiredKeyCount: 1,
  })],
  ["constructed on a discovery route", (end) => ({
    ...discoveryEvent(end),
    requestConstruction: "constructed",
    requestConstructionRequiredKeyCount: 1,
  })],
  ["missing_required_input on POST", (end) => ({
    ...constructedCrawlerEvent(end),
    method: "POST",
    requestConstruction: "missing_required_input",
    requestConstructionRequiredKeyCount: 1,
    status: 402,
    result: "challenge",
  })],
  ["constructed unmatched route", (end) => ({
    ...mcpProbeEvent(end),
    requestConstruction: "constructed",
    requestConstructionRequiredKeyCount: 1,
  })],
  ["crawler without a classified discovery source", (end) => ({
    ...constructedCrawlerEvent(end),
    agentDiscoverySource: null,
  })],
  ["paying crawler instead of writer-classified external origin", (end) => ({
    ...sourcedPaidSuccessEvent(end),
    originClass: "crawler",
    agentDiscoverySource: "agent402",
  })],
  ["unpaid sourced external instead of writer-classified crawler origin", (end) => ({
    ...constructedCrawlerEvent(end),
    originClass: "external",
  })],
  ["settlement amount without settlement reference", (end) => ({
    ...discoveryEvent(end),
    settlementAmountAtomic: "1",
  })],
  ["settlement network without settlement reference", (end) => ({
    ...discoveryEvent(end),
    settlementNetwork: "eip155:8453",
  })],
  ["settlement currency without settlement reference", (end) => ({
    ...discoveryEvent(end),
    settlementCurrency: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  })],
  ["status below writer response range", (end) => ({
    ...discoveryEvent(end),
    status: 99,
  })],
  ["status above writer response range", (end) => ({
    ...discoveryEvent(end),
    status: 1000,
  })],
];

test("writer-impossible cross-field v3 rows cannot establish coverage or change public counts", async () => {
  for (const [label, mutate] of CROSS_FIELD_MISMATCHES) {
    const { snapshot, dataDir } = await snapshotCompleteWindowWith(mutate);
    assertCannotUndercountWhileClaimingComplete(snapshot, label);
    assert.equal(snapshot.constructedRequestEvents, 0, `${label} counted constructed request`);
    assert.equal(snapshot.paymentIdentifierEvents || 0, 0, `${label} counted payment identifier`);
    assert.equal(snapshot.parseableCredentialAttemptEvents || 0, 0, `${label} counted parsed credential`);
    assert.equal(snapshot.byResult?.paid_success || 0, 0, `${label} counted paid success`);
    assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
    const serialized = JSON.stringify(snapshot);
    assert.ok(serialized.length < PUBLIC_SNAPSHOT_MAX_CHARS, `${label} inflated public snapshot to ${serialized.length}`);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("middleware stores oversized settlement amounts as null without poisoning integrity", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-settlement-bound-"));
  const now = Date.now();
  const start = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  await seedEventFiles(dataDir, { current: [discoveryEvent(start)] });
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    requestConstructionSince: start,
    agentDiscoverySince: start,
    credentialAttemptSince: start,
    settlementEvidenceSince: start,
  });

  const paymentSignature = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      amount: "20000",
      asset: "0x2222222222222222222222222222222222222222",
      payTo: "0x3333333333333333333333333333333333333333",
    },
    payload: { authorization: { from: "0x1111111111111111111111111111111111111111" } },
    extensions: { "payment-identifier": { info: { id: "order_1234567890abcdef" } } },
  })).toString("base64");
  const settlementReference = `0x${"4".repeat(64)}`;
  const oversizedAmount = `1${"0".repeat(78)}`;
  const maxLengthAmount = "9".repeat(78);

  function emitPaidSuccess(amount) {
    const listeners = new Map();
    const paymentResponse = Buffer.from(JSON.stringify({
      success: true,
      transaction: settlementReference,
      amount,
      network: "eip155:8453",
      asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    })).toString("base64");
    telemetry.middleware({
      path: "/extract",
      url: "/extract",
      method: "GET",
      headers: {
        "user-agent": "Agent402/1.0",
        "payment-signature": paymentSignature,
      },
      query: { url: "https://example.com/resource" },
      ip: "203.0.113.79",
      socket: {},
    }, {
      statusCode: 200,
      once(name, listener) { listeners.set(name, listener); },
      getHeader(name) {
        return String(name).toLowerCase() === "payment-response" ? paymentResponse : undefined;
      },
    }, () => {});
    listeners.get("finish")?.();
  }

  emitPaidSuccess(oversizedAmount);
  await telemetry.flush();
  const oversizedRaw = await readFile(telemetry.paths.currentPath, "utf8");
  const oversizedWritten = oversizedRaw.trim().split("\n").map((line) => JSON.parse(line)).at(-1);
  assert.equal(oversizedWritten.settlementAmountAtomic, null);
  assert.equal(oversizedWritten.settlementReference, settlementReference);
  assert.equal(oversizedRaw.includes(oversizedAmount), false);
  const oversizedSnapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(oversizedSnapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
  assert.equal(oversizedSnapshot.coverage.integrity.currentFile.unusableRecordCount, 0);
  assert.equal(oversizedSnapshot.requestedWindowCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(oversizedSnapshot.requestedWindowComplete, true);
  assert.equal(oversizedSnapshot.requestConstructionCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(oversizedSnapshot.byResult.paid_success, 1);
  assert.equal(oversizedSnapshot.settlementReferencePaidSuccesses, 1);
  assert.equal(JSON.stringify(oversizedSnapshot).includes(oversizedAmount), false);

  emitPaidSuccess(maxLengthAmount);
  emitPaidSuccess("20000");
  await telemetry.flush();
  const raw = await readFile(telemetry.paths.currentPath, "utf8");
  const written = raw.trim().split("\n").map((line) => JSON.parse(line));
  const liveRows = written.filter((row) => row.settlementReference === settlementReference);
  assert.equal(liveRows.some((row) => row.settlementAmountAtomic === null), true);
  assert.equal(liveRows.some((row) => row.settlementAmountAtomic === maxLengthAmount), true);
  assert.equal(liveRows.some((row) => row.settlementAmountAtomic === "20000"), true);
  assert.equal(raw.includes(oversizedAmount), false);

  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
  assert.equal(snapshot.coverage.integrity.currentFile.unusableRecordCount, 0);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(snapshot.requestedWindowComplete, true);
  assert.equal(snapshot.byResult.paid_success, 3);
  assert.equal(snapshot.settlementReferencePaidSuccesses, 3);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes(oversizedAmount), false);
  assert.ok(serialized.length < PUBLIC_SNAPSHOT_MAX_CHARS);
  await rm(dataDir, { recursive: true, force: true });
});

test("canonical v4 MCP typed rows are consumed separately and corrupt v4 is unusable", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-typed-v4-"));
  const telemetry = createCommerceTelemetry({ dataDir, secret: "typed-v4-secret" });
  const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const decision = evaluateMcpTypedTelemetryOutcome({
    schemaVersion: "samedaydesk.mcp-typed-telemetry-input.v1",
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/enrich",
      issuedOfferDigest: digest,
    },
    request: { jsonrpc: "2.0", hasId: true, id: 7, method: "tools/call" },
    response: { hasId: true, id: 7, kind: "tool_result" },
    credential: { state: "verified", offerDigest: digest },
    execution: { state: "handler_success", handlerInvoked: true, resultIsError: false },
    settlement: { state: "succeeded", offerDigest: digest },
  });
  telemetry.appendMcpTypedDecision(decision);
  await telemetry.flush();
  const raw = await readFile(telemetry.paths.currentPath, "utf8");
  assert.equal(raw.includes("mcp-typed-telemetry.ndjson"), false);
  const row = JSON.parse(raw.trim());
  assert.equal(row.v, 4);
  assert.equal(row.sourceContract, "mcp_typed_outcome");
  assert.equal(isCanonicalMcpTypedCommerceEvent(row), true);
  const typedSnapshot = await telemetry.snapshot({ days: 90 });
  assert.equal(typedSnapshot.mcpTyped.parseableRecordCount, 1);
  assert.equal(typedSnapshot.mcpTyped.byResult.paid_success, 1);
  assert.equal(typedSnapshot.mcpTyped.byTool.enrich, 1);
  assert.equal(typedSnapshot.retainedParseableEventCount, 0);
  assert.equal(typedSnapshot.byResult.paid_success || 0, 0);
  assert.equal(typedSnapshot.coverage.integrity.currentFile.unusableRecordCount, 0);

  await writeFile(telemetry.paths.currentPath, `${raw.trim()}\n{"v":4,"sourceContract":"mcp_typed_outcome"}\n`);
  const broken = await telemetry.snapshot({ days: 90 });
  assert.equal(broken.coverage.integrity.currentFile.unusableRecordCount, 1);
  assert.equal(broken.mcpTyped.parseableRecordCount, 1);
  await rm(dataDir, { recursive: true, force: true });
});

function typedChallengeDecision({ credentialState }) {
  const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  return evaluateMcpTypedTelemetryOutcome({
    schemaVersion: "samedaydesk.mcp-typed-telemetry-input.v1",
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/enrich",
      issuedOfferDigest: digest,
    },
    request: { jsonrpc: "2.0", hasId: true, id: 7, method: "tools/call" },
    response: { hasId: true, id: 7, kind: "payment_required" },
    credential: { state: credentialState, offerDigest: null },
    execution: { state: "not_invoked", handlerInvoked: false, resultIsError: null },
    settlement: { state: "not_attempted", offerDigest: null },
  });
}

test("canonical v4 ledger persists absent and rejected challenges without redefining presence", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-typed-challenges-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "typed-challenge-secret",
    writerProcessCount: 1,
  });
  const absent = typedChallengeDecision({ credentialState: "absent" });
  const rejected = typedChallengeDecision({ credentialState: "rejected" });
  assert.equal(absent.result, "challenge");
  assert.equal(absent.paymentPresent, false);
  assert.equal(rejected.result, "challenge");
  assert.equal(rejected.paymentPresent, true);
  const queued = telemetry.appendMcpTypedDecision(absent);
  assert.equal(typeof queued?.then, "function");
  await queued;
  await telemetry.appendMcpTypedDecision(rejected);
  await telemetry.flush();
  const rows = (await readFile(telemetry.paths.currentPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].paymentPresent, false);
  assert.equal(rows[0].paymentCredentialParsed, false);
  assert.equal(rows[1].paymentPresent, true);
  assert.equal(rows[1].paymentCredentialParsed, false);
  assert.equal(isCanonicalMcpTypedCommerceEvent(rows[0]), true);
  assert.equal(isCanonicalMcpTypedCommerceEvent(rows[1]), true);
  const snapshot = await telemetry.snapshot({ days: 30 });
  assert.equal(snapshot.mcpTyped.byResult.challenge, 2);
  await rm(dataDir, { recursive: true, force: true });
});

test("appendMcpTypedDecision owns the canonical event at call time", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-typed-call-time-"));
  try {
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "typed-call-time-secret",
      writerProcessCount: 1,
    });
    const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const decision = evaluateMcpTypedTelemetryOutcome({
      schemaVersion: "samedaydesk.mcp-typed-telemetry-input.v1",
      binding: {
        tool: "enrich",
        productSku: "samedaydesk-enrich",
        resource: "mcp://tool/enrich",
        issuedOfferDigest: digest,
      },
      request: { jsonrpc: "2.0", hasId: true, id: 7, method: "tools/call" },
      response: { hasId: true, id: 7, kind: "tool_result" },
      credential: { state: "verified", offerDigest: digest },
      execution: { state: "handler_success", handlerInvoked: true, resultIsError: false },
      settlement: { state: "succeeded", offerDigest: digest },
    });
    assert.equal(decision.result, "paid_success");
    assert.equal(decision.action, "emit");
    const pending = telemetry.appendMcpTypedDecision(decision);
    decision.action = "drop";
    decision.result = "invalid";
    decision.reason = "mutated_reason";
    decision.paymentPresent = false;
    decision.paymentCredentialParsed = false;
    decision.handlerInvoked = false;
    decision.applicationOutcome = "not_run";
    decision.settlementState = "not_attempted";
    decision.schemaVersion = "mutated.schema";
    decision.binding.tool = "read";
    decision.binding.productSku = "samedaydesk-read";
    decision.binding.resource = "mcp://tool/read";
    decision.binding.issuedOfferDigest = "b".repeat(64);
    await pending;
    await telemetry.flush();
    let rows = (await readFile(telemetry.paths.currentPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    assert.equal(rows.length, 1);
    assert.equal(isCanonicalMcpTypedCommerceEvent(rows[0]), true);
    assert.equal(rows[0].action, "emit");
    assert.equal(rows[0].result, "paid_success");
    assert.equal(rows[0].reason, "typed_paid_success");
    assert.equal(rows[0].paymentPresent, true);
    assert.equal(rows[0].paymentCredentialParsed, true);
    assert.equal(rows[0].handlerInvoked, true);
    assert.equal(rows[0].applicationOutcome, "success");
    assert.equal(rows[0].settlementState, "succeeded");
    assert.equal(rows[0].binding.tool, "enrich");
    assert.equal(rows[0].binding.productSku, "samedaydesk-enrich");
    assert.equal(rows[0].binding.resource, "mcp://tool/enrich");
    assert.equal(rows[0].binding.issuedOfferDigest, digest);

    const replacedGraph = typedChallengeDecision({ credentialState: "absent" });
    await telemetry.appendMcpTypedDecision(replacedGraph);
    replacedGraph.binding = {
      tool: "read",
      productSku: "samedaydesk-read",
      resource: "mcp://tool/read",
      issuedOfferDigest: "c".repeat(64),
    };
    replacedGraph.result = "paid_success";
    await telemetry.flush();

    const invalidAtCallTime = { v: 4, sourceContract: "mcp_typed_outcome", action: "emit" };
    const queuedInvalid = telemetry.appendMcpTypedDecision(invalidAtCallTime);
    Object.assign(invalidAtCallTime, {
      result: "challenge",
      reason: "typed_payment_required",
      paymentPresent: false,
      paymentCredentialParsed: false,
      handlerInvoked: false,
      applicationOutcome: "not_run",
      settlementState: "not_attempted",
      binding: null,
    });
    await queuedInvalid;
    await telemetry.flush();
    rows = (await readFile(telemetry.paths.currentPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].result, "challenge");
    assert.equal(rows[1].reason, "typed_payment_required");
    assert.equal(rows[1].binding.tool, "enrich");
    assert.equal(rows[1].binding.issuedOfferDigest, digest);
    assert.equal(isCanonicalMcpTypedCommerceEvent(rows[1]), true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("appendMcpTypedDecision contains hostile adaptation failures without surfacing their text", async () => {
  const PRIVATE_MARKER = "PRIVATE_REVIEW_MARKER_6a61d8";
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-typed-hostile-"));
  const logged = [];
  const originalError = console.error;
  console.error = (message) => { logged.push(String(message)); };
  try {
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "typed-hostile-secret",
      writerProcessCount: 1,
    });
    const hostileInputs = [
      ["root proxy with throwing get trap", () => new Proxy({}, {
        get() { throw new Error(PRIVATE_MARKER); },
      })],
      ["throwing binding accessor", () => Object.defineProperty({
        action: "emit",
        result: "challenge",
      }, "binding", {
        enumerable: true,
        get() { throw new Error(PRIVATE_MARKER); },
      })],
      ["revoked proxy", () => {
        const pair = Proxy.revocable({}, {});
        pair.revoke();
        return pair.proxy;
      }],
    ];
    for (const [, makeInput] of hostileInputs) {
      let escaped = null;
      let pending = null;
      try {
        pending = telemetry.appendMcpTypedDecision(makeInput());
      } catch (error) {
        escaped = error;
      }
      assert.equal(escaped, null);
      assert.equal(typeof pending?.then, "function");
      await assert.doesNotReject(pending);
    }

    const queuedAfterHostile = telemetry.appendMcpTypedDecision(
      typedChallengeDecision({ credentialState: "absent" }),
    );
    assert.equal(typeof queuedAfterHostile?.then, "function");
    await queuedAfterHostile;
    await telemetry.flush();

    const raw = await readFile(telemetry.paths.currentPath, "utf8").catch(() => "");
    const rows = raw.trim() ? raw.trim().split("\n").filter(Boolean).map(JSON.parse) : [];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].result, "challenge");
    assert.equal(rows[0].binding.tool, "enrich");
    assert.equal(isCanonicalMcpTypedCommerceEvent(rows[0]), true);
    assert.ok(!raw.includes(PRIVATE_MARKER));
    assert.ok(logged.every((line) => !line.includes(PRIVATE_MARKER)));
  } finally {
    console.error = originalError;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("appendMcpTypedDecision still stores nonthrowing accessor and plain object decisions", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-typed-accessor-"));
  try {
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "typed-accessor-secret",
      writerProcessCount: 1,
    });

    const accessorDecision = typedChallengeDecision({ credentialState: "absent" });
    const accessorBinding = accessorDecision.binding;
    Object.defineProperty(accessorDecision, "binding", {
      enumerable: true,
      get() { return accessorBinding; },
    });
    const accessorPending = telemetry.appendMcpTypedDecision(accessorDecision);
    assert.equal(typeof accessorPending?.then, "function");
    await accessorPending;

    const plainDecision = typedChallengeDecision({ credentialState: "rejected" });
    const plainPending = telemetry.appendMcpTypedDecision(plainDecision);
    assert.equal(typeof plainPending?.then, "function");
    await plainPending;

    await telemetry.flush();
    const rows = (await readFile(telemetry.paths.currentPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].result, "challenge");
    assert.equal(rows[0].paymentPresent, false);
    assert.equal(rows[0].binding.tool, "enrich");
    assert.equal(rows[0].binding.issuedOfferDigest, "a".repeat(64));
    assert.equal(rows[1].result, "challenge");
    assert.equal(rows[1].paymentPresent, true);
    assert.equal(rows[1].binding.tool, "enrich");
    assert.equal(isCanonicalMcpTypedCommerceEvent(rows[0]), true);
    assert.equal(isCanonicalMcpTypedCommerceEvent(rows[1]), true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("typed snapshot coverage freshness and source-local integrity are retained", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-typed-coverage-"));
  const now = Date.now();
  const oldTs = new Date(now - 31 * 86_400_000).toISOString();
  const recentTs = new Date(now - 1_000).toISOString();
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "typed-coverage-secret",
    writerProcessCount: 1,
    mcpTypedSince: new Date(now - 90 * 86_400_000).toISOString(),
    mcpTypedFreshnessMaxAgeMs: 900_000,
  });
  const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const decision = evaluateMcpTypedTelemetryOutcome({
    schemaVersion: "samedaydesk.mcp-typed-telemetry-input.v1",
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/enrich",
      issuedOfferDigest: digest,
    },
    request: { jsonrpc: "2.0", hasId: true, id: 7, method: "tools/call" },
    response: { hasId: true, id: 7, kind: "tool_result" },
    credential: { state: "verified", offerDigest: digest },
    execution: { state: "handler_success", handlerInvoked: true, resultIsError: false },
    settlement: { state: "succeeded", offerDigest: digest },
  });
  const oldEvent = adaptMcpTypedDecisionToCommerceEvent(decision, {
    id: "11111111-1111-4111-8111-111111111111",
    ts: oldTs,
  });
  const recentEvent = adaptMcpTypedDecisionToCommerceEvent(decision, {
    id: "22222222-2222-4222-8222-222222222222",
    ts: recentTs,
  });
  await writeFile(
    telemetry.paths.currentPath,
    `${JSON.stringify(oldEvent)}\n${JSON.stringify(recentEvent)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  const snapshot = await telemetry.snapshot({ days: 30 });
  const coverage = snapshot.mcpTyped.coverage;
  assert.equal(coverage.requestedWindowComplete, true);
  assert.equal(coverage.requestedWindowCoverage, COMMERCE_COVERAGE_COMPLETE);
  assert.equal(coverage.retainedObservationStart, oldTs);
  assert.equal(coverage.retainedObservationEnd, recentTs);
  assert.equal(coverage.freshness.latestObservationAt, recentTs);
  assert.equal(coverage.freshness.status, "fresh");
  assert.equal(coverage.freshness.maxAgeMs, 900_000);
  assert.ok(Number.isFinite(coverage.freshness.ageMs) && coverage.freshness.ageMs >= 0);
  assert.equal(coverage.integrity.status, COMMERCE_INTEGRITY_OK);
  assert.equal(coverage.integrity.currentFile.parseableRecordCount, 2);
  assert.equal(coverage.integrity.currentFile.unusableRecordCount, 0);
  await appendFile(
    telemetry.paths.currentPath,
    `${JSON.stringify({ v: 4, sourceContract: "mcp_typed_outcome" })}\n`,
    "utf8",
  );
  const corrupt = await telemetry.snapshot({ days: 30 });
  assert.equal(corrupt.mcpTyped.coverage.integrity.status, COMMERCE_INTEGRITY_UNUSABLE_RECORDS);
  assert.equal(corrupt.mcpTyped.coverage.integrity.currentFile.unusableRecordCount, 1);
  assert.ok(corrupt.coverage.integrity.currentFile.unusableRecordCount >= 1);
  await rm(dataDir, { recursive: true, force: true });
});

test("late baseline does not claim full requested window", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-typed-late-baseline-"));
  try {
    const now = Date.now();
    const baseline = new Date(now - 86_400_000).toISOString();
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "typed-late-baseline-secret",
      writerProcessCount: 1,
      mcpTypedSince: baseline,
    });
    const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const decision = evaluateMcpTypedTelemetryOutcome({
      schemaVersion: "samedaydesk.mcp-typed-telemetry-input.v1",
      binding: {
        tool: "enrich",
        productSku: "samedaydesk-enrich",
        resource: "mcp://tool/enrich",
        issuedOfferDigest: digest,
      },
      request: { jsonrpc: "2.0", hasId: true, id: 7, method: "tools/call" },
      response: { hasId: true, id: 7, kind: "tool_result" },
      credential: { state: "verified", offerDigest: digest },
      execution: { state: "handler_success", handlerInvoked: true, resultIsError: false },
      settlement: { state: "succeeded", offerDigest: digest },
    });
    const event = adaptMcpTypedDecisionToCommerceEvent(decision, {
      id: "00000000-0000-4000-8000-000000000001",
      ts: baseline,
    });
    await writeFile(telemetry.paths.currentPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    const snapshot = await telemetry.snapshot({ days: 30 });
    assert.equal(snapshot.mcpTyped.coverage.requestedWindowComplete, false);
    assert.equal(snapshot.mcpTyped.coverage.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("future rows do not enter window or freshness", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-typed-future-row-"));
  try {
    const now = Date.now();
    const future = new Date(now + 86_400_000).toISOString();
    const baseline = new Date(now - 60 * 86_400_000).toISOString();
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "typed-future-row-secret",
      writerProcessCount: 1,
      mcpTypedSince: baseline,
    });
    const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const decision = evaluateMcpTypedTelemetryOutcome({
      schemaVersion: "samedaydesk.mcp-typed-telemetry-input.v1",
      binding: {
        tool: "enrich",
        productSku: "samedaydesk-enrich",
        resource: "mcp://tool/enrich",
        issuedOfferDigest: digest,
      },
      request: { jsonrpc: "2.0", hasId: true, id: 7, method: "tools/call" },
      response: { hasId: true, id: 7, kind: "tool_result" },
      credential: { state: "verified", offerDigest: digest },
      execution: { state: "handler_success", handlerInvoked: true, resultIsError: false },
      settlement: { state: "succeeded", offerDigest: digest },
    });
    const event = adaptMcpTypedDecisionToCommerceEvent(decision, {
      id: "00000000-0000-4000-8000-000000000001",
      ts: future,
    });
    await writeFile(telemetry.paths.currentPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    const snapshot = await telemetry.snapshot({ days: 30 });
    assert.equal(snapshot.mcpTyped.parseableRecordCount, 0);
    assert.equal(snapshot.mcpTyped.byResult.paid_success || 0, 0);
    assert.equal(snapshot.mcpTyped.coverage.freshness.status, "no_observations");
    assert.equal(snapshot.mcpTyped.coverage.freshness.latestObservationAt, null);
    assert.equal(snapshot.mcpTyped.coverage.retainedObservationStart, null);
    assert.equal(snapshot.mcpTyped.coverage.retainedObservationEnd, null);
    assert.equal(snapshot.mcpTyped.coverage.requestedWindowComplete, false);
    assert.equal(snapshot.mcpTyped.coverage.integrity.status, COMMERCE_INTEGRITY_SOURCE_LOCAL_DRIFT);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("production shutdown helper rejects undrained or failed lifecycle visibly", async () => {
  assert.equal(typeof drainCommerceTelemetryForShutdown, "function");
  await assert.rejects(() => drainCommerceTelemetryForShutdown({
    typedTelemetryLifecycle: {
      async shutdown() { return { drained: false, pending: 1, failures: 0 }; },
    },
    commerceTelemetry: { async flush() {} },
    timeoutMs: 5,
  }));
  await assert.rejects(() => drainCommerceTelemetryForShutdown({
    typedTelemetryLifecycle: {
      async shutdown() { throw new Error("reviewer-lifecycle-error"); },
    },
    commerceTelemetry: { async flush() {} },
    timeoutMs: 5,
  }));
  const order = [];
  await drainCommerceTelemetryForShutdown({
    typedTelemetryLifecycle: {
      async shutdown() {
        order.push("typed");
        return { drained: true, pending: 0, failures: 0 };
      },
    },
    commerceTelemetry: { async flush() { order.push("writer"); } },
    timeoutMs: 5,
  });
  assert.deepEqual(order, ["typed", "writer"]);
  const writerOnly = [];
  await drainCommerceTelemetryForShutdown({
    typedTelemetryLifecycle: null,
    commerceTelemetry: { async flush() { writerOnly.push("writer"); } },
    timeoutMs: 5,
  });
  assert.deepEqual(writerOnly, ["writer"]);
  await assert.rejects(() => drainCommerceTelemetryForShutdown({
    typedTelemetryLifecycle: {
      async shutdown() { return { drained: true, pending: 0, failures: 0 }; },
    },
    commerceTelemetry: { async flush() { throw new Error("reviewer-writer-error"); } },
    timeoutMs: 5,
  }));
});

test("writer process gate accepts only the safe integer 1", async () => {
  const badDir = await mkdtemp(path.join(os.tmpdir(), "commerce-bad-writer-"));
  const goodDir = await mkdtemp(path.join(os.tmpdir(), "commerce-good-writer-"));
  try {
    assert.throws(() => createCommerceTelemetry({
      dataDir: badDir,
      secret: "writer-gate-secret",
      writerProcessCount: 2,
    }));
    const telemetry = createCommerceTelemetry({
      dataDir: goodDir,
      secret: "writer-gate-secret",
      writerProcessCount: 1,
    });
    const status = await telemetry.storageStatus();
    assert.equal(status.writerGate.mode, "single_process_only");
    assert.equal(status.writerGate.configuredProcesses, 1);
    assert.equal(status.writerGate.crossProcessSafe, false);
  } finally {
    await rm(badDir, { recursive: true, force: true });
    await rm(goodDir, { recursive: true, force: true });
  }
});
