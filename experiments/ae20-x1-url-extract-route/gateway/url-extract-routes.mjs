import { GatewayError } from "./errors.mjs";
import { hashSchema, integer, nullable, object, text } from "./schemas.mjs";

/** Same job id shape as journey-x402-async at 1b5fd425 (`JOB_ID`). */
export const JOB_ID = /^j[a-f0-9]{32}$/;

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const STATES = ["queued", "running", "ready", "no_fit", "fit", "failed", "aborted", "timed_out", "unknown"];
const FIXTURE_JOB = `j${"0".repeat(32)}`;

let binding = null;

function fail(code, status = 400) {
  throw new GatewayError(code, status);
}

/**
 * Bind the AE19 extraction service for this process. The gateway does not pass
 * a tenant into run(); deployment code selects the actor before listen.
 */
export function bindUrlExtractService(next) {
  if (!next?.service?.pool || typeof next.service.submit !== "function" || typeof next.service.read !== "function"
    || typeof next.service.pump !== "function") {
    throw new Error("url_extract_service_required");
  }
  if (typeof next.tenantId !== "string" || typeof next.actorId !== "string") throw new Error("url_extract_actor_required");
  const schema = next.schema || "ae19_paid_continuation";
  if (!SCHEMA_NAME.test(schema)) throw new Error("url_extract_schema_required");
  binding = { service: next.service, tenantId: next.tenantId, actorId: next.actorId, schema };
  return binding;
}

export function unbindUrlExtractService() {
  binding = null;
}

function useBinding() {
  if (!binding) fail("url_extract_unbound", 503);
  return binding;
}

function completionOf(state) {
  if (state === "queued" || state === "running") return "pending";
  if (state === "ready" || state === "no_fit" || state === "fit") return "ready";
  return "failed";
}

function availability(state) {
  return state === "queued" || state === "running" ? "queued" : "ready";
}

function asText(value, max) {
  if (typeof value !== "string" || value.length < 1 || value.length > max) return null;
  return value;
}

function asCount(value) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0 || number > 1_000_000) fail("extraction_contract_mismatch", 502);
  return number;
}

async function loadRow(current, jobId) {
  const { rows } = await current.service.pool.query(
    `SELECT result_bytes, result_digest, fetch_mode, state, reason, attempts, payment_attempts
     FROM ${current.schema}.extraction_job
     WHERE job_id = $1 AND tenant_id = $2`,
    [jobId, current.tenantId],
  );
  return rows[0] || null;
}

function assertUnpaid(view, row) {
  if (view?.paymentAttempts !== 0 || view?.newPayment !== false || asCount(row?.payment_attempts) !== 0) {
    fail("extraction_payment_mismatch", 502);
  }
}

function assertState(state) {
  if (!STATES.includes(state)) fail("extraction_state_unknown", 502);
  return state;
}

function parsedResult(row) {
  if (!row?.result_bytes) return {};
  try {
    const value = JSON.parse(Buffer.from(row.result_bytes).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("extraction_contract_mismatch", 502);
    return value;
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    fail("extraction_contract_mismatch", 502);
  }
}

function projectSubmit(view, row) {
  if (view?.ok !== true) fail("extraction_contract_mismatch", 502);
  assertUnpaid(view, row);
  const state = assertState(view.state);
  if (typeof view.jobId !== "string" || !JOB_ID.test(view.jobId)) fail("invalid_job_id", 400);
  const digest = view.resultDigest || null;
  if (digest !== null && !/^[a-f0-9]{64}$/.test(digest)) fail("extraction_contract_mismatch", 502);
  return {
    jobId: view.jobId,
    status: availability(state),
    digest,
    state,
    reason: asText(view.reason, 128),
    attempts: asCount(row?.attempts),
    paymentAttempts: 0,
    newPayment: false,
    fetch_mode: asText(view.fetchMode || row?.fetch_mode, 64),
    completion: completionOf(state),
  };
}

function projectRead(view, row) {
  assertUnpaid(view, row);
  if (typeof view?.jobId !== "string" || !JOB_ID.test(view.jobId)) fail("invalid_job_id", 400);
  if (view.ok === false && view.code === "digest_mismatch") {
    return {
      jobId: view.jobId,
      title: null,
      status: null,
      requestedUrl: null,
      fetch_mode: asText(row?.fetch_mode, 64),
      completion: "failed",
      digest: null,
      state: "unknown",
      reason: "digest_mismatch",
      attempts: asCount(row?.attempts),
      paymentAttempts: 0,
      newPayment: false,
      verdict: "unknown",
      code: "digest_mismatch",
    };
  }
  if (view.ok !== true) fail("extraction_contract_mismatch", 502);
  const state = assertState(view.state);
  const parsed = parsedResult(row);
  const httpStatus = Number.isInteger(parsed.status) && parsed.status >= 0 && parsed.status <= 599 ? parsed.status : null;
  const digest = view.resultDigest || null;
  if (digest !== null && !/^[a-f0-9]{64}$/.test(digest)) fail("extraction_contract_mismatch", 502);
  const title = typeof parsed.title === "string" && parsed.title.length <= 4000 ? parsed.title : null;
  return {
    jobId: view.jobId,
    title,
    status: httpStatus,
    requestedUrl: asText(parsed.requestedUrl, 2048),
    fetch_mode: asText(view.fetchMode || row?.fetch_mode, 64),
    completion: completionOf(state),
    digest,
    state,
    reason: asText(view.reason, 128),
    attempts: asCount(row?.attempts),
    paymentAttempts: 0,
    newPayment: false,
    verdict: null,
    code: null,
  };
}

async function guard(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    const code = error?.code;
    if (code === "invalid_idempotency" || code === "invalid_tenant" || code === "invalid_actor" || code === "invalid_job_id") {
      throw new GatewayError(code, 400);
    }
    if (code === "idempotency_conflict") throw new GatewayError(code, 409);
    throw new GatewayError("provider_failed", 502);
  }
}

