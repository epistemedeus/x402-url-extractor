import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import https from "node:https";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parityProjection } from "../src/service.mjs";
import { actors, fund, parties, setupService } from "./helpers.mjs";

const root = path.resolve(import.meta.dirname, "..");

function makeCerts(dir) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", path.join(dir, "ca.key"), "-out", path.join(dir, "ca.pem"), "-days", "1", "-nodes", "-subj", "/CN=ae14-e08-ca"], { stdio: "ignore" });
  execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-keyout", path.join(dir, "srv.key"), "-out", path.join(dir, "srv.csr"), "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  execFileSync("openssl", ["x509", "-req", "-in", path.join(dir, "srv.csr"), "-CA", path.join(dir, "ca.pem"), "-CAkey", path.join(dir, "ca.key"), "-CAcreateserial", "-out", path.join(dir, "srv.pem"), "-days", "1", "-copy_extensions", "copy"], { stdio: "ignore" });
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", path.join(dir, "bad.key"), "-out", path.join(dir, "bad.pem"), "-days", "1", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  return {
    ca: path.join(dir, "ca.pem"),
    key: path.join(dir, "srv.key"),
    cert: path.join(dir, "srv.pem"),
    badKey: path.join(dir, "bad.key"),
    badCert: path.join(dir, "bad.pem"),
  };
}

