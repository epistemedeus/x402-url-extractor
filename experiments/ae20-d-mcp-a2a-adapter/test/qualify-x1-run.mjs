import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { digestBytes } from "../../ae19-paid-continuation/extraction-contract/digest.mjs";
import { ExtractionService } from "../../ae19-paid-continuation/extraction-contract/service.mjs";
import { createDatabase, dropDatabase, migrate, SCHEMA } from "../../ae19-paid-continuation/extraction-contract/store.mjs";
import { PUBLISHED_LOCAL_UNSIGNED_TEST_CREDENTIAL } from "../src/config.mjs";
import { connectStdio, readTool, root, rpc, spawnNode, startA2a, stop, submitMessage } from "./support.mjs";

const exec = promisify(execFile);
const X1 = "79b5e55f82e3bed9eaaf694ffd74d591160f6616";
const GATEWAY = "667fba353e9082d8a0842437442dabc42843abf8";
const NEO = "/tmp/ae20-x1-pins/neo";
const AJV = "/tmp/242003-gateway-i9refh4z/services/machine-gateway/node_modules";
const TOKEN = PUBLISHED_LOCAL_UNSIGNED_TEST_CREDENTIAL;
const TENANT = "tenant-a";
const ACTOR = "url-extract";

const repo = join(root, "../..");
const temps = [];
let db = null;
let server = null;
let routes = null;

async function materialize() {
  const dir = await mkdtemp(join(tmpdir(), "ae20-d-x1-"));
  temps.push(dir);
  await exec("bash", ["-c", "git -C \"$1\" archive \"$2\" services/machine-gateway | tar -C \"$3\" -x", "bash", NEO, GATEWAY, dir]);
  const gateway = join(dir, "services/machine-gateway");
  const patchFile = join(dir, "gateway-url-extract.patch");
  const { stdout } = await exec("git", ["-C", repo, "show", `${X1}:experiments/ae20-x1-url-extract-route/proposed/gateway-url-extract.patch`]);
  await writeFile(patchFile, stdout);
  await exec("patch", ["-p1", "--forward", "--batch", `--input=${patchFile}`], { cwd: gateway });
  await symlink(AJV, join(gateway, "node_modules"), "dir");
  return gateway;
}

async function listenGateway(gateway, service) {
  const src = join(gateway, "src");
  const gatewayMod = await import(pathToFileURL(join(src, "index.mjs")).href);
  const util = await import(pathToFileURL(join(src, "util.mjs")).href);
  routes = await import(pathToFileURL(join(src, "url-extract-routes.mjs")).href);
  routes.bindUrlExtractService({ service, tenantId: TENANT, actorId: ACTOR, schema: SCHEMA });
  const stateDir = await mkdtemp(join(tmpdir(), "ae20-d-gwstate-"));
  temps.push(stateDir);
  const store = new gatewayMod.SqliteStore(join(stateDir, "machine-gateway.sqlite"));
  const registry = new gatewayMod.RouteRegistry(gatewayMod.builtinRoutes());
  const gatewayApp = new gatewayMod.MachineGateway({
    store,
    registry,
    tenants: [{
      id: TENANT,
      tokenSha256: util.sha256(TOKEN),
      routes: registry.list().map((route) => route.id),
      maxUnits: 100,
      maxCalls: 1000,
      maxConcurrent: 4,
    }],
    environment: "test",
    paymentsEnabled: false,
  });
  server = gatewayMod.createGatewayServer(gatewayApp);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { base: `${origin}${gatewayApp.prefix}`, store };
}

async function cleanup() {
  routes?.unbindUrlExtractService();
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  if (db) {
    await db.pool.end().catch(() => {});
    await dropDatabase(db.name).catch(() => {});
  }
  for (const dir of temps) await rm(dir, { recursive: true, force: true }).catch(() => {});
}

const ignore = { after() {} };
let mcp = null;
let a2a = null;
let store = null;

