import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { executeVendorBudgetImpact, ownedVendorBudgetWorkerCount } from "./vendor-budget-impact.mjs";
import { VENDOR_BUDGET_IMPACT_PATH } from "./vendor-budget-impact-config.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const NETWORK = "eip155:8453";
const PAYER = `0x${"2".repeat(40)}`;
const MPP_SECRET = "test-secret-key-test-secret-key-32";
const callerBefore = JSON.parse(readFileSync(path.join(cwd, "fixtures/vendor-budget-impact/caller-before.json"), "utf8"));
const callerAfter = JSON.parse(readFileSync(path.join(cwd, "fixtures/vendor-budget-impact/caller-after.json"), "utf8"));

function maxSnapshot(n) {
  return {
    rows: Array.from({ length: n }, (_, i) => ({
      field: `sku-${String(i).padStart(4, "0")}`,
      value: i + 0.01,
      unit: "USD/1M-tokens",
    })),
  };
}

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

function rssKb(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/status`, "utf8");
    return Number((/VmRSS:\s+(\d+)/.exec(text) || [])[1] || 0);
  } catch {
    return 0;
  }
}

function descendantPids(pid) {
  const found = [];
  try {
    const raw = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
    for (const child of raw.split(/\s+/).filter(Boolean).map(Number)) {
      found.push(child, ...descendantPids(child));
    }
  } catch {
    // process exited
  }
  return found;
}

function treeRssKb(pid) {
  return [pid, ...descendantPids(pid)].reduce((sum, id) => sum + rssKb(id), 0);
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
    return send(404, { error: "unexpected" });
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
      MPP_SECRET_KEY: MPP_SECRET,
      IDEMPOTENCY_INFLIGHT_WAIT_MS: "50",
      VENDOR_BUDGET_IMPACT_ENABLED: "1",
      LOCKFILE_PIN_DELTA_ENABLED: "0",
      EXTRACT_BATCH_ENABLED: "0",
      PUBLIC_URL: "https://agents.samedaydesk.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited ${code}/${signal}`));
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

function decodePaymentRequired(response) {
  return JSON.parse(Buffer.from(response.headers.get("payment-required"), "base64").toString("utf8"));
}

function testPayment(challenge, id) {
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  const nonce = `0x${Buffer.from(id).toString("hex").padEnd(64, "0").slice(0, 64)}`;
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    resource: challenge.resource,
    accepted,
    payload: {
      signature: `0x${"4".repeat(130)}`,
      authorization: {
        from: PAYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        nonce,
      },
    },
    extensions: { "payment-identifier": { info: { required: true, id } } },
  })).toString("base64");
}

async function paidOnce(base, body, id) {
  const unpaid = await fetch(`${base}${VENDOR_BUDGET_IMPACT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const challenge = decodePaymentRequired(unpaid);
  const started = performance.now();
  const paid = await fetch(`${base}${VENDOR_BUDGET_IMPACT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "payment-signature": testPayment(challenge, id) },
    body: JSON.stringify(body),
  });
  const wallMs = performance.now() - started;
  const text = await paid.text();
  return { status: paid.status, wallMs, bytes: Buffer.byteLength(text), body: JSON.parse(text) };
}

