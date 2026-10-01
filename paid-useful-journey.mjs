import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { normalizeSellerIntegrityAuditInput } from "./seller-integrity-audit.mjs";

export const PAID_USEFUL_JOURNEY_SCHEMA = "samedaydesk.paid-useful-journey.v1";
export const PAID_USEFUL_JOURNEY_JOIN_SCHEMA = "samedaydesk.paid-useful-journey-join.v1";
export const PAID_USEFUL_JOURNEY_HEADER = "x-samedaydesk-paid-journey";
export const PAID_OPERATION_METHOD = "GET";
export const PAID_OPERATION_PATH = "/commerce/seller-integrity-audit";
export const PAID_OPERATION_PRODUCT = "samedaydesk-seller-integrity-audit";
export const FREE_DIAGNOSTIC_PRODUCT = "samedaydesk-discovery-drift";
export const FREE_DIAGNOSTIC_SCHEMA = "samedaydesk.discovery-drift-report.v1";
export const ACTOR_LABELS = Object.freeze(["owner_test", "recruited", "independent", "unknown"]);
export const JOURNEY_DECISIONS = Object.freeze(["offer", "decline", "attempt", "reuse"]);

const ACTOR_LABEL_SET = new Set(ACTOR_LABELS);
const DECISION_SET = new Set(JOURNEY_DECISIONS);
const HEADER_MAX_CHARS = 700;
const USEFUL_REASONS = new Set([
  "not_delivery",
  "additional_work_present",
  "echoes_free_diagnostic",
  "additional_work_missing",
  "target_mismatch",
  "schema_invalid",
  "delivery_failed",
  "body_unavailable",
]);
const JOURNEY_HEX_32 = /^[0-9a-f]{32}$/;
const DIAGNOSIS_HEX_64 = /^[0-9a-f]{64}$/;
const ATOMIC = /^(0|[1-9][0-9]{0,77})$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;
const ELIGIBLE_STATUSES = new Set(["mismatch", "network-mismatch", "asset-mismatch"]);
const SUFFICIENT_STATUSES = new Set(["match", "stale", "reordered-multiple-offer"]);
const SPECIFIC_DIMENSIONS = new Set(["resource", "protocol", "network", "asset", "recipient", "amountAtomic"]);
const AUDIT_DECISIONS = new Set(["machine_buyable", "contract_ready", "repair_required"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function actorLabel(value) {
  return typeof value === "string" && ACTOR_LABEL_SET.has(value) ? value : "unknown";
}

export function encodePaidUsefulJourneyHeader(input) {
  const decision = input?.decision;
  if (!DECISION_SET.has(decision)) throw new Error("journey decision is not recognized");
  if (!JOURNEY_HEX_32.test(input?.journey || "")) throw new Error("journey id is not a 32-character hex digest");
  if (!DIAGNOSIS_HEX_64.test(input?.diagnosis || "")) throw new Error("diagnosis id is not a 64-character hex digest");
  const body = {
    actor: actorLabel(input.actor),
    decision,
    diagnosis: input.diagnosis,
    journey: input.journey,
    v: 1,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  if (encoded.length > HEADER_MAX_CHARS) throw new Error("journey header exceeds the size limit");
  return encoded;
}

export function parsePaidUsefulJourneyHeader(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > HEADER_MAX_CHARS) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!plainObject(parsed)) return null;
  const keys = Object.keys(parsed).sort();
  const allowed = ["actor", "decision", "diagnosis", "journey", "v"];
  if (keys.some((key) => !allowed.includes(key)) || parsed.v !== 1) return null;
  if (!JOURNEY_HEX_32.test(parsed.journey || "") || !DIAGNOSIS_HEX_64.test(parsed.diagnosis || "")) return null;
  if (!DECISION_SET.has(parsed.decision)) return null;
  return Object.freeze({
    v: 1,
    journey: parsed.journey,
    diagnosis: parsed.diagnosis,
    actor: actorLabel(parsed.actor),
    decision: parsed.decision,
  });
}

export function assessSellerIntegrityUsefulness(body, target) {
  if (!plainObject(body)) return { useful: false, reason: "schema_invalid" };
  if (body.schemaVersion === FREE_DIAGNOSTIC_SCHEMA || body.product === FREE_DIAGNOSTIC_PRODUCT) {
    return { useful: false, reason: "echoes_free_diagnostic" };
  }
  if (body.product !== PAID_OPERATION_PRODUCT || typeof body.version !== "string" || !body.version) {
    return { useful: false, reason: "schema_invalid" };
  }
  if (!AUDIT_DECISIONS.has(body.decision) || !plainObject(body.report) || typeof body.report.auditCompleted !== "boolean") {
    return { useful: false, reason: "schema_invalid" };
  }
  const additional = (plainObject(body.report.responseContract) ? 1 : 0)
    + (plainObject(body.report.repairPlan) ? 1 : 0)
    + (Array.isArray(body.report.findings) && body.report.findings.length > 0 ? 1 : 0);
  if (!additional) return { useful: false, reason: "additional_work_missing" };
  const request = body.request;
  const method = String(target?.method || "GET").toUpperCase();
  if (!plainObject(request) || request.origin !== target?.origin || request.route !== target?.route || request.method !== method) {
    return { useful: false, reason: "target_mismatch" };
  }
  if (body.boundary?.targetPaymentSent !== false) return { useful: false, reason: "schema_invalid" };
  return { useful: true, reason: "additional_work_present" };
}

export function paidUsefulJourneyMetadata(claim, { status, paymentPresent, body, target, route }) {
  if (!claim || route !== PAID_OPERATION_PATH) return null;
  let usefulDelivery = "unknown";
  let usefulReason = "not_delivery";
  const code = Number(status);
  if (claim.decision === "attempt" && paymentPresent && code >= 200 && code < 300) {
    if (body === undefined) {
      usefulReason = "body_unavailable";
    } else {
      const assessed = assessSellerIntegrityUsefulness(body, target);
      usefulDelivery = assessed.useful ? "true" : "false";
      usefulReason = assessed.reason;
    }
  } else if (claim.decision === "attempt" && paymentPresent && code >= 400 && code !== 402) {
    usefulDelivery = "false";
    usefulReason = "delivery_failed";
  }
  if (!USEFUL_REASONS.has(usefulReason)) usefulReason = "schema_invalid";
  return Object.freeze({
    v: 1,
    journey: claim.journey,
    diagnosis: claim.diagnosis,
    actor: claim.actor,
    decision: claim.decision,
    usefulDelivery,
    usefulReason,
  });
}

function dimensionRows(report) {
  return (Array.isArray(report?.dimensions) ? report.dimensions : []).map((item) => ({
    dimension: item?.dimension ?? null,
    disposition: item?.disposition ?? null,
    catalog: item?.catalog ?? null,
    live: item?.live ?? null,
  }));
}

export function diagnosisIdForReport(report) {
  return sha256(canonicalJson({
    schema: FREE_DIAGNOSTIC_SCHEMA,
    status: report?.status ?? null,
    catalogResource: report?.catalog?.resource ?? null,
    liveResource: report?.live?.resource ?? null,
    dimensions: dimensionRows(report),
  }));
}

export function journeyIdFor(diagnosisId, target) {
  return sha256(canonicalJson({
    diagnosisId,
    method: PAID_OPERATION_METHOD,
    path: PAID_OPERATION_PATH,
    origin: target.origin,
    route: target.route,
    requestMethod: target.method,
  })).slice(0, 32);
}

function targetFromResource(resource) {
  let url;
  try {
    url = new URL(String(resource || ""));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
  if (!url.pathname.startsWith("/") || url.pathname === "/") return null;
  try {
    const normalized = normalizeSellerIntegrityAuditInput({
      origin: url.origin,
      route: url.pathname,
      method: "GET",
    });
    return { origin: normalized.origin, route: normalized.route, method: normalized.method };
  } catch {
    return null;
  }
}

export function assessFreeDiagnosis(report) {
  const freeResult = {
    product: report?.product ?? null,
    schemaVersion: report?.schemaVersion ?? null,
    status: report?.status ?? "unknown",
    observedMatch: report?.observedMatch === true,
    resolvedCause: false,
    resource: report?.live?.resource ?? null,
    unknowns: Array.isArray(report?.unknowns) ? [...report.unknowns] : [],
  };
  const base = {
    schemaVersion: PAID_USEFUL_JOURNEY_SCHEMA,
    eligible: false,
    reason: "not_a_discovery_drift_report",
    freeResult,
    target: null,
    diagnosisId: null,
    journeyId: null,
    offeredOperation: null,
    purchaseAuthorized: false,
    revenueRecognized: false,
  };
  if (!plainObject(report) || report.schemaVersion !== FREE_DIAGNOSTIC_SCHEMA || report.product !== FREE_DIAGNOSTIC_PRODUCT) {
    return base;
  }
  if (report.resolvedCause !== false) {
    return { ...base, reason: "resolved_cause_not_accepted" };
  }
  const diagnosisId = diagnosisIdForReport(report);
  const liveTarget = targetFromResource(report.live?.resource);
  const specific = dimensionRows(report).some((item) => (
    SPECIFIC_DIMENSIONS.has(item.dimension) && (item.disposition === "drifted" || item.disposition === "unknown")
  ));
  const status = report.status;
  let reason = "free_result_sufficient";
  let eligible = false;
  if (!liveTarget) reason = "target_unknown";
  else if (SUFFICIENT_STATUSES.has(status) && !ELIGIBLE_STATUSES.has(status)) reason = "free_result_sufficient";
  else if (ELIGIBLE_STATUSES.has(status) || (status === "unknown" && specific)) {
    eligible = true;
    reason = "seller_contract_unresolved";
  } else reason = "diagnosis_not_specific";
  const target = eligible ? liveTarget : null;
  return {
    ...base,
    eligible,
    reason,
    diagnosisId,
    journeyId: target ? journeyIdFor(diagnosisId, target) : null,
    target,
    offeredOperation: target ? {
      method: PAID_OPERATION_METHOD,
      path: PAID_OPERATION_PATH,
      product: PAID_OPERATION_PRODUCT,
      query: { origin: target.origin, route: target.route, method: target.method },
      additionalWork: "response contract, repair plan, and machine-buyable decision",
      priceSource: "live_unpaid_challenge",
    } : null,
  };
}

function resourceUrlOf(challenge) {
  const resource = challenge?.resource;
  if (typeof resource === "string") return resource;
  if (plainObject(resource) && typeof resource.url === "string") return resource.url;
  return null;
}

function sameTargetQuery(url, target) {
  const origin = url.searchParams.get("origin");
  const route = url.searchParams.get("route");
  const method = (url.searchParams.get("method") || "GET").toUpperCase();
  const queryPresent = url.searchParams.has("origin") || url.searchParams.has("route") || url.searchParams.has("method");
  if (!queryPresent) return true;
  return origin === target.origin && route === target.route && method === target.method;
}

export function termsDigestFor(terms) {
  return sha256(canonicalJson({
    amount: terms.amount,
    asset: terms.asset,
    maxTimeoutSeconds: terms.maxTimeoutSeconds,
    network: terms.network,
    payTo: terms.payTo,
    resource: terms.resource,
    scheme: terms.scheme,
  }));
}

export function bindUnpaidOffer({ challenge, requestedUrl, target, receivedAt }) {
  if (!plainObject(challenge) || !target?.origin || !target?.route) {
    return { ok: false, reason: "terms_incomplete" };
  }
  const received = Number(receivedAt);
  if (!Number.isFinite(received)) return { ok: false, reason: "terms_incomplete" };
  let requested;
  try {
    requested = new URL(requestedUrl);
  } catch {
    return { ok: false, reason: "target_changed" };
  }
  if (requested.pathname !== PAID_OPERATION_PATH || !sameTargetQuery(requested, target)) {
    return { ok: false, reason: "target_changed" };
  }
  const accepts = Array.isArray(challenge.accepts) ? challenge.accepts.filter((item) => item?.scheme === "exact") : [];
  const baseAccepts = accepts.filter((item) => item.network === "eip155:8453");
  const accept = accepts.length === 1 ? accepts[0] : baseAccepts.length === 1 ? baseAccepts[0] : null;
  if (!accept) return { ok: false, reason: accepts.length ? "terms_ambiguous" : "terms_incomplete" };
  const amount = String(accept.amount ?? "");
  const payTo = String(accept.payTo ?? "");
  const asset = String(accept.asset ?? "");
  const network = String(accept.network ?? "");
  const timeout = accept.maxTimeoutSeconds;
  if (!ATOMIC.test(amount) || !ADDRESS.test(payTo) || !asset || !network) return { ok: false, reason: "terms_incomplete" };
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 86_400) return { ok: false, reason: "terms_incomplete" };
  const resource = resourceUrlOf(challenge);
  if (!resource) return { ok: false, reason: "terms_incomplete" };
  let resourceUrl;
  try {
    resourceUrl = new URL(resource);
  } catch {
    return { ok: false, reason: "target_changed" };
  }
  if (resourceUrl.pathname !== PAID_OPERATION_PATH || !sameTargetQuery(resourceUrl, target)) {
    return { ok: false, reason: "target_changed" };
  }
  const terms = {
    scheme: "exact",
    amount,
    asset: asset.toLowerCase(),
    network,
    payTo: payTo.toLowerCase(),
    resource: resourceUrl.toString(),
    maxTimeoutSeconds: timeout,
  };
  return {
    ok: true,
    reason: null,
    terms,
    termsDigest: termsDigestFor(terms),
    receivedAt: new Date(received).toISOString(),
    expiresAt: new Date(received + timeout * 1000).toISOString(),
    protocolsOffered: ["x402"],
    revenueRecognized: false,
  };
}

export function authorizePurchase({ authorization, offer, now }) {
  if (authorization?.authorizePurchase !== true) return { ok: false, reason: "authorization_required" };
  if (!offer?.ok || !offer.termsDigest || !offer.expiresAt) return { ok: false, reason: "terms_incomplete" };
  const clock = Number(now);
  const expiry = Date.parse(offer.expiresAt);
  const received = Date.parse(offer.receivedAt);
  const authorizedUntil = Date.parse(authorization.expiresAt || "");
  if (!Number.isFinite(clock) || !Number.isFinite(expiry) || !Number.isFinite(received) || !Number.isFinite(authorizedUntil)) {
    return { ok: false, reason: "terms_incomplete" };
  }
  if (clock < received || clock >= expiry || clock >= authorizedUntil) return { ok: false, reason: "terms_expired" };
  if (authorization.termsDigest !== offer.termsDigest) return { ok: false, reason: "wrong_terms" };
  const target = authorization.target;
  if (!target || target.origin !== authorization.expectedTarget?.origin
    || target.route !== authorization.expectedTarget?.route
    || target.method !== authorization.expectedTarget?.method) {
    return { ok: false, reason: "target_changed" };
  }
  return { ok: true, reason: null, actor: actorLabel(authorization.actor) };
}

function journeyOf(event) {
  return plainObject(event?.paidUsefulJourney) ? event.paidUsefulJourney : null;
}

export function planRestart({ events = [], journeyId, session = null }) {
  const local = session?.get(journeyId)?.state;
  if (local === "in_flight" || local === "unknown_financial") {
    return { action: "stop", reason: local === "in_flight" ? "duplicate_in_flight" : "unknown_financial_outcome", financialOutcome: "unknown" };
  }
  if (local === "settled") return { action: "stop", reason: "duplicate_settled", financialOutcome: "settled_observed" };
  const attempts = (events || []).filter((event) => {
    const journey = journeyOf(event);
    return journey?.journey === journeyId && journey.decision === "attempt" && event.paymentPresent === true;
  });
  if (attempts.some((event) => TX.test(String(event.settlementReference || "")))) {
    return { action: "stop", reason: "duplicate_settled", financialOutcome: "settled_observed" };
  }
  if (attempts.some((event) => event.result === "paid_success" || event.result === "replay_success" || event.result === "service_failure")) {
    return { action: "stop", reason: "unknown_financial_outcome", financialOutcome: "unknown" };
  }
  return { action: "allow", reason: null, financialOutcome: attempts.length ? "known_rejection" : "not_attempted" };
}

export function createTestModePayment(challenge, { now = Date.now() } = {}) {
  const accepts = Array.isArray(challenge?.accepts) ? challenge.accepts : [];
  const accepted = accepts.find((entry) => entry?.scheme === "exact") || accepts[0];
  if (!accepted?.payTo || accepted.amount === undefined) throw new Error("test-mode payment requires the live challenge terms");
  const nonce = `0x${randomBytes(32).toString("hex")}`;
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted,
    payload: {
      signature: `0x${"4".repeat(130)}`,
      authorization: {
        from: `0x${"2".repeat(40)}`,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: String(Math.floor(Number(now) / 1000) + Number(accepted.maxTimeoutSeconds || 60)),
        nonce,
      },
    },
    extensions: {
      "payment-identifier": {
        info: { required: challenge?.extensions?.["payment-identifier"]?.info?.required === true, id: `journey_${randomBytes(8).toString("hex")}` },
      },
    },
  })).toString("base64");
}

