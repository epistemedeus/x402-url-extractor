import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { normalizeAuthorization } from "../src/authorization.mjs";
import { LIVE_ORIGIN } from "../src/constants.mjs";
import { runAuthorizedPurchase } from "../src/purchase.mjs";
import { runPreflight } from "../src/preflight.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const MERCHANT_ROOT = join(PKG, "..", "..");
const NETWORK = "eip155:8453";
const MPP_SECRET = "test-secret-key-test-secret-key-32";
const merchantReady = existsSync(join(MERCHANT_ROOT, "server.js"))
  && existsSync(join(MERCHANT_ROOT, "node_modules"));

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

async function startFakeFacilitator({ payer }) {
  const calls = { settle: 0, supported: 0, verify: 0 };
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      calls.supported += 1;
      return send(200, { kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }], extensions: [], signers: {} });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return send(200, { isValid: true, payer });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return send(200, {
        success: true,
        payer,
        transaction: `0x${"3".repeat(64)}`,
        network: NETWORK,
      });
    }
    return send(404, { error: "unexpected_test_facilitator_request" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function startMerchant({ dataDir, facilitatorUrl, extraEnv = {} } = {}) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: MERCHANT_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: MPP_SECRET,
      IDEMPOTENCY_INFLIGHT_WAIT_MS: "50",
      LOCKFILE_PIN_DELTA_ENABLED: "1",
      EXTRACT_BATCH_ENABLED: "0",
      PUBLIC_URL: LIVE_ORIGIN,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-40_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited: ${code}/${signal}\n${output.slice(-2000)}`));
    });
    child.once("error", reject);
  });
  return { base: `http://127.0.0.1:${port}`, child };
}

async function stopChild(child) {
  if (!child) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000).unref();
  });
}

function proxyToMerchant(merchantBase) {
  const origin = new URL(merchantBase);
  return async (input, init) => {
    const request = input instanceof Request && init == null ? input : new Request(input, init);
    const publicUrl = new URL(request.url);
    if (publicUrl.origin !== LIVE_ORIGIN) {
      throw new Error(`unexpected public client target: ${publicUrl.origin}`);
    }
    const body = ["GET", "HEAD"].includes(request.method) ? null : Buffer.from(await request.arrayBuffer());
    const headers = Object.fromEntries(request.headers.entries());
    headers.host = publicUrl.host;
    headers["x-forwarded-host"] = publicUrl.host;
    headers["x-forwarded-proto"] = "https";
    if (body) headers["content-length"] = String(body.length);
    return new Promise((resolve, reject) => {
      const req = httpRequest({
        hostname: origin.hostname,
        port: origin.port,
        path: `${publicUrl.pathname}${publicUrl.search}`,
        method: request.method,
        headers,
      }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (value == null) continue;
            if (Array.isArray(value)) value.forEach((entry) => responseHeaders.append(name, entry));
            else responseHeaders.set(name, value);
          }
          resolve(new Response(Buffer.concat(chunks), {
            status: res.statusCode || 500,
            headers: responseHeaders,
          }));
        });
      });
      req.on("error", reject);
      req.setTimeout(20_000, () => req.destroy(new Error("local merchant request timed out")));
      if (body) req.write(body);
      req.end();
    });
  };
}

function capturingFetch(proxy) {
  const payments = [];
  const fetchImpl = async (input, init) => {
    const request = input instanceof Request && init == null ? input : new Request(input, init);
    const header = request.headers.get("payment-signature") || request.headers.get("PAYMENT-SIGNATURE");
    const bodyText = request.method === "POST" ? await request.clone().text() : null;
    if (header) payments.push({ header, body: bodyText, url: request.url });
    return proxy(request);
  };
  return { fetchImpl, payments };
}

const skip = merchantReady ? false : "merchant runtime dependencies are not installed in this checkout";

