/**
 * Optional, caller-owned statement for one paid response.
 *
 * The bearer stays in this process (WeakMap). It is not copied into the
 * returned JSON, attempt receipts, errors, or logs. The post URL is the
 * authorized merchant origin plus the exact free path. Link text and any
 * caller-supplied URL are ignored. Schema success does not choose a disposition.
 */

export const CALLER_RESULT_FEEDBACK_PATH = "/commerce/caller-result-feedback";
export const CALLER_RESULT_FEEDBACK_HEADER = "x-samedaydesk-caller-result-feedback";
export const CALLER_RESULT_DISPOSITIONS = Object.freeze(["useful", "not_useful"]);
export const CALLER_RESULT_REASON_CATEGORIES = Object.freeze([
  "matched_task",
  "saved_a_step",
  "wrong_output",
  "missing_field",
  "not_actionable",
]);

const DISPOSITIONS = new Set(CALLER_RESULT_DISPOSITIONS);
const REASONS = new Set(CALLER_RESULT_REASON_CATEGORIES);
const TOKEN_RE = /^[A-Za-z0-9_-]{20,1500}\.[A-Za-z0-9_-]{43}$/;
const MAX_TOKEN_CHARS = 1544;
const MAX_STATEMENT_BYTES = 512;
const MAX_RESPONSE_BYTES = 4096;
const MAX_HEADER_VALUE_CHARS = 8192;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 15_000;
const STATEMENT_KEYS = new Set(["disposition", "reasonCategory"]);
const RESPONSE_FIELDS = Object.freeze([
  "ok",
  "accepted",
  "bound",
  "idempotentReplay",
  "charged",
  "payerIdentity",
  "usefulness",
  "disposition",
  "reasonCategory",
  "coverage",
  "code",
  "retainedDisposition",
  "retainedReasonCategory",
]);

const bearers = new WeakMap();

function publicView({ available, reason }) {
  return {
    optional: true,
    available,
    reason,
    charged: false,
    payerIdentity: false,
    usefulness: "unknown",
    method: "POST",
    path: CALLER_RESULT_FEEDBACK_PATH,
    header: CALLER_RESULT_FEEDBACK_HEADER,
    dispositions: [...CALLER_RESULT_DISPOSITIONS],
    reasonCategories: [...CALLER_RESULT_REASON_CATEGORIES],
    automatic: false,
  };
}

function fail(code) {
  return {
    ok: false,
    accepted: false,
    bound: false,
    charged: false,
    payerIdentity: false,
    usefulness: "unknown",
    disposition: null,
    reasonCategory: null,
    code,
    coverage: "this_retained_result_only",
    deliveryPreserved: true,
    repurchaseAuthorized: false,
    taskSubmitted: false,
    paymentAttempted: false,
  };
}

function statementDestination(resourceUrl) {
  let url;
  try {
    url = new URL(String(resourceUrl || ""));
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return `${url.origin}${CALLER_RESULT_FEEDBACK_PATH}`;
}

function readPresentedToken(response) {
  const headers = response?.headers;
  if (!headers || typeof headers.has !== "function" || typeof headers.get !== "function") {
    return { status: "absent" };
  }
  if (!headers.has(CALLER_RESULT_FEEDBACK_HEADER)) return { status: "absent" };
  const raw = headers.get(CALLER_RESULT_FEEDBACK_HEADER);
  if (typeof raw !== "string") return { status: "malformed" };
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_TOKEN_CHARS || !TOKEN_RE.test(value)) {
    return { status: "malformed" };
  }
  return { status: "ok", token: value };
}

// A remote body can echo a header capability in values or property names.
// Remove its exact parts too: general redaction may already have replaced the
// long payload while leaving the MAC fragment. Keep the purchase object identity.
function scrubPresentedBearer(value, token, seen = new WeakSet()) {
  const parts = [token, ...token.split(".")];
  const cleanText = (text) => parts.reduce(
    (clean, part) => clean.split(part).join("[caller-capability-redacted]"),
    text,
  );
  const visit = (item) => {
    if (typeof item === "string") return cleanText(item);
    if (!item || typeof item !== "object" || seen.has(item)) return item;
    seen.add(item);
    for (const [key, child] of Object.entries(item)) {
      if (parts.some((part) => key.includes(part))) delete item[key];
      else item[key] = visit(child);
    }
    return item;
  };
  return visit(value);
}

/**
 * Attach the optional action to the in-process purchase result.
 * Missing or malformed capabilities do not change delivery classification.
 * Any echoed valid capability is removed from serializable evidence.
 */
export function bindCallerResultFeedback(result, { response, resourceUrl } = {}) {
  if (!result || typeof result !== "object") return result;
  try {
    bearers.delete(result);
    const presented = readPresentedToken(response);
    if (presented.status === "absent") {
      result.callerResultFeedback = publicView({ available: false, reason: "absent" });
      return result;
    }
    if (presented.status !== "ok") {
      result.callerResultFeedback = publicView({ available: false, reason: "malformed_capability" });
      return result;
    }
    scrubPresentedBearer(result, presented.token);
    const url = statementDestination(resourceUrl);
    if (!url) {
      result.callerResultFeedback = publicView({ available: false, reason: "untrusted_origin" });
      return result;
    }
    bearers.set(result, { token: presented.token, url });
    result.callerResultFeedback = publicView({ available: true, reason: null });
    return result;
  } catch {
    result.callerResultFeedback = publicView({ available: false, reason: "absent" });
    return result;
  }
}