try {
  const head = (await exec("git", ["-C", repo, "rev-parse", "origin/codex/ae20-x1-url-extract-route"])).stdout.trim();
  const gatewayDir = await materialize();
  db = await createDatabase();
  await migrate(db.pool);
  const service = new ExtractionService({
    pool: db.pool,
    merchantRoot: repo,
    extract: async (url) => ({
      requestedUrl: url,
      finalUrl: url,
      status: 200,
      sourceOk: true,
      title: "X1 real",
      error: null,
    }),
  });
  const listened = await listenGateway(gatewayDir, service);
  store = listened.store;
  const { base } = listened;
  const quoted = await fetch(`${base}/v1/quote`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      routeId: "url.extract.submit",
      input: { url: "https://ok.example/ae20-d-quote", idempotencyKey: "d8-quote-only-0001" },
    }),
  });
  const quoteBody = await quoted.json();
  if (quoted.status !== 200 || quoteBody.price?.amount !== 0 || quoteBody.requirements != null || Object.hasOwn(quoteBody, "payment")) {
    throw new Error(`quote not free ${quoted.status} ${JSON.stringify(quoteBody)}`);
  }
  const beforeJobs = await db.pool.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.extraction_job`);
  if (beforeJobs.rows[0].n !== 0) throw new Error("quote created a job");

  mcp = await connectStdio(ignore, base);
  const submitted = readTool(await mcp.callTool({
    name: "url_extract_submit",
    arguments: { url: "https://ok.example/ae20-d-mcp", idempotencyKey: "d8-mcp-key-0001" },
  }));
  const jobId = submitted.structured?.jobId || submitted.envelope.output?.jobId;
  const status = readTool(await mcp.callTool({ name: "url_extract_status", arguments: { jobId } }));
  const result = readTool(await mcp.callTool({ name: "url_extract_result", arguments: { jobId } }));
  if (status.structured.jobId !== jobId || result.structured.jobId !== jobId) throw new Error("mcp job id changed");
  if (status.structured.digest !== result.structured.digest) throw new Error("mcp digest changed");
  if (!/^[a-f0-9]{64}$/.test(result.structured.digest)) throw new Error("mcp digest missing");
  const stored = await db.pool.query(
    `SELECT result_bytes, result_digest, payment_attempts FROM ${SCHEMA}.extraction_job WHERE job_id = $1`,
    [jobId],
  );
  const row = stored.rows[0];
  if (!row || digestBytes(row.result_bytes) !== row.result_digest || row.result_digest !== result.structured.digest) {
    throw new Error("mcp digest is not the stored sha256");
  }
  if (row.payment_attempts !== 0 || result.structured.paymentAttempts !== 0 || result.structured.newPayment !== false) {
    throw new Error("mcp payment field set");
  }
  if (submitted.envelope.httpAttempts.execute !== 1 || status.envelope.httpAttempts.execute !== 1 || result.envelope.httpAttempts.execute !== 1) {
    throw new Error("mcp retried");
  }

  a2a = await startA2a(ignore, base);
  const sent = await rpc(a2a.origin, "message/send", submitMessage("https://ok.example/ae20-d-a2a", "d8-a2a-key-0001", "d8"));
  const taskId = sent.body?.result?.task?.id;
  if (!taskId || taskId !== sent.body.result.task.metadata.jobId) throw new Error(`a2a task id ${taskId}`);
  const got = await rpc(a2a.origin, "tasks/get", { id: taskId });
  const artifact = got.body?.result?.artifacts?.[0]?.parts?.[0]?.data;
  if (got.body?.result?.status?.state !== "TASK_STATE_COMPLETED") throw new Error(`a2a state ${got.body?.result?.status?.state}`);
  if (got.body?.result?.id !== taskId) throw new Error("a2a id changed");
  const a2aRow = await db.pool.query(
    `SELECT result_bytes, result_digest, payment_attempts FROM ${SCHEMA}.extraction_job WHERE job_id = $1`,
    [taskId],
  );
  if (!a2aRow.rows[0] || digestBytes(a2aRow.rows[0].result_bytes) !== artifact?.digest || a2aRow.rows[0].payment_attempts !== 0) {
    throw new Error("a2a digest is not the stored sha256");
  }
  const report = {
    ok: true,
    x1Head: head,
    x1Pin: X1,
    gateway: GATEWAY,
    mcpJobId: jobId,
    mcpDigest: result.structured.digest,
    a2aTaskId: taskId,
    a2aDigest: artifact.digest,
    quoteAmount: quoteBody.price.amount,
    requirements: quoteBody.requirements,
    quoteHasPayment: Object.hasOwn(quoteBody, "payment"),
    paymentsEnabled: false,
  };
  process.stdout.write(`AE20_D_QUAL ${JSON.stringify(report)}\n`);
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  await mcp?.close().catch(() => {});
  await a2a?.close().catch(() => {});
  store?.close();
  await cleanup();
}
