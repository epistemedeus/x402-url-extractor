import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalReplayUrl,
  createIdempotencyReplay,
  decodeReplayPayment,
  MCP_RECOVERY_META,
  mcpRecoveryResultDigest,
  trackReplaySettlementAttempts,
} from "./idempotency-replay.mjs";

const payer = "0x1111111111111111111111111111111111111111";
const payTo = "0x2222222222222222222222222222222222222222";
const asset = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const paymentId = "order_1234567890abcdef";

function nativeOperation(now = Date.now()) {
  const payment = JSON.parse(Buffer.from(encodedPayment(), "base64").toString());
  payment.resource = { url: "mcp://tool/opportunity_preflight" };
  Object.assign(payment.payload.authorization, { to: payTo, value: payment.accepted.amount,
    nonce: `0x${"9".repeat(64)}`, validBefore: String(Math.floor(now / 1000) + 30) });
  return { name: "opportunity_preflight", arguments: { rewardUsd: 10, hours: 1 }, payment,
    scope: { endpointUrl: "http://127.0.0.1:21120/mcp", tenantId: "tenant-a" },
    context: { operationId: "operation-a", reservationId: "reservation-a", principalId: "principal-a", grantId: "grant-a" } };
}

const nativeResult = { content: [{ type: "text", text: '{"decision":"attempt"}' }],
  structuredContent: { decision: "attempt" }, _meta: { "x402/payment-response": { success: true } } };

test("native reservation pins its original credential and operation across process restart", async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "native-replay-binding-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const options = { dataDir, secret: "native-test-secret", ttlMs: 60_000 };
  const journal = createIdempotencyReplay(options), input = nativeOperation();
  let executions = 0;
  const result = await journal.runMcpTool(input, async () => { executions++; return nativeResult; });
  assert.equal(result._meta[MCP_RECOVERY_META].persisted, true);
  assert.equal(result._meta[MCP_RECOVERY_META].resultDigest, mcpRecoveryResultDigest(nativeResult));
  const restarted = createIdempotencyReplay(options);
  assert.deepEqual((await restarted.recoverMcpResult(input)).structuredContent, nativeResult.structuredContent);
  assert.equal((await restarted.runMcpTool(input, () => { executions++; }))._meta[MCP_RECOVERY_META].replayed, true);
  const replacement = structuredClone(input);
  replacement.payment.extensions["payment-identifier"].info.id = "replacement_credential_12345";
  replacement.payment.payload.authorization.nonce = `0x${"8".repeat(64)}`;
  replacement.payment.payload.signature = "0xreplacement";
  for (const changed of [replacement, { ...input, context: { ...input.context, principalId: "principal-b" } },
    { ...input, context: { ...input.context, operationId: "operation-b" } }]) {
    const rejected = await restarted.runMcpTool(changed, () => { executions++; });
    assert.equal(rejected.isError, true);
    assert.equal(JSON.parse(rejected.content[0].text).error, "payment_identifier_request_conflict");
  }
  assert.equal(executions, 1);
});

test("native completed output survives failed persistence in its execution and can save without re-execution", async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "native-replay-save-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const options = { dataDir, secret: "native-test-secret", ttlMs: 60_000 };
  const journal = createIdempotencyReplay(options), input = nativeOperation();
  let executions = 0, settlements = 0;
  const facilitator = trackReplaySettlementAttempts({ async settle() {
    settlements++;
    const disk = JSON.parse(await readFile(journal.storePath, "utf8"));
    assert.equal(disk.records[0].settlementAttempted, true);
    return { success: true };
  } });
  const obstruction = path.join(dataDir, "idempotency-replay.tmp.json");
  const delivered = await journal.runMcpTool(input, async () => {
    executions++; await facilitator.settle(); await mkdir(obstruction); return nativeResult;
  });
  assert.equal(delivered._meta[MCP_RECOVERY_META].persisted, false);
  assert.deepEqual(delivered.structuredContent, nativeResult.structuredContent);
  const retained = await journal.recoverMcpResult(input);
  assert.equal(retained._meta[MCP_RECOVERY_META].persisted, false);
  assert.equal(retained._meta[MCP_RECOVERY_META].newSettlementAttempt, false);
  assert.equal((await journal.flushMcpResults()).pendingPersistence, 1);
  await rm(obstruction, { recursive: true });
  assert.equal((await journal.flushMcpResults()).pendingPersistence, 0);
  const cold = await createIdempotencyReplay(options).recoverMcpResult(input);
  assert.equal(cold._meta[MCP_RECOVERY_META].persisted, true);
  assert.deepEqual(cold.structuredContent, nativeResult.structuredContent);
  assert.equal(executions, 1); assert.equal(settlements, 1);
});