function decodeChallengeResponse(response) {
  if (response.status >= 300 && response.status < 400) return { ok: false, reason: "redirect_refused", status: response.status };
  if (response.type === "opaqueredirect") return { ok: false, reason: "redirect_refused", status: response.status };
  const encoded = response.headers.get("payment-required");
  if (response.status !== 402 || !encoded) return { ok: false, reason: "offer_not_presented", status: response.status };
  try {
    const challenge = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return { ok: true, challenge };
  } catch {
    try {
      const challenge = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      return { ok: true, challenge };
    } catch {
      return { ok: false, reason: "terms_incomplete", status: response.status };
    }
  }
}

export function operationUrl(merchantBase, target) {
  const url = new URL(PAID_OPERATION_PATH, merchantBase);
  url.searchParams.set("origin", target.origin);
  url.searchParams.set("route", target.route);
  url.searchParams.set("method", target.method);
  return url;
}

async function fetchOperation({ fetchImpl, merchantBase, target, claim, payment = null, redirect = "manual" }) {
  const url = operationUrl(merchantBase, target);
  const headers = { accept: "application/json", [PAID_USEFUL_JOURNEY_HEADER]: encodePaidUsefulJourneyHeader(claim) };
  if (payment) headers["payment-signature"] = payment;
  const response = await fetchImpl(url, { method: "GET", redirect, headers });
  return { url, response };
}

