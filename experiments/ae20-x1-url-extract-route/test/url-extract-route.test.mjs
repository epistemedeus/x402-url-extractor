import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { promisify } from "node:util";
import pg from "pg";
import { digestBytes } from "../../ae19-paid-continuation/extraction-contract/digest.mjs";
import { startExtractionServer } from "../../ae19-paid-continuation/extraction-contract/http.mjs";
import { SCHEMA } from "../../ae19-paid-continuation/extraction-contract/store.mjs";
import { htmlResponse, withService } from "../../ae19-paid-continuation/support/helpers.mjs";
import { cannedExtract } from "../../ae19-paid-continuation/support/helpers.mjs";
import {
  AJV_MODULES,
  ASYNC_PIN,
  GATEWAY_667,
  GATEWAY_7E,
  NEO,
  TOKEN,
  listenGateway,
  materializeGateway,
} from "../support/gateway.mjs";

const exec = promisify(execFile);
const writerRoot = join(import.meta.dirname, "..");
const patchFile = join(writerRoot, "proposed/gateway-url-extract.patch");
const sourceRoutes = join(writerRoot, "gateway/url-extract-routes.mjs");
const TENANT = "tenant-a";
const ACTOR = "url-extract";
const JOB = `${SCHEMA}.extraction_job`;
const ROUTES = ["url.extract.submit", "url.extract.poll", "url.extract.result"];

