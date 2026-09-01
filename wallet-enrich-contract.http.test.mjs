import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { walletEnrich } from "./wallet-enrich.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const ADDRESS = `0x${"1".repeat(40)}`;
const PAYER = `0x${"2".repeat(40)}`;
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const NETWORK = "eip155:8453";
const PRICE_ATOMIC = "50000";
const UPSTREAM_ERROR = "wallet_enrichment_upstream_unavailable";

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

async function startFakeFacilitator() {
  const calls = { settle: 0, supported: 0, verify: 0 };
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      calls.supported += 1;
      return send(200, {
        kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return send(200, { isValid: true, payer: PAYER });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return send(200, {
        success: true,
        payer: PAYER,
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

async function startMerchant({ dataDir, facilitatorUrl }) {
  const preloadPath = path.join(dataDir, "force-wallet-rpc-failure.mjs");
  await writeFile(preloadPath, `
const originalFetch = globalThis.fetch;
const baseRpcHosts = new Set(["mainnet.base.org", "base-rpc.publicnode.com", "base.llamarpc.com"]);
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  if (baseRpcHosts.has(url.hostname)) {
    let method = "unknown";
    try { method = JSON.parse(String(init?.body || "{}")).method || method; } catch {}
    process.stderr.write("wallet-enrich-test-rpc:" + method + "\\n");
    throw new Error("forced Base RPC failure for wallet-enrich route test");
  }
  return originalFetch(input, init);
};
`, "utf8");

  const port = await unusedPort();
  const existingNodeOptions = String(process.env.NODE_OPTIONS || "").trim();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: "",
      NODE_OPTIONS: [existingNodeOptions, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(" "),
      PUBLIC_URL: "https://agents.samedaydesk.com",
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
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", reject);
  });
  return { base: `http://127.0.0.1:${port}`, child, output: () => output };
}

async function stopChild(child) {
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

function decodePaymentRequired(response) {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded, "wallet-enrich challenge omitted payment-required");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function testPayment(challenge) {
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.ok(accepted, "wallet-enrich challenge omitted Base exact payment terms");
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted,
    payload: {
      signature: `0x${"4".repeat(130)}`,
      authorization: {
        from: PAYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        nonce: `0x${"5".repeat(64)}`,
      },
    },
  })).toString("base64");
}

test("walletEnrich success retains the declared required fields", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    const { id, method } = JSON.parse(String(init?.body || "{}"));
    const result = method === "eth_getCode" || method === "eth_call" ? "0x" : "0x0";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };

  const result = await walletEnrich(ADDRESS);
  assert.equal(result.ok, true);
  assert.equal(result.address, ADDRESS);
  assert.equal(result.type, "eoa");
});

test("wallet-enrich exports RPC failure as a declared non-success without a second payment path", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "wallet-enrich-contract-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });

  const [openapi, mppOpenapi, catalog] = await Promise.all([
    fetch(`${merchant.base}/openapi.json`).then((response) => response.json()),
    fetch(`${merchant.base}/mpp-openapi.json`).then((response) => response.json()),
    fetch(`${merchant.base}/api/actions`).then((response) => response.json()),
  ]);
  const operation = openapi.paths["/wallet-enrich"].get;
  const mppOperation = mppOpenapi.paths["/wallet-enrich"].get;
  const action = catalog.actions.find((entry) => entry.route === "/wallet-enrich");
  assert.deepEqual(operation.parameters.map((parameter) => ({
    in: parameter.in,
    name: parameter.name,
    required: parameter.required,
    type: parameter.schema.type,
  })), [{ in: "query", name: "address", required: true, type: "string" }]);
  assert.deepEqual(action.request.schema.properties.queryParams.required, ["address"]);
  assert.equal(action.request.example.queryParams.address, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");

  const successSchema = operation.responses["200"].content["application/json"].schema;
  assert.deepEqual(successSchema.required, ["ok", "address", "type"]);
  assert.deepEqual(mppOperation.responses["200"].content["application/json"].schema, successSchema);
  assert.deepEqual(action.response.schema, successSchema);
  assert.equal(successSchema.properties.ok.type, "boolean");
  assert.deepEqual(successSchema.properties.type.enum, ["eoa", "contract"]);

  assert.deepEqual(operation["x-payment-info"].price, { amount: "0.05", currency: "USD", mode: "fixed" });
  assert.deepEqual(operation["x-payment-info"].protocols.map((entry) => Object.keys(entry)[0]), ["x402", "mpp"]);
  assert.equal(operation["x-payment-info"].protocols[0].x402.network, NETWORK);
  assert.equal(operation["x-payment-info"].protocols[1].mpp.network, NETWORK);
  assert.equal(action.priceAtomicUsdc, PRICE_ATOMIC);
  assert.equal(action.priceUsdc, 0.05);
  assert.equal(catalog.payTo, PAY_TO);
  assert.equal(catalog.network, NETWORK);
  assert.deepEqual(action.paymentProtocols, ["x402", "mpp"]);

  for (const alias of ["address", "wallet", "addr"]) {
    const response = await fetch(`${merchant.base}/wallet-enrich?${alias}=${ADDRESS}`);
    assert.equal(response.status, 402, `${alias} alias no longer reaches the payment challenge`);
  }
  const challengeResponse = await fetch(`${merchant.base}/wallet-enrich?address=${ADDRESS}`);
  assert.equal(challengeResponse.status, 402);
  const challenge = decodePaymentRequired(challengeResponse);
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.equal(accepted.amount, PRICE_ATOMIC);
  assert.equal(accepted.payTo, PAY_TO);

  const response = await fetch(`${merchant.base}/wallet-enrich?address=${ADDRESS}`, {
    headers: { "payment-signature": testPayment(challenge) },
  });
  const text = await response.text();
  assert.equal(response.status, 502, `wallet-enrich returned ${response.status}: ${text}`);
  assert.ok(Buffer.byteLength(text) <= 256, `wallet-enrich error exceeded 256 bytes: ${Buffer.byteLength(text)}`);
  assert.deepEqual(JSON.parse(text), { ok: false, address: ADDRESS, error: UPSTREAM_ERROR });

  for (const declaredOperation of [operation, mppOperation]) {
    const failure = declaredOperation.responses["502"];
    assert.match(failure.description, /Base RPC/i);
    const schema = failure.content["application/json"].schema;
    assert.deepEqual(schema.required, ["ok", "address", "error"]);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.ok.const, false);
    assert.equal(schema.properties.error.const, UPSTREAM_ERROR);
  }

  await new Promise((resolve) => setTimeout(resolve, 25));
  const rpcAttempts = merchant.output().match(/^wallet-enrich-test-rpc:[^\n]+$/gm) || [];
  assert.equal(rpcAttempts.length, 12, `wallet enrichment invocation count changed: ${rpcAttempts.join(",")}`);
  for (const method of ["eth_getCode", "eth_getBalance", "eth_getTransactionCount", "eth_call"]) {
    assert.equal(rpcAttempts.filter((entry) => entry.endsWith(`:${method}`)).length, 3, method);
  }
  assert.equal(facilitator.calls.verify, 1, "paid request was verified more than once");
  assert.equal(facilitator.calls.settle, 0, "failed delivery reached settlement or a second payment path");
});
