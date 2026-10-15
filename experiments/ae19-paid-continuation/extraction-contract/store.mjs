import { randomBytes } from "node:crypto";
import pg from "pg";

const DB_NAME = /^[a-z][a-z0-9_]{0,40}$/;
export const SCHEMA = "ae19_paid_continuation";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function assertDbName(name) {
  if (!DB_NAME.test(name) || name === "postgres") throw fail("database_name");
  return name;
}

export async function createDatabase() {
  const name = assertDbName(`ae19g4_${randomBytes(6).toString("hex")}`);
  const admin = new pg.Client({ host: "/var/run/postgresql", database: "postgres" });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const pool = new pg.Pool({ host: "/var/run/postgresql", database: name, max: 4 });
  // DROP DATABASE FORCE during cleanup notifies idle clients. Queries still reject.
  pool.on("error", () => {});
  return { name, pool };
}

export async function dropDatabase(name) {
  assertDbName(name);
  const admin = new pg.Client({ host: "/var/run/postgresql", database: "postgres" });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

export async function migrate(pool) {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.extraction_job (
      job_id text PRIMARY KEY,
      tenant_id text NOT NULL,
      actor_id text NOT NULL,
      url text,
      state text NOT NULL,
      acceptance jsonb NOT NULL,
      result_bytes bytea,
      result_digest text,
      artifact_kind text,
      artifact_body text,
      artifact_digest text,
      reason text,
      fetch_mode text,
      attempts integer NOT NULL DEFAULT 0,
      payment_attempts integer NOT NULL DEFAULT 0,
      deadline_at timestamptz,
      lease_until timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.extraction_idem (
      tenant_id text NOT NULL,
      idem_key text NOT NULL,
      job_id text NOT NULL,
      request_digest text NOT NULL,
      PRIMARY KEY (tenant_id, idem_key)
    );
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.tenant_delivery (
      delivery_id text PRIMARY KEY,
      tenant_id text NOT NULL,
      job_id text NOT NULL,
      digest text NOT NULL,
      state text NOT NULL,
      acked_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.source_occurrence (
      source_id text PRIMARY KEY,
      digest text NOT NULL,
      occurrence_id text,
      state text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.later_need (
      continuation_id text PRIMARY KEY,
      tenant_id text NOT NULL,
      prior_job_id text NOT NULL,
      prior_digest text NOT NULL,
      later_task text NOT NULL,
      payment_attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.capture_verdict (
      verdict_id text PRIMARY KEY,
      tenant_id text NOT NULL,
      job_id text NOT NULL,
      accepted_digest text NOT NULL,
      status text NOT NULL,
      reason text,
      record jsonb NOT NULL
    );
  `);
}

export async function transaction(pool, fn) {
  const client = await pool.connect();
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
