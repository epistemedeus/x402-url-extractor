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
import {
  bindGetExtractResourceUrl,
  classifyRequestConstruction,
} from "../src/request-construction.mjs";

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

async function startFakeFacilitator({ payer, refuseVerify = false } = {}) {
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
      if (refuseVerify) return send(200, { isValid: false, invalidReason: "fixture_provider_refused" });
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

function walletSentinel(account) {
  const state = { opened: 0, signCalled: 0 };
  return {
    state,
    loadAccount: async () => {
      state.opened += 1;
      return {
        address: account.address,
        async signTypedData(value) {
          state.signCalled += 1;
          return account.signTypedData(value);
        },
      };
    },
  };
}

const skip = merchantReady ? false : "merchant runtime dependencies are not installed in this checkout";

test("mounted merchant: discovery, invalid input, bound extract, refused verify", { timeout: 180_000, skip }, async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "cx402-construct-mount-"));
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

  const bare = await proxy(`${LIVE_ORIGIN}/extract`);
  assert.equal(bare.status, 402);
  const bareBody = await bare.json();
  assert.equal(bareBody.resource?.url, `${LIVE_ORIGIN}/extract`);
  assert.equal(classifyRequestConstruction(`${LIVE_ORIGIN}/extract`, { method: "GET" }).kind, "unsigned_discovery");

  const clientBare = await runPreflight({
    url: `${LIVE_ORIGIN}/extract`,
    method: "GET",
    fetchImpl: proxy,
  });
  assert.equal(clientBare.outcome, "preflight_ok");
  assert.equal(clientBare.construction.kind, "unsigned_discovery");
  assert.equal(clientBare.walletAccessed, false);
  assert.equal(clientBare.paymentSigned, false);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);

  for (const path of [
    "/extract?url=not-a-url",
    "/extract?url=",
    "/lockfile-pin-delta",
  ]) {
    const init = path === "/lockfile-pin-delta"
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ before: { lockfileVersion: 3 } }) }
      : undefined;
    const response = await proxy(`${LIVE_ORIGIN}${path}`, init);
    const body = await response.json();
    assert.equal(response.status, 400, path);
    assert.equal(body.charged, false, path);
  }

  const emptyLockfile = await proxy(`${LIVE_ORIGIN}/lockfile-pin-delta`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(emptyLockfile.status, 402);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);

  const sentinel = walletSentinel(account);
  const boundUrl = bindGetExtractResourceUrl("https://example.com");
  const unpaid = await runPreflight({
    url: boundUrl,
    authorization: { ...JSON.parse(await readFile(join(PKG, "fixtures/authorization.json"), "utf8")) },
    fetchImpl: proxy,
  });
  assert.equal(unpaid.outcome, "preflight_ok");
  assert.equal(unpaid.construction.kind, "bound_request");
  assert.equal(unpaid.walletAccessed, false);

  const paid = await runAuthorizedPurchase({
    authorization: normalizeAuthorization(JSON.parse(
      await readFile(join(PKG, "fixtures/authorization.json"), "utf8"),
    )),
    approve: true,
    fetchImpl: proxy,
    loadAccount: sentinel.loadAccount,
  });
  assert.equal(sentinel.state.opened, 1);
  assert.equal(sentinel.state.signCalled, 1);
  assert.equal(paid.paymentSigned, true);
  assert.equal(paid.paymentSent, true);
  assert.ok(facilitator.calls.verify >= 1);
  assert.ok(facilitator.calls.settle >= 1);
  assert.ok(
    paid.outcome === "valid_delivered" || paid.outcome === "partial_delivered",
    `bound extract charged without useful/partial delivery: ${paid.outcome} ${paid.message}`,
  );
  assert.equal(paid.evidence.outputValid, true);
  assert.notEqual(paid.outcome, "paid_invalid_output");
});

test("mounted merchant: facilitator verify refusal never settles", { timeout: 120_000, skip }, async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "cx402-construct-refuse-"));
  const throwawayKey = generatePrivateKey();
  const account = privateKeyToAccount(throwawayKey);
  const facilitator = await startFakeFacilitator({ payer: account.address, refuseVerify: true });
  let merchant;
  t.after(async () => {
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const proxy = proxyToMerchant(merchant.base);
  const sentinel = walletSentinel(account);
  const result = await runAuthorizedPurchase({
    authorization: normalizeAuthorization(JSON.parse(
      await readFile(join(PKG, "fixtures/authorization.json"), "utf8"),
    )),
    approve: true,
    fetchImpl: proxy,
    loadAccount: sentinel.loadAccount,
  });
  assert.equal(sentinel.state.signCalled, 1);
  assert.equal(result.paymentSent, true);
  assert.ok(facilitator.calls.verify >= 1);
  assert.equal(facilitator.calls.settle, 0);
  assert.notEqual(result.outcome, "valid_delivered");
  assert.notEqual(result.outcome, "useful_delivered");
});
