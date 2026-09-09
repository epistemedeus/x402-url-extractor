import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createCommerceTelemetry } from "./commerce-events.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));

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

async function readJson(url) {
  const response = await fetch(url);
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body);
}

test("mounted /v0/commerce-demand.json exposes durableRareFunnel after rare capture", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "commerce-rare-funnel-mounted-"));
  const port = await unusedPort();
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "mounted-rare-funnel-secret",
    credentialAttemptSince: "2020-01-01T00:00:00.000Z",
  });
  const listeners = new Map();
  const mountedCredential = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      amount: "5000",
      asset: "0x8888888888888888888888888888888888888888",
      payTo: "0x9999999999999999999999999999999999999999",
    },
    payload: { authorization: { from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
  })).toString("base64");
  const req = {
    path: "/extract",
    url: "/extract?url=https%3A%2F%2Fexample.com",
    originalUrl: "/extract?url=https%3A%2F%2Fexample.com",
    method: "GET",
    headers: { "payment-signature": mountedCredential },
    query: { url: "https://example.com" },
    rawBody: Buffer.alloc(0),
    ip: "203.0.113.77",
    socket: {},
  };
  const res = {
    statusCode: 200,
    locals: { samedaydeskPayment: { protocol: "x402" } },
    output: [],
    once(name, listener) { listeners.set(name, listener); },
    getHeader() { return undefined; },
    write(chunk) { this.output.push(Buffer.from(chunk)); return true; },
    end(chunk) { if (chunk) this.write(chunk); return this; },
    finish() { listeners.get("finish")?.(); },
  };
  telemetry.middleware(req, res, () => {});
  res.finish();
  await telemetry.flush();

  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      COMMERCE_CREDENTIAL_ATTEMPT_SINCE: "2020-01-01T00:00:00.000Z",
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 15_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve(true);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  try {
    assert.equal(await listening, true);
    const demand = await readJson(`http://127.0.0.1:${port}/v0/commerce-demand.json?days=90`);
    assert.ok(demand.durableRareFunnel, "commerce-demand missing durableRareFunnel plane");
    assert.equal(demand.durableRareFunnel.schemaVersion, "samedaydesk.commerce-rare-funnel-evidence.v1");
    assert.equal(demand.durableRareFunnel.parseableCredentialAttemptEvents, 1);
    assert.equal(demand.durableRareFunnel.paymentHeaderEvents, 1);
    assert.equal(demand.durableRareFunnel.paidSuccessEvents, 1);
    assert.equal(demand.durableRareFunnel.coverage.integrityStatus, "ok");
    assert.equal(JSON.stringify(demand).includes(mountedCredential), false);
    assert.ok(demand.paymentEvidence, "paymentEvidence readout still present");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000).unref();
    });
    await rm(dataDir, { recursive: true, force: true });
  }
});