test("mounted lockfile: change, no-change, replay-negative", { timeout: 120_000, skip }, async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "cx402-lockfile-mount-"));
  const throwawayKey = generatePrivateKey();
  const account = privateKeyToAccount(throwawayKey);
  const facilitator = await startFakeFacilitator({ payer: account.address });
  let merchant;
  t.after(async () => {
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const proxy = proxyToMerchant(merchant.base);
  const { fetchImpl, payments } = capturingFetch(proxy);
  const changeAuth = normalizeAuthorization(JSON.parse(
    await readFile(join(PKG, "fixtures/authorization-lockfile.json"), "utf8"),
  ));
  const noChangeAuth = normalizeAuthorization(JSON.parse(
    await readFile(join(PKG, "fixtures/authorization-lockfile-no-change.json"), "utf8"),
  ));

  const unpaid = await runPreflight({ authorization: changeAuth, fetchImpl });
  assert.equal(unpaid.outcome, "preflight_ok");
  assert.equal(unpaid.walletAccessed, false);
  assert.equal(unpaid.paymentSent, false);
  assert.equal(unpaid.offer.amountAtomic, "5000");

  const refused = await runAuthorizedPurchase({
    authorization: changeAuth,
    account,
    fetchImpl,
    approve: false,
  });
  assert.equal(refused.outcome, "authorization_refused");
  assert.equal(refused.walletAccessed, false);

  const change = await runAuthorizedPurchase({
    authorization: changeAuth,
    account,
    fetchImpl,
    approve: true,
  });
  assert.equal(change.outcome, "valid_delivered", change.message);
  assert.equal(change.evidence.retainedBody.analysis, "actionable");
  assert.equal(change.evidence.retainedBody.charged, true);
  assert.equal(facilitator.calls.settle, 1);
  assert.equal(payments.length, 1);

  const sameBodyReplay = await proxy(changeAuth.url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "payment-signature": payments[0].header,
    },
    body: changeAuth.bodyRaw,
  });
  assert.equal(sameBodyReplay.status, 200);
  assert.equal(sameBodyReplay.headers.get("x-payment-replay"), "hit");
  assert.equal(facilitator.calls.settle, 1);

  const replayNegative = await proxy(noChangeAuth.url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "payment-signature": payments[0].header,
    },
    body: noChangeAuth.bodyRaw,
  });
  const replayNegativeBody = await replayNegative.json();
  assert.equal(replayNegative.status, 409, JSON.stringify(replayNegativeBody));
  assert.equal(replayNegativeBody.charged, false);
  assert.equal(facilitator.calls.settle, 1);

  const noChange = await runAuthorizedPurchase({
    authorization: noChangeAuth,
    account,
    fetchImpl,
    approve: true,
  });
  assert.equal(noChange.outcome, "valid_delivered", noChange.message);
  assert.equal(noChange.evidence.retainedBody.analysis, "informational");
  assert.equal(facilitator.calls.settle, 2);
});

test("mounted lockfile: timeout/unknown does not authorize a new payment", { timeout: 60_000, skip }, async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "cx402-lockfile-timeout-"));
  const throwawayKey = generatePrivateKey();
  const account = privateKeyToAccount(throwawayKey);
  const facilitator = await startFakeFacilitator({ payer: account.address });
  let merchant;
  t.after(async () => {
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({
    dataDir,
    facilitatorUrl: facilitator.url,
    extraEnv: {
      LOCKFILE_PIN_DELTA_TIMEOUT_MS: "200",
      LOCKFILE_PIN_DELTA_WORKER_HOLD_MS: "2000",
    },
  });
  const proxy = proxyToMerchant(merchant.base);
  const { fetchImpl, payments } = capturingFetch(proxy);
  const auth = normalizeAuthorization(JSON.parse(
    await readFile(join(PKG, "fixtures/authorization-lockfile.json"), "utf8"),
  ));

  const timedOut = await runAuthorizedPurchase({
    authorization: auth,
    account,
    fetchImpl,
    approve: true,
    timeoutMs: 15_000,
  });
  assert.equal(timedOut.outcome, "unknown", timedOut.message);
  assert.equal(timedOut.paymentSent, true);
  assert.equal(timedOut.evidence.httpStatus, 503);
  assert.equal(timedOut.evidence.retainedBody?.charged, false);
  assert.equal(timedOut.evidence.retainedBody?.analysis, "not-run");
  assert.equal(facilitator.calls.settle, 0);
  assert.equal(payments.length, 1);

  const retry = await proxy(auth.url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "payment-signature": payments[0].header,
    },
    body: auth.bodyRaw,
  });
  const retryBody = await retry.json();
  assert.equal(retry.status, 503, JSON.stringify(retryBody));
  assert.notEqual(retry.headers.get("x-payment-replay"), "hit");
  assert.equal(facilitator.calls.settle, 0);
});