test("native unknown payment stays quarantined; missing, expired and corrupt recovery never executes", async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "native-replay-unknown-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let clock = Date.now(), executions = 0;
  const options = { dataDir, secret: "native-test-secret", ttlMs: 60_000, now: () => clock };
  const journal = createIdempotencyReplay(options), input = nativeOperation(clock);
  assert.equal(JSON.parse((await journal.recoverMcpResult(input)).content[0].text).error, "recovery_not_found_or_expired");
  assert.equal(JSON.parse(await readFile(journal.storePath, "utf8")).records.length, 0);
  const facilitator = trackReplaySettlementAttempts({ async settle() { throw new Error("unknown_provider_reply"); } });
  const unknown = await journal.runMcpTool(input, async () => { executions++; await facilitator.settle(); });
  assert.equal(JSON.parse(unknown.content[0].text).charged, null);
  const restarted = createIdempotencyReplay(options);
  const pending = await restarted.runMcpTool(input, () => { executions++; });
  assert.equal(JSON.parse(pending.content[0].text).error, "payment_execution_in_flight_or_unknown");
  assert.equal(JSON.parse(await readFile(journal.storePath, "utf8")).records[0].settlementAttempted, true);
  clock += 120_000;
  assert.equal(JSON.parse((await restarted.recoverMcpResult(input)).content[0].text).error, "recovery_not_found_or_expired");
  assert.equal(JSON.parse((await restarted.runMcpTool(input, () => { executions++; })).content[0].text).error, "payment_replay_expired");
  await writeFile(journal.storePath, "corrupt");
  assert.equal(JSON.parse((await restarted.recoverMcpResult(input)).content[0].text).error, "recovery_storage_unavailable");
  assert.equal(await readFile(journal.storePath, "utf8"), "corrupt");
  assert.equal(executions, 1);
});

test("native unpaid terminal refusal keeps its useful result without inventing settlement", async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "native-replay-refusal-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const journal = createIdempotencyReplay({ dataDir, secret: "native-test-secret", ttlMs: 60_000 });
  const input = nativeOperation();
  const refusal = { isError: true, content: [{ type: "text", text: '{"error":"unsupported_network","charged":false}' }] };
  await journal.runMcpTool(input, async () => refusal);
  const cold = await journal.recoverMcpResult(input);
  assert.deepEqual(cold.content, refusal.content);
  assert.equal(cold.isError, true);
  assert.equal(cold._meta["x402/payment-response"], undefined);
  assert.equal(cold._meta[MCP_RECOVERY_META].newSettlementAttempt, false);
});

test("concurrent native continuation never starts a second execution while the first runs", async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "native-replay-inflight-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const journal = createIdempotencyReplay({ dataDir, secret: "native-test-secret", ttlMs: 60_000 });
  const input = nativeOperation();
  let executions = 0, finish, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const first = journal.runMcpTool(input, async () => {
    executions++; entered(); await new Promise(resolve => { finish = resolve; }); return nativeResult;
  });
  await ready;
  const second = await journal.runMcpTool(input, () => { executions++; });
  assert.equal(JSON.parse(second.content[0].text).error, "payment_execution_in_flight_or_unknown");
  finish(); await first;
  assert.deepEqual((await journal.recoverMcpResult(input)).structuredContent, nativeResult.structuredContent);
  assert.equal(executions, 1);
});

