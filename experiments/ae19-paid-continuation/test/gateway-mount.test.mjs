import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { startExtractionServer } from "../extraction-contract/http.mjs";
import { SCHEMA } from "../extraction-contract/store.mjs";
import { delay, ensureMerchantModules, htmlResponse, repoRoot, withService, writerRoot } from "../support/helpers.mjs";

const exec = promisify(execFile);
const GATEWAY_PIN = "7e5078bbf213ae3d1ff8d4638199ff8d1d1d81a8";
const ASYNC_PIN = "1b5fd425408d34be232cd1c2ce059d3571b56c63";
const GATEWAY_REPO = "/home/ubuntu/root-sol-window100337/240200/source";
const NEO = "/home/ubuntu/root-sol-window100337/232600/neo";
const FORBIDDEN_OLDER = "728f27ec";
const ALLOWED = `j${"0".repeat(32)}`;
const ACTOR = { tenantId: "tenant-a", actorId: "later-a", role: "later-consumer" };

function archivePackage(dir) {
  return new Promise((resolve, reject) => {
    const git = spawn("git", ["-C", NEO, "archive", ASYNC_PIN, "packages/journey-x402-async"], { stdio: ["ignore", "pipe", "pipe"] });
    const tar = spawn("tar", ["-C", dir, "-x"], { stdio: ["pipe", "ignore", "pipe"] });
    let gitCode = null;
    let tarCode = null;
    let settled = false;
    const finish = () => {
      if (settled || gitCode === null || tarCode === null) return;
      settled = true;
      if (gitCode !== 0 || tarCode !== 0) reject(new Error(`archive git=${gitCode} tar=${tarCode}`));
      else resolve(join(dir, "packages/journey-x402-async"));
    };
    git.stdout.pipe(tar.stdin);
    git.on("close", (code) => { gitCode = code; finish(); });
    tar.on("close", (code) => { tarCode = code; finish(); });
    git.on("error", reject);
    tar.on("error", reject);
  });
}

async function pinBlob(repo, spec) {
  const { stdout } = await exec("git", ["-C", repo, "rev-parse", spec]);
  return stdout.trim();
}

test("gateway pin is 7e5078bb and 242007 is mounted from 1b5fd425", async () => {
  assert.equal(await pinBlob(GATEWAY_REPO, "HEAD"), GATEWAY_PIN);
  assert.equal(GATEWAY_PIN.startsWith(FORBIDDEN_OLDER), false);
  const index = join(GATEWAY_REPO, "services/machine-gateway/src/index.mjs");
  assert.equal(await pinBlob(GATEWAY_REPO, `${GATEWAY_PIN}:services/machine-gateway/src/index.mjs`), (await exec("git", ["hash-object", index])).stdout.trim());
  assert.equal(await pinBlob(NEO, ASYNC_PIN), ASYNC_PIN);
  const before = await pinBlob(NEO, `${ASYNC_PIN}:packages/journey-x402-async/src/e08-client.mjs`);
  assert.match(before, /^[a-f0-9]{40}$/);
});

async function loadGateway() {
  const root = join(GATEWAY_REPO, "services/machine-gateway/src");
  const gateway = await import(pathToFileURL(join(root, "index.mjs")).href);
  const errors = await import(pathToFileURL(join(root, "errors.mjs")).href);
  const util = await import(pathToFileURL(join(root, "util.mjs")).href);
  return { ...gateway, GatewayError: errors.GatewayError, sha256: util.sha256 };
}

