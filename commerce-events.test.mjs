import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyCommerceResult,
  classifyCommerceRoute,
  createCommerceTelemetry,
} from "./commerce-events.mjs";

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
});

test("paid response classes separate challenge, validation, success, and failure", () => {
  assert.equal(classifyCommerceResult({ kind: "paid", matched: true, paymentPresent: false, status: 402 }), "challenge");
  assert.equal(classifyCommerceResult({ kind: "paid", matched: true, paymentPresent: true, status: 400 }), "validation_failure");
  assert.equal(classifyCommerceResult({ kind: "paid", matched: true, paymentPresent: true, status: 200 }), "paid_success");
  assert.equal(classifyCommerceResult({ kind: "paid", matched: true, paymentPresent: true, status: 503 }), "service_failure");
  assert.equal(classifyCommerceResult({ kind: "unmatched", matched: false, paymentPresent: false, status: 404 }), "unmatched");
  assert.equal(classifyCommerceResult({ route: "/mcp", kind: "paid", matched: true, paymentPresent: false, status: 200 }), "protocol_discovery");
});

test("aggregate snapshot excludes internal and crawler events and exposes no actor IDs", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-events-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "test-secret",
    internalToken: "owner-canary",
    maxBytes: 1024 * 1024,
  });

  function run({ path: requestPath, status = 200, headers = {}, query = {}, ip = "203.0.113.10" }) {
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
    };
    telemetry.middleware(req, res, () => {});
    listeners.get("finish")?.();
  }

  run({ path: "/.well-known/x402", status: 200 });
  run({ path: "/defi/morpho-position", status: 402, query: { address: "secret-value" } });
  run({ path: "/defi/morpho-position", status: 200, headers: { "payment-signature": "not-stored" } });
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

  await telemetry.flush();
  const storage = await telemetry.storageStatus();
  assert.equal(storage.ready, true);
  assert.ok(storage.currentBytes > 0);
  assert.equal(storage.boundedBytes, 2 * 1024 * 1024);
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.externalEvents, 4);
  assert.equal(snapshot.externalActors, 1);
  assert.equal(snapshot.repeatExternalActors, 1);
  assert.equal(snapshot.byResult.discovery, 1);
  assert.equal(snapshot.byResult.challenge, 1);
  assert.equal(snapshot.byResult.paid_success, 1);
  assert.equal(snapshot.byResult.protocol_discovery, 1);
  assert.equal(JSON.stringify(snapshot).includes("secret-value"), false);
  assert.equal(JSON.stringify(snapshot).includes("not-stored"), false);
  assert.equal(JSON.stringify(snapshot).includes("actor"), false);

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
