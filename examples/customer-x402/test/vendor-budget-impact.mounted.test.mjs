import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { normalizeAuthorization } from "../src/authorization.mjs";
import { LIVE_ORIGIN, LIVE_VENDOR_BUDGET_URL } from "../src/constants.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const CLI = join(PKG, "bin/cli.mjs");
const MERCHANT_ROOT = join(PKG, "..", "..");
const NETWORK = "eip155:8453";
const MPP_SECRET = "test-secret-key-test-secret-key-32";
const KEY_ENV = "CUSTOMER_X402_PRIVATE_KEY";
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
      if (calls.failSettlement) return send(200, { success: false, errorReason: "unknown_settlement", transaction: "", network: NETWORK });
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

async function startMerchant({ dataDir, facilitatorUrl } = {}) {
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
      VENDOR_BUDGET_IMPACT_ENABLED: "1",
      LOCKFILE_PIN_DELTA_ENABLED: "0",
      EXTRACT_BATCH_ENABLED: "0",
      PUBLIC_URL: LIVE_ORIGIN,
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

async function writeCliProxy(dir, { merchantBase, payLog }) {
  const path = join(dir, "cli-proxy.mjs");
  await writeFile(path, `import { appendFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
const merchant = ${JSON.stringify(merchantBase)};
const payLog = ${JSON.stringify(payLog)};
const liveOrigin = ${JSON.stringify(LIVE_ORIGIN)};
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = input instanceof Request && init == null ? input : new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== liveOrigin) throw new Error("unexpected public client target: " + url.origin);
  const body = ["GET", "HEAD"].includes(request.method) ? null : Buffer.from(await request.arrayBuffer());
  const headers = Object.fromEntries(request.headers.entries());
  const pay = request.headers.get("payment-signature") || request.headers.get("PAYMENT-SIGNATURE");
  if (pay && payLog) {
    appendFileSync(payLog, JSON.stringify({ header: pay, body: body ? body.toString("utf8") : null, url: request.url }) + "\\n");
  }
  headers.host = url.host;
  headers["x-forwarded-host"] = url.host;
  headers["x-forwarded-proto"] = "https";
  if (body) headers["content-length"] = String(body.length);
  const origin = new URL(merchant);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: origin.hostname,
      port: origin.port,
      path: url.pathname + url.search,
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
        let bytes = Buffer.concat(chunks);
        if (pay && res.statusCode === 200 && process.env.CUSTOMER_X402_TEST_RESPONSE_MODE === "unrelated") {
          bytes = Buffer.from(JSON.stringify({ok:true,product:"other",schemaVersion:"other",charged:false,
            analysis:"not-run",quote:{amountAtomic:"5000"}}));
          responseHeaders.delete("content-length");
        }
        resolve(new Response(bytes, { status: res.statusCode || 500, headers: responseHeaders }));
      });
    });
    req.on("error", reject);
    req.setTimeout(20_000, () => req.destroy(new Error("cli proxy timeout")));
    if (body) req.write(body);
    req.end();
  });
};
`);
  return path;
}

function runCli(args, { env = {}, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: PKG,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`cli timed out: ${stdout}${stderr}`.slice(-2000)));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, child });
    });
  });
}

function parseCliJson(result) {
  const text = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  assert.ok(start >= 0 && end > start, `cli did not print JSON: ${text.slice(-500)}`);
  return JSON.parse(text.slice(start, end + 1));
}

const skip = merchantReady ? false : "merchant runtime dependencies are not installed in this checkout";