function request({ port, ca, method, path: pathname, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: "127.0.0.1",
      port,
      ca,
      rejectUnauthorized: true,
      servername: "localhost",
      method,
      path: pathname,
      headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : undefined,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

function startChild(env) {
  const child = spawn(process.execPath, ["src/serve.mjs"], { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ready timeout\n${stdout}\n${stderr}`)), 8000);
    const onData = () => {
      const match = stdout.match(/ready (\d+)/);
      if (!match) return;
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
      resolve(Number(match[1]));
    };
    const onExit = (code) => {
      clearTimeout(timer);
      reject(new Error(`server exit ${code}\n${stdout}\n${stderr}`));
    };
    child.stdout.on("data", onData);
    child.on("exit", onExit);
  });
  return { child, ready, output: () => `${stdout}\n${stderr}` };
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
}

test("certificate-verified restart keeps a lost callback from becoming a second capture", { timeout: 30000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ae14-e08-"));
  const tls = makeCerts(dir);
  const ctx = await setupService();
  const caPem = readFileSync(tls.ca);
  const sink = https.createServer({ key: readFileSync(tls.key), cert: readFileSync(tls.cert), ca: caPem }, (req) => {
    req.socket.destroy();
  });
  await new Promise((resolve) => sink.listen(0, "127.0.0.1", resolve));
  const sinkPort = sink.address().port;
  let server;
  try {
    const opened = await ctx.service.openJob(actors().requester, {
      ...parties,
      gross: "19",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      callbackUrl: `https://127.0.0.1:${sinkPort}/callback`,
    });
    assert.equal(opened.platformFee, "0");
    assert.equal(opened.contributorNet, "19");
    const record = await ctx.journal.read(opened.jobId);
    const proofId = `proof${opened.jobId}`;
    await ctx.port.put({
      proofId,
      qualification: "stand-in-not-rail",
      provenance: "fake",
      stage: "confirmed_usable",
      finalityRef: "local:final:1",
      tenantId: record.quote.tenantId,
      allocationId: record.quote.canonicalTaskId,
      quoteId: record.quote.quoteId,
      taskId: record.quote.taskId,
      requesterId: record.quote.requesterId,
      fundingAuthorityId: record.quote.fundingAuthorityId,
      asset: record.quote.asset,
      recipient: record.quote.fundingTarget,
      amount: record.quote.gross,
      quoteDigest: record.quoteDigest,
      effect: null,
      invocations: 0,
    });
    const baseEnv = {
      AE14_ASYNC_PORT: "stand-in",
      AE14_ASYNC_DATABASE: ctx.database,
      AE14_ASYNC_TLS_CERT: tls.cert,
      AE14_ASYNC_TLS_KEY: tls.key,
      AE14_ASYNC_TLS_CA: tls.ca,
    };
    server = startChild(baseEnv);
    const port = await server.ready;
    const health = await request({ port, ca: caPem, method: "GET", path: "/v1/health" });
    assert.equal(health.body.qualification, "pending-join");
    assert.equal(health.body.liveImmediatePay, false);
    assert.equal(health.body.bind, "127.0.0.1");
    assert.equal(health.body.routes.includes("GET /extract"), false);
    const missing = await request({ port, ca: caPem, method: "GET", path: "/extract" });
    const reader = await request({ port, ca: caPem, method: "GET", path: "/read" });
    assert.equal(missing.status, 404);
    assert.equal(reader.status, 404);
    const funded = await request({
      port,
      ca: caPem,
      method: "POST",
      path: `/v1/jobs/${opened.jobId}/funding`,
      body: { actor: actors().requester, proofId },
    });
    assert.equal(funded.body.reservedFunding, true);
    const delivered = await request({
      port,
      ca: caPem,
      method: "POST",
      path: `/v1/jobs/${opened.jobId}/output`,
      body: { actor: actors().worker, output: { kind: "repair", body: "async repair", assent: true } },
    });
    assert.equal(delivered.status, 200);
    assert.equal(delivered.body.usefulWork, false);
    assert.equal(delivered.body.paymentCompleted, false);
    assert.equal(delivered.body.callback.acked, false);
    assert.equal(delivered.body.callback.authority, false);
    assert.ok(delivered.body.callback.attempts >= 1);
    assert.equal((await ctx.port.load(proofId)).invocations || 0, 0);
    await stop(server.child);
    server = startChild(baseEnv);
    const port2 = await server.ready;
    const observed = await request({
      port: port2,
      ca: caPem,
      method: "GET",
      path: `/v1/jobs/${opened.jobId}?tenantId=tenant-a&actorId=requester-a&role=requester`,
    });
    assert.equal(observed.body.state, "output_ready");
    assert.equal(observed.body.capturePosted, false);
    assert.equal(observed.body.ambiguousEffect, false);
    assert.ok(observed.body.callback.attempts >= 2);
    assert.equal((await ctx.port.load(proofId)).invocations || 0, 0);
    const cli = spawn(process.execPath, [
      "src/cli.mjs", "accept",
      "--database", ctx.database,
      "--port-mode", "stand-in",
      "--job", opened.jobId,
      "--callback-ca", tls.ca,
      "--json", JSON.stringify({ actor: actors().reviewer }),
    ], { cwd: root });
    const cliOut = await new Promise((resolve, reject) => {
      let text = "";
      cli.stdout.on("data", (chunk) => { text += chunk; });
      cli.on("exit", (code) => code === 0 ? resolve(text) : reject(new Error(`cli ${code} ${text}`)));
    });
    const direct = JSON.parse(cliOut);
    assert.equal(direct.state, "approval_pending");
    assert.equal(direct.acceptedSettled, false);
    assert.equal(direct.usefulWork, true);
    assert.equal(direct.platformFee, "0");
    assert.equal(direct.directRoute.authority, true);
    assert.equal(direct.callback.authority, false);
    assert.equal((await ctx.port.load(proofId)).invocations, 1);
    await stop(server.child);
    server = startChild(baseEnv);
    const port3 = await server.ready;
    const replay = await request({
      port: port3,
      ca: caPem,
      method: "POST",
      path: `/v1/jobs/${opened.jobId}/accept`,
      body: { actor: actors().reviewer },
    });
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.secondCapturePost, false);
    assert.equal(replay.body.canonicalJoin, "pending-join");
    assert.equal((await ctx.port.load(proofId)).invocations, 1);
    const httpView = await request({
      port: port3,
      ca: caPem,
      method: "GET",
      path: `/v1/jobs/${opened.jobId}?tenantId=tenant-a&actorId=reviewer-a&role=evaluator`,
    });
    assert.deepEqual(parityProjection(direct), parityProjection(httpView.body));
    await assert.rejects(() => request({ port: port3, ca: readFileSync(tls.badCert), method: "GET", path: "/v1/health" }), (error) => ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN"].includes(error.code));
  } finally {
    if (server) await stop(server.child);
    sink.close();
    await ctx.close();
  }
});

