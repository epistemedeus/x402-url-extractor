import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evm, Mppx } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";
import { mppAssetForNetwork } from "./mpp-dual-stack.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const network = "eip155:8453";
const account = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const route = "/work/opportunity-preflight?rewardUsd=10&hours=1&hourlyCostUsd=1";
const host = "agents.samedaydesk.com";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function setup(t, { unknown = false, verifyValid = true } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "merchant-replay-http-"));
  const state = { settle: 0, verify: 0, verifyValid, markerBeforeSettle: false };
  const facilitator = createServer(async (req, res) => {
    let output;
    if (req.url === "/supported") output = { kinds: [{ network, scheme: "exact", x402Version: 2 }], extensions: [], signers: {} };
    else if (req.url === "/verify") { state.verify += 1; output = { isValid: state.verifyValid, invalidReason: state.verifyValid ? undefined : "invalid_signature", payer: account.address }; }
    else if (req.url === "/settle") {
      state.settle += 1;
      const store = JSON.parse(await readFile(path.join(dataDir, "idempotency-replay.json"), "utf8"));
      state.markerBeforeSettle = store.records.some((record) => record.pending && record.settlementAttempted);
      output = unknown ? { success: false, errorReason: "unknown_settlement", transaction: "", network }
        : { success: true, payer: account.address, transaction: `0x${"3".repeat(64)}`, network };
    } else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(output));
  });
  await new Promise((resolve) => facilitator.listen(0, "127.0.0.1", resolve));
  let child;
  let base;
  async function start() {
    await stop(child);
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    child = spawn(process.execPath, ["server.js"], { cwd, env: { ...process.env,
      PORT: String(port), PUBLIC_URL: `https://${host}`, COMMERCE_DATA_DIR: dataDir,
      FACILITATOR: "xpay", FACILITATOR_URL: `http://127.0.0.1:${facilitator.address().port}`,
      EXTRACT_BATCH_ENABLED: "0", IDEMPOTENCY_INFLIGHT_WAIT_MS: "50",
      MPP_SECRET_KEY: "test-secret-key-test-secret-key-32", COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
    }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (data) => { output = (output + data).slice(-8000); });
    child.stderr.on("data", (data) => { output = (output + data).slice(-8000); });
    const deadline = Date.now() + 20000;
    while (!output.includes(`x402-merchant listening on :${port}`)) {
      if (child.exitCode !== null || Date.now() > deadline) { await stop(child); throw new Error(`merchant startup failed: ${output}`); }
      await sleep(20);
    }
    base = `http://127.0.0.1:${port}`;
  }
  t.after(async () => { await stop(child); await new Promise((resolve) => facilitator.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  await start();
  return { state, restart: start, request: (headers = {}, suffix = route) => fetch(`${base}${suffix}`, { headers: { host, ...headers } }) };
}

async function credential(preview, rail, { identifier = true } = {}) {
  const response = await preview.request();
  assert.equal(response.status, 402);
  if (rail === "mpp") {
    const client = Mppx.create({ methods: [evm({ account, currencies: [mppAssetForNetwork(network)], maxAmount: "1" })], polyfill: false });
    return { authorization: await client.createCredential(response) };
  }
  const challenge = JSON.parse(Buffer.from(response.headers.get("payment-required"), "base64").toString());
  await response.text();
  const accepted = challenge.accepts.find((item) => item.network === network && item.scheme === "exact");
  return { "payment-signature": Buffer.from(JSON.stringify({ x402Version: 2, accepted,
    payload: { signature: `0x${"4".repeat(130)}`, authorization: { from: account.address, to: accepted.payTo,
      value: accepted.amount, validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: `0x${"5".repeat(64)}` } },
    ...(identifier ? { extensions: { "payment-identifier": { info: { required: false, id: "shared_replay_1234567890" } } } } : {}),
  })).toString("base64") };
}

for (const rail of ["x402", "mpp"]) {
  test(`existing ${rail} unknown settlement is durable across retry and restart`, { timeout: 60000 }, async (t) => {
    const preview = await setup(t, { unknown: true });
    const headers = await credential(preview, rail);
    await preview.request(headers).then((r) => r.text());
    assert.equal(preview.state.settle, 1);
    assert.equal(preview.state.markerBeforeSettle, true);
    const retry = await preview.request(headers);
    assert.equal(retry.status, 503); await retry.text();
    await preview.restart();
    const resumed = await preview.request(headers);
    assert.equal(resumed.status, 503); await resumed.text();
    assert.equal(preview.state.settle, 1);
    assert.equal(preview.state.verify, 1);
  });

  test(`existing ${rail} successful response replays after restart without settlement`, { timeout: 60000 }, async (t) => {
    const preview = await setup(t);
    const headers = await credential(preview, rail);
    const first = await preview.request(headers);
    assert.equal(first.status, 200);
    const body = await first.text();
    await preview.restart();
    const resumed = await preview.request(headers);
    assert.equal(resumed.headers.get("x-payment-replay"), "hit");
    assert.equal(await resumed.text(), body);
    assert.equal(preview.state.settle, 1);
  });

  test(`existing ${rail} definite verification rejection permits a valid retry`, { timeout: 60000 }, async (t) => {
    const preview = await setup(t, { verifyValid: false });
    const headers = await credential(preview, rail);
    const rejected = await preview.request(headers); assert.equal(rejected.status, 402); await rejected.text();
    assert.equal(preview.state.settle, 0);
    preview.state.verifyValid = true;
    const paid = await preview.request(headers); assert.equal(paid.status, 200); await paid.text();
    assert.equal(preview.state.settle, 1);
  });
}

test("existing x402 without optional payment ID still works and gets restart replay", { timeout: 60000 }, async (t) => {
  const preview = await setup(t);
  const headers = await credential(preview, "x402", { identifier: false });
  const first = await preview.request(headers); assert.equal(first.status, 200); await first.text();
  await preview.restart();
  const resumed = await preview.request(headers); assert.equal(resumed.headers.get("x-payment-replay"), "hit"); await resumed.text();
  assert.equal(preview.state.settle, 1);
});

test("changing only the x402 payment identifier cannot reuse a settled authorization", { timeout: 60000 }, async (t) => {
  const preview = await setup(t);
  const headers = await credential(preview, "x402");
  const first = await preview.request(headers); assert.equal(first.status, 200); await first.text();
  const payment = JSON.parse(Buffer.from(headers["payment-signature"], "base64").toString());
  payment.extensions["payment-identifier"].info.id = "different_identifier_1234567890";
  const changed = { "payment-signature": Buffer.from(JSON.stringify(payment)).toString("base64") };
  const rejected = await preview.request(changed, route.replace("rewardUsd=10", "rewardUsd=20"));
  assert.equal(rejected.status, 409); await rejected.text();
  assert.equal(preview.state.settle, 1);
});
