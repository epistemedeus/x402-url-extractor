import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import test from "node:test";
import { createFiniteMonitor } from "../delivery/monitor.mjs";
import { digestBytes } from "../extraction-contract/digest.mjs";
import { startExtractionServer } from "../extraction-contract/http.mjs";
import { SCHEMA } from "../extraction-contract/store.mjs";
import { ACTOR, TENANT, cannedExtract, delay, htmlResponse, withService } from "../support/helpers.mjs";

const JOB = `${SCHEMA}.extraction_job`;

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("a free no-fit is retained and a fit does not fetch", async (t) => {
  let fetched = 0;
  const { service, pool } = await withService(t, {
    extract: async () => { fetched += 1; throw new Error("fetched"); },
  });
  const blocked = await service.fit({ tenantId: TENANT, url: "http://127.0.0.1/secret" });
  assert.equal(blocked.state, "no_fit");
  assert.equal(blocked.reason, "ssrf_blocked");
  assert.equal(blocked.paymentAttempts, 0);
  assert.equal(blocked.newPayment, false);
  assert.equal(blocked.artifact.kind, "no_fit");
  assert.equal(fetched, 0);
  const row = await pool.query(`SELECT result_bytes, result_digest, payment_attempts FROM ${JOB} WHERE job_id = $1`, [blocked.jobId]);
  assert.equal(sha(row.rows[0].result_bytes), row.rows[0].result_digest);
  assert.equal(row.rows[0].result_digest, blocked.resultDigest);
  assert.equal(row.rows[0].payment_attempts, 0);
  const again = await service.read({ tenantId: TENANT, jobId: blocked.jobId });
  assert.equal(again.resultDigest, blocked.resultDigest);
  assert.equal(await service.read({ tenantId: "tenant-b", jobId: blocked.jobId }), null);
  const passed = await service.fit({ tenantId: TENANT, url: "https://example.com/" });
  assert.equal(passed.state, "fit");
  assert.equal(passed.artifact, null);
  assert.equal(fetched, 0);
});

test("submit runs the extractor once, rereads after a lost body, and does not repurchase", async (t) => {
  const { service, pool } = await withService(t, { extract: cannedExtract("Kept") });
  const http = await startExtractionServer({ service });
  t.after(() => http.close());
  const key = "lost-body-key-01";
  const first = await fetch(`${http.origin}/v1/extractions`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ tenantId: TENANT, actorId: ACTOR, url: "https://ok.example/" }),
  });
  assert.equal(first.status, 202);
  await first.body.cancel();
  await service.pump();
  const second = await fetch(`${http.origin}/v1/extractions`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ tenantId: TENANT, actorId: ACTOR, url: "https://ok.example/" }),
  });
  const body = await second.json();
  assert.equal(body.state, "ready");
  assert.equal(body.artifact.kind, "repair");
  assert.equal(body.paymentAttempts, 0);
  const count = await pool.query(`SELECT count(*)::int AS n FROM ${JOB}`);
  assert.equal(count.rows[0].n, 1);
  const reread = await fetch(`${http.origin}/v1/extractions/${body.jobId}?tenantId=${TENANT}`);
  const stored = await reread.json();
  assert.equal(stored.resultDigest, body.resultDigest);
  const bytes = await pool.query(`SELECT result_bytes, result_digest, attempts FROM ${JOB} WHERE job_id = $1`, [body.jobId]);
  assert.equal(sha(bytes.rows[0].result_bytes), bytes.rows[0].result_digest);
  assert.equal(JSON.parse(bytes.rows[0].result_bytes.toString("utf8")).title, "Kept");
  assert.equal(bytes.rows[0].attempts, 1);
  const conflict = await fetch(`${http.origin}/v1/extractions`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ tenantId: TENANT, actorId: ACTOR, url: "https://other.example/" }),
  });
  assert.equal(conflict.status, 409);
  const deliveries = await service.pollDeliveries(TENANT);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].digest, body.resultDigest);
  const acked = await service.ackDelivery({ tenantId: TENANT, deliveryId: deliveries[0].deliveryId });
  assert.equal(acked.replayed, false);
  const replay = await service.ackDelivery({ tenantId: TENANT, deliveryId: deliveries[0].deliveryId });
  assert.equal(replay.replayed, true);
  assert.equal(replay.digest, body.resultDigest);
});

test("title acceptance no-fit is distinct from a repair", async (t) => {
  const { service } = await withService(t, { extract: cannedExtract("") });
  const job = await service.submit({
    tenantId: TENANT, actorId: ACTOR, url: "https://ok.example/", acceptance: { requireTitle: true },
  });
  await service.pump();
  const view = await service.read({ tenantId: TENANT, jobId: job.jobId });
  assert.equal(view.state, "no_fit");
  assert.equal(view.reason, "title_required");
  assert.equal(view.artifact.kind, "no_fit");
  assert.equal(view.paymentAttempts, 0);
});

test("abort and deadline do not call a finished extraction", async (t) => {
  let calls = 0;
  const { service } = await withService(t, {
    extract: async () => { calls += 1; return cannedExtract()(); },
  });
  const queued = await service.submit({ tenantId: TENANT, actorId: ACTOR, url: "https://ok.example/" });
  const aborted = await service.abort({ tenantId: TENANT, jobId: queued.jobId });
  assert.equal(aborted.aborted, true);
  await service.pump();
  assert.equal((await service.read({ tenantId: TENANT, jobId: queued.jobId })).state, "aborted");
  const timed = await service.submit({ tenantId: TENANT, actorId: ACTOR, url: "https://ok.example/", timeoutMs: 1 });
  await delay(10);
  await service.pump();
  const view = await service.read({ tenantId: TENANT, jobId: timed.jobId });
  assert.equal(view.state, "timed_out");
  assert.equal(view.reason, "deadline_exceeded");
  assert.equal(calls, 0);
});

