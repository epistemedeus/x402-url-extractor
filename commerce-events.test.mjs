import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyCommerceResult,
  classifyCommerceRoute,
  createCommerceTelemetry,
  isSemanticUnmatched,
  normalizeCommercePayerClasses,
} from "./commerce-events.mjs";

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
  assert.equal(classifyCommerceRoute("/a2a/message:send").route, "/a2a/message:send");
  assert.equal(classifyCommerceRoute("/work/opportunity-preflight").kind, "paid");
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

test("semantic unmatched classification is high precision and excludes technical misses", () => {
  assert.equal(isSemanticUnmatched({ route: "/morpho-risk/*", kind: "unmatched", matched: false, status: 404 }), true);
  assert.equal(isSemanticUnmatched({ route: "/repository-audit/*", kind: "unmatched", matched: false, status: 404 }), true);
  assert.equal(isSemanticUnmatched({ route: "/assets/*", kind: "unmatched", matched: false, status: 404 }), false);
  assert.equal(isSemanticUnmatched({ route: "/:opaque/*", kind: "unmatched", matched: false, status: 404 }), false);
  assert.equal(isSemanticUnmatched({ route: "/defi/morpho-position", kind: "paid", matched: true, status: 402 }), false);
});

test("aggregate snapshot excludes internal and crawler events and exposes no actor IDs", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-events-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    internalToken: "owner-canary",
    settlementEvidenceSince: "2020-01-01T00:00:00.000Z",
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
  run({ path: "/morpho-risk/quote", status: 404 });
  run({ path: "/assets/logo.svg", status: 404 });
  run({ path: "/someone@example.com/private", status: 404 });

  await telemetry.flush();
  const storage = await telemetry.storageStatus();
  assert.equal(storage.ready, true);
  assert.ok(storage.currentBytes > 0);
  assert.equal(storage.boundedBytes, 2 * 1024 * 1024);
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.externalEvents, 8);
  assert.equal(snapshot.externalActors, 1);
  assert.equal(snapshot.repeatExternalActors, 1);
  assert.equal(snapshot.byResult.discovery, 1);
  assert.equal(snapshot.byResult.challenge, 1);
  assert.equal(snapshot.byResult.paid_success, 1);
  assert.equal(snapshot.byResult.replay_success, 1);
  assert.equal(snapshot.replaySuccessEvents, 1);
  assert.equal(snapshot.paidSuccessActors, 1);
  assert.equal(snapshot.repeatPaidSuccessActors, 0);
  assert.equal(snapshot.independentPaidSuccessActors, 0);
  assert.equal(snapshot.repeatIndependentPaidSuccessActors, 0);
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
  assert.equal(snapshot.byResult.unmatched, 3);
  assert.equal(snapshot.unmatchedRequests["/morpho-risk/*"], 1);
  assert.equal(snapshot.unmatchedRequests["/assets/*"], 1);
  assert.equal(snapshot.unmatchedRequests["/:opaque/*"], 1);
  assert.equal(snapshot.semanticUnmatchedEvents, 1);
  assert.equal(snapshot.semanticUnmatchedActors, 1);
  assert.equal(snapshot.repeatSemanticUnmatchedActors, 0);
  assert.deepEqual({ ...snapshot.semanticUnmatched }, { "/morpho-risk/*": 1 });
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
      headers: { "payment-signature": signature }, query: {}, ip: "203.0.113.30", socket: {},
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
  assert.equal(snapshot.independentPaidSuccessActors, 1);
  assert.equal(snapshot.repeatIndependentPaidSuccessActors, 1);
  assert.equal(snapshot.settlementReferenceEligiblePaidSuccesses, 2);
  assert.equal(snapshot.missingSettlementReferencePaidSuccesses, 2);
  assert.equal(snapshot.settlementReferenceCoverage, 0);
  assert.equal(snapshot.settlementEvidenceByClass.independent.missingReference, 2);
  assert.equal(JSON.stringify(snapshot).includes(payer), false);
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
