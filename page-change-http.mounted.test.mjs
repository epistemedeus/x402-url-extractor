import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { link, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { PAGE_CHANGE_HTTP_PATH } from "./page-change-http.mjs";
import { MCP_JSON_RPC_MAX_BYTES } from "./mcp-json-rpc-limit.mjs";

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

async function startMerchant({ extraEnv = {}, startupTimeout = 20_000, dataDir: retainedDataDir = null } = {}) {
  const dataDir = retainedDataDir || await mkdtemp(path.join(tmpdir(), "page-change-http-"));
  const facilitator = await startFakeFacilitator();
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      NETWORK: "eip155:8453", // Test chain; do not inherit a Work network-policy label.
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
  child.stdout.on("data", chunk => { output = `${output}${chunk}`.slice(-40_000); });
  child.stderr.on("data", chunk => { output = `${output}${chunk}`.slice(-40_000); });
  return {
    base: `http://127.0.0.1:${port}`,
    dataDir,
    child,
    output: () => output,
    async close() {
      await stopChild(child);
      await facilitator.close();
      if (!retainedDataDir) await rm(dataDir, { recursive: true, force: true });
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
  const pageChangeOperation = paidSpec.paths?.[PAGE_CHANGE_HTTP_PATH]?.post;
  assert.equal(pageChangeOperation?.operationId, "postRecipesPageChange");
  assert.equal(pageChangeOperation?.["x-payment-info"], undefined);
  assert.equal(pageChangeOperation?.responses?.["402"], undefined);
  assert.equal(pageChangeOperation?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.charged?.const, false);
  const llms = await fetch(`${merchant.base}/llms.txt`).then((r) => r.text());
  assert.match(llms, /POST \/recipes\/page-change \(charged: false\)/);
  assert.doesNotMatch(llms, /\/recipes\/page-change[^\n]*USDC/);
  const skills = await fetch(`${merchant.base}/.well-known/skills/index.json`).then((r) => r.json());
  const pageChangeSkill = skills.skills.find((skill) => skill.name === "page-change");
  assert.match(pageChangeSkill.description, /charged: false/);
  const catalog = await fetch(`${merchant.base}/api/actions`).then((r) => r.json());
  assert.equal(catalog.freeRecipes?.[0]?.charged, false);
  assert.equal(catalog.freeRecipes?.[0]?.route, PAGE_CHANGE_HTTP_PATH);
  assert.equal(catalog.actions.some((action) => action.route === PAGE_CHANGE_HTTP_PATH), false);
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


test("conflicting host pins emit neither proof nor source header", {timeout:60000}, async(t)=>{
  const merchant=await startMerchant({extraEnv:{PAGE_CHANGE_HTTP_ENABLED:'1',RAILWAY_GIT_COMMIT_SHA:'a'.repeat(40),SOURCE_COMMIT:'b'.repeat(40),PAGE_CHANGE_XAGENT_SLUG:'samedaydesk-page-change'}});
  t.after(()=>merchant.close());
  const health=await fetch(`${merchant.base}/recipes/page-change/health`);assert.equal(health.headers.get('x-source-commit'),null);const body=await health.json();assert.equal(body.commit,null);assert.equal(body.reason,'source_commit_mismatch');
  const proof=await fetch(`${merchant.base}/.well-known/xagent-verification.json`);assert.equal(proof.status,404);assert.equal(proof.headers.get('x-source-commit'),null);assert.equal((await proof.json()).error,'xagent_verification_unavailable');
});

// This regression must exercise server.js's actual mounts, not a copied route.
test("free HTTP and MCP outcomes reach the normal operator summary", { timeout: 60_000 }, async (t) => {
  const merchant = await startMerchant({ extraEnv: { PAGE_CHANGE_HTTP_ENABLED: "1" } });
  t.after(() => merchant.close());
  const payload = { before: load("merchant", "unchanged-before.json"), after: load("merchant", "unchanged-after.json"), fields: ["title"] };
  const http = await postJson(merchant.base, payload);
  assert.equal(http.response.status, 200);
  assert.equal(http.json.report.verdict, "unchanged");
  // server.js mounts MCP asynchronously after listen.
  let mcp;
  for (let n = 0; n < 100; n++) {
    const response = await fetch(`${merchant.base}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2131, method: "tools/call", params: { name: "page_change", arguments: payload } }),
    });
    if (response.status === 404) { await delay(30); continue; }
    const wire = await response.text();
    mcp = JSON.parse(wire.startsWith("event:") ? wire.split("data: ")[1].trim() : wire);
    break;
  }
  assert.ok(mcp?.result, JSON.stringify(mcp));
  assert.notEqual(mcp.result.isError, true);
  await delay(100);
  const summary = await (await fetch(`${merchant.base}/v0/commerce-demand.json`)).json();
  assert.ok(summary.freePageChange, `missing free outcome observation: HTTP and MCP succeeded; paidSuccesses=${summary.paidSuccesses}`);
  assert.equal(summary.freePageChange.transports.http.byOutcome.unchanged, 1);
  assert.equal(summary.freePageChange.transports.mcp.byOutcome.unchanged, 1);
});

async function callFreePageChange(base, payload, headers = {}) {
  for (let n = 0; n < 100; n++) {
    const response = await fetch(`${base}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: n, method: "tools/call", params: { name: "page_change", arguments: payload } }),
    });
    if (response.status === 404) { await delay(30); continue; }
    const wire = await response.text();
    const body = JSON.parse(wire.startsWith("event:") ? wire.split("data: ")[1].trim() : wire);
    return { response, body };
  }
  throw new Error("MCP did not mount");
}

async function freeOutcomeSummary(merchant) {
  const response = await fetch(`${merchant.base}/v0/commerce-demand.json`);
  assert.equal(response.status, 200);
  return response.json();
}

const unchangedPayload = () => ({ before: load("merchant", "unchanged-before.json"), after: load("merchant", "unchanged-after.json"), fields: ["title"] });

test("mounted HTTP/MCP distinguish complete, partial, unavailable and refused invocations without retaining private bytes", { timeout: 60_000 }, async t => {
  const internalToken = "root2131-owner-token-".repeat(3);
  const merchant = await startMerchant({ extraEnv: { PAGE_CHANGE_HTTP_ENABLED: "1", COMMERCE_INTERNAL_TOKEN: internalToken } });
  t.after(() => merchant.close());
  const completeChanged = unchangedPayload();
  completeChanged.after.sources[0].data.title = "private-document-marker-2131";
  completeChanged.before.sources[0].source = completeChanged.after.sources[0].source = "https://private-source-marker-2131.example/a";
  const cases = [
    { input: unchangedPayload(), outcome: "unchanged" },
    { input: completeChanged, outcome: "changed" },
    { input: { ...unchangedPayload(), after: load("merchant", "reordered-after.json") }, outcome: "reordered" },
    { input: { before: load("customer-job", "before.json"), after: load("customer-job", "after.json"), fields: ["title", "description", "headings"] }, outcome: "partial" },
    { input: { before: {}, after: {}, fields: ["title"] }, outcome: "unavailable" },
    { input: { ...unchangedPayload(), fields: ["private-property-marker-2131"] }, outcome: "refused" },
    { input: { ...unchangedPayload(), fields: [] }, outcome: "refused" },
  ];
  const privacyHeaders = { "x-private-marker": "private-header-marker-2131", "x-samedaydesk-page-change-outcome": "unchanged", "payment-signature": "private-wallet-secret-marker-2131" };
  for (const entry of cases) {
    const http = await postJson(merchant.base, entry.input, { headers: privacyHeaders });
    assert.equal(http.response.status, entry.outcome === "refused" ? 400 : 200);
    const mcp = await callFreePageChange(merchant.base, entry.input, privacyHeaders);
    assert.equal(mcp.response.status, 200);
    assert.equal(mcp.body.result?.isError === true, entry.outcome === "refused");
  }
  // Identical retries are distinct invocations; finish + close cannot double-record one.
  await postJson(merchant.base, unchangedPayload());
  await callFreePageChange(merchant.base, unchangedPayload());
  const populations = [
    { headers: { "x-samedaydesk-internal": internalToken }, name: "internal" },
    { headers: { "user-agent": "SameDayDesk-owner-test" }, name: "owner_monitor" },
    { headers: { "user-agent": "GPTBot" }, name: "crawler" },
  ];
  for (const population of populations) {
    await postJson(merchant.base, unchangedPayload(), { headers: population.headers });
    await callFreePageChange(merchant.base, unchangedPayload(), population.headers);
  }
  // Unverified owner declarations and bogus tokens do not establish identity.
  const unverified = { "x-samedaydesk-internal": "bogus", "x-samedaydesk-validation-marker": "owner", "x-samedaydesk-origin-class": "internal" };
  await postJson(merchant.base, unchangedPayload(), { headers: unverified });
  await callFreePageChange(merchant.base, unchangedPayload(), unverified);
  const malformed = await postJson(merchant.base, "{private-parser-marker-2131", { headers: { "x-forwarded-for": "203.0.113.201" } });
  assert.equal(malformed.response.status, 400);
  const oversized = await postJson(merchant.base, Buffer.alloc(300_000, 97), { headers: { "x-forwarded-for": "203.0.113.202" } });
  assert.equal(oversized.response.status, 413);
  const summary = await freeOutcomeSummary(merchant);
  for (const transport of ["http", "mcp"]) {
    const observed = summary.freePageChange.transports[transport];
    assert.equal(observed.byOutcome.changed, 1);
    assert.equal(observed.byOutcome.reordered, 1);
    assert.equal(observed.byOutcome.partial, 1);
    assert.equal(observed.byOutcome.unavailable, 1);
    assert.equal(observed.byOutcome.unchanged, 3);
    assert.equal(observed.byOutcome.refused, transport === "http" ? 4 : 2);
    assert.equal(observed.observations, transport === "http" ? 11 : 9);
    assert.equal(observed.populations.internal.unchanged, 1);
    assert.equal(observed.populations.owner_monitor.unchanged, 1);
    assert.equal(observed.populations.crawler.unchanged, 1);
    assert.equal(observed.captureVersion, 1);
    assert.equal(observed.coverage, "prospective_process_only");
    assert.equal(observed.requestedWindowComplete, false);
  }
  assert.equal(summary.freePageChange.usefulness, "unknown");
  assert.equal(summary.freePageChange.callerIdentity, "unknown");
  const stored = await readFile(path.join(merchant.dataDir, "commerce-events.ndjson"), "utf8");
  for (const marker of ["private-document-marker", "private-source-marker", "private-property-marker", "private-header-marker", "private-wallet-secret", "private-parser-marker", internalToken]) assert.ok(!stored.includes(marker), marker);
  const rows = stored.trim().split("\n").map(JSON.parse).filter(row => row.pageChangeOutcome);
  assert.equal(rows.length, 26);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.ok(rows.every(row => row.paymentPresent === false && row.paymentActor === null && row.queryKeys.length === 0));
  assert.equal(summary.paidSuccessActors, 0);
  assert.equal(summary.byResult.paid_success || 0, 0);
});

test("mounted timeout, disconnect and worker failure never become completed comparisons", { timeout: 60_000 }, async t => {
  const timed = await startMerchant({ extraEnv: { PAGE_CHANGE_HTTP_ENABLED: "1", PAGE_CHANGE_HTTP_WORKER_PATH: path.join(cwd, "page-change-http-sleep-worker.mjs"), PAGE_CHANGE_HTTP_TIMEOUT_MS: "180" } });
  t.after(() => timed.close());
  assert.equal((await postJson(timed.base, unchangedPayload())).response.status, 408);
  const mcp = await callFreePageChange(timed.base, unchangedPayload());
  assert.equal(mcp.body.result.isError, true);
  const abort = new AbortController();
  const pending = postJson(timed.base, unchangedPayload(), { signal: abort.signal });
  await delay(60);
  abort.abort();
  await assert.rejects(pending, /abort/i);
  const mcpAbort = new AbortController();
  const pendingMcp = fetch(`${timed.base}/mcp`, {
    method: "POST", signal: mcpAbort.signal,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 88, method: "tools/call", params: { name: "page_change", arguments: unchangedPayload() } }),
  }).then(response => response.text());
  await delay(60);
  mcpAbort.abort();
  await assert.rejects(pendingMcp, /abort/i);
  await delay(220);
  const timedSummary = await freeOutcomeSummary(timed);
  assert.equal(timedSummary.freePageChange.transports.http.byOutcome.aborted, 2);
  assert.equal(timedSummary.freePageChange.transports.mcp.byOutcome.aborted, 2);
  assert.equal(timedSummary.freePageChange.transports.http.byOutcome.unchanged, 0);
  const failed = await startMerchant({ extraEnv: { PAGE_CHANGE_HTTP_ENABLED: "1", PAGE_CHANGE_HTTP_WORKER_PATH: path.join(cwd, "does-not-exist-root2131.mjs") } });
  t.after(() => failed.close());
  assert.equal((await postJson(failed.base, unchangedPayload())).response.status, 500);
  assert.equal((await callFreePageChange(failed.base, unchangedPayload())).body.result.isError, true);
  const failureSummary = await freeOutcomeSummary(failed);
  assert.equal(failureSummary.freePageChange.transports.http.byOutcome.failed, 1);
  assert.equal(failureSummary.freePageChange.transports.mcp.byOutcome.failed, 1);
});

