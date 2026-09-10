import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { PAGE_CHANGE_HTTP_PATH } from "./page-change-http.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const fx = (...parts) => path.join(cwd, "examples/customer-x402/fixtures/page-change", ...parts);
const load = (...parts) => JSON.parse(readFileSync(fx(...parts), "utf8"));
const PIN = "e0daf4d9a9e775a8180ae0aa9bee351c10b850c8";

const expectedVerdicts = {
  unchanged_pages: "unchanged",
  changed_selected_fields: "changed",
  row_reorder: "reordered",
  duplicate_urls: "unchanged",
  missing_requested_field: "incomplete",
  failed_fetch: "incomplete",
  partial_batch: "changed",
  differing_requested_fields: "incomplete",
  unknown_observation_freshness: "unchanged",
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
  const server = createHttpServer((req, res) => {
    if (req.method === "GET" && req.url === "/supported") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ isValid: false, success: false }));
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${server.address().port}`,
  };
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

async function startMerchant({ extraEnv = {}, startupTimeout = 20_000 } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "page-change-http-"));
  const facilitator = await startFakeFacilitator();
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitator.url,
      MPP_SECRET_KEY: "test-secret-key-test-secret-key-32",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      PAGE_CHANGE_SOURCE_COMMIT: "",
      SOURCE_COMMIT: "",
      RAILWAY_GIT_COMMIT_SHA: "",
      PAGE_CHANGE_XAGENT_SLUG: "",
      PAGE_CHANGE_XAGENT_COMMIT: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  try {
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("error", onError);
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => finish(new Error(`startup timed out: ${output.slice(-2000)}`)), startupTimeout);
      const onData = (chunk) => {
        output = `${output}${chunk}`.slice(-40_000);
        if (output.includes(`x402-merchant listening on :${port}`)) finish();
      };
      const onExit = (code, signal) => finish(new Error(`startup exited: code=${code} signal=${signal}\n${output.slice(-4000)}`));
      const onError = (error) => finish(error);
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("exit", onExit);
      child.once("error", onError);
    });
  } catch (error) {
    await stopChild(child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
  return {
    base: `http://127.0.0.1:${port}`,
    child,
    output: () => output,
    async close() {
      await stopChild(child);
      await facilitator.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function postJson(base, body, { headers = {}, method = "POST", path = PAGE_CHANGE_HTTP_PATH, signal } = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "GET" || method === "HEAD" ? undefined : payload,
    signal,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { response, json, text };
}

function streamRequest(base) {
  let request;
  const result = new Promise((resolve, reject) => {
    request = httpRequest(`${base}${PAGE_CHANGE_HTTP_PATH}`, { method: "POST", headers: { "content-type": "application/json" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    request.on("error", reject);
  });
  // Caller may intentionally disconnect before there is a response.
  result.catch(() => {});
  return { request, result };
}

test("stream admission caps active uploads and releases capacity on disconnect", { timeout: 30000 }, async (t) => {
  const merchant = await startEnabledMerchant(t, { PAGE_CHANGE_HTTP_MAX_CONCURRENT: "1" });
  const first = streamRequest(merchant.base);
  t.after(() => first.request.destroy());
  first.request.write("{");
  await delay(80);
  const payload = { before: load("merchant", "unchanged-before.json"), after: load("merchant", "unchanged-after.json"), fields: ["title"] };
  const busy = await postJson(merchant.base, payload);
  assert.equal(busy.response.status, 503);
  assert.equal(busy.json.code, "page_change_busy");
  first.request.destroy();
  await delay(80);
  assert.equal((await postJson(merchant.base, payload)).response.status, 200);
});

test("oversized chunked upload gets immediate 413 without waiting for its end", { timeout: 30000 }, async (t) => {
  const merchant = await startEnabledMerchant(t, { PAGE_CHANGE_HTTP_MAX_REQUEST_BYTES: "512", PAGE_CHANGE_HTTP_TIMEOUT_MS: "1500" });
  const stream = streamRequest(merchant.base);
  t.after(() => stream.request.destroy());
  const started = performance.now();
  stream.request.write(Buffer.alloc(1024, 0x61));
  const response = await stream.result;
  assert.equal(response.status, 413);
  assert.ok(performance.now() - started < 1000);
});

test("one deadline covers body plus compare and mounted cancellation leaves no worker", { timeout: 30000 }, async (t) => {
  const merchant = await startEnabledMerchant(t, { PAGE_CHANGE_HTTP_TIMEOUT_MS: "450", PAGE_CHANGE_HTTP_WORKER_PATH: path.join(cwd, "page-change-http-sleep-worker.mjs") });
  const payload = JSON.stringify({ before: load("merchant", "unchanged-before.json"), after: load("merchant", "unchanged-after.json"), fields: ["title"] });
  const stream = streamRequest(merchant.base);
  t.after(() => stream.request.destroy());
  const started = performance.now();
  stream.request.write(payload.slice(0, 20));
  await delay(300);
  stream.request.end(payload.slice(20));
  assert.equal((await stream.result).status, 408);
  assert.ok(performance.now() - started < 700, "upload cannot buy another full worker timeout");
  await delay(80);
  const children = spawnSync("pgrep", ["-P", String(merchant.child.pid), "-f", "page-change-http"], { encoding: "utf8" });
  assert.equal(children.status, 1, children.stdout);
});

test("mounted wrapper covers parser aliases, graph/output ceilings, and unverified freshness", { timeout: 30000 }, async (t) => {
  const merchant = await startEnabledMerchant(t);
  const artifact = load("merchant", "unchanged-before.json");
  const payload = { before: { mediaType: "application/json", body: artifact, observedAt: "2026-09-08T12:00:00Z" }, after: { mediaType: "application/json", body: artifact, observedAt: "2026-09-08T12:00:01Z" }, fields: ["title"], clock: "2026-09-08T12:00:02Z", maxStaleMs: 10000 };
  const normal = await postJson(merchant.base, payload, { path: "/Recipes/Page-Change/" });
  assert.equal(normal.response.status, 200);
  assert.equal(normal.json.report.claims.current, false);
  assert.equal(normal.json.report.claims.fresh, false);
  assert.equal(normal.json.report.freshness, "unknown");
  const forged = await postJson(merchant.base, { ...payload, allowFreshClaim: true });
  assert.equal(forged.response.status, 400);
  let deep = {};
  for (let i = 0; i < 20; i++) deep = { nested: deep };
  assert.equal((await postJson(merchant.base, { before: deep, after: artifact, fields: ["title"] })).json.code, "json_depth_limit");
  assert.equal((await postJson(merchant.base, { before: { rows: Array(4200).fill(1) }, after: artifact, fields: ["title"] })).json.code, "json_node_limit");
  const bounded = await startEnabledMerchant(t, { PAGE_CHANGE_HTTP_MAX_OUTPUT_BYTES: "256" });
  const oversized = await postJson(bounded.base, payload);
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.json.code, "output_too_large");
  await delay(80);
  assert.equal(spawnSync("pgrep", ["-P", String(bounded.child.pid), "-f", "page-change-http"], { encoding: "utf8" }).status, 1);
});

test("disabled companion stays dark and does not change healthz or paid extract", { timeout: 60_000 }, async (t) => {
  const merchant = await startMerchant();
  t.after(() => merchant.close());
  const denied = await postJson(merchant.base, {
    before: load("merchant", "unchanged-before.json"),
    after: load("merchant", "unchanged-after.json"),
    fields: ["title"],
  });
  assert.equal(denied.response.status, 404);
  assert.equal(denied.json.error, "page_change_http_disabled");
  assert.equal(denied.json.charged, false);
  const health = await fetch(`${merchant.base}/recipes/page-change/health`);
  assert.equal(health.status, 404);
  const healthBody = await health.json();
  assert.equal(Object.hasOwn(healthBody, "commit"), false);
  const proof = await fetch(`${merchant.base}/.well-known/xagent-verification.json`);
  assert.equal(proof.status, 404);
  const healthz = await fetch(`${merchant.base}/healthz`).then((r) => r.json());
  assert.equal(healthz.ok, true);
  assert.ok(healthz.prices.extract);
  assert.equal(Object.hasOwn(healthz.prices, "page-change"), false);
  assert.equal(healthz.trustArtifacts.serviceDeployment.statement.endsWith(".json"), true);
  const extract = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://example.com/")}`);
  assert.equal(extract.status, 402);
});

async function startEnabledMerchant(t, extraEnv = {}) {
  const merchant = await startMerchant({
    extraEnv: {
      PAGE_CHANGE_HTTP_ENABLED: "1",
      PAGE_CHANGE_SOURCE_COMMIT: PIN,
      PAGE_CHANGE_XAGENT_SLUG: "samedaydesk-page-change",
      ...extraEnv,
    },
  });
  t.after(() => merchant.close());
  return merchant;
}

test("enabled no-key HTTP matches C31 customer and merchant compare semantics", { timeout: 60_000 }, async (t) => {
  const merchant = await startEnabledMerchant(t);

  const healthResponse = await fetch(`${merchant.base}/recipes/page-change/health`);
  assert.equal(healthResponse.headers.get("x-source-commit"), PIN);
  const health = await healthResponse.json();
  assert.equal(health.status, "ok");
  assert.equal(health.commit, PIN);
  const proof = await fetch(`${merchant.base}/.well-known/xagent-verification.json`).then((r) => r.json());
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.commit, PIN);
  const spec = await fetch(`${merchant.base}/recipes/page-change/openapi.json`).then((r) => r.json());
  assert.equal(spec.paths[PAGE_CHANGE_HTTP_PATH].post.operationId, "postRecipesPageChange");

  const changed = await postJson(merchant.base, {
    before: load("customer-job", "before.json"),
    after: load("customer-job", "after.json"),
    fields: ["title", "description", "headings"],
  });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.json.charged, false);
  assert.equal(changed.json.report.verdict, "changed");
  assert.equal(changed.json.report.claims.paymentImpliesUsefulOutput, false);
  assert.ok(changed.json.report.rows.failed.some((row) => String(row.sourceKey).includes("fasteners")));

  const unchanged = await postJson(merchant.base, {
    before: load("merchant", "unchanged-before.json"),
    after: load("merchant", "unchanged-after.json"),
    fields: ["title", "description"],
  });
  assert.equal(unchanged.json.report.verdict, "unchanged");

  const reordered = await postJson(merchant.base, {
    before: load("merchant", "unchanged-before.json"),
    after: load("merchant", "reordered-after.json"),
    fields: ["title", "description"],
  });
  assert.equal(reordered.json.report.verdict, "reordered");

  const duplicate = await postJson(merchant.base, {
    before: load("merchant", "duplicate-active.json"),
    after: load("merchant", "duplicate-active.json"),
    fields: ["title"],
  });
  assert.equal(duplicate.json.report.verdict, "ambiguous");

  const healthz = await fetch(`${merchant.base}/healthz`).then((r) => r.json());
  assert.equal(healthz.ok, true);
  assert.equal(Object.hasOwn(healthz.prices, "page-change"), false);
  const paidSpec = await fetch(`${merchant.base}/openapi.json`).then((r) => r.json());
  assert.equal(paidSpec.paths?.[PAGE_CHANGE_HTTP_PATH], undefined);
  const extract = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://example.com/")}`);
  assert.equal(extract.status, 402);
});

test("enabled no-key HTTP matches W5 composition verdicts", { timeout: 60_000 }, async (t) => {
  const merchant = await startEnabledMerchant(t);
  for (const entry of load("w5-corpus", "manifest.json").cases) {
    const expected = load("w5-corpus", "cases", entry.case_id, "expected.json");
    const result = await postJson(merchant.base, {
      before: load("w5-corpus", "cases", entry.case_id, "observation-before.json"),
      after: load("w5-corpus", "cases", entry.case_id, "observation-after.json"),
      fields: expected.buyer_owned_dependent_fields,
    });
    assert.equal(result.response.status, 200, entry.kind);
    assert.equal(result.json.report.verdict, expectedVerdicts[entry.kind], entry.kind);
  }
});

test("host-injected Railway commit binds health without a manual page-change pin", { timeout: 60_000 }, async (t) => {
  const host = "d".repeat(40);
  const merchant = await startMerchant({
    extraEnv: {
      PAGE_CHANGE_HTTP_ENABLED: "1",
      RAILWAY_GIT_COMMIT_SHA: host,
      PAGE_CHANGE_XAGENT_SLUG: "samedaydesk-page-change",
    },
  });
  t.after(() => merchant.close());
  const healthResponse = await fetch(`${merchant.base}/recipes/page-change/health`);
  assert.equal(healthResponse.headers.get("x-source-commit"), host);
  const health = await healthResponse.json();
  assert.equal(health.commit, host);
  assert.equal(health.commitSource, "railway_git_commit_sha");
  const proof = await fetch(`${merchant.base}/.well-known/xagent-verification.json`);
  assert.equal(proof.headers.get("x-source-commit"), host);
  assert.deepEqual(await proof.json(), {
    schemaVersion: 1,
    slug: "samedaydesk-page-change",
    commit: host,
  });
});

test("enabled companion rejects method, content-type, paths, limit raises, and oversize", { timeout: 60_000 }, async (t) => {
  const merchant = await startEnabledMerchant(t);

  const method = await fetch(`${merchant.base}${PAGE_CHANGE_HTTP_PATH}`, { method: "GET" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "POST");

  const ctype = await fetch(`${merchant.base}${PAGE_CHANGE_HTTP_PATH}`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal(ctype.status, 415);

  const raised = await postJson(merchant.base, {
    before: load("merchant", "unchanged-before.json"),
    after: load("merchant", "unchanged-after.json"),
    fields: ["title"],
    maxBytes: 9_999_999,
  });
  assert.equal(raised.response.status, 400);
  assert.equal(raised.json.error, "invalid_page_change_input");
  assert.match(String(raised.json.message), /cannot raise|admission limits/);

  const pathInput = await postJson(merchant.base, {
    before: "/tmp/before.json",
    after: load("merchant", "unchanged-after.json"),
    fields: ["title"],
  });
  assert.equal(pathInput.response.status, 400);

  const huge = Buffer.alloc(300_000, 0x61);
  const oversize = await fetch(`${merchant.base}${PAGE_CHANGE_HTTP_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: huge,
  });
  assert.equal(oversize.status, 413);
  await delay(150);
});

test("mounted cancel and timeout leave the merchant serving later compares", { timeout: 30_000 }, async (t) => {
  const merchant = await startMerchant({
    extraEnv: {
      PAGE_CHANGE_HTTP_ENABLED: "1",
      PAGE_CHANGE_HTTP_WORKER_PATH: path.join(cwd, "page-change-http-sleep-worker.mjs"),
      PAGE_CHANGE_HTTP_TIMEOUT_MS: "120",
    },
  });
  t.after(() => merchant.close());
  const payload = {
    before: load("merchant", "unchanged-before.json"),
    after: load("merchant", "unchanged-after.json"),
    fields: ["title"],
  };
  const timed = await postJson(merchant.base, payload);
  assert.equal(timed.response.status, 408);
  const abort = new AbortController();
  const pending = postJson(merchant.base, payload, { signal: abort.signal });
  await delay(20);
  abort.abort();
  await assert.rejects(pending, /abort/i);
  await delay(250);
  const stillUp = await postJson(merchant.base, payload);
  assert.equal(stillUp.response.status, 408);
});