test("a crash after the capture fence does not send a second capture on restart", { timeout: 20000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ae14-e08-crash-"));
  const tls = makeCerts(dir);
  const ctx = await setupService();
  const caPem = readFileSync(tls.ca);
  let server;
  try {
    const funded = await fund(ctx, { gross: "21" });
    await ctx.service.deliverOutput(actors().worker, funded.opened.jobId, { kind: "no_fit", body: "no fit yet" });
    server = startChild({
      AE14_ASYNC_PORT: "stand-in",
      AE14_ASYNC_DATABASE: ctx.database,
      AE14_ASYNC_TLS_CERT: tls.cert,
      AE14_ASYNC_TLS_KEY: tls.key,
      AE14_ASYNC_TLS_CA: tls.ca,
      AE14_ASYNC_CRASH_AFTER: "capture-commit",
    });
    const port = await server.ready;
    await assert.rejects(() => request({
      port,
      ca: caPem,
      method: "POST",
      path: `/v1/jobs/${funded.opened.jobId}/accept`,
      body: { actor: actors().reviewer },
    }));
    await new Promise((resolve) => server.child.once("exit", resolve));
    const crashed = await ctx.journal.read(funded.opened.jobId);
    assert.equal(crashed.capturePosted, true);
    assert.equal(crashed.review.decision, "accept");
    assert.equal((await ctx.port.load(funded.proofId)).invocations || 0, 0);
    server = startChild({
      AE14_ASYNC_PORT: "stand-in",
      AE14_ASYNC_DATABASE: ctx.database,
      AE14_ASYNC_TLS_CERT: tls.cert,
      AE14_ASYNC_TLS_KEY: tls.key,
      AE14_ASYNC_TLS_CA: tls.ca,
    });
    const port2 = await server.ready;
    const observed = await request({
      port: port2,
      ca: caPem,
      method: "GET",
      path: `/v1/jobs/${funded.opened.jobId}?tenantId=tenant-a&actorId=requester-a&role=requester`,
    });
    assert.equal(observed.body.ambiguousEffect, true);
    assert.equal(observed.body.captureState, null);
    assert.equal(observed.body.acceptedSettled, false);
    assert.equal(observed.body.resultKind, "no_fit");
    const again = await request({
      port: port2,
      ca: caPem,
      method: "POST",
      path: `/v1/jobs/${funded.opened.jobId}/accept`,
      body: { actor: actors().reviewer },
    });
    assert.equal(again.body.secondCapturePost, false);
    assert.equal((await ctx.port.load(funded.proofId)).invocations || 0, 0);
  } finally {
    if (server) await stop(server.child);
    await ctx.close();
  }
});

test("rail mode without the amended export exits pending-join", async () => {
  const child = spawn(process.execPath, ["src/serve.mjs"], {
    cwd: root,
    env: { ...process.env, AE14_ASYNC_PORT: "rail" },
  });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 2);
});

test("an untrusted callback certificate is not an acknowledgement", { timeout: 15000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ae14-e08-bad-"));
  const tls = makeCerts(dir);
  const ctx = await setupService({ callbackCa: readFileSync(tls.ca) });
  const sink = https.createServer({ key: readFileSync(tls.badKey), cert: readFileSync(tls.badCert) }, (_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });
  await new Promise((resolve) => sink.listen(0, "127.0.0.1", resolve));
  try {
    const funded = await fund(ctx, { jobExtras: { callbackUrl: `https://127.0.0.1:${sink.address().port}/cb` } });
    const delivered = await ctx.service.deliverOutput(actors().worker, funded.opened.jobId, { kind: "repair", body: "bad tls" });
    assert.equal(delivered.callback.acked, false);
    assert.equal(delivered.callback.authority, false);
    assert.equal(delivered.usefulWork, false);
    const direct = await ctx.service.accept(actors().reviewer, funded.opened.jobId);
    assert.equal(direct.state, "approval_pending");
    assert.equal(direct.usefulWork, true);
    assert.equal((await ctx.port.load(funded.proofId)).invocations, 1);
  } finally {
    sink.close();
    await ctx.close();
  }
});