test("bounded worker execution and mounted HTTP produce measured cost inputs", { timeout: 120_000 }, async (t) => {
  const ordinary = { before: callerBefore, after: callerAfter };
  const maximal = { before: maxSnapshot(256), after: { rows: maxSnapshot(256).rows.map((row, i) => (i === 0 ? { ...row, value: row.value + 1 } : row)) } };

  async function benchExecute(name, input, { inProcess, repeats }) {
    const started = performance.now();
    const cpu0 = process.cpuUsage();
    let last;
    for (let i = 0; i < repeats; i += 1) {
      last = await executeVendorBudgetImpact({ input, inProcess });
    }
    const cpu = process.cpuUsage(cpu0);
    assert.equal(last.ok, true, name);
    assert.equal(ownedVendorBudgetWorkerCount(), 0);
    return {
      name,
      inProcess,
      repeats,
      wallMs: Number(((performance.now() - started) / repeats).toFixed(3)),
      cpuUserMs: Number((cpu.user / 1000 / repeats).toFixed(3)),
      requestBytes: Buffer.byteLength(JSON.stringify(input)),
      responseBytes: Buffer.byteLength(JSON.stringify(last)),
    };
  }

  const inProcessOrdinary = await benchExecute("in-process-ordinary", ordinary, { inProcess: true, repeats: 20 });
  const workerOrdinary = await benchExecute("worker-ordinary", ordinary, { inProcess: false, repeats: 8 });
  const workerMax = await benchExecute("worker-max-256", maximal, { inProcess: false, repeats: 4 });

  const dataDir = await mkdtemp(path.join(tmpdir(), "vendor-budget-cost-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const idleRssKb = treeRssKb(merchant.child.pid);

  const one = await paidOnce(merchant.base, ordinary, "cost_one_1234567890abcd");
  assert.equal(one.status, 200);
  const oneRssKb = treeRssKb(merchant.child.pid);

  async function cohort(n, label) {
    let peakRssKb = treeRssKb(merchant.child.pid);
    const sampler = setInterval(() => {
      peakRssKb = Math.max(peakRssKb, treeRssKb(merchant.child.pid));
    }, 10);
    const started = performance.now();
    const settledBefore = facilitator.calls.settle;
    const results = await Promise.all(Array.from({ length: n }, (_, i) => (
      paidOnce(merchant.base, ordinary, `${label}_${String(i).padStart(2, "0")}_1234567890`)
    )));
    const wallMs = performance.now() - started;
    clearInterval(sampler);
    peakRssKb = Math.max(peakRssKb, treeRssKb(merchant.child.pid));
    const successful = results.filter(row => row.status === 200 && row.body.charged === true).length;
    const busy = results.filter(row => row.status === 503 && row.body.transport === "busy" && row.body.charged === false).length;
    assert.equal(successful + busy, n, label);
    assert.ok(successful > 0, label);
    assert.equal(facilitator.calls.settle - settledBefore, successful, "busy requests never settle");
    return {
      n,
      successful,
      busy,
      maxWorkersPerProcess: 4,
      totalWallMs: Number(wallMs.toFixed(2)),
      meanWallMs: Number((results.reduce((sum, row) => sum + row.wallMs, 0) / n).toFixed(2)),
      maxWallMs: Number(Math.max(...results.map((row) => row.wallMs)).toFixed(2)),
      peakRssKb,
      settle: facilitator.calls.settle,
    };
  }

  const cohort1 = await cohort(1, "c1");
  const cohort6 = await cohort(6, "c6");
  const cohort12 = await cohort(12, "c12");
  const maxHttp = await paidOnce(merchant.base, maximal, "cost_max_1234567890abcd");
  assert.equal(maxHttp.status, 200);
  assert.equal(ownedVendorBudgetWorkerCount(), 0);

  const railwayCpuPerVcpuS = 0.00000772;
  const railwayRamPerGbS = 0.00000386;
  const railwayEgressPerGb = 0.05;
  const cdpSettleUsd = 0.001;
  const worstCpuS = Math.max(workerMax.wallMs, maxHttp.wallMs, cohort12.maxWallMs) / 1000;
  const peakGb = Math.max(idleRssKb, oneRssKb, cohort12.peakRssKb) / (1024 * 1024);
  const estimate = {
    railwayCpuUsd: Number((worstCpuS * railwayCpuPerVcpuS).toFixed(10)),
    railwayRamUsdForCallWindow: Number((peakGb * railwayRamPerGbS * worstCpuS).toFixed(10)),
    railwayEgressUsd: Number((((maxHttp.bytes + 30_028) / (1024 ** 3)) * railwayEgressPerGb).toFixed(10)),
    cdpSettleUsdAfterFreeTier: cdpSettleUsd,
    note: "Estimates only. Idle shared RAM is billed while the merchant runs, not per call. First 1000 CDP settles/month are $0.",
  };

  const report = {
    measuredAt: new Date().toISOString(),
    inProcessOrdinary,
    workerOrdinary,
    workerMax,
    http: {
      idleRssKb,
      one: { wallMs: Number(one.wallMs.toFixed(2)), rssKb: oneRssKb, responseBytes: one.bytes },
      maxInput: { wallMs: Number(maxHttp.wallMs.toFixed(2)), responseBytes: maxHttp.bytes },
      cohort1,
      cohort6,
      cohort12,
    },
    rates: {
      source: "https://docs.railway.com/pricing.md and https://railway.com/pricing.md (2026-09-12); https://docs.cdp.coinbase.com/x402/seller/facilitator.md",
      railwayCpuPerVcpuS,
      railwayRamPerGbS,
      railwayEgressPerGb,
      cdpVerifyUsd: 0,
      cdpSettleUsdAfter1000: cdpSettleUsd,
    },
    estimate,
    keepPriceUsd: "0.005",
    provenProfit: false,
  };
  // Tests must not overwrite the retained baseline/Root measurement.
  if (process.env.VENDOR_BUDGET_COST_RECEIPT) {
    await writeFile(process.env.VENDOR_BUDGET_COST_RECEIPT, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  }
  assert.equal(workerOrdinary.wallMs < 250, true, "worker ordinary should stay well under a second");
  assert.equal(cohort12.maxWallMs < 5_000, true);
  assert.equal(estimate.railwayCpuUsd + estimate.railwayEgressUsd < 0.005, true);
});