test("a restarted service recovers a leased job from postgres", async (t) => {
  const { service, pool, name } = await withService(t, { extract: cannedExtract("After restart") });
  const job = await service.submit({ tenantId: TENANT, actorId: ACTOR, url: "https://ok.example/" });
  const claimed = await service.claim();
  assert.equal(claimed.job_id, job.jobId);
  assert.equal(claimed.state, "running");
  await pool.query(`UPDATE ${JOB} SET lease_until = now() - interval '1 minute' WHERE job_id = $1`, [job.jobId]);
  const secondPool = new pg.Pool({ host: "/var/run/postgresql", database: name, max: 2 });
  secondPool.on("error", () => {});
  t.after(() => secondPool.end());
  const restarted = new (service.constructor)({ pool: secondPool, merchantRoot: service.merchantRoot, extract: cannedExtract("After restart") });
  assert.equal(await restarted.recover(), 1);
  assert.equal((await restarted.read({ tenantId: TENANT, jobId: job.jobId })).state, "queued");
  await restarted.pump();
  const view = await restarted.read({ tenantId: TENANT, jobId: job.jobId });
  assert.equal(view.state, "ready");
  assert.equal(view.jobId, job.jobId);
  const bytes = await secondPool.query(`SELECT result_bytes, result_digest, payment_attempts FROM ${JOB} WHERE job_id = $1`, [job.jobId]);
  assert.equal(digestBytes(bytes.rows[0].result_bytes), bytes.rows[0].result_digest);
  assert.equal(JSON.parse(bytes.rows[0].result_bytes.toString("utf8")).title, "After restart");
  assert.equal(bytes.rows[0].payment_attempts, 0);
});

test("source change admits one bounded occurrence and a later need reads the stored digest", async (t) => {
  const { service, pool } = await withService(t, { extract: cannedExtract("Prior") });
  const monitor = createFiniteMonitor(service);
  assert.equal(monitor.schedulesCreated, 0);
  const base = "a".repeat(64);
  assert.equal((await monitor.note("source-a", base)).reason, "not_yet_due");
  assert.equal((await monitor.note("source-a", base)).reason, "not_yet_due");
  const changed = await monitor.note("source-a", "b".repeat(64));
  assert.equal(changed.applicable, true);
  assert.equal(changed.reason, "source_changed");
  assert.equal((await monitor.note("source-a", "c".repeat(64))).reason, "occurrence_open");
  const due = await monitor.due();
  assert.equal(due.length, 1);
  assert.equal(due[0].schedulesCreated, 0);
  await monitor.close("source-a");
  assert.equal((await monitor.note("source-a", "d".repeat(64))).reason, "source_changed");
  const job = await service.submit({ tenantId: TENANT, actorId: ACTOR, url: "https://ok.example/" });
  await service.pump();
  const view = await service.read({ tenantId: TENANT, jobId: job.jobId });
  const later = await service.measureLater({ tenantId: TENANT, priorJobId: job.jobId, laterTask: "later-task-1" });
  assert.equal(later.status, "measured");
  assert.equal(later.distinct, true);
  assert.equal(later.paymentAttempts, 0);
  assert.equal(later.priorDigest, view.resultDigest);
  const row = await pool.query(
    `SELECT prior_digest, payment_attempts FROM ${SCHEMA}.later_need WHERE continuation_id = $1`,
    [later.continuationId],
  );
  assert.equal(row.rows[0].prior_digest, view.resultDigest);
  assert.equal(row.rows[0].payment_attempts, 0);
  await pool.query(`UPDATE ${JOB} SET result_bytes = $2 WHERE job_id = $1`, [job.jobId, Buffer.from("tampered")]);
  const unknown = await service.read({ tenantId: TENANT, jobId: job.jobId });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "digest_mismatch");
  assert.equal(unknown.state, "unknown");
  const refused = await service.measureLater({ tenantId: TENANT, priorJobId: job.jobId, laterTask: "later-task-2" });
  assert.equal(refused.status, "unknown");
});

test("merchant extract runs through the public fetch hook and keeps fetch mode", async (t) => {
  const { service, pool } = await withService(t);
  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input) => htmlResponse(
    String(input),
    "<html><head><title>Hooked</title></head><body><p>hook</p></body></html>",
  );
  t.after(() => { delete globalThis.__SAMEDAYDESK_EXTRACT_FETCH__; });
  const job = await service.submit({ tenantId: TENANT, actorId: ACTOR, url: "https://ok.example/" });
  await service.pump();
  const view = await service.read({ tenantId: TENANT, jobId: job.jobId });
  assert.equal(view.state, "ready");
  assert.equal(view.fetchMode, "injected");
  const bytes = await pool.query(`SELECT result_bytes, result_digest, fetch_mode FROM ${JOB} WHERE job_id = $1`, [job.jobId]);
  assert.equal(sha(bytes.rows[0].result_bytes), view.resultDigest);
  assert.equal(JSON.parse(bytes.rows[0].result_bytes.toString("utf8")).title, "Hooked");
  assert.equal(bytes.rows[0].fetch_mode, "injected");
});
