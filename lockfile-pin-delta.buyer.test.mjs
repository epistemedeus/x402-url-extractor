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
const cli = path.join(cwd, "examples/lockfile-pin-delta-buyer/cli.mjs");
const beforePath = path.join(cwd, "fixtures/lockfile-pin-delta/journey-before.json");
const afterPath = path.join(cwd, "fixtures/lockfile-pin-delta/journey-after.json");
const NETWORK = "eip155:8453";
const MPP_SECRET = "test-secret-key-test-secret-key-32";

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
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      return send(200, { kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }], extensions: [], signers: {} });
    }
    if (req.method === "POST" && req.url === "/verify") return send(200, { isValid: true, payer: `0x${"2".repeat(40)}` });
    if (req.method === "POST" && req.url === "/settle") {
      return send(200, { success: true, payer: `0x${"2".repeat(40)}`, transaction: `0x${"3".repeat(64)}`, network: NETWORK });
    }
    return send(404, { error: "unexpected" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return { close: () => new Promise((resolve) => server.close(resolve)), url: `http://127.0.0.1:${server.address().port}` };
}

async function startMerchant({ dataDir, facilitatorUrl, enabled = true } = {}) {
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
      LOCKFILE_PIN_DELTA_ENABLED: enabled ? "1" : "0",
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
      reject(new Error(`startup exited: ${code}/${signal}\n${output.slice(-2000)}`));
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
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2_000).unref();
  });
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("buyer CLI discover and unpaid compare work against a provided base URL", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lockfile-buyer-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, enabled: true });
  const discovered = await runCli(["--base-url", merchant.base, "discover"]);
  assert.equal(discovered.code, 0, discovered.stderr || discovered.stdout);
  const discovery = JSON.parse(discovered.stdout);
  assert.equal(discovery.enabled, true);
  assert.equal(discovery.openapiOperationId, "compareLockfilePinDelta");
  assert.equal(discovery.challenge, true);
  assert.equal(discovery.unpaidStatus, 402);

  const compared = await runCli([
    "--base-url", merchant.base,
    "compare",
    "--before", beforePath,
    "--after", afterPath,
  ]);
  assert.equal(compared.code, 0, compared.stderr || compared.stdout);
  const comparison = JSON.parse(compared.stdout);
  assert.equal(comparison.challenge, true);
  assert.equal(comparison.status, 402);
  assert.equal(comparison.charged, false);
  assert.match(comparison.boundary, /JSON objects/);
});

test("buyer CLI discover reports the route absent when the flag is off", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lockfile-buyer-off-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, enabled: false });
  const discovered = await runCli(["--base-url", merchant.base, "discover"]);
  const discovery = JSON.parse(discovered.stdout);
  assert.equal(discovery.enabled, false);
  assert.equal(discovery.challenge, false);
});
