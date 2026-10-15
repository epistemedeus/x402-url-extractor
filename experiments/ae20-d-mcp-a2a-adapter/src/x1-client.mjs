import { randomBytes } from "node:crypto";

const JOB_ID = /^j[a-f0-9]{32}$/;

function paymentRefusal(body) {
  if (!body || typeof body !== "object") return "payment_refused";
  if (body.price?.amount !== 0 || body.price?.unit !== "usd-micros") return "payment_refused";
  if (body.requirements != null) return "payment_refused";
  if (Object.hasOwn(body, "payment")) return "payment_refused";
  if (body.executable === false) return "not_executable";
  return null;
}

async function postOnce(fetchImpl, url, headers, body) {
  const response = await fetchImpl(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: response.status, body: parsed };
}

/**
 * One quote and, only when that quote is free, one execute.
 * No loop, no second execute, no payment header.
 */
export async function callRoute({ baseUrl, bearer, routeId, input, fetchImpl = globalThis.fetch }) {
  if (!baseUrl) throw Object.assign(new Error("x1_base_url_required"), { code: "x1_base_url_required" });
  const root = baseUrl.replace(/\/+$/, "");
  const attempts = { quote: 0, execute: 0 };
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${bearer}`,
  };
  attempts.quote += 1;
  const quoted = await postOnce(fetchImpl, `${root}/v1/quote`, headers, { routeId, input });
  const refused = quoted.status === 200 ? paymentRefusal(quoted.body) : null;
  if (quoted.status !== 200 || refused) {
    return {
      routeId,
      attempts,
      phase: quoted.status === 200 ? "refused" : "quote",
      httpStatus: quoted.status,
      quote: quoted.body,
      receipt: null,
      errorBody: quoted.status === 200 ? null : quoted.body,
      output: null,
      code: refused || quoted.body?.error?.code || null,
    };
  }
  attempts.execute += 1;
  const idempotencyKey = `ae20d${randomBytes(16).toString("hex")}`;
  const executed = await postOnce(fetchImpl, `${root}/v1/execute`, {
    ...headers,
    "idempotency-key": idempotencyKey,
  }, { quoteId: quoted.body.quoteId, input, maxUnits: 0 });
  const receipt = executed.status === 200 ? executed.body : null;
  return {
    routeId,
    attempts,
    phase: "execute",
    httpStatus: executed.status,
    quote: quoted.body,
    receipt,
    errorBody: executed.status === 200 ? null : executed.body,
    output: receipt && receipt.output && typeof receipt.output === "object" ? receipt.output : null,
    code: receipt?.error?.code || null,
  };
}

export function mapCall(call) {
  const quote = call.quote && typeof call.quote === "object" ? call.quote : null;
  const receipt = call.receipt && typeof call.receipt === "object" ? call.receipt : null;
  const output = call.output && typeof call.output === "object" ? call.output : null;
  const price = receipt?.price ?? quote?.price ?? null;
  const payment = receipt?.payment ?? null;
  if (call.phase === "refused" || call.code === "payment_refused" || call.code === "not_executable") {
    return { mapped: "rejected", code: call.code || "payment_refused", isError: true, output: null, price, payment, httpStatus: call.httpStatus };
  }
  if (call.phase !== "execute" || call.httpStatus !== 200) {
    const code = call.errorBody?.error?.code || quote?.error?.code || call.code || "request_failed";
    const mapped = call.httpStatus === 400 ? "invalid" : "failed";
    return { mapped, code, isError: true, output: null, price: quote?.price ?? null, payment: null, httpStatus: call.httpStatus };
  }
  if (receipt?.status === "failed") {
    const code = receipt.error?.code || "failed";
    const mapped = code === "e08_job_forbidden" ? "rejected" : "failed";
    return { mapped, code, isError: true, output: null, price: receipt.price ?? null, payment, httpStatus: 200 };
  }
  if (output?.state === "no_fit" || output?.reason === "ssrf_blocked") {
    return { mapped: "rejected", code: output.reason || "no_fit", isError: true, output, price: receipt?.price ?? null, payment, httpStatus: 200 };
  }
  if (output?.code === "digest_mismatch" || output?.verdict === "unknown") {
    return { mapped: "failed", code: output.code || "digest_mismatch", isError: true, output, price: receipt?.price ?? null, payment, httpStatus: 200 };
  }
  return { mapped: "ok", code: null, isError: false, output, price: receipt?.price ?? null, payment, httpStatus: 200 };
}

export function envelope(call, mapped) {
  return {
    mapped: mapped.mapped,
    code: mapped.code,
    route: call.routeId,
    httpAttempts: call.attempts,
    price: mapped.price,
    requirements: call.quote && typeof call.quote === "object" && Object.hasOwn(call.quote, "requirements") ? call.quote.requirements : null,
    quoteHasPayment: call.quote && typeof call.quote === "object" ? Object.hasOwn(call.quote, "payment") : null,
    payment: mapped.payment,
    output: mapped.output,
  };
}

export function terminalState(output) {
  if (!output) return "TASK_STATE_FAILED";
  if (output.status === "queued" || output.completion === "pending" || output.state === "queued" || output.state === "running") {
    return "TASK_STATE_WORKING";
  }
  return "TASK_STATE_COMPLETED";
}

export function isJobId(value) {
  return typeof value === "string" && JOB_ID.test(value);
}