const patched = await materializeGateway(GATEWAY_667, { patchFile });
after(async () => {
  await rm(patched.root, { recursive: true, force: true });
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function bind(service) {
  return { service, tenantId: TENANT, actorId: ACTOR, schema: SCHEMA };
}

async function mounted(t, service) {
  return listenGateway(t, patched.gateway, bind(service));
}

async function row(pool, jobId) {
  const { rows } = await pool.query(
    `SELECT attempts, payment_attempts, fetch_mode, result_bytes, result_digest, state FROM ${JOB} WHERE job_id = $1`,
    [jobId],
  );
  return rows[0];
}

async function countJobs(pool) {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${JOB}`);
  return rows[0].n;
}

function assertFreeReceipt(body) {
  assert.equal(body.price.amount, 0);
  assert.equal(body.payment.state, "not_required");
  assert.equal(body.payment.evidence, "none");
  assert.equal(body.payment.adapter, null);
  assert.equal(body.payment.reference, null);
  assert.equal(body.payment.network, null);
}

test("gateway patch matches the provider source and openapi stays in sync", async () => {
  const patchedSource = readFileSync(join(patched.gateway, "src/url-extract-routes.mjs"), "utf8");
  assert.equal(patchedSource, readFileSync(sourceRoutes, "utf8"));
  const openapi = JSON.parse(readFileSync(join(patched.gateway, "openapi.json"), "utf8"));
  assert.match(JSON.stringify(openapi), /url[._-]?extract/i);
  for (const id of ROUTES) {
    for (const side of ["input", "output"]) {
      assert.ok(openapi.paths[`/v1/routes/${id}/${side}.schema.json`], id + side);
    }
  }
  const { stdout } = await exec(process.execPath, ["bin/check.mjs"], { cwd: patched.gateway });
  assert.match(stdout, /checked/);
});

test("the same gateway patch applies on 7e5078bb", async (t) => {
  const copy = await materializeGateway(GATEWAY_7E, { patchFile });
  t.after(() => rm(copy.root, { recursive: true, force: true }));
  const openapi = JSON.parse(readFileSync(join(copy.gateway, "openapi.json"), "utf8"));
  assert.match(JSON.stringify(openapi), /url[._-]?extract/i);
  const { stdout } = await exec(process.execPath, ["bin/check.mjs"], { cwd: copy.gateway });
  assert.match(stdout, /checked/);
  assert.equal(readFileSync(join(copy.gateway, "src/providers.mjs"), "utf8").includes("urlExtractRoutes"), true);
});

test("JOB_ID matches the 242007 pin and G4's async patch is unchanged", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ae20-x1-async-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await exec("bash", ["-c", "git -C \"$1\" archive \"$2\" packages/journey-x402-async | tar -C \"$3\" -x", "bash", NEO, ASYNC_PIN, dir]);
  const pinned = await import(pathToFileURL(join(dir, "packages/journey-x402-async/src/e08-client.mjs")).href);
  const local = await import(pathToFileURL(join(patched.gateway, "src/url-extract-routes.mjs")).href);
  assert.equal(local.JOB_ID.source, pinned.JOB_ID.source);
  assert.equal(local.JOB_ID.flags, pinned.JOB_ID.flags);
  const g4Patch = "experiments/ae19-paid-continuation/proposed/242007-extraction-submit.patch";
  const committed = await exec("git", ["-C", join(writerRoot, "../.."), "show", `6dd7a040f80f3e3ce1d914383172721751de59a2:${g4Patch}`]);
  const working = readFileSync(join(writerRoot, "../..", g4Patch));
  assert.equal(sha256(working), sha256(committed.stdout));
  assert.equal(AJV_MODULES.endsWith("/node_modules"), true);
});

test("discovery lists url.extract schema paths when the patch is mounted", async (t) => {
  const { service } = await withService(t);
  const gateway = await mounted(t, service);
  const discovered = await gateway.call("/v1/discover");
  assert.equal(discovered.status, 200);
  assert.equal(discovered.body.paymentsEnabled, false);
  const byId = new Map(discovered.body.routes.map((route) => [route.id, route]));
  for (const id of ROUTES) {
    const route = byId.get(id);
    assert.ok(route, id);
    assert.equal(route.price.amount, 0);
    assert.equal(route.executable, true);
    assert.equal(route.inputSchemaPath, `${gateway.prefix}/v1/routes/${id}/input.schema.json`);
    assert.equal(route.outputSchemaPath, `${gateway.prefix}/v1/routes/${id}/output.schema.json`);
    const input = await gateway.call(`/v1/routes/${id}/input.schema.json`);
    const output = await gateway.call(`/v1/routes/${id}/output.schema.json`);
    assert.equal(input.status, 200);
    assert.equal(output.status, 200);
    assert.equal(input.body.additionalProperties, false);
    assert.equal(output.body.additionalProperties, false);
  }
  assert.equal(discovered.body.routes.some((route) => route.id === "lockfile.delta"), true);
  assert.equal(discovered.body.routes.some((route) => route.id === "http.capture"), true);
});

test("T5 injected public fetch returns a job id, stored fields, and a stable digest", async (t) => {
  const { service, pool } = await withService(t);
  let calls = 0;
  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input) => {
    calls += 1;
    return htmlResponse(String(input), "<html><head><title>Hooked</title></head><body><p>hook</p></body></html>");
  };
  t.after(() => { delete globalThis.__SAMEDAYDESK_EXTRACT_FETCH__; });
  const gateway = await mounted(t, service);
  const url = "https://ok.example/hooked";
  const submitted = await gateway.execute("url.extract.submit", {
    url,
    idempotencyKey: "t5-submit-key-0001",
  }, "t5-gateway-key-0001");
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.status, "completed", JSON.stringify(submitted.body));
  assertFreeReceipt(submitted.body);
  const jobId = submitted.body.output.jobId;
  assert.match(jobId, /^j[a-f0-9]{32}$/);
  assert.equal(submitted.body.output.paymentAttempts, 0);
  assert.equal(submitted.body.output.newPayment, false);
  const read = await gateway.execute("url.extract.result", { jobId }, "t5-result-key-00001");
  assert.equal(read.status, 200);
  assert.equal(read.body.status, "completed", JSON.stringify(read.body));
  assert.equal(read.body.output.title, "Hooked");
  assert.equal(read.body.output.status, 200);
  assert.equal(read.body.output.requestedUrl, url);
  assert.equal(read.body.output.fetch_mode, "injected");
  assert.equal(read.body.output.completion, "ready");
  assert.equal(read.body.output.state, "ready");
  assert.match(read.body.output.digest, /^[a-f0-9]{64}$/);
  const again = await gateway.execute("url.extract.result", { jobId }, "t5-result-key-00002");
  assert.equal(again.body.output.digest, read.body.output.digest);
  const stored = await row(pool, jobId);
  assert.equal(digestBytes(stored.result_bytes), stored.result_digest);
  assert.equal(stored.result_digest, read.body.output.digest);
  assert.equal(sha256(stored.result_bytes), stored.result_digest);
  assert.equal(JSON.parse(stored.result_bytes.toString("utf8")).title, "Hooked");
  assert.equal(calls, 1);
  assert.equal(stored.payment_attempts, 0);
  const polled = await gateway.execute("url.extract.poll", { jobId }, "t5-poll-key-000001");
  assert.equal(polled.body.output.digest, read.body.output.digest);
  assert.equal(polled.body.output.title, "Hooked");
  assert.equal(calls, 1);
});

test("T6 private loopback is no_fit ssrf_blocked with zero attempts", async (t) => {
  const { service, pool } = await withService(t);
  let calls = 0;
  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async () => {
    calls += 1;
    throw new Error("fetched");
  };
  t.after(() => { delete globalThis.__SAMEDAYDESK_EXTRACT_FETCH__; });
  const gateway = await mounted(t, service);
  const blocked = await gateway.execute("url.extract.submit", {
    url: "http://127.0.0.1/private",
    idempotencyKey: "t6-nofit-key-0001",
  }, "t6-gateway-key-0001");
  assert.equal(blocked.body.status, "completed", JSON.stringify(blocked.body));
  assert.equal(blocked.body.output.state, "no_fit");
  assert.equal(blocked.body.output.reason, "ssrf_blocked");
  assert.equal(blocked.body.output.status, "ready");
  assert.equal(blocked.body.output.completion, "ready");
  assert.equal(blocked.body.output.attempts, 0);
  assert.equal(blocked.body.output.paymentAttempts, 0);
  assert.equal(blocked.body.output.newPayment, false);
  assert.match(blocked.body.output.digest, /^[a-f0-9]{64}$/);
  assertFreeReceipt(blocked.body);
  const stored = await row(pool, blocked.body.output.jobId);
  assert.equal(stored.attempts, 0);
  assert.equal(stored.payment_attempts, 0);
  assert.equal(stored.fetch_mode, "none");
  assert.equal(stored.state, "no_fit");
  assert.equal(calls, 0);
  assert.equal(await countJobs(pool), 1);
});

test("T7 a lost submit body retries onto the same job and one extraction", async (t) => {
  const { service, pool } = await withService(t);
  let calls = 0;
  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input) => {
    calls += 1;
    return htmlResponse(String(input), "<html><head><title>Kept</title></head><body><p>kept</p></body></html>");
  };
  t.after(() => { delete globalThis.__SAMEDAYDESK_EXTRACT_FETCH__; });
  const gateway = await mounted(t, service);
  const input = { url: "https://ok.example/kept", idempotencyKey: "t7-lost-body-key" };
  const first = await gateway.call("/v1/quote", { body: { routeId: "url.extract.submit", input } });
  assert.equal(first.status, 200);
  const posted = await fetch(`${gateway.origin}${gateway.prefix}/v1/execute`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "idempotency-key": "t7-gateway-lost-0001",
    },
    body: JSON.stringify({ quoteId: first.body.quoteId, input, maxUnits: 0 }),
  });
  assert.equal(posted.status, 200);
  await posted.body.cancel();
  const secondQuote = await gateway.quote("url.extract.submit", input);
  const second = await gateway.call("/v1/execute", {
    body: { quoteId: secondQuote.body.quoteId, input, maxUnits: 0 },
    key: "t7-gateway-lost-0002",
  });
  assert.equal(second.replay, "false");
  assert.equal(second.body.status, "completed", JSON.stringify(second.body));
  const jobId = second.body.output.jobId;
  assert.match(jobId, /^j[a-f0-9]{32}$/);
  const result = await gateway.execute("url.extract.result", { jobId }, "t7-result-key-00001");
  assert.equal(result.body.output.title, "Kept");
  assert.equal(result.body.output.completion, "ready");
  assert.equal(await countJobs(pool), 1);
  assert.equal(calls, 1);
  const conflict = await gateway.execute("url.extract.submit", {
    url: "https://other.example/kept",
    idempotencyKey: input.idempotencyKey,
  }, "t7-gateway-conflict01");
  assert.equal(conflict.body.status, "failed");
  assert.equal(conflict.body.error.code, "idempotency_conflict");
  assert.equal(await countJobs(pool), 1);
  assert.equal(calls, 1);
});

test("T8 unknown well-formed job id is forbidden after a 404 and a malformed id is 400", async (t) => {
  const { service } = await withService(t);
  const http = await startExtractionServer({ service });
  t.after(() => http.close());
  const gateway = await mounted(t, service);
  const unknownId = `j${"ab".repeat(16)}`;
  const missed = await fetch(`${http.origin}/v1/extractions/${unknownId}?tenantId=${TENANT}`);
  assert.equal(missed.status, 404);
  const missBody = await missed.json();
  assert.equal(missBody.code, "job_absent");
  const forbidden = await gateway.execute("url.extract.result", { jobId: unknownId }, "t8-unknown-key-0001");
  assert.equal(forbidden.status, 200);
  assert.equal(forbidden.body.status, "failed");
  assert.equal(forbidden.body.error.code, "e08_job_forbidden");
  assert.equal(forbidden.body.output, null);
  const malformed = await gateway.quote("url.extract.poll", { jobId: "not-a-job" });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, "request_schema_invalid");
  const uppercase = await gateway.quote("url.extract.result", { jobId: `J${"ab".repeat(16)}` });
  assert.equal(uppercase.status, 400);
  assert.equal(uppercase.body.error.code, "request_schema_invalid");
});

test("T9 tampered stored bytes are digest_mismatch and verdict unknown", async (t) => {
  const { service, pool } = await withService(t, { extract: cannedExtract("Before tamper") });
  const gateway = await mounted(t, service);
  const submitted = await gateway.execute("url.extract.submit", {
    url: "https://ok.example/tamper",
    idempotencyKey: "t9-tamper-key-001",
  }, "t9-gateway-key-0001");
  const jobId = submitted.body.output.jobId;
  const ready = await gateway.execute("url.extract.result", { jobId }, "t9-result-key-00001");
  assert.equal(ready.body.output.state, "ready");
  const digest = ready.body.output.digest;
  assert.match(digest, /^[a-f0-9]{64}$/);
  await pool.query(`UPDATE ${JOB} SET result_bytes = $2 WHERE job_id = $1`, [jobId, Buffer.from("tampered")]);
  const tampered = await gateway.execute("url.extract.result", { jobId }, "t9-result-key-00002");
  assert.equal(tampered.body.status, "completed", JSON.stringify(tampered.body));
  assert.equal(tampered.body.output.code, "digest_mismatch");
  assert.equal(tampered.body.output.verdict, "unknown");
  assert.equal(tampered.body.output.state, "unknown");
  assert.equal(tampered.body.output.digest, null);
  assert.equal(tampered.body.output.paymentAttempts, 0);
  assert.notEqual(tampered.body.output.digest, digest);
  const direct = await service.read({ tenantId: TENANT, jobId });
  assert.equal(direct.ok, false);
  assert.equal(direct.code, "digest_mismatch");
  assert.equal(direct.state, "unknown");
});

test("T10 a new process and pool recover a leased job with the same id and digest", async (t) => {
  const { service, pool, name } = await withService(t, { extract: cannedExtract("After restart") });
  const gateway = await mounted(t, service);
  const submitted = await service.submit({
    tenantId: TENANT,
    actorId: ACTOR,
    url: "https://ok.example/restart",
    idempotencyKey: "t10-restart-key01",
  });
  const claimed = await service.claim();
  assert.equal(claimed.job_id, submitted.jobId);
  assert.equal(claimed.state, "running");
  await pool.query(`UPDATE ${JOB} SET lease_until = now() - interval '1 minute' WHERE job_id = $1`, [submitted.jobId]);
  const child = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(writerRoot, "bin/recover-leased.mjs")], {
      env: {
        PATH: process.env.PATH,
        USER: process.env.USER,
        LOGNAME: process.env.LOGNAME,
        HOME: process.env.HOME,
        AE20_X1_DATABASE: name,
        AE20_X1_JOB: submitted.jobId,
        AE20_X1_TENANT: TENANT,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk; });
    proc.stderr.on("data", (chunk) => { stderr += chunk; });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal(child.code, 0, child.stderr);
  const recovered = JSON.parse(child.stdout);
  assert.equal(recovered.recovered, 1);
  assert.equal(recovered.jobId, submitted.jobId);
  assert.equal(recovered.state, "ready");
  assert.match(recovered.digest, /^[a-f0-9]{64}$/);
  assert.equal(recovered.paymentAttempts, 0);
  const second = new pg.Pool({ host: "/var/run/postgresql", database: name, max: 2 });
  second.on("error", () => {});
  t.after(() => second.end());
  const restarted = new service.constructor({
    pool: second,
    merchantRoot: service.merchantRoot,
    extract: cannedExtract("After restart"),
  });
  const rebound = await listenGateway(t, patched.gateway, bind(restarted));
  const read = await rebound.execute("url.extract.result", { jobId: submitted.jobId }, "t10-result-key-0001");
  assert.equal(read.body.status, "completed", JSON.stringify(read.body));
  assert.equal(read.body.output.jobId, submitted.jobId);
  assert.equal(read.body.output.digest, recovered.digest);
  assert.equal(read.body.output.state, "ready");
  const again = await rebound.execute("url.extract.poll", { jobId: submitted.jobId }, "t10-poll-key-000001");
  assert.equal(again.body.output.digest, recovered.digest);
  const stored = await second.query(
    `SELECT result_bytes, result_digest, payment_attempts FROM ${JOB} WHERE job_id = $1`,
    [submitted.jobId],
  );
  assert.equal(digestBytes(stored.rows[0].result_bytes), stored.rows[0].result_digest);
  assert.equal(stored.rows[0].result_digest, recovered.digest);
  assert.equal(stored.rows[0].payment_attempts, 0);
  assert.equal(JSON.parse(stored.rows[0].result_bytes.toString("utf8")).title, "After restart");
});

test("T11 quote and test are price 0 with no capture and no payment fields", async (t) => {
  const { service, pool } = await withService(t);
  let calls = 0;
  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async () => {
    calls += 1;
    throw new Error("fetched");
  };
  t.after(() => { delete globalThis.__SAMEDAYDESK_EXTRACT_FETCH__; });
  const gateway = await mounted(t, service);
  const inputs = {
    "url.extract.submit": { url: "https://ok.example/quote", idempotencyKey: "t11-quote-key-0001" },
    "url.extract.poll": { jobId: `j${"cd".repeat(16)}` },
    "url.extract.result": { jobId: `j${"ef".repeat(16)}` },
  };
  for (const id of ROUTES) {
    const quoted = await gateway.quote(id, inputs[id]);
    assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
    assert.equal(quoted.body.price.amount, 0);
    assert.equal(quoted.body.price.unit, "usd-micros");
    assert.equal(quoted.body.requirements, null);
    assert.equal(Object.hasOwn(quoted.body, "payment"), false);
    assert.equal(quoted.body.executable, true);
    const fixture = await gateway.testRoute(id);
    assert.equal(fixture.status, 200, JSON.stringify(fixture.body));
    assert.equal(fixture.body.fixture, true);
    assert.equal(fixture.body.paymentAttempts, 0);
    assert.equal(Object.hasOwn(fixture.body, "payment"), false);
    assert.equal(fixture.body.output.paymentAttempts, 0);
    assert.equal(fixture.body.output.newPayment, false);
    assert.equal(Object.hasOwn(fixture.body.output, "payment"), false);
  }
  assert.equal(await countJobs(pool), 0);
  assert.equal(calls, 0);
  const privateQuote = await gateway.quote("url.extract.submit", {
    url: "http://127.0.0.1/private",
    idempotencyKey: "t11-private-quote1",
  });
  assert.equal(privateQuote.status, 200);
  assert.equal(privateQuote.body.price.amount, 0);
  assert.equal(await countJobs(pool), 0);
});