export function createJourneySession() {
  const states = new Map();
  return {
    get(id) { return states.get(id) || null; },
    mark(id, state) { states.set(id, { state }); },
  };
}

export async function presentOffer({
  fetchImpl = fetch,
  merchantBase,
  assessment,
  actor,
  now = Date.now(),
}) {
  if (!assessment?.eligible || !assessment.target) {
    return { ...assessment, purchaseAuthorized: false, revenueRecognized: false, paymentSent: false };
  }
  const claim = { journey: assessment.journeyId, diagnosis: assessment.diagnosisId, actor, decision: "offer" };
  const { url, response } = await fetchOperation({ fetchImpl, merchantBase, target: assessment.target, claim });
  const decoded = decodeChallengeResponse(response);
  if (!decoded.ok) {
    return { ok: false, reason: decoded.reason, status: decoded.status, paymentSent: false, revenueRecognized: false, offer: null };
  }
  const offer = bindUnpaidOffer({
    challenge: decoded.challenge,
    requestedUrl: url,
    target: assessment.target,
    receivedAt: now,
  });
  return {
    ok: offer.ok,
    reason: offer.reason,
    status: response.status,
    paymentSent: false,
    revenueRecognized: false,
    offer: offer.ok ? { ...offer, challenge: decoded.challenge } : null,
    challenge: decoded.challenge,
  };
}