test("mounted restart retains observations but starts fresh process coverage; disabled transports remain unmeasured", { timeout: 60_000 }, async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "root2131-restart-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const first = await startMerchant({ dataDir, extraEnv: { PAGE_CHANGE_HTTP_ENABLED: "1" } });
  t.after(() => first.close());
  await postJson(first.base, unchangedPayload());
  await callFreePageChange(first.base, unchangedPayload());
  const initial = await freeOutcomeSummary(first);
  await first.close();
  const second = await startMerchant({ dataDir, extraEnv: { PAGE_CHANGE_HTTP_ENABLED: "1" } });
  t.after(() => second.close());
  await callFreePageChange(second.base, unchangedPayload());
  const restarted = await freeOutcomeSummary(second);
  for (const transport of ["http", "mcp"]) {
    assert.ok(restarted.freePageChange.transports[transport].captureStartedAt > initial.freePageChange.transports[transport].captureStartedAt);
    assert.equal(restarted.freePageChange.transports[transport].requestedWindowComplete, false);
  }
  assert.equal(restarted.freePageChange.transports.http.byOutcome.unchanged, 1);
  assert.equal(restarted.freePageChange.transports.mcp.byOutcome.unchanged, 2);
  await second.close();
  const disabled = await startMerchant({ dataDir, extraEnv: { PAGE_CHANGE_HTTP_ENABLED: "0" } });
  t.after(() => disabled.close());
  assert.equal((await postJson(disabled.base, unchangedPayload())).response.status, 404);
  const unmeasured = await freeOutcomeSummary(disabled);
  for (const transport of ["http", "mcp"]) {
    assert.equal(unmeasured.freePageChange.transports[transport].captureStartedAt, null);
    assert.equal(unmeasured.freePageChange.transports[transport].coverage, "unmeasured");
  }
  assert.equal(unmeasured.freePageChange.transports.http.byOutcome.unchanged, 1);
});

