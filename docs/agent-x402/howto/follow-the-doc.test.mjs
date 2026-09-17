import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  expectSeededRejected,
  runFollowTheDoc,
  serveLoopbackMcp,
} from "./follow-the-doc.mjs";
import {
  Rejected,
  assertDiscoveryInventory,
  rejectSeededDocument,
} from "./rpc.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const runner = join(here, "follow-the-doc.mjs");

function spawnAsync(cmd, args, opts = {}) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || repoRoot,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString("utf8"); });
    child.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    child.on("error", rejectP);
    child.on("close", (status) => resolveP({ status: status ?? 1, stdout, stderr }));
  });
}

test("docs tree exists under docs/agent-x402/howto", () => {
  for (const name of [
    "README.md",
    "how-to.md",
    "follow-the-doc.mjs",
    "rpc.mjs",
    "fixtures/seeded-failures.json",
    "fixtures/loopback-catalog.json",
    "fixtures/batch-settlement.json",
  ]) {
    assert.equal(existsSync(join(here, name)), true, name);
  }
});

test("pack text stays unpaid and does not mention neomorphic", () => {
  for (const name of ["README.md", "how-to.md"]) {
    const text = readFileSync(join(here, name), "utf8");
    assert.equal(text.includes("\uFEFF"), false, name);
    assert.match(text, /2025-11-25/);
    assert.match(text, /extract_batch/);
    assert.match(text, /batch-settlement/);
    assert.doesNotMatch(text, /neomorphic/i);
    assert.doesNotMatch(text, /smithery\.ai\/publish/);
  }
});

test("loopback catalog is a valid unpaid inventory", () => {
  const catalog = JSON.parse(readFileSync(join(here, "fixtures/loopback-catalog.json"), "utf8"));
  const found = assertDiscoveryInventory(catalog.tools);
  assert.equal(found.names.includes("extract"), true);
  assert.equal(found.names.includes("extract_batch"), true);
  assert.equal(found.names.includes("enrich"), true);
});

test("full cold follow-the-doc run succeeds and rejects seeded failures", async () => {
  const result = await runFollowTheDoc({ seededFailure: "all" });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.paid, false);
  assert.equal(result.liveMerchantPay, false);
  assert.equal(result.batchSettlement, false);
  assert.equal(result.discovery.exitCode, 0);
  assert.equal(result.discovery.initializeOk, true);
  assert.equal(result.discovery.toolsListOk, true);
  assert.equal(result.discovery.unpaid402Ok, true);
  const byId = Object.fromEntries(result.seededFailures.map((s) => [s.id, s]));
  assert.equal(byId["batch-settlement"].rejected, true);
  assert.notEqual(byId["batch-settlement"].exitCode, 0);
  assert.equal(byId["tools-call-paid"].rejected, true);
  assert.equal(byId["payment-header-initialize"].rejected, true);
  assert.equal(byId["mcp-method-header"].rejected, true);
  assert.equal(byId["registry-publish"].rejected, true);
  assert.equal(byId["missing-extract"].rejected, true);
  assert.equal(byId["protocol-2026-07-28"].rejected, true);
  assert.equal(byId["checkout-mutation"].rejected, true);
});

test("CLI --seeded-failure batch-settlement is rejected (exit 0 from runner)", async () => {
  const r = await spawnAsync(process.execPath, [
    runner,
    "--seeded-failure",
    "batch-settlement",
    "--json",
  ]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.seededFailures[0].id, "batch-settlement");
  assert.equal(body.seededFailures[0].rejected, true);
  assert.match(body.seededFailures[0].output, /batch-settlement scheme is forbidden/);
});

test("CLI default follow-the-doc prints ok true", async () => {
  const r = await spawnAsync(process.execPath, [runner]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.surface, "mcp-unpaid-discovery");
  assert.equal(body.protocolVersion, "2025-11-25");
  assert.equal(body.paid, false);
});

test("CLI unknown seeded-failure is refused without claiming ok", async () => {
  const r = await spawnAsync(process.execPath, [
    runner,
    "--seeded-failure",
    "not-a-real-id",
    "--json",
  ]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.code, "unknown-seeded-failure");
  assert.equal(body.discovery, null);
});

test("CLI publish is a kill without contacting a registry", async () => {
  const r = await spawnAsync(process.execPath, [runner, "publish"]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.killed, true);
  assert.match(r.stderr, /KILL: publish\/registry is out of scope/);
});

test("seeded documents reject missing extract and batch-settlement", () => {
  const missing = JSON.parse(readFileSync(join(here, "fixtures/missing-extract.json"), "utf8"));
  assert.throws(() => rejectSeededDocument(missing), (err) => {
    assert.equal(err instanceof Rejected, true);
    assert.equal(err.message, missing.expectReject);
    return true;
  });
  const batch = JSON.parse(readFileSync(join(here, "fixtures/batch-settlement.json"), "utf8"));
  assert.throws(() => rejectSeededDocument(batch), (err) => {
    assert.equal(err instanceof Rejected, true);
    assert.equal(err.message, batch.expectReject);
    return true;
  });
});

test("seeded expect rejects a zero exit that the fixture forbids", () => {
  const fixture = JSON.parse(readFileSync(join(here, "fixtures/seeded-failures.json"), "utf8"));
  const spec = fixture.failures.find((f) => f.id === "batch-settlement");
  const accepted = expectSeededRejected(spec, { status: 0, stdout: "", stderr: "" });
  assert.equal(accepted, false);
  const refused = expectSeededRejected(
    spec,
    { status: 1, stdout: "", stderr: "batch-settlement scheme is forbidden for unpaid MCP discovery\n" },
  );
  assert.equal(refused, true);
});

function rawPost(origin, body, headers = {}) {
  return new Promise((resolveP, rejectP) => {
    const u = new URL(origin);
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolveP({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", rejectP);
    req.end(payload);
  });
}

test("loopback unpaid tools/call returns exact 402 and never runs a handler", async () => {
  const catalog = JSON.parse(readFileSync(join(here, "fixtures/loopback-catalog.json"), "utf8"));
  const srv = await serveLoopbackMcp(catalog);
  try {
    const listed = await rawPost(srv.origin, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    assert.equal(listed.status, 200);
    const tools = JSON.parse(listed.body).result.tools;
    assertDiscoveryInventory(tools);

    const unpaid = await rawPost(srv.origin, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "extract", arguments: { url: "https://example.com/" } },
    });
    assert.equal(unpaid.status, 200);
    const payload = JSON.parse(unpaid.body);
    assert.equal(payload.result.isError, true);
    assert.equal(payload.result.structuredContent.error, "Payment required");
    assert.equal(payload.result.structuredContent.accepts[0].scheme, "exact");
    assert.equal("requestedUrl" in payload.result.structuredContent, false);

    const paidHeader = await rawPost(srv.origin, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    }, { "PAYMENT-SIGNATURE": "e30=" });
    assert.equal(paidHeader.status, 400);

    const root = await new Promise((resolveP, rejectP) => {
      const u = new URL(srv.origin);
      const req = http.request({
        hostname: u.hostname,
        port: u.port,
        path: "/",
        method: "GET",
      }, (res) => {
        res.resume();
        res.on("end", () => resolveP(res.statusCode));
      });
      req.on("error", rejectP);
      req.end();
    });
    assert.equal(root, 404);
  } finally {
    await srv.stop();
  }
});
