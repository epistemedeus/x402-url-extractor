import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { QA_ROOT, testDirectory } from "./mounted-owner.mjs";
import { contract } from "./caller.mjs";
import { executeDelivery, evaluateReceipt } from "../src/consumer.mjs";

async function listen(server) { await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); return server.address().port; }
test("actual unchanged merchant server publishes its real manifest and delivers a free caller scan without settlement", async () => {
  const directory = await testDirectory(); const calls = { supported: 0, verify: 0, settle: 0, other: 0 };
  const facilitator = createServer((req, res) => {
    if (req.url === "/supported" && req.method === "GET") {
      calls.supported++; res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }], extensions: [], signers: {} }));
    }
    if (req.url === "/verify") calls.verify++;
    else if (req.url === "/settle") calls.settle++;
    else calls.other++;
    res.writeHead(503).end();
  });
  const facilitatorPort = await listen(facilitator);
  const reservation = createServer(); const port = await listen(reservation); await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: QA_ROOT, env: { PATH: process.env.PATH || "", PORT: String(port), PUBLIC_URL: "https://agents.samedaydesk.com",
      COMMERCE_DATA_DIR: path.join(directory, "commerce"), COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay", FACILITATOR_URL: `http://127.0.0.1:${facilitatorPort}`, MPP_SECRET_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("full_server_startup_timeout")), 10000);
    const onData = chunk => {
      output = (output + chunk).slice(-32000);
      if (output.includes(`x402-merchant listening on :${port}`)) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.once("exit", () => { clearTimeout(timer); reject(new Error("full_server_startup_failed")); });
    child.once("error", reject);
  });
  try {
    await ready;
    const r = await executeDelivery(contract(), `http://127.0.0.1:${port}`, { allowLoopback: true });
    const e = evaluateReceipt(r);
    assert.equal(r.observations.releaseBefore.body.service.version, "1.23.49");
    assert.ok(r.observations.releaseBefore.body.operations.length > 1);
    assert.equal(e.usefulOutput, "met"); assert.equal(e.verdict, "fulfilled");
    assert.equal(e.release.authority, "anonymous_descriptor_observation");
    assert.equal(e.release.deployment, "unknown");
    assert.equal(calls.verify, 0); assert.equal(calls.settle, 0); assert.equal(calls.other, 0);
    assert.equal(r.observations.execution.body.paymentPerformed, false);
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    facilitator.closeAllConnections(); await new Promise(resolve => facilitator.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