function projectServerBody(value, token) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const projected = {};
  for (const key of RESPONSE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) projected[key] = value[key];
  }
  if (token && JSON.stringify(projected).includes(token)) return { echo: true };
  return { projected };
}

function finishFromServer(status, projected, sent) {
  if (projected.charged !== false) return fail("unexpected_charge");
  if (projected.payerIdentity !== false) return fail("payer_identity_claim_refused");
  if (projected.usefulness !== "unknown") return fail("usefulness_claim_refused");
  const accepted = status === 200 && projected.accepted === true && projected.ok === true;
  if (accepted) {
    if (projected.disposition !== sent.disposition) return fail("disposition_mismatch");
    const sentReason = sent.reasonCategory ?? null;
    const gotReason = projected.reasonCategory === undefined ? null : projected.reasonCategory;
    if (gotReason !== sentReason) return fail("reason_mismatch");
    return {
      ok: true,
      accepted: true,
      bound: projected.bound === true,
      idempotentReplay: projected.idempotentReplay === true,
      charged: false,
      payerIdentity: false,
      usefulness: "unknown",
      disposition: sent.disposition,
      reasonCategory: sentReason,
      code: null,
      coverage: projected.coverage ?? "this_retained_result_only",
      deliveryPreserved: true,
      repurchaseAuthorized: false,
      taskSubmitted: false,
      paymentAttempted: false,
    };
  }
  return {
    ...fail(typeof projected.code === "string" ? projected.code : "rejected"),
    retainedDisposition: typeof projected.retainedDisposition === "string" ? projected.retainedDisposition : null,
    retainedReasonCategory: projected.retainedReasonCategory === undefined ? null : projected.retainedReasonCategory,
    coverage: typeof projected.coverage === "string" ? projected.coverage : "this_retained_result_only",
  };
}

async function boundedStatementPost(fetchImpl, url, { token, body, timeoutMs }) {
  const controller = new AbortController();
  let timer;
  let reader;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error("transport_timeout"), { code: "transport_timeout" }));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      fetchImpl(url, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          [CALLER_RESULT_FEEDBACK_HEADER]: token,
        },
        body,
      }),
      expired,
    ]);
    if (!response || response.redirected || (response.status >= 300 && response.status < 400)) {
      return { transportCode: "redirect_refused" };
    }
    if (response.headers && typeof response.headers.forEach === "function") {
      let headerTooLarge = false;
      response.headers.forEach((value) => {
        if (String(value).length > MAX_HEADER_VALUE_CHARS) headerTooLarge = true;
      });
      if (headerTooLarge) return { transportCode: "header_too_large" };
    }
    const length = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) return { transportCode: "response_too_large" };
    const chunks = [];
    let bytes = 0;
    reader = response.body?.getReader?.();
    while (reader) {
      const next = await Promise.race([reader.read(), expired]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) return { transportCode: "response_too_large" };
      chunks.push(Buffer.from(next.value));
    }
    return {
      status: response.status,
      text: Buffer.concat(chunks).toString("utf8"),
    };
  } catch (error) {
    const name = error?.name || "";
    const code = error?.code || "";
    if (code === "transport_timeout" || name === "AbortError" || name === "TimeoutError") {
      return { transportCode: "transport_timeout" };
    }
    const message = error instanceof Error ? error.message : "";
    if (/redirect/i.test(message)) return { transportCode: "redirect_refused" };
    return { transportCode: "transport_failed" };
  } finally {
    clearTimeout(timer);
    controller.abort();
    reader?.cancel?.().catch(() => {});
  }
}

/**
 * One explicit free statement. Does not pay, retry, follow redirects, or
 * submit a task. A failure leaves the original purchase result unchanged.
 */
export async function reportCallerResult(result, statement, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!statement || typeof statement !== "object" || Array.isArray(statement)) return fail("disposition_rejected");
  for (const key of Object.keys(statement)) {
    if (!STATEMENT_KEYS.has(key)) return fail("unbounded_field");
  }
  if (!DISPOSITIONS.has(statement.disposition)) return fail("disposition_rejected");
  const hasReason = Object.prototype.hasOwnProperty.call(statement, "reasonCategory");
  if (hasReason && !REASONS.has(statement.reasonCategory)) return fail("reason_rejected");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) return fail("deadline_rejected");
  if (typeof fetchImpl !== "function") return fail("transport_failed");

  const slot = bearers.get(result);
  if (!slot) {
    const reason = result?.callerResultFeedback?.reason;
    if (reason === "malformed_capability") return fail("malformed_capability");
    if (reason === "untrusted_origin") return fail("untrusted_origin");
    if (reason === "absent" || !result?.callerResultFeedback) return fail("capability_absent");
    return fail("bearer_not_in_process");
  }

  const payload = hasReason
    ? { disposition: statement.disposition, reasonCategory: statement.reasonCategory }
    : { disposition: statement.disposition };
  const raw = JSON.stringify(payload);
  if (Buffer.byteLength(raw) > MAX_STATEMENT_BYTES) return fail("body_too_large");

  const posted = await boundedStatementPost(fetchImpl, slot.url, {
    token: slot.token,
    body: raw,
    timeoutMs,
  });
  if (posted.transportCode) return fail(posted.transportCode);
  let parsed;
  try {
    parsed = JSON.parse(posted.text);
  } catch {
    return fail("malformed_response");
  }
  const projected = projectServerBody(parsed, slot.token);
  if (!projected) return fail("malformed_response");
  if (projected.echo) return fail("bearer_echo_refused");
  return finishFromServer(posted.status, projected.projected, {
    disposition: statement.disposition,
    reasonCategory: hasReason ? statement.reasonCategory : null,
  });
}