test("mounted parser, graph, rate and capacity limits are refusals, while unselected MCP parser failures remain unattributed", { timeout: 60_000 }, async t => {
  const merchant = await startMerchant({ extraEnv: { PAGE_CHANGE_HTTP_ENABLED: "1", PAGE_CHANGE_HTTP_MAX_CONCURRENT: "1" } });
  t.after(() => merchant.close());
  let nested = {};
  for (let n = 0; n < 25; n++) nested = { child: nested };
  const input = { ...unchangedPayload(), before: nested };
  assert.equal((await postJson(merchant.base, input)).json.code, "json_depth_limit");
  assert.equal((await callFreePageChange(merchant.base, input)).body.result.isError, true);
  const stream = streamRequest(merchant.base);
  t.after(() => stream.request.destroy());
  stream.request.write("{");
  await delay(80);
  assert.equal((await postJson(merchant.base, unchangedPayload())).response.status, 503);
  stream.request.destroy();
  await delay(80);
  // Existing rate ceiling is 12: invalid inputs consume admission too.
  for (let n = 0; n < 9; n++) assert.equal((await postJson(merchant.base, {})).response.status, 400);
  assert.equal((await postJson(merchant.base, unchangedPayload())).response.status, 429);
  const before = await freeOutcomeSummary(merchant);
  assert.equal(before.freePageChange.transports.http.byOutcome.refused, 12);
  assert.equal(before.freePageChange.transports.http.byOutcome.aborted, 1);
  const mcpHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const malformed = await fetch(`${merchant.base}/mcp`, { method: "POST", headers: mcpHeaders, body: "{private-mcp-parser-marker" });
  assert.equal(malformed.status, 400);
  const overlimit = await fetch(`${merchant.base}/mcp`, { method: "POST", headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "page_change", arguments: { pad: "a".repeat(MCP_JSON_RPC_MAX_BYTES) } } }) });
  assert.equal((await overlimit.json()).error.message, "mcp_json_rpc_too_large");
  const invalidRpc = await fetch(`${merchant.base}/mcp`, { method: "POST", headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: "0.1", id: 5, method: "tools/call", params: { name: "page_change", arguments: unchangedPayload() } }) });
  assert.equal(invalidRpc.status, 400);
  const after = await freeOutcomeSummary(merchant);
  assert.equal(after.freePageChange.transports.mcp.observations, before.freePageChange.transports.mcp.observations);
  assert.equal(after.freePageChange.transports.mcp.byOutcome.refused, 1);
  assert.equal(after.freePageChange.transports.mcp.byOutcome.changed, 0);
  assert.equal(after.freePageChange.transports.mcp.scope, "parsed_page_change_tools_call");
});