/**
 * Absent row: ExtractionService.read returns null. The extraction HTTP contract
 * maps that miss to 404 job_absent. Forbid the id only after the miss.
 */
async function readOrForbidden(current, jobId) {
  const view = await current.service.read({ tenantId: current.tenantId, jobId });
  if (!view) fail("e08_job_forbidden", 403);
  return view;
}

const submitOutput = object({
  jobId: { type: "string", pattern: JOB_ID.source },
  status: { enum: ["queued", "ready"] },
  digest: nullable(hashSchema),
  state: { enum: STATES },
  reason: nullable(text(128)),
  attempts: integer(1_000_000),
  paymentAttempts: { const: 0 },
  newPayment: { const: false },
  fetch_mode: nullable(text(64)),
  completion: { enum: ["pending", "ready", "failed"] },
});

const readOutput = object({
  jobId: { type: "string", pattern: JOB_ID.source },
  title: nullable({ type: "string", maxLength: 4000 }),
  status: nullable(integer(599)),
  requestedUrl: nullable(text(2048)),
  fetch_mode: nullable(text(64)),
  completion: { enum: ["pending", "ready", "failed"] },
  digest: nullable(hashSchema),
  state: { enum: STATES },
  reason: nullable(text(128)),
  attempts: integer(1_000_000),
  paymentAttempts: { const: 0 },
  newPayment: { const: false },
  verdict: nullable({ const: "unknown" }),
  code: nullable(text(64)),
});

const submitInput = object({
  url: text(2048),
  idempotencyKey: { type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9_.-]{8,128}$" },
});

const jobInput = object({
  jobId: { type: "string", pattern: JOB_ID.source },
});

function submitFixture() {
  return {
    jobId: FIXTURE_JOB,
    status: "ready",
    digest: null,
    state: "ready",
    reason: null,
    attempts: 0,
    paymentAttempts: 0,
    newPayment: false,
    fetch_mode: "none",
    completion: "ready",
  };
}

function readFixture() {
  return {
    jobId: FIXTURE_JOB,
    title: "fixture",
    status: 200,
    requestedUrl: "https://example.com/",
    fetch_mode: "none",
    completion: "ready",
    digest: null,
    state: "ready",
    reason: null,
    attempts: 0,
    paymentAttempts: 0,
    newPayment: false,
    verdict: null,
    code: null,
  };
}

export function urlExtractRoutes({ budgetUnit = "usd-micros" } = {}) {
  const price = { amount: 0, unit: budgetUnit };
  return [
    {
      id: "url.extract.submit",
      version: "1",
      provider: "ae19-extraction-contract",
      description: "Free test submit of one URL. Fit and SSRF run before any fetch. Returns a job id and does not take payment.",
      price,
      timeoutMs: 15000,
      maxOutputBytes: 16384,
      inputSchema: submitInput,
      outputSchema: submitOutput,
      async run(input, { signal }) {
        signal?.throwIfAborted();
        return guard(async () => {
          const current = useBinding();
          const view = await current.service.submit({
            tenantId: current.tenantId,
            actorId: current.actorId,
            url: input.url,
            idempotencyKey: input.idempotencyKey,
          });
          if (view?.state === "queued" || view?.state === "running") {
            void current.service.pump({ limit: 4 }).catch(() => {});
          }
          return projectSubmit(view, await loadRow(current, view.jobId));
        });
      },
      test: submitFixture,
    },
    {
      id: "url.extract.poll",
      version: "1",
      provider: "ae19-extraction-contract",
      description: "Free test poll of one extraction job by id. No payment.",
      price,
      timeoutMs: 15000,
      maxOutputBytes: 16384,
      inputSchema: jobInput,
      outputSchema: readOutput,
      async run(input, { signal }) {
        signal?.throwIfAborted();
        return guard(() => finishRead(input.jobId, signal));
      },
      test: readFixture,
    },
    {
      id: "url.extract.result",
      version: "1",
      provider: "ae19-extraction-contract",
      description: "Free test read of one stored extraction by job id, including its digest. No payment.",
      price,
      timeoutMs: 15000,
      maxOutputBytes: 16384,
      inputSchema: jobInput,
      outputSchema: readOutput,
      async run(input, { signal }) {
        signal?.throwIfAborted();
        return guard(() => finishRead(input.jobId, signal));
      },
      test: readFixture,
    },
  ];
}

async function finishRead(jobId, signal) {
  const current = useBinding();
  let view = await readOrForbidden(current, jobId);
  if (view.ok === true && (view.state === "queued" || view.state === "running")) {
    await current.service.pump({ signal, limit: 4 });
    view = await readOrForbidden(current, jobId);
  }
  return projectRead(view, await loadRow(current, jobId));
}