test("CLI --help documents vendor-budget inspect/approve", () => {
  const result = spawnSync(process.execPath, [CLI, "--help"], { cwd: PKG, encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /vendor-budget-impact/);
  assert.match(result.stdout, /authorization-vendor-budget\.json/);
  assert.match(result.stdout, /empty \{\} is unpaid discovery/);
});

test("CLI inspect then --approve against mounted merchant; refuse, replay, concurrent", { timeout: 180_000, skip }, async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "cx402-vendor-budget-cli-"));
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
  const payLog = join(dataDir, "pay.jsonl");
  const preload = await writeCliProxy(dataDir, { merchantBase: merchant.base, payLog });
  const existingNodeOptions = String(process.env.NODE_OPTIONS || "").trim();
  const cliEnv = {
    NODE_OPTIONS: [existingNodeOptions, `--import=${pathToFileURL(preload).href}`].filter(Boolean).join(" "),
    [KEY_ENV]: throwawayKey,
  };
  const changePath = join(PKG, "fixtures/authorization-vendor-budget.json");
  const noChangePath = join(PKG, "fixtures/authorization-vendor-budget-no-change.json");
  const changeAuth = normalizeAuthorization(JSON.parse(await readFile(changePath, "utf8")));
  const noChangeAuth = normalizeAuthorization(JSON.parse(await readFile(noChangePath, "utf8")));
  const proxy = proxyToMerchant(merchant.base);

  const unsigned = await proxy(LIVE_VENDOR_BUDGET_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: "{}",
  });
  assert.equal(unsigned.status, 402);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);

  const inspect = await runCli(["--authorization", changePath], { env: cliEnv });
  const inspectJson = parseCliJson(inspect);
  assert.equal(inspect.code, 0, inspect.stderr);
  assert.equal(inspectJson.outcome, "preflight_ok");
  assert.equal(inspectJson.construction.kind, "bound_request");
  assert.equal(inspectJson.walletAccessed, false);
  assert.equal(inspectJson.paymentSigned, false);
  assert.equal(inspectJson.paymentSent, false);
  assert.equal(inspectJson.offer.amountAtomic, "5000");
  assert.equal(inspectJson.bodyDigest, changeAuth.bodyDigest);
  assert.equal(facilitator.calls.settle, 0);

  const missingAfter = JSON.parse(await readFile(changePath, "utf8"));
  delete missingAfter.body.after;
  const missingPath = join(dataDir, "missing-after.json");
  await writeFile(missingPath, `${JSON.stringify(missingAfter, null, 2)}\n`);
  const refused = await runCli([
    "--approve",
    "--authorization",
    missingPath,
    "--private-key-env",
    KEY_ENV,
  ], { env: cliEnv });
  const refusedJson = parseCliJson(refused);
  assert.notEqual(refused.code, 0);
  assert.equal(refusedJson.outcome, "authorization_refused");
  assert.equal(refusedJson.walletAccessed, false);
  assert.equal(refusedJson.paymentSigned, false);
  assert.equal(refusedJson.paymentSent, false);
  assert.equal(facilitator.calls.verify, 0);

  const approved = await runCli([
    "--approve",
    "--authorization",
    changePath,
    "--private-key-env",
    KEY_ENV,
  ], { env: cliEnv });
  const approvedJson = parseCliJson(approved);
  assert.equal(approved.code, 0, `${approved.stdout}${approved.stderr}`);
  assert.equal(approvedJson.outcome, "valid_delivered");
  assert.equal(approvedJson.paymentSigned, true);
  assert.equal(approvedJson.paymentSent, true);
  assert.equal(approvedJson.evidence.outputValid, true);
  assert.equal(approvedJson.evidence.retainedBody.analysis, "actionable");
  assert.equal(approvedJson.evidence.retainedBody.charged, true);
  assert.equal(approvedJson.evidence.bodyDigest, changeAuth.bodyDigest);
  assert.equal(approvedJson.evidence.retainedBody.engine.purchaseAuthority, false);
  const inputChange = approvedJson.evidence.retainedBody.engine.fieldChanges.find((row) => row.fieldKey === "desk-chat-input");
  assert.equal(inputChange.beforeValue, 1);
  assert.equal(inputChange.afterValue, 1.5);
  assert.equal(facilitator.calls.settle, 1);

  const payRows = (await readFile(payLog, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(payRows.length >= 1, true);
  const paidSend = payRows[payRows.length - 1];
  assert.equal(paidSend.body, changeAuth.bodyRaw);
  const replay = await proxy(LIVE_VENDOR_BUDGET_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "payment-signature": paidSend.header,
    },
    body: changeAuth.bodyRaw,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-payment-replay"), "hit");
  assert.equal(facilitator.calls.settle, 1);

  const drifted = await proxy(LIVE_VENDOR_BUDGET_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "payment-signature": paidSend.header,
    },
    body: noChangeAuth.bodyRaw,
  });
  assert.equal(drifted.status, 409);
  assert.equal(facilitator.calls.settle, 1);

  const [first, second] = await Promise.all([
    runCli(["--approve", "--authorization", changePath, "--private-key-env", KEY_ENV], { env: cliEnv }),
    runCli(["--approve", "--authorization", noChangePath, "--private-key-env", KEY_ENV], { env: cliEnv }),
  ]);
  const firstJson = parseCliJson(first);
  const secondJson = parseCliJson(second);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  const analyses = [firstJson.evidence.retainedBody.analysis, secondJson.evidence.retainedBody.analysis].sort();
  assert.deepEqual(analyses, ["actionable", "informational"]);
  assert.notEqual(firstJson.evidence.bodyDigest, secondJson.evidence.bodyDigest);
  assert.equal(facilitator.calls.settle, 3);

  const unrelated = await runCli(["--approve", "--authorization", changePath, "--private-key-env", KEY_ENV],
    {env:{...cliEnv,CUSTOMER_X402_TEST_RESPONSE_MODE:"unrelated"}});
  const unrelatedJson = parseCliJson(unrelated);
  assert.notEqual(unrelated.code, 0);
  assert.equal(unrelatedJson.outcome, "paid_invalid_output");
  assert.equal(unrelatedJson.evidence.outputValid, false);
  assert.equal(facilitator.calls.settle, 4);

  facilitator.calls.failSettlement = true;
  const uncertain = await runCli(["--approve", "--authorization", changePath, "--private-key-env", KEY_ENV], {env:cliEnv});
  const uncertainJson = parseCliJson(uncertain);
  assert.notEqual(uncertain.code, 0);
  assert.equal(uncertainJson.outcome, "unknown");
  assert.equal(uncertainJson.evidence.retainedBody.charged, null);
  assert.equal(uncertainJson.evidence.retainedBody.settlementConfirmed, false);
  assert.equal(uncertainJson.evidence.retainedBody.delivery.charged, null);
  assert.ok(uncertainJson.evidence.retainedBody.delivery.engine.fieldChanges.length > 0);
  assert.equal(facilitator.calls.settle, 5);
});
