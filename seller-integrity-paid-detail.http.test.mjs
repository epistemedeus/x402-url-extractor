import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PAYER = `0x${"2".repeat(40)}`;
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const NETWORK = "eip155:8453";
const DETAIL_PRICE_ATOMIC = "250000";
const AUDIT_PATH = "/commerce/seller-integrity-audit";
const AUDIT_QUERY = "origin=https%3A%2F%2Fseller.example&route=%2Fpaid&method=GET";

const STUB_REPORT = {
  schemaVersion: "agent-payment-integrity.audit.v4",
  checkedAt: "2026-08-12T07:50:00.000Z",
  versions: { x402: "1.0.0", mpp: "1.0.0" },
  ok: false,
  machineBuyable: false,
  routes: [{
    status: 402,
    method: "GET",
    runtimeChallengeVerified: true,
    probe: { attempted: true, reason: null },
    protocols: ["mpp", "x402"],
    valid: false,
    findings: ["seller_response_contract_partial"],
    economics: { x402: { amountAtomic: "5000" }, mpp: { amountAtomic: "5000" } },
    discovery: { bazaar: { present: true, valid: true } },
    responseContract: { decision: "partial", requiredPaths: ["ok"] },
    repairPlan: {
      mode: "advisory_openapi_repair",
      requiredPaths: ["data.id"],
      guaranteedPaths: [],
      actions: [{
        requiredPath: "data.id",
        action: "add_property_to_required",
        parentPath: "data",
        property: "id",
        propertyDeclared: true,
        propertyType: "string",
      }],
      complete: false,
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
  const calls = { settle: 0, verify: 0 };
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
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
  assert.ok(encoded, "seller-integrity challenge omitted payment-required");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function testPayment(challenge) {
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.ok(accepted, "seller-integrity challenge omitted Base exact payment terms");
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
        nonce: `0x${"6".repeat(64)}`,
      },
    },
  })).toString("base64");
}

test("GB11 unpaid seller-integrity keeps the summary free and 402s the field-level report", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "seller-integrity-detail-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });

  const bare = await fetch(`${merchant.base}${AUDIT_PATH}`);
  assert.equal(bare.status, 402);
  const bareChallenge = decodePaymentRequired(bare);
  const bareAccepted = bareChallenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.equal(bareAccepted.amount, DETAIL_PRICE_ATOMIC);
  assert.equal(bareAccepted.payTo, PAY_TO);

  const unpaid = await fetch(`${merchant.base}${AUDIT_PATH}?${AUDIT_QUERY}`);
  assert.equal(unpaid.status, 402);
  const unpaidBody = await unpaid.json();
  assert.equal(unpaidBody.x402Version, 2);
  assert.equal(unpaidBody.summary.access, "summary");
  assert.equal(unpaidBody.summary.decision, "repair_required");
  assert.equal(unpaidBody.summary.findingCount, 1);
  assert.equal(unpaidBody.summary.report, null);
  assert.equal(unpaidBody.detail.access, "payment_required");
  assert.equal(unpaidBody.detail.priceUsdc, 0.25);
  assert.equal(JSON.stringify(unpaidBody.summary).includes("repairPlan"), false);
  const challenge = decodePaymentRequired(unpaid);
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.equal(accepted.amount, DETAIL_PRICE_ATOMIC);
  assert.equal(accepted.payTo, PAY_TO);

  const paid = await fetch(`${merchant.base}${AUDIT_PATH}?${AUDIT_QUERY}`, {
    headers: { "payment-signature": testPayment(challenge) },
  });
  const full = await paid.json();
  assert.equal(paid.status, 200, `paid seller-integrity returned ${paid.status}: ${JSON.stringify(full)}`);
  assert.equal(full.product, "samedaydesk-seller-integrity-audit");
  assert.equal(full.decision, "repair_required");
  assert.ok(Array.isArray(full.report.findings));
  assert.equal(full.report.findings[0], "seller_response_contract_partial");
  assert.equal(full.report.repairPlan.mode, "advisory_openapi_repair");
  assert.equal(facilitator.calls.verify, 1);
  assert.equal(facilitator.calls.settle, 1);
});