export async function declineOffer({ fetchImpl = fetch, merchantBase, assessment, actor }) {
  if (!assessment?.eligible) return { ok: false, reason: "not_eligible", paymentSent: false, revenueRecognized: false };
  const claim = { journey: assessment.journeyId, diagnosis: assessment.diagnosisId, actor, decision: "decline" };
  const { response } = await fetchOperation({ fetchImpl, merchantBase, target: assessment.target, claim });
  return {
    ok: response.status === 402,
    reason: response.status === 402 ? "explicit_decline" : "offer_not_presented",
    status: response.status,
    paymentSent: false,
    revenueRecognized: false,
  };
}

function responseSettlement(response) {
  const encoded = response.headers?.get?.("payment-response");
  if (!encoded) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const reference = payload?.transaction || payload?.txHash || null;
    return TX.test(String(reference || "")) ? String(reference).toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function purchaseAuthorized({
  fetchImpl = fetch,
  merchantBase,
  assessment,
  authorization,
  now = Date.now(),
  testMode = false,
  priorEvents = [],
  session = null,
}) {
  const stopped = { paymentSent: false, revenueRecognized: false, testMode: testMode === true };
  if (!assessment?.eligible) return { ...stopped, ok: false, reason: "not_eligible" };
  const restart = planRestart({ events: priorEvents, journeyId: assessment.journeyId, session });
  if (restart.action === "stop") return { ...stopped, ok: false, ...restart };
  const preview = await presentOffer({ fetchImpl, merchantBase, assessment, actor: authorization?.actor, now });
  if (!preview.ok) return { ...stopped, ok: false, reason: preview.reason, status: preview.status };
  const decision = authorizePurchase({
    authorization: { ...authorization, expectedTarget: assessment.target },
    offer: preview.offer,
    now,
  });
  if (!decision.ok) return { ...stopped, ok: false, reason: decision.reason, offer: preview.offer };
  if (testMode !== true) return { ...stopped, ok: false, reason: "live_payment_refused", offer: preview.offer };
  session?.mark(assessment.journeyId, "in_flight");
  let payment;
  try {
    payment = createTestModePayment(preview.challenge, { now });
  } catch (error) {
    session?.mark(assessment.journeyId, "known_rejection");
    return { ...stopped, ok: false, reason: "terms_incomplete", error: String(error?.message || error) };
  }
  const claim = { journey: assessment.journeyId, diagnosis: assessment.diagnosisId, actor: authorization.actor, decision: "attempt" };
  let response;
  let body = null;
  try {
    const fetched = await fetchOperation({
      fetchImpl,
      merchantBase,
      target: assessment.target,
      claim,
      payment,
    });
    response = fetched.response;
    if (response.status !== 402) body = await response.json().catch(() => null);
  } catch (error) {
    session?.mark(assessment.journeyId, "unknown_financial");
    return { ...stopped, ok: false, paymentSent: true, reason: "delivery_failed", financialOutcome: "unknown", error: String(error?.message || error) };
  }
  const settlementReference = responseSettlement(response);
  const useful = response.status >= 200 && response.status < 300
    ? assessSellerIntegrityUsefulness(body, assessment.target)
    : { useful: false, reason: response.status === 402 ? "offer_not_presented" : "delivery_failed" };
  let financialOutcome = "known_rejection";
  if (settlementReference) financialOutcome = "settled_observed";
  else if (response.status >= 200 && response.status < 300) financialOutcome = "unknown";
  else if (response.status >= 500) financialOutcome = "unknown";
  session?.mark(
    assessment.journeyId,
    financialOutcome === "unknown" ? "unknown_financial" : financialOutcome === "settled_observed" ? "settled" : "known_rejection",
  );
  return {
    ok: useful.useful === true,
    reason: useful.useful ? "useful_delivery" : useful.reason,
    status: response.status,
    paymentSent: true,
    testMode: true,
    settlementReference,
    financialOutcome,
    usefulDelivery: useful.useful ? "true" : "false",
    usefulReason: useful.reason,
    body,
    revenueRecognized: false,
  };
}

export async function recordLaterReuse({ fetchImpl = fetch, merchantBase, assessment, actor, usefulDelivery }) {
  if (usefulDelivery !== "true") {
    return { ok: false, reason: "useful_delivery_required", paymentSent: false, revenueRecognized: false };
  }
  const claim = { journey: assessment.journeyId, diagnosis: assessment.diagnosisId, actor, decision: "reuse" };
  const { response } = await fetchOperation({ fetchImpl, merchantBase, target: assessment.target, claim });
  return {
    ok: response.status === 402,
    reason: response.status === 402 ? "later_task_reuse" : "reuse_not_recorded",
    status: response.status,
    paymentSent: false,
    revenueRecognized: false,
  };
}

function stageEventId(events, predicate) {
  const found = events.find(predicate);
  return found?.id ?? null;
}

export function joinPaidUsefulJourney({ events = [], forwardRecords = [], journeyId, claimedSettlement = null }) {
  const related = (events || []).filter((event) => journeyOf(event)?.journey === journeyId);
  const labels = [...new Set(related.map((event) => actorLabel(journeyOf(event)?.actor)))];
  const actor = labels.length === 1 ? labels[0] : "unknown";
  const challenge = (event) => event?.result === "challenge" && Number(event.status) === 402;
  const attempt = (event) => journeyOf(event)?.decision === "attempt" && event.paymentPresent === true;
  const attempts = related.filter(attempt);
  const references = [...new Set(attempts.map((event) => String(event.settlementReference || "").toLowerCase()).filter((value) => TX.test(value)))];
  const claim = typeof claimedSettlement === "string" && claimedSettlement ? claimedSettlement.toLowerCase() : null;
  let settlement = "unknown";
  if (claim && !references.includes(claim)) settlement = "false_claim";
  else if (references.length === 1) settlement = "present";
  else if (references.length > 1) settlement = "unknown";
  const usefulValues = attempts.map((event) => journeyOf(event)?.usefulDelivery).filter((value) => value === "true" || value === "false");
  let useful = "unknown";
  if (usefulValues.includes("true")) useful = "true";
  else if (usefulValues.includes("false")) useful = "false";
  const reuseEvent = related.some((event) => journeyOf(event)?.decision === "reuse") && useful === "true";
  const reuseForward = (forwardRecords || []).some((record) => (
    record?.schemaVersion === "samedaydesk.outcome-binding.forward.v2"
    && record.stage === "retained_use"
    && record.operationId === journeyId
  ));
  const stages = {
    eligible_diagnosis: related.some((event) => DIAGNOSIS_HEX_64.test(journeyOf(event)?.diagnosis || "")) ? "present" : "unknown",
    offered_operation: related.some((event) => challenge(event) && ["offer", "decline"].includes(journeyOf(event)?.decision)) ? "present" : "unknown",
    explicit_decline: related.some((event) => journeyOf(event)?.decision === "decline" && challenge(event)) ? "present" : "unknown",
    explicit_attempt: attempts.length ? "present" : "unknown",
    settlement,
    useful_delivery: useful,
    later_task_reuse: reuseEvent || reuseForward ? "present" : "unknown",
  };
  return {
    schemaVersion: PAID_USEFUL_JOURNEY_JOIN_SCHEMA,
    journey: journeyId,
    actorLabel: actor,
    revenueRecognized: false,
    attemptCount: attempts.length,
    settlementReference: references.length === 1 ? references[0] : null,
    rejectedSettlementClaim: settlement === "false_claim" ? claim : null,
    stages,
    evidence: {
      eligible_diagnosis: stageEventId(related, (event) => DIAGNOSIS_HEX_64.test(journeyOf(event)?.diagnosis || "")),
      offered_operation: stageEventId(related, (event) => challenge(event) && ["offer", "decline"].includes(journeyOf(event)?.decision)),
      explicit_decline: stageEventId(related, (event) => journeyOf(event)?.decision === "decline" && challenge(event)),
      explicit_attempt: stageEventId(attempts, () => true),
      settlement: stageEventId(attempts, (event) => TX.test(String(event.settlementReference || ""))),
      useful_delivery: stageEventId(attempts, (event) => journeyOf(event)?.usefulDelivery === "true" || journeyOf(event)?.usefulDelivery === "false"),
      later_task_reuse: stageEventId(related, (event) => journeyOf(event)?.decision === "reuse"),
    },
    missing: Object.entries(stages).filter(([, value]) => value === "unknown").map(([key]) => key),
  };
}

export async function loadCommerceJourneyFiles(dataDir) {
  async function lines(name) {
    try {
      return await readFile(path.join(dataDir, name), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return "";
      throw error;
    }
  }
  const events = [];
  const forwardRecords = [];
  let unreadable = 0;
  for (const name of ["commerce-events.1.ndjson", "commerce-events.ndjson"]) {
    for (const line of (await lines(name)).split("\n")) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { unreadable += 1; }
    }
  }
  for (const name of ["commerce-outcome-binding.1.ndjson", "commerce-outcome-binding.ndjson"]) {
    for (const line of (await lines(name)).split("\n")) {
      if (!line.trim()) continue;
      try { forwardRecords.push(JSON.parse(line)); } catch { unreadable += 1; }
    }
  }
  return { events, forwardRecords, unreadable };
}
