// Caller hook beside the existing bearer client. The canonical client still
// sends only disposition and reasonCategory. This hook adds the optional
// extension and refuses to copy the bearer into the returned view.

import { bindCallerResultFeedback } from "../../../caller-result-client/src/http-caller-result.mjs";
import {
  CALLER_RESULT_DISPOSITIONS,
  CALLER_RESULT_FEEDBACK_HEADER,
  CALLER_RESULT_FEEDBACK_PATH,
  CALLER_RESULT_REASON_CATEGORIES,
  CALLER_RESULT_TOKEN_RE,
  CALLER_RESULT_USEFULNESS,
} from "../../../caller-result-client/src/contract.mjs";
import { PRIOR_CAPABILITY_HEADER, USEFULNESS_UNKNOWN } from "./contract.mjs";

const bearers = new WeakMap();
const DISPOSITIONS = new Set(CALLER_RESULT_DISPOSITIONS);
const REASONS = new Set(CALLER_RESULT_REASON_CATEGORIES);
const MAX_STATEMENT_BYTES = 1024;

function fail(code) {
  return {
    ok: false,
    accepted: false,
    bound: false,
    charged: false,
    payerIdentity: false,
    usefulness: USEFULNESS_UNKNOWN,
    disposition: null,
    retainedUse: null,
    code,
    coverage: "this_retained_result_only",
    deliveryPreserved: true,
    repurchaseAuthorized: false,
    taskSubmitted: false,
    paymentAttempted: false,
    e08UsefulWork: "unknown",
  };
}

function destination(resourceUrl) {
  let url;
  try {
    url = new URL(String(resourceUrl || ""));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.protocol === "http:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
  if (url.username || url.password) return null;
  return `${url.origin}${CALLER_RESULT_FEEDBACK_PATH}`;
}

export function bindUsefulServiceObservation(result, { response, resourceUrl } = {}) {
  bindCallerResultFeedback(result, { response, resourceUrl });
  if (!result || typeof result !== "object") return result;
  const token = response?.headers?.get?.(CALLER_RESULT_FEEDBACK_HEADER);
  const url = destination(resourceUrl);
  if (typeof token === "string" && CALLER_RESULT_TOKEN_RE.test(token.trim()) && url) {
    bearers.set(result, { token: token.trim(), url });
  } else {
    bearers.delete(result);
  }
  return result;
}

export async function reportUsefulServiceObservation(result, statement, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
  priorCapability = "",
} = {}) {
  if (!statement || typeof statement !== "object" || Array.isArray(statement)) return fail("malformed_extension");
  if (statement.disposition !== undefined && !DISPOSITIONS.has(statement.disposition)) return fail("disposition_rejected");
  if (statement.reasonCategory !== undefined && !REASONS.has(statement.reasonCategory)) return fail("reason_rejected");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) return fail("deadline_rejected");
  const slot = bearers.get(result);
  if (!slot) return fail("capability_absent");
  const payload = { ...statement };
  const raw = JSON.stringify(payload);
  if (raw.includes(slot.token) || Buffer.byteLength(raw) > MAX_STATEMENT_BYTES) return fail("body_too_large");
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    [CALLER_RESULT_FEEDBACK_HEADER]: slot.token,
  };
  if (priorCapability) headers[PRIOR_CAPABILITY_HEADER] = priorCapability;
  let response;
  try {
    response = await fetchImpl(slot.url, { method: "POST", redirect: "error", headers, body: raw });
  } catch {
    return fail("transport_failed");
  }
  if (!response || response.redirected) return fail("redirect_refused");
  const text = typeof response.text === "function" ? await response.text() : "";
  if (text.includes(slot.token) || (priorCapability && text.includes(priorCapability))) return fail("bearer_echo_refused");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("malformed_response");
  }
  if (parsed.charged !== false || parsed.payerIdentity !== false || parsed.usefulness !== CALLER_RESULT_USEFULNESS) {
    return fail("usefulness_claim_refused");
  }
  return {
    ok: parsed.ok === true,
    accepted: parsed.accepted === true,
    declined: parsed.declined === true,
    bound: parsed.bound === true,
    idempotentReplay: parsed.idempotentReplay === true,
    charged: false,
    payerIdentity: false,
    usefulness: USEFULNESS_UNKNOWN,
    disposition: parsed.disposition ?? statement.disposition ?? null,
    retainedUse: parsed.retainedUse ?? null,
    code: parsed.code ?? null,
    coverage: parsed.coverage ?? "this_retained_result_only",
    deliveryPreserved: true,
    repurchaseAuthorized: false,
    taskSubmitted: false,
    paymentAttempted: false,
    e08UsefulWork: parsed.e08UsefulWork === true || parsed.e08UsefulWork === false || parsed.e08UsefulWork === "unknown"
      ? parsed.e08UsefulWork
      : "unknown",
  };
}
