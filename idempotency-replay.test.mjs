import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalReplayUrl,
  createIdempotencyReplay,
  decodeReplayPayment,
} from "./idempotency-replay.mjs";

const payer = "0x1111111111111111111111111111111111111111";
const payTo = "0x2222222222222222222222222222222222222222";
const asset = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const paymentId = "order_1234567890abcdef";

function encodedPayment({ id = paymentId, from = payer, amount = "20000" } = {}) {
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      asset,
      amount,
      payTo,
      maxTimeoutSeconds: 300,
    },
    payload: { authorization: { from } },
    extensions: { "payment-identifier": { info: { id } } },
  })).toString("base64");
}

function fakeResponse() {
  const headers = {};
  return {
    statusCode: 200,
    body: null,
    set(name, value) {
      headers[String(name).toLowerCase()] = String(value);
      return this;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.body = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
      return this;
    },
    json(value) {
      this.set("content-type", "application/json");
      this.body = Buffer.from(JSON.stringify(value));
      return this;
    },
    getHeaders() {
      return { ...headers };
    },
    headers,
  };
}

test("canonical replay URL binds sorted query keys and values", () => {
  assert.equal(
    canonicalReplayUrl("https://agents.samedaydesk.com/defi/morpho-position?shocks=-20,-10&address=0xabc"),
    "https://agents.samedaydesk.com/defi/morpho-position?address=0xabc&shocks=-20%2C-10",
  );
});

test("payment decoder requires a complete x402 v2 exact payment binding", () => {
  const decoded = decodeReplayPayment({ "payment-signature": encodedPayment() });
  assert.equal(decoded.id, paymentId);
  assert.equal(decoded.protocol, "x402");
  assert.equal(decoded.payer, payer);
  assert.equal(decoded.terms.amount, "20000");
  assert.equal(decodeReplayPayment({ "payment-signature": "not-base64-json" }), null);
  assert.equal(decodeReplayPayment({}), null);
});

test("same payment ID and canonical request replays without a second handler run", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "idempotency-replay-"));
  const replay = createIdempotencyReplay({ dataDir, secret: "test-secret", ttlMs: 60_000 });
  const headers = { "payment-signature": encodedPayment() };
  const original = replay.bindingFor({
    method: "GET",
    url: "https://agents.samedaydesk.com/defi/morpho-position?shocks=-20,-10&address=0xabc",
    headers,
  });
  assert.equal(await replay.store(original, {
    status: 200,
    headers: { "content-type": "application/json", "payment-response": "signed-settlement" },
    body: Buffer.from('{"ok":true}'),
  }), true);

  let nextRuns = 0;
  const req = {
    method: "GET",
    path: "/defi/morpho-position",
    originalUrl: "/defi/morpho-position?address=0xabc&shocks=-20,-10",
    headers: { ...headers, host: "agents.samedaydesk.com", "x-forwarded-proto": "https" },
    protocol: "http",
  };
  const res = fakeResponse();
  await replay.middleware(req, res, () => { nextRuns += 1; });
  assert.equal(nextRuns, 0);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.toString("utf8"), '{"ok":true}');
  assert.equal(res.headers["x-payment-replay"], "hit");
  assert.equal(res.headers["payment-response"], "signed-settlement");

  const onDisk = await readFile(replay.storePath, "utf8");
  assert.equal(onDisk.includes(paymentId), false);
  assert.equal(onDisk.includes(payer), false);
  assert.equal(onDisk.includes("morpho-position"), false);
  await rm(dataDir, { recursive: true, force: true });
});

test("same payment ID on changed input or payer fails with uncharged 409", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "idempotency-conflict-"));
  const replay = createIdempotencyReplay({ dataDir, secret: "test-secret", ttlMs: 60_000 });
  const originalHeaders = { "payment-signature": encodedPayment() };
  const original = replay.bindingFor({
    method: "GET",
    url: "https://agents.samedaydesk.com/defi/morpho-position?address=0xabc",
    headers: originalHeaders,
  });
  await replay.store(original, {
    status: 200,
    headers: { "content-type": "application/json", "payment-response": "signed-settlement" },
    body: Buffer.from('{"ok":true}'),
  });

  for (const [query, from] of [
    ["address=0xdef", payer],
    ["address=0xabc", "0x3333333333333333333333333333333333333333"],
  ]) {
    let nextRuns = 0;
    const res = fakeResponse();
    await replay.middleware({
      method: "GET",
      path: "/defi/morpho-position",
      originalUrl: `/defi/morpho-position?${query}`,
      headers: {
        "payment-signature": encodedPayment({ from }),
        host: "agents.samedaydesk.com",
        "x-forwarded-proto": "https",
      },
      protocol: "http",
    }, res, () => { nextRuns += 1; });
    assert.equal(nextRuns, 0);
    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(res.body).charged, false);
    assert.equal(res.headers["x-payment-idempotency"], "conflict");
  }
  await rm(dataDir, { recursive: true, force: true });
});

test("expired records return to normal payment processing", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "idempotency-expiry-"));
  let currentTime = 1_000_000;
  const replay = createIdempotencyReplay({
    dataDir,
    secret: "test-secret",
    ttlMs: 60_000,
    now: () => currentTime,
  });
  const binding = replay.bindingFor({
    method: "GET",
    url: "https://agents.samedaydesk.com/defi/morpho-position?address=0xabc",
    headers: { "payment-signature": encodedPayment() },
  });
  await replay.store(binding, {
    status: 200,
    headers: { "content-type": "application/json", "payment-response": "signed-settlement" },
    body: Buffer.from('{"ok":true}'),
  });
  currentTime += 60_001;
  assert.deepEqual(await replay.lookup(binding), { kind: "miss" });
  const status = await replay.storageStatus();
  assert.equal(status.activeEntries, 0);
  await rm(dataDir, { recursive: true, force: true });
});

test("a newly settled response is durable before the network response ends", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "idempotency-before-end-"));
  const replay = createIdempotencyReplay({ dataDir, secret: "test-secret", ttlMs: 60_000 });
  const headers = {
    "payment-signature": encodedPayment(),
    host: "agents.samedaydesk.com",
    "x-forwarded-proto": "https",
  };
  const req = {
    method: "GET",
    path: "/defi/morpho-position",
    originalUrl: "/defi/morpho-position?address=0xabc",
    headers,
    protocol: "http",
  };
  const responseHeaders = { "content-type": "application/json" };
  let resolveEnded;
  const ended = new Promise((resolve) => { resolveEnded = resolve; });
  const res = {
    statusCode: 200,
    set(name, value) {
      responseHeaders[String(name).toLowerCase()] = String(value);
      return this;
    },
    getHeaders() {
      return { ...responseHeaders };
    },
    write() {
      return true;
    },
    end() {
      resolveEnded();
      return this;
    },
  };
  await replay.middleware(req, res, () => {
    res.set("payment-response", "signed-settlement");
    res.end('{"ok":true}');
  });
  await ended;
  const binding = replay.bindingFor({
    method: "GET",
    url: "https://agents.samedaydesk.com/defi/morpho-position?address=0xabc",
    headers,
  });
  assert.equal((await replay.lookup(binding)).kind, "hit");
  await rm(dataDir, { recursive: true, force: true });
});
