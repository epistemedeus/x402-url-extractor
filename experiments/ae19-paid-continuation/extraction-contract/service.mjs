import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { evaluateFit } from "./fit.mjs";
import { canonicalBytes, digestBytes, digestValue, jobId as newJobId, newId } from "./digest.mjs";
import { SCHEMA, transaction } from "./store.mjs";

const JOB = `${SCHEMA}.extraction_job`;
const IDEM = `${SCHEMA}.extraction_idem`;
const DELIVERY = `${SCHEMA}.tenant_delivery`;
const SOURCE = `${SCHEMA}.source_occurrence`;
const LATER = `${SCHEMA}.later_need`;
const VERDICT = `${SCHEMA}.capture_verdict`;
const TENANT = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,80}$/;
const JOB_ID = /^j[a-f0-9]{32}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireId(value, code) {
  if (typeof value !== "string" || !TENANT.test(value)) throw fail(code);
  return value;
}

function artifactFor(kind, body) {
  if (typeof body !== "string" || body.length < 1 || body.length > 4000) throw fail("artifact_bounds");
  return { kind, body, digest: digestValue({ kind, body }) };
}

function summaryArtifact(kind, fields) {
  let body = JSON.stringify(fields);
  if (body.length > 4000) {
    body = JSON.stringify({ reason: fields.reason || "bounded", bytesDigest: fields.bytesDigest || null });
  }
  return artifactFor(kind, body);
}

function rowView(row) {
  if (!row) return null;
  if (row.result_bytes && row.result_digest && digestBytes(row.result_bytes) !== row.result_digest) {
    return {
      ok: false,
      code: "digest_mismatch",
      jobId: row.job_id,
      tenantId: row.tenant_id,
      state: "unknown",
      paymentAttempts: 0,
      newPayment: false,
    };
  }
  const terminal = row.state === "ready" || row.state === "no_fit" || row.state === "fit";
  return {
    ok: true,
    schema: "ae19.extraction-job.v1",
    jobId: row.job_id,
    tenantId: row.tenant_id,
    state: row.state,
    reason: row.reason,
    fetchMode: row.fetch_mode,
    resultDigest: row.result_digest,
    paymentAttempts: row.payment_attempts,
    newPayment: false,
    artifact: terminal && row.artifact_kind ? {
      kind: row.artifact_kind,
      body: row.artifact_body,
      digest: row.artifact_digest,
    } : null,
  };
}

export class ExtractionService {
  constructor({ pool, merchantRoot, extract = null, leaseMs = 30_000, now = () => new Date() }) {
    this.pool = pool;
    this.merchantRoot = merchantRoot;
    this.extract = extract;
    this.leaseMs = leaseMs;
    this.now = now;
    this.pumping = null;
  }

  async loadExtractor() {
    if (this.extract) return this.extract;
    const href = pathToFileURL(join(this.merchantRoot, "extract.mjs")).href;
    const mod = await import(href);
    return mod.extract;
  }

  async insertJob(client, row) {
    await client.query(
      `INSERT INTO ${JOB}
        (job_id, tenant_id, actor_id, url, state, acceptance, result_bytes, result_digest,
         artifact_kind, artifact_body, artifact_digest, reason, fetch_mode, payment_attempts, deadline_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,0,$14)`,
      [
        row.jobId, row.tenantId, row.actorId, row.url, row.state, JSON.stringify(row.acceptance || {}),
        row.bytes || null, row.digest || null, row.artifact?.kind || null, row.artifact?.body || null,
        row.artifact?.digest || null, row.reason || null, row.fetchMode || null, row.deadlineAt || null,
      ],
    );
  }

  async retain(client, row) {
    if (row.state !== "ready" && row.state !== "no_fit" && row.state !== "fit") return;
    if (!row.digest) return;
    await client.query(
      `INSERT INTO ${DELIVERY} (delivery_id, tenant_id, job_id, digest, state)
       VALUES ($1,$2,$3,$4,'pending')`,
      [newId("d"), row.tenantId, row.jobId, row.digest],
    );
  }