async function mount(t, routes) {
  const { SqliteStore, RouteRegistry, MachineGateway, createGatewayServer, GatewayError, sha256 } = await loadGateway();
  const dir = await mkdtemp(join(tmpdir(), "ae19-gw-"));
  const store = new SqliteStore(join(dir, "machine-gateway.sqlite"));
  const registry = new RouteRegistry(routes);
  const token = "local_unsigned_tenant_a_credential_000001";
  const gateway = new MachineGateway({
    store,
    registry,
    tenants: [{
      id: "tenant-a",
      tokenSha256: sha256(token),
      routes: registry.list().map((route) => route.id),
      maxUnits: 100,
      maxCalls: 1000,
      maxConcurrent: 4,
    }],
    environment: "test",
    paymentsEnabled: false,
  });
  const server = createGatewayServer(gateway);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  let n = 0;
  async function call(path, { body, key } = {}) {
    const response = await fetch(`${origin}${gateway.prefix}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, replay: response.headers.get("idempotency-replayed"), body: await response.json() };
  }
  async function execute(routeId, input, key = `ae19-exec-${String(++n).padStart(8, "0")}`) {
    const quote = await call("/v1/quote", { body: { routeId, input } });
    if (quote.status !== 200) return { quote, status: quote.status, body: quote.body };
    const ran = await call("/v1/execute", { body: { quoteId: quote.body.quoteId, input, maxUnits: 0 }, key });
    return { ...ran, quoteId: quote.body.quoteId, input };
  }
  return { call, execute, GatewayError };
}

function clientOptions(extra = {}) {
  return {
    origin: "https://127.0.0.1:9",
    ca: Buffer.from("local-test-ca"),
    actor: ACTOR,
    mode: "test",
    timeoutMs: 4000,
    ...extra,
  };
}

test("unpatched 242007 submit through the pinned gateway stays the extraction gap", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ae19-async-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = await archivePackage(dir);
  const before = (await exec("git", ["-C", NEO, "rev-parse", `${ASYNC_PIN}:packages/journey-x402-async/src/e08-client.mjs`])).stdout.trim();
  const { createE08Client, SUBMIT_GAP } = await import(pathToFileURL(join(root, "src/e08-client.mjs")).href);
  const { createAsyncProviders } = await import(pathToFileURL(join(root, "adapters/gateway-240200/index.mjs")).href);
  const client = createE08Client(clientOptions());
  await assert.rejects(() => client.submit({ url: "https://example.com/" }), (error) => error.code === SUBMIT_GAP);
  const { GatewayError } = await loadGateway();
  const gateway = await mount(t, createAsyncProviders({
    client,
    allowedJobIds: [ALLOWED],
    gatewayError: (code, status) => new GatewayError(code, status),
  }));
  const fixture = await gateway.call("/v1/test", { body: { routeId: "e08.async.submit" } });
  assert.equal(fixture.body.output.gap, SUBMIT_GAP);
  const ran = await gateway.execute("e08.async.submit", { url: "https://example.com/" }, "unpatched-submit-01");
  assert.equal(ran.status, 200);
  assert.equal(ran.body.status, "failed");
  assert.equal(ran.body.error.code, SUBMIT_GAP);
  assert.equal(ran.body.output, null);
  const after = (await exec("git", ["-C", NEO, "rev-parse", `${ASYNC_PIN}:packages/journey-x402-async/src/e08-client.mjs`])).stdout.trim();
  assert.equal(after, before);
});

test("a real URL through patched 242007 returns an extraction readable by job id", { timeout: 90_000 }, async (t) => {
  await ensureMerchantModules();
  const dir = await mkdtemp(join(tmpdir(), "ae19-async-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = await archivePackage(dir);
  await exec("patch", ["-p1", "--forward", "--input", join(writerRoot, "proposed/242007-extraction-submit.patch")], { cwd: root });
  const { createE08Client } = await import(pathToFileURL(join(root, "src/e08-client.mjs")).href);
  const { createAsyncProviders } = await import(pathToFileURL(join(root, "adapters/gateway-240200/index.mjs")).href);
  const { pool, service } = await withService(t);
  const http = await startExtractionServer({ service });
  t.after(() => http.close());
  const { GatewayError } = await loadGateway();
  const client = createE08Client(clientOptions({ extractionOrigin: http.origin }));
  const providers = createAsyncProviders({
    client,
    allowedJobIds: [ALLOWED],
    gatewayError: (code, status) => new GatewayError(code, status),
    timeoutMs: 10_000,
  });
  const gateway = await mount(t, providers);
  const fixture = await gateway.call("/v1/test", { body: { routeId: "e08.async.submit" } });
  assert.equal(fixture.body.output.gap, "e08_extraction_submit_pending_join");

  const blocked = await gateway.execute("e08.async.submit", { url: "http://127.0.0.1/private" }, "nofit-submit-key01");
  assert.equal(blocked.body.status, "completed", JSON.stringify(blocked.body));
  assert.equal(blocked.body.output.gap, null);
  assert.equal(blocked.body.output.paymentAttempts, 0);
  assert.equal(blocked.body.output.newPayment, false);
  assert.equal(blocked.body.output.paymentCompleted, false);
  assert.equal(blocked.body.output.qualification, "pending-join");
  assert.equal(blocked.body.output.artifact.kind, "no_fit");
  assert.equal(JSON.parse(blocked.body.output.artifact.body).reason, "ssrf_blocked");
  const blockedRow = await pool.query(`SELECT attempts, payment_attempts, fetch_mode FROM ${SCHEMA}.extraction_job WHERE job_id = $1`, [blocked.body.output.jobId]);
  assert.equal(blockedRow.rows[0].attempts, 0);
  assert.equal(blockedRow.rows[0].payment_attempts, 0);
  assert.equal(blockedRow.rows[0].fetch_mode, "none");

  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input) => htmlResponse(
    String(input),
    "<html><head><title>Hooked</title></head><body><p>hook</p></body></html>",
  );
  t.after(() => { delete globalThis.__SAMEDAYDESK_EXTRACT_FETCH__; });
  const synthetic = await gateway.execute("e08.async.submit", { url: "https://ok.example/" }, "synthetic-submit-01");
  assert.equal(synthetic.body.status, "completed", JSON.stringify(synthetic.body));
  assert.equal(synthetic.body.output.gap, null);
  assert.match(synthetic.body.output.jobId, /^j[a-f0-9]{32}$/);
  const replay = await gateway.call("/v1/execute", {
    body: { quoteId: synthetic.quoteId, input: synthetic.input, maxUnits: 0 },
    key: "synthetic-submit-01",
  });
  assert.equal(replay.replay, "true");
  assert.equal(replay.body.id, synthetic.body.id);
  const syntheticCount = await pool.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.extraction_job`);
  assert.equal(syntheticCount.rows[0].n, 2);

  async function poll(jobId) {
    for (let i = 0; i < 40; i += 1) {
      const receipt = await gateway.execute("e08.async.poll", { jobId }, `poll-${jobId.slice(1, 9)}-${String(i).padStart(4, "0")}`);
      assert.equal(receipt.body.status, "completed", JSON.stringify(receipt.body.error || receipt.body));
      if (receipt.body.output.resultReady || receipt.body.output.completion === "failed") return receipt.body;
      await delay(250);
    }
    throw new Error(`job ${jobId} did not finish`);
  }
  const syntheticReady = await poll(synthetic.body.output.jobId);
  assert.equal(syntheticReady.output.gap, null);
  assert.equal(syntheticReady.output.state, "output_ready");
  assert.equal(JSON.parse(syntheticReady.output.artifact.body).title, "Hooked");
  const result = await gateway.execute("e08.async.result", { jobId: synthetic.body.output.jobId }, "synthetic-result-0001");
  assert.equal(result.body.output.artifact.digest, syntheticReady.output.artifact.digest);
  assert.equal(result.body.output.paymentCompleted, false);
  const reread = await gateway.call(`/v1/receipts/${result.body.id}`);
  assert.equal(reread.body.output.jobId, synthetic.body.output.jobId);
  assert.equal(reread.body.output.gap, null);
  const stored = await pool.query(
    `SELECT result_bytes, result_digest, artifact_digest, fetch_mode, payment_attempts FROM ${SCHEMA}.extraction_job WHERE job_id = $1`,
    [synthetic.body.output.jobId],
  );
  assert.equal(createHash("sha256").update(stored.rows[0].result_bytes).digest("hex"), stored.rows[0].result_digest);
  assert.equal(stored.rows[0].artifact_digest, syntheticReady.output.artifact.digest);
  assert.equal(stored.rows[0].fetch_mode, "injected");
  assert.equal(stored.rows[0].payment_attempts, 0);
  assert.equal(JSON.parse(stored.rows[0].result_bytes.toString("utf8")).title, "Hooked");

  delete globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
  const live = await gateway.execute("e08.async.submit", { url: "https://example.com/" }, "example-submit-0001");
  assert.equal(live.body.status, "completed", JSON.stringify(live.body));
  assert.equal(live.body.output.gap, null);
  const liveReady = await poll(live.body.output.jobId);
  assert.equal(liveReady.output.completion, "ready", JSON.stringify(liveReady.output));
  assert.equal(liveReady.output.gap, null);
  assert.equal(JSON.parse(liveReady.output.artifact.body).title, "Example Domain");
  const liveRow = await pool.query(
    `SELECT result_bytes, result_digest, fetch_mode, attempts, payment_attempts FROM ${SCHEMA}.extraction_job WHERE job_id = $1`,
    [live.body.output.jobId],
  );
  assert.equal(createHash("sha256").update(liveRow.rows[0].result_bytes).digest("hex"), liveRow.rows[0].result_digest);
  assert.equal(liveRow.rows[0].fetch_mode, "merchant-public-fetch");
  assert.equal(liveRow.rows[0].attempts, 1);
  assert.equal(liveRow.rows[0].payment_attempts, 0);
  const parsed = JSON.parse(liveRow.rows[0].result_bytes.toString("utf8"));
  assert.equal(parsed.title, "Example Domain");
  assert.equal(parsed.status, 200);
  assert.equal(parsed.requestedUrl, "https://example.com/");
  const liveReceipt = await gateway.call(`/v1/receipts/${live.body.id}`);
  assert.equal(liveReceipt.body.output.jobId, live.body.output.jobId);
  assert.equal(liveReceipt.body.error, null);

  const missing = await gateway.execute("e08.async.poll", { jobId: `j${"ab".repeat(16)}` }, "missing-job-key-0001");
  assert.equal(missing.body.status, "failed");
  assert.equal(missing.body.error.code, "e08_job_forbidden");
  const fallthrough = await gateway.execute("e08.async.poll", { jobId: ALLOWED }, "allowlisted-gap-0001");
  assert.equal(fallthrough.body.status, "failed");
  assert.equal(fallthrough.body.error.code, "e08_readback_failed");
  assert.equal((await exec("git", ["-C", repoRoot, "status", "--porcelain", "server.js", "experiments/ae14-async-delivery"])).stdout, "");
});
