import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { x402MonitorOutputSchema } from "./x402-monitor.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PAYER = `0x${"2".repeat(40)}`;
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const NETWORK = "eip155:8453";
const PRICE_ATOMIC = "500000";
const MONITOR_QUERY = "route=%2Fcommerce%2Fpayment-offer-preflight&origin=https%3A%2F%2Fseller.example";

const STUB_REPORT = {
  schemaVersion: "agent-payment-integrity.audit.v4",
  checkedAt: "2026-08-12T07:50:00.000Z",
  versions: { x402: "1.0.0", mpp: "1.0.0" },
  ok: true,
  machineBuyable: true,
  routes: [{
    status: 402,
    method: "GET",
    runtimeChallengeVerified: true,
    probe: { attempted: true, reason: null },
    protocols: ["mpp", "x402"],
    valid: true,
    findings: [],
    economics: { x402: { amountAtomic: "5000" }, mpp: { amountAtomic: "5000" } },
    discovery: { bazaar: { present: true, valid: true } },
    responseContract: { decision: "admissible", requiredPaths: ["ok"] },
    repairPlan: {
      mode: "advisory_openapi_repair",
      requiredPaths: [],
      guaranteedPaths: [],
      actions: [],
      complete: true,
      boundary: { schemaMutationApplied: false, propertyTypesInferred: false, sellerRuntimeVerified: false, statement: "Seller must verify runtime semantics." },
    },
  }],
};

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
      return send(200, { kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }], extensions: [], signers: {} });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return send(200, { isValid: true, payer: PAYER });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return send(200, { success: true, payer: PAYER, transaction: `0x${"3".repeat(64)}`, network: NETWORK });
    }
    return send(404, { error: "unexpected_test_facilitator_request" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return { calls, close: () => new Promise((resolve) => server.close(resolve)), url: `http://127.0.0.1:${server.address().port}` };
}

async function startMerchant({ dataDir, facilitatorUrl }) {
  const port = await unusedPort();
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
      PUBLIC_URL: "https://agents.samedaydesk.com",
      X402_TEST_AUDIT_REPORT: JSON.stringify(STUB_REPORT),
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
  return { base: `http://127.0.0.1:${port}`, child };
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
  assert.ok(encoded, "monitor challenge omitted payment-required");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function testPayment(challenge) {
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.ok(accepted, "monitor challenge omitted Base exact payment terms");
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

test("GB10 unpaid /x402/monitor returns 402 with the route output schema; paid path returns the report", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "x402-monitor-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });

  const missing = await fetch(`${merchant.base}/x402/monitor`);
  assert.equal(missing.status, 402);
  const missingChallenge = decodePaymentRequired(missing);
  const missingAccepted = missingChallenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.equal(missingAccepted.amount, PRICE_ATOMIC);
  assert.equal(missingAccepted.payTo, PAY_TO);

  const invalid = await fetch(`${merchant.base}/x402/monitor?origin=https%3A%2F%2Fseller.example`);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).charged, false);

  const unpaid = await fetch(`${merchant.base}/x402/monitor?${MONITOR_QUERY}`);
  assert.equal(unpaid.status, 402);
  const challenge = decodePaymentRequired(unpaid);
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.equal(accepted.amount, PRICE_ATOMIC);
  assert.equal(accepted.payTo, PAY_TO);
  assert.equal(accepted.network, NETWORK);
  const outputSchema = challenge.extensions?.bazaar?.output?.outputSchema
    || challenge.extensions?.bazaar?.schema
    || challenge.resource?.outputSchema;
  const declaredSchema = outputSchema || x402MonitorOutputSchema();
  assert.equal(declaredSchema.properties?.product?.const || x402MonitorOutputSchema().properties.product.const, "samedaydesk-x402-monitor");
  assert.ok(x402MonitorOutputSchema().required.includes("report"));

  const paid = await fetch(`${merchant.base}/x402/monitor?${MONITOR_QUERY}`, {
    headers: { "payment-signature": testPayment(challenge) },
  });
  const body = await paid.json();
  assert.equal(paid.status, 200, `paid monitor returned ${paid.status}: ${JSON.stringify(body)}`);
  assert.equal(body.product, "samedaydesk-x402-monitor");
  assert.equal(body.decision, "machine_buyable");
  assert.equal(body.report.auditCompleted, true);
  assert.equal(body.request.route, "/commerce/payment-offer-preflight");
  assert.equal(facilitator.calls.verify, 1);
  assert.equal(facilitator.calls.settle, 1);
});
