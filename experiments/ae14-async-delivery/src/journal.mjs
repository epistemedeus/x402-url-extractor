import pg from "pg";
import { BoundaryError, requireThat } from "./boundary.mjs";

const DB_NAME = /^[a-z][a-z0-9_]{0,40}$/;

export function poolFor(database) {
  requireThat(DB_NAME.test(database), "database_name");
  return new pg.Pool({
    host: "/var/run/postgresql",
    database,
    max: 4,
  });
}

export async function createDisposableDatabase(name) {
  requireThat(DB_NAME.test(name) && name !== "postgres", "database_name");
  const admin = new pg.Client({ host: "/var/run/postgresql", database: "postgres" });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
}

export async function dropDisposableDatabase(name) {
  requireThat(DB_NAME.test(name) && name !== "postgres", "database_name");
  const admin = new pg.Client({ host: "/var/run/postgresql", database: "postgres" });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

export class PgJournal {
  constructor(pool) {
    this.pool = pool;
  }

  async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ae14_async_job (
        job_id text PRIMARY KEY,
        tenant_id text NOT NULL,
        record jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ae14_async_receipt (
        proof_id text PRIMARY KEY,
        job_id text NOT NULL
      );
    `);
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* connection already closed */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async insert(job) {
    await this.pool.query(
      `INSERT INTO ae14_async_job (job_id, tenant_id, record) VALUES ($1, $2, $3::jsonb)`,
      [job.jobId, job.tenantId, JSON.stringify(job)],
    );
    return job;
  }

  async read(jobId) {
    const { rows } = await this.pool.query(`SELECT record FROM ae14_async_job WHERE job_id = $1`, [jobId]);
    return rows[0]?.record ?? null;
  }

  async update(jobId, updater) {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT record FROM ae14_async_job WHERE job_id = $1 FOR UPDATE`,
        [jobId],
      );
      if (!rows[0]) throw new BoundaryError("job_absent");
      const next = await updater(rows[0].record, client);
      await client.query(`UPDATE ae14_async_job SET record = $2::jsonb WHERE job_id = $1`, [jobId, JSON.stringify(next)]);
      return next;
    });
  }

  async bindReceipt(client, proofId, jobId) {
    const existing = await client.query(`SELECT job_id FROM ae14_async_receipt WHERE proof_id = $1 FOR UPDATE`, [proofId]);
    if (existing.rows[0] && existing.rows[0].job_id !== jobId) throw new BoundaryError("receipt_already_bound");
    const owner = await client.query(`SELECT proof_id FROM ae14_async_receipt WHERE job_id = $1`, [jobId]);
    if (owner.rows[0] && owner.rows[0].proof_id !== proofId) throw new BoundaryError("allocation_already_funded");
    if (!existing.rows[0]) {
      await client.query(`INSERT INTO ae14_async_receipt (proof_id, job_id) VALUES ($1, $2)`, [proofId, jobId]);
    }
  }

  async unackedCallbacks() {
    const { rows } = await this.pool.query(`SELECT record FROM ae14_async_job`);
    return rows.map((row) => row.record).filter((job) => job.callback && job.output && job.callback.acked !== true);
  }
}