  async fit({ tenantId, actorId = "fit-check", url, acceptance = {} }) {
    requireId(tenantId, "invalid_tenant");
    const decision = evaluateFit(url, acceptance);
    const fields = { reason: decision.reason, fit: decision.fit, paymentAttempts: 0 };
    const bytes = canonicalBytes(fields);
    const digest = digestBytes(bytes);
    const artifact = decision.fit ? null : summaryArtifact("no_fit", { ...fields, bytesDigest: digest });
    const jobId = newJobId();
    const stored = {
      jobId, tenantId, actorId, url: decision.href || null,
      state: decision.fit ? "fit" : "no_fit",
      acceptance, bytes, digest, artifact,
      reason: decision.reason, fetchMode: "none",
    };
    await transaction(this.pool, async (client) => {
      await this.insertJob(client, stored);
      await this.retain(client, stored);
    });
    return this.read({ tenantId, jobId });
  }

  async submit({ tenantId, actorId, url, acceptance = {}, idempotencyKey = null, timeoutMs = 20_000 }) {
    requireId(tenantId, "invalid_tenant");
    requireId(actorId, "invalid_actor");
    const boundedTimeout = Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 60_000 ? timeoutMs : 20_000;
    const requestDigest = digestValue({ url, acceptance });
    if (idempotencyKey) {
      if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_.-]{8,128}$/.test(idempotencyKey)) throw fail("invalid_idempotency");
      const existing = await this.pool.query(
        `SELECT job_id, request_digest FROM ${IDEM} WHERE tenant_id = $1 AND idem_key = $2`,
        [tenantId, idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_digest !== requestDigest) throw fail("idempotency_conflict");
        return this.read({ tenantId, jobId: existing.rows[0].job_id });
      }
    }
    const decision = evaluateFit(url, acceptance);
    const jobId = newJobId();
    const deadlineAt = new Date(this.now().getTime() + boundedTimeout);
    if (!decision.fit) {
      const fields = { reason: decision.reason, fit: false, paymentAttempts: 0 };
      const bytes = canonicalBytes(fields);
      const digest = digestBytes(bytes);
      const artifact = summaryArtifact("no_fit", { ...fields, bytesDigest: digest });
      const stored = {
        jobId, tenantId, actorId, url: null, state: "no_fit", acceptance, bytes, digest, artifact,
        reason: decision.reason, fetchMode: "none",
      };
      await transaction(this.pool, async (client) => {
        await this.insertJob(client, stored);
        await this.retain(client, stored);
        if (idempotencyKey) {
          await client.query(
            `INSERT INTO ${IDEM} (tenant_id, idem_key, job_id, request_digest) VALUES ($1,$2,$3,$4)`,
            [tenantId, idempotencyKey, jobId, requestDigest],
          );
        }
      });
      return this.read({ tenantId, jobId });
    }
    await transaction(this.pool, async (client) => {
      await this.insertJob(client, {
        jobId, tenantId, actorId, url: decision.href, state: "queued", acceptance, deadlineAt,
        fetchMode: null,
      });
      if (idempotencyKey) {
        await client.query(
          `INSERT INTO ${IDEM} (tenant_id, idem_key, job_id, request_digest) VALUES ($1,$2,$3,$4)`,
          [tenantId, idempotencyKey, jobId, requestDigest],
        );
      }
    });
    return this.read({ tenantId, jobId });
  }

  async read({ tenantId, jobId }) {
    requireId(tenantId, "invalid_tenant");
    if (!JOB_ID.test(jobId || "")) return null;
    const { rows } = await this.pool.query(
      `SELECT * FROM ${JOB} WHERE job_id = $1 AND tenant_id = $2`,
      [jobId, tenantId],
    );
    return rowView(rows[0]);
  }

  async recover() {
    const { rowCount } = await this.pool.query(
      `UPDATE ${JOB} SET state = 'queued', lease_until = NULL, updated_at = now()
       WHERE state = 'running' AND (lease_until IS NULL OR lease_until < now())`,
    );
    return rowCount || 0;
  }

  async claim() {
    return transaction(this.pool, async (client) => {
      const { rows } = await client.query(
        `WITH next AS (
           SELECT job_id FROM ${JOB}
           WHERE state = 'queued' OR (state = 'running' AND lease_until < now())
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE ${JOB} AS j
         SET state = 'running',
             attempts = j.attempts + 1,
             lease_until = now() + ($1::int * interval '1 millisecond'),
             updated_at = now()
         FROM next
         WHERE j.job_id = next.job_id
         RETURNING j.*`,
        [this.leaseMs],
      );
      return rows[0] || null;
    });
  }

  async finish(jobId, patch) {
    await transaction(this.pool, async (client) => {
      const { rows } = await client.query(`SELECT * FROM ${JOB} WHERE job_id = $1 FOR UPDATE`, [jobId]);
      const current = rows[0];
      if (!current || current.state === "aborted" || current.state === "timed_out") return;
      await client.query(
        `UPDATE ${JOB}
         SET state = $2, result_bytes = $3, result_digest = $4, artifact_kind = $5, artifact_body = $6,
             artifact_digest = $7, reason = $8, fetch_mode = $9, lease_until = NULL, updated_at = now()
         WHERE job_id = $1`,
        [
          jobId, patch.state, patch.bytes, patch.digest, patch.artifact?.kind || null,
          patch.artifact?.body || null, patch.artifact?.digest || null, patch.reason || null, patch.fetchMode,
        ],
      );
      if (patch.digest && (patch.state === "ready" || patch.state === "no_fit")) {
        await client.query(
          `INSERT INTO ${DELIVERY} (delivery_id, tenant_id, job_id, digest, state)
           SELECT $1, tenant_id, job_id, $2, 'pending' FROM ${JOB} WHERE job_id = $3
           AND NOT EXISTS (SELECT 1 FROM ${DELIVERY} WHERE job_id = $3)`,
          [newId("d"), patch.digest, jobId],
        );
      }
    });
  }

  async runOne(row, signal) {
    if (row.deadline_at && new Date(row.deadline_at).getTime() <= this.now().getTime()) {
      const bytes = canonicalBytes({ reason: "deadline_exceeded", paymentAttempts: 0 });
      await this.finish(row.job_id, {
        state: "timed_out", bytes, digest: digestBytes(bytes), fetchMode: "none", reason: "deadline_exceeded",
      });
      return;
    }
    const fetchMode = globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ ? "injected" : "merchant-public-fetch";
    const extract = await this.loadExtractor();
    try {
      const result = await extract(row.url, { signal });
      const acceptance = row.acceptance || {};
      const noTitle = acceptance.requireTitle === true && !result.title;
      const kind = noTitle ? "no_fit" : "repair";
      const kept = {
        requestedUrl: result.requestedUrl,
        finalUrl: result.finalUrl,
        status: result.status,
        sourceOk: result.sourceOk,
        title: result.title || "",
        error: result.error,
        capture: result.capture,
      };
      const bytes = canonicalBytes(kept);
      const digest = digestBytes(bytes);
      const artifact = summaryArtifact(kind, {
        reason: noTitle ? "title_required" : null,
        status: result.status,
        sourceOk: result.sourceOk,
        title: (result.title || "").slice(0, 180),
        bytesDigest: digest,
        fetchMode,
      });
      await this.finish(row.job_id, {
        state: noTitle ? "no_fit" : "ready",
        bytes, digest, artifact, fetchMode, reason: noTitle ? "title_required" : null,
      });
    } catch (error) {
      const code = signal?.aborted ? "aborted" : (error?.name === "AbortError" ? "aborted" : (error?.code || "extract_failed"));
      const state = code === "aborted" ? "aborted" : (code === "timeout" ? "timed_out" : (["ssrf_blocked", "invalid_url", "invalid_protocol"].includes(code) ? "no_fit" : "failed"));
      const bytes = canonicalBytes({ reason: code, paymentAttempts: 0 });
      const digest = digestBytes(bytes);
      const artifact = state === "no_fit" ? summaryArtifact("no_fit", { reason: code, bytesDigest: digest }) : null;
      await this.finish(row.job_id, { state, bytes, digest, artifact, fetchMode, reason: code });
    }
  }

  async pump({ signal, limit = 8 } = {}) {
    if (this.pumping) return this.pumping;
    this.pumping = (async () => {
      let ran = 0;
      while (ran < limit) {
        if (signal?.aborted) break;
        const row = await this.claim();
        if (!row) break;
        await this.runOne(row, signal);
        ran += 1;
      }
      return ran;
    })();
    try {
      return await this.pumping;
    } finally {
      this.pumping = null;
    }
  }

  async abort({ tenantId, jobId }) {
    requireId(tenantId, "invalid_tenant");
    const { rowCount } = await this.pool.query(
      `UPDATE ${JOB} SET state = 'aborted', reason = 'aborted', lease_until = NULL, updated_at = now()
       WHERE job_id = $1 AND tenant_id = $2 AND state IN ('queued', 'running')`,
      [jobId, tenantId],
    );
    return { aborted: rowCount > 0 };
  }

  async pollDeliveries(tenantId) {
    requireId(tenantId, "invalid_tenant");
    const { rows } = await this.pool.query(
      `SELECT delivery_id, job_id, digest, state FROM ${DELIVERY}
       WHERE tenant_id = $1 AND state = 'pending' ORDER BY delivery_id`,
      [tenantId],
    );
    return rows.map((row) => ({
      deliveryId: row.delivery_id,
      jobId: row.job_id,
      digest: row.digest,
      state: row.state,
    }));
  }

  async ackDelivery({ tenantId, deliveryId }) {
    requireId(tenantId, "invalid_tenant");
    const { rows } = await this.pool.query(
      `UPDATE ${DELIVERY} SET state = 'acked', acked_at = now()
       WHERE delivery_id = $1 AND tenant_id = $2 AND state = 'pending'
       RETURNING delivery_id, job_id, digest, state`,
      [deliveryId, tenantId],
    );
    if (rows[0]) {
      return { deliveryId: rows[0].delivery_id, jobId: rows[0].job_id, digest: rows[0].digest, state: "acked", replayed: false };
    }
    const again = await this.pool.query(
      `SELECT delivery_id, job_id, digest, state FROM ${DELIVERY} WHERE delivery_id = $1 AND tenant_id = $2`,
      [deliveryId, tenantId],
    );
    if (!again.rows[0]) return null;
    return {
      deliveryId: again.rows[0].delivery_id,
      jobId: again.rows[0].job_id,
      digest: again.rows[0].digest,
      state: again.rows[0].state,
      replayed: true,
    };
  }

  async noteSource({ sourceId, digest }) {
    requireId(sourceId, "invalid_source");
    if (!/^[a-f0-9]{64}$/.test(digest || "")) throw fail("invalid_digest");
    return transaction(this.pool, async (client) => {
      const { rows } = await client.query(`SELECT * FROM ${SOURCE} WHERE source_id = $1 FOR UPDATE`, [sourceId]);
      const current = rows[0];
      if (!current) {
        await client.query(
          `INSERT INTO ${SOURCE} (source_id, digest, occurrence_id, state) VALUES ($1,$2,NULL,'baseline')`,
          [sourceId, digest],
        );
        return { applicable: false, reason: "not_yet_due", occurrenceId: null, state: "baseline" };
      }
      if (current.digest === digest) {
        return { applicable: false, reason: "not_yet_due", occurrenceId: current.occurrence_id, state: current.state };
      }
      if (current.state === "admitted") {
        return { applicable: false, reason: "occurrence_open", occurrenceId: current.occurrence_id, state: current.state };
      }
      const occurrenceId = newId("o").slice(0, 40);
      await client.query(
        `UPDATE ${SOURCE} SET digest = $2, occurrence_id = $3, state = 'admitted', updated_at = now() WHERE source_id = $1`,
        [sourceId, digest, occurrenceId],
      );
      return { applicable: true, reason: "source_changed", occurrenceId, state: "admitted" };
    });
  }

  async closeOccurrence({ sourceId }) {
    requireId(sourceId, "invalid_source");
    await this.pool.query(
      `UPDATE ${SOURCE} SET state = 'closed', updated_at = now() WHERE source_id = $1 AND state = 'admitted'`,
      [sourceId],
    );
    const { rows } = await this.pool.query(`SELECT occurrence_id, state, digest FROM ${SOURCE} WHERE source_id = $1`, [sourceId]);
    return rows[0] ? { occurrenceId: rows[0].occurrence_id, state: rows[0].state, digest: rows[0].digest } : null;
  }

  async dueOccurrences() {
    const { rows } = await this.pool.query(
      `SELECT source_id, digest, occurrence_id, state FROM ${SOURCE} WHERE state = 'admitted' ORDER BY source_id`,
    );
    return rows.map((row) => ({
      sourceId: row.source_id,
      digest: row.digest,
      occurrenceId: row.occurrence_id,
      state: row.state,
      schedulesCreated: 0,
    }));
  }

  async measureLater({ tenantId, priorJobId, laterTask }) {
    requireId(tenantId, "invalid_tenant");
    requireId(laterTask, "invalid_task");
    const prior = await this.read({ tenantId, jobId: priorJobId });
    if (!prior?.ok || !prior.resultDigest) return { status: "unknown", reason: "prior_unreadable" };
    if (!["ready", "no_fit", "fit"].includes(prior.state)) return { status: "unknown", reason: "prior_not_retained" };
    const continuationId = newId("c");
    await this.pool.query(
      `INSERT INTO ${LATER} (continuation_id, tenant_id, prior_job_id, prior_digest, later_task, payment_attempts)
       VALUES ($1,$2,$3,$4,$5,0)`,
      [continuationId, tenantId, priorJobId, prior.resultDigest, laterTask],
    );
    const { rows } = await this.pool.query(
      `SELECT continuation_id, prior_job_id, prior_digest, later_task, payment_attempts
       FROM ${LATER} WHERE continuation_id = $1 AND tenant_id = $2`,
      [continuationId, tenantId],
    );
    const row = rows[0];
    return {
      status: "measured",
      continuationId: row.continuation_id,
      priorJobId: row.prior_job_id,
      priorDigest: row.prior_digest,
      laterTask: row.later_task,
      paymentAttempts: row.payment_attempts,
      distinct: row.later_task !== row.prior_job_id,
    };
  }

  async recordVerdict({ tenantId, jobId, acceptedDigest, verdict }) {
    requireId(tenantId, "invalid_tenant");
    const verdictId = newId("v");
    await this.pool.query(
      `INSERT INTO ${VERDICT} (verdict_id, tenant_id, job_id, accepted_digest, status, reason, record)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [verdictId, tenantId, jobId, acceptedDigest, verdict.status, verdict.reason || null, JSON.stringify(verdict)],
    );
    const { rows } = await this.pool.query(
      `SELECT status, reason, accepted_digest, record FROM ${VERDICT} WHERE verdict_id = $1 AND tenant_id = $2`,
      [verdictId, tenantId],
    );
    return { verdictId, ...rows[0].record, storedStatus: rows[0].status, storedDigest: rows[0].accepted_digest };
  }
}

export function repoRootFromHere() {
  return join(dirname(fileURLToPath(import.meta.url)), "../../..");
}