function encodedPayment({ id = paymentId, from = payer, amount = "20000", signature = "0xsigned-original" } = {}) {
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
    payload: { authorization: { from }, signature },
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

test("persistent identity and capacity preserve pending claims, corrupt state fails closed", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "replay-durable-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const options = { dataDir, maxEntries: 1, publicUrl: "https://agents.samedaydesk.com" };
  const replay = createIdempotencyReplay(options);
  const request = { method: "GET", url: "http://127.0.0.1:1234/extract", headers: { "payment-signature": encodedPayment() } };
  const binding = replay.bindingFor(request);
  assert.equal((await replay.claim(binding)).reserved, true);
  const restarted = createIdempotencyReplay(options);
  const rebound = restarted.bindingFor({ ...request, url: "http://127.0.0.1:9876/extract" });
  assert.equal((await restarted.claim(rebound)).kind, "pending");
  const another = restarted.bindingFor({ ...request, headers: { "payment-signature": encodedPayment({ id: "another_order_12345678" }) } });
  assert.equal((await restarted.claim(another)).kind, "capacity");
  await writeFile(restarted.storePath, "corrupt");
  await assert.rejects(restarted.claim(rebound));
  assert.equal(await readFile(restarted.storePath, "utf8"), "corrupt");
});

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

test("cached x402 response requires the exact credential that originally settled", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "idempotency-credential-"));
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

  let nextRuns = 0;
  const res = fakeResponse();
  await replay.middleware({
    method: "GET",
    path: "/defi/morpho-position",
    originalUrl: "/defi/morpho-position?address=0xabc",
    headers: {
      "payment-signature": encodedPayment({ signature: "0xlookalike" }),
      host: "agents.samedaydesk.com",
      "x-forwarded-proto": "https",
    },
    protocol: "http",
  }, res, () => { nextRuns += 1; });
  assert.equal(nextRuns, 0);
  assert.equal(res.statusCode, 409);
  assert.equal(JSON.parse(res.body).error, "payment_identifier_request_conflict");
  await rm(dataDir, { recursive: true, force: true });
});

test("paid POST replay binds the exact request bytes and rejects body drift before the handler", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "idempotency-post-body-"));
  const replay = createIdempotencyReplay({ dataDir, secret: "test-secret", ttlMs: 60_000 });
  const headers = { "payment-signature": encodedPayment() };
  const originalBody = Buffer.from('{"provider":"openfort","observations":[]}');
  const original = replay.bindingFor({
    method: "POST",
    url: "https://agents.samedaydesk.com/security/wallet-policy-conformance",
    headers,
    bodyBytes: originalBody,
  });
  await replay.store(original, {
    status: 200,
    headers: { "content-type": "application/json", "payment-response": "signed-settlement" },
    body: Buffer.from('{"ok":true}'),
  });

  for (const [rawBody, expectedStatus, expectedHeader] of [
    [originalBody, 200, "hit"],
    [Buffer.from('{"provider":"privy","observations":[]}'), 409, undefined],
  ]) {
    let nextRuns = 0;
    const res = fakeResponse();
    await replay.middleware({
      method: "POST",
      path: "/security/wallet-policy-conformance",
      originalUrl: "/security/wallet-policy-conformance",
      rawBody,
      headers: { ...headers, host: "agents.samedaydesk.com", "x-forwarded-proto": "https" },
      protocol: "http",
    }, res, () => { nextRuns += 1; });
    assert.equal(nextRuns, 0);
    assert.equal(res.statusCode, expectedStatus);
    assert.equal(res.headers["x-payment-replay"], expectedHeader);
    if (expectedStatus === 409) {
      assert.equal(JSON.parse(res.body).error, "payment_identifier_request_conflict");
      assert.equal(JSON.parse(res.body).charged, false);
    }
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

test("in-flight claim prevents a twin POST from running a second handler", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "idempotency-inflight-"));
  const replay = createIdempotencyReplay({
    dataDir,
    secret: "test-secret",
    ttlMs: 60_000,
    routes: new Set(["/extract/batch"]),
    inFlightPaths: new Set(["/extract/batch"]),
    inFlightWaitMs: 200,
  });
  const headers = {
    "payment-signature": encodedPayment(),
    host: "agents.samedaydesk.com",
    "x-forwarded-proto": "https",
  };
  const body = Buffer.from('{"urls":["https://example.com/"]}');
  let handlerRuns = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  function liveResponse() {
    const responseHeaders = { "content-type": "application/json" };
    let ended;
    const endedPromise = new Promise((resolve) => { ended = resolve; });
    const res = {
      statusCode: 200,
      body: null,
      set(name, value) {
        responseHeaders[String(name).toLowerCase()] = String(value);
        return this;
      },
      status(value) {
        this.statusCode = value;
        return this;
      },
      json(value) {
        this.body = Buffer.from(JSON.stringify(value));
        this.end(this.body);
        return this;
      },
      send(value) {
        this.body = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
        return this;
      },
      getHeaders() {
        return { ...responseHeaders };
      },
      write() { return true; },
      end(chunk) {
        if (chunk) this.send(chunk);
        ended();
        return this;
      },
      endedPromise,
    };
    return res;
  }

  const firstReq = {
    method: "POST",
    path: "/extract/batch",
    originalUrl: "/extract/batch",
    rawBody: body,
    headers,
    protocol: "http",
  };
  const firstRes = liveResponse();
  const first = replay.middleware(firstReq, firstRes, async () => {
    handlerRuns += 1;
    await firstGate;
    firstRes.set("payment-response", "signed-settlement");
    firstRes.end('{"ok":true}');
  });

  const secondReq = { ...firstReq };
  const secondRes = liveResponse();
  const second = replay.middleware(secondReq, secondRes, () => { handlerRuns += 1; });
  await second;
  assert.equal(handlerRuns, 1);
  assert.equal(secondRes.statusCode, 503);
  assert.equal(JSON.parse(secondRes.body).charged, null);
  releaseFirst();
  await first;
  await firstRes.endedPromise;
  assert.equal(handlerRuns, 1);
  await rm(dataDir, { recursive: true, force: true });
});