test("canonical journal failure cannot change mounted HTTP or MCP free delivery", { timeout: 60_000 }, async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "root2131-journal-failure-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await writeFile(path.join(dataDir, "commerce-events.ndjson"), "");
  await link(path.join(dataDir, "commerce-events.ndjson"), path.join(dataDir, "unsafe-hardlink"));
  const merchant = await startMerchant({ dataDir, extraEnv: { PAGE_CHANGE_HTTP_ENABLED: "1" } });
  t.after(() => merchant.close());
  const http = await postJson(merchant.base, unchangedPayload()).catch(error => { throw new Error(`${error.message}: ${merchant.output()}`); });
  assert.equal(http.response.status, 200);
  assert.equal(http.json.report.verdict, "unchanged");
  assert.equal(http.json.charged, false);
  const mcp = await callFreePageChange(merchant.base, unchangedPayload());
  assert.notEqual(mcp.body.result.isError, true);
  assert.equal(JSON.parse(mcp.body.result.content[0].text).charged, false);
  const summary = await freeOutcomeSummary(merchant);
  for (const transport of ["http", "mcp"]) {
    assert.equal(summary.freePageChange.transports[transport].coverage, "unmeasured");
    assert.equal(summary.freePageChange.transports[transport].observations, 0);
  }
});