test("required replay paths classify missing identifier separately from unbounded validity", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "idempotency-classify-"));
  const ttlMs = 60_000;
  const nowMs = 1_700_000_000_000;
  const replay = createIdempotencyReplay({
    dataDir,
    secret: "test-secret",
    ttlMs,
    now: () => nowMs,
    routes: new Set(["/extract/batch"]),
    requiredReplayPaths: new Set(["/extract/batch"]),
    publicUrl: "https://agents.samedaydesk.com",
  });

  function response() {
    return fakeResponse();
  }

  const missingIdPayment = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      asset,
      amount: "10000",
      payTo,
      maxTimeoutSeconds: 300,
    },
    payload: {
      authorization: {
        from: payer,
        validBefore: String(Math.floor(nowMs / 1000) + 30),
      },
      signature: "0xsigned",
    },
    extensions: { "payment-identifier": { info: { required: true } } },
  })).toString("base64");

  const missingRes = response();
  let next = false;
  await replay.middleware({
    method: "POST",
    path: "/extract/batch",
    originalUrl: "/extract/batch",
    rawBody: Buffer.from("{}"),
    headers: {
      "payment-signature": missingIdPayment,
      host: "agents.samedaydesk.com",
      "x-forwarded-proto": "https",
    },
    protocol: "http",
  }, missingRes, () => { next = true; });
  assert.equal(next, false);
  assert.equal(missingRes.statusCode, 400);
  assert.deepEqual(JSON.parse(missingRes.body), {
    ok: false,
    error: "payment_identifier_required",
    charged: false,
  });

  const unboundedPayment = encodedPayment({ id: "bounded_order_1234567890" });
  const decoded = JSON.parse(Buffer.from(unboundedPayment, "base64").toString("utf8"));
  decoded.payload.authorization.validBefore = String(Math.floor(nowMs / 1000) + Math.floor(ttlMs / 1000) + 120);
  const unboundedHeader = Buffer.from(JSON.stringify(decoded)).toString("base64");
  const unboundedRes = response();
  next = false;
  await replay.middleware({
    method: "POST",
    path: "/extract/batch",
    originalUrl: "/extract/batch",
    rawBody: Buffer.from("{}"),
    headers: {
      "payment-signature": unboundedHeader,
      host: "agents.samedaydesk.com",
      "x-forwarded-proto": "https",
    },
    protocol: "http",
  }, unboundedRes, () => { next = true; });
  assert.equal(next, false);
  assert.equal(unboundedRes.statusCode, 400);
  assert.deepEqual(JSON.parse(unboundedRes.body), {
    ok: false,
    error: "bounded_payment_validity_required",
    charged: false,
  });

  await rm(dataDir, { recursive: true, force: true });
});
