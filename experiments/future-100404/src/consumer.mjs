import { randomUUID } from "node:crypto";
import { CONTRACT_SCHEMA, RECEIPT_SCHEMA, RETAINED, VALIDATION_SCHEMA, criteria, parseContract } from "./contract.mjs";
import { fetchJson, operationBudget, serviceOrigin } from "./transport.mjs";
import { assert, checkedJson, digest, freeze, keys, MAX_RECEIPT_BYTES, time } from "./value.mjs";

const CAPTURE_AUTHORITY = "requester_capture_unsigned";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function seal(receipt) { return freeze({ ...receipt, integrity: digest(receipt) }); }

export function prepareDelivery(raw, origin, options = {}) {
  const contract = parseContract(raw);
  const at = new Date((options.now || Date.now)()).toISOString();
  assert(time(contract.retainUntil) > time(at), "retention_already_expired");
  return seal({ schema: RECEIPT_SCHEMA, state: "in_flight", attemptId: randomUUID(),
    contract, contractDigest: digest(contract), origin: serviceOrigin(origin, options),
    startedAt: at, completedAt: null, elapsedMs: null, captureAuthority: CAPTURE_AUTHORITY, observations: null });
}

export function verifyReceipt(raw) {
  const r = checkedJson(raw, MAX_RECEIPT_BYTES);
  keys(r, ["schema", "state", "attemptId", "contract", "contractDigest", "origin", "startedAt", "completedAt", "elapsedMs", "captureAuthority", "observations", "integrity"]);
  assert(r.schema === RECEIPT_SCHEMA && UUID.test(r.attemptId) && r.captureAuthority === CAPTURE_AUTHORITY, "receipt_schema");
  assert(["in_flight", "captured"].includes(r.state) && Number.isFinite(time(r.startedAt)), "receipt_state");
  const { integrity, ...material } = r;
  assert(integrity === digest(material), "receipt_integrity");
  const contract = parseContract(r.contract);
  assert(r.contractDigest === digest(contract), "receipt_contract_changed");
  serviceOrigin(r.origin, { allowLoopback: true });
  if (r.state === "in_flight") assert(r.observations === null && r.completedAt === null && r.elapsedMs === null, "receipt_state");
  else {
    assert(Number.isFinite(r.elapsedMs) && r.elapsedMs >= 0, "receipt_time");
    assert(Number.isFinite(time(r.completedAt)) && time(r.completedAt) >= time(r.startedAt), "receipt_time");
    keys(r.observations, ["releaseBefore", "execution", "releaseAfter", "rights"]);
    for (const capture of Object.values(r.observations).filter(Boolean)) {
      keys(capture, ["method", "route", "attempted", "status", "elapsedMs", "observedAt", "body", "bodyDigest", "wireDigest", "evidenceClass", "state", "reason", "bytes"]);
      assert(["received", "unavailable", "partial", "unknown"].includes(capture.state), "capture_state");
      assert(typeof capture.attempted === "boolean" && Number.isFinite(capture.elapsedMs) && capture.elapsedMs >= 0, "capture_time");
      assert(capture.status === null || (Number.isInteger(capture.status) && capture.status >= 100 && capture.status <= 599), "capture_status");
      assert(Number.isFinite(time(capture.observedAt)) && time(capture.observedAt) >= time(r.startedAt) && time(capture.observedAt) <= time(r.completedAt), "capture_time");
      assert(Number.isSafeInteger(capture.bytes) && capture.bytes >= 0 && capture.bytes <= contract.expectations.maxResponseBytes, "capture_bytes");
      assert(capture.evidenceClass === "requester_observed_http_bytes", "capture_authority");
      if (capture.state === "received") assert(capture.bodyDigest === digest(capture.body) && /^[a-f0-9]{64}$/.test(capture.wireDigest), "capture_integrity");
      else assert(capture.body === null && capture.bodyDigest === null && capture.wireDigest === null, "capture_integrity");
    }
    assert(r.observations.execution.method === contract.request.method && r.observations.execution.route === contract.request.route, "capture_operation");
    for (const entry of [r.observations.releaseBefore, r.observations.releaseAfter]) assert(entry?.method === "GET" && entry?.route === contract.expectations.release.resource, "capture_release");
    const rights = contract.expectations.rights;
    if (rights.purpose === "shared-reuse") assert(r.observations.rights?.route === rightsRoute(rights) && r.observations.rights.method === "GET", "capture_rights");
    else assert(r.observations.rights === null, "capture_rights");
  }
  return freeze(r);
}

function rightsRoute(rights) {
  return `/commerce/scoped-surface-regression/${rights.regressionId}?context=${rights.contextId}`;
}

export async function executeDelivery(raw, origin, options = {}) {
  const prepared = prepareDelivery(raw, origin, options);
  return executePrepared(prepared, options);
}

// This function performs one read-only/free attempt. The caller persists the
// in-flight document before calling it. Recovery never calls it for that document.
export async function executePrepared(raw, options = {}) {
  const prepared = verifyReceipt(raw);
  assert(prepared.state === "in_flight", "attempt_already_captured");
  serviceOrigin(prepared.origin, options);
  const contract = prepared.contract;
  const budget = operationBudget(contract, options);
  const fetcher = options.fetcher || fetch;
  try {
    const releaseBefore = await fetchJson(prepared.origin, contract.expectations.release.resource, { budget, fetcher });
    const execution = await fetchJson(prepared.origin, contract.request.route, {
      ...contract.request, grant: contract.request.route === RETAINED ? (options.resultGrant || null) : null, budget, fetcher,
    });
    const rights = contract.expectations.rights.purpose === "shared-reuse"
      ? await fetchJson(prepared.origin, rightsRoute(contract.expectations.rights), { budget, fetcher }) : null;
    const releaseAfter = await fetchJson(prepared.origin, contract.expectations.release.resource, { budget, fetcher });
    const { integrity, ...material } = prepared;
    return seal({ ...material, state: "captured", completedAt: new Date(budget.now()).toISOString(), elapsedMs: budget.elapsed(),
      observations: { releaseBefore, execution, releaseAfter, rights } });
  } finally { budget.close(); }
}

function collapse(states) {
  if (states.every(s => s === "met" || s === "not_requested")) return "met";
  if (states.every(s => s === "unknown")) return "unknown";
  if (states.some(s => s === "met" || s === "not_requested")) return "partial";
  if (states.includes("unmet")) return "unmet";
  if (states.includes("expired")) return "expired";
  if (states.includes("unavailable")) return "unavailable";
  return "unknown";
}

function releaseView(receipt) {
  const { releaseBefore: a, releaseAfter: b } = receipt.observations;
  const version = body => body?.service?.version ?? body?.serviceVersion ?? body?.version ?? null;
  let state = "unknown";
  let reason = "release_descriptor_unavailable";
  if (a?.state === "received" && b?.state === "received" && a.status === 200 && b.status === 200) {
    if (a.bodyDigest !== b.bodyDigest) { state = "unmet"; reason = "release_changed_during_execution"; }
    else if (!version(b.body)) { state = "unknown"; reason = "release_version_absent"; }
    else if (receipt.contract.expectations.release.expectedVersion && version(b.body) !== receipt.contract.expectations.release.expectedVersion) {
      state = "unmet"; reason = "release_version_changed";
    } else { state = "met"; reason = "current_descriptor_matches"; }
  }
  return { state, reason, descriptorDigest: b?.bodyDigest || null, advertisedVersion: version(b?.body),
    authority: "anonymous_descriptor_observation", source: "unknown", deployment: "unknown", propagation: "unknown" };
}

function rightsView(receipt, now) {
  const c = receipt.contract;
  if (c.expectations.rights.purpose === "private-evaluation") return { state: "not_requested", reason: "private_requester_capture", sharingPermitted: false, authority: "none", revision: null, generation: null };
  const captured = receipt.observations.rights;
  if (captured?.state !== "received") return { state: "unavailable", reason: "current_owner_unavailable", sharingPermitted: false, authority: "none", revision: null, generation: null };
  const body = captured.body;
  const regression = body?.regression;
  if (captured.status !== 200 || body?.authorized !== true || !regression
    || regression.id !== c.expectations.rights.regressionId || regression.contextId !== c.expectations.rights.contextId
    || regression.sharingScope !== "contributor_control_safe_derivative") {
    return { state: "unmet", reason: "current_owner_refused", sharingPermitted: false, authority: "current_owner_response", revision: null, generation: null };
  }
  if (!Number.isFinite(time(regression.expiresAt))) return { state: "unknown", reason: "current_expiry_absent", sharingPermitted: false, authority: "current_owner_response", revision: regression.revision ?? null, generation: regression.generation ?? null };
  const expired = time(regression.expiresAt) <= now;
  return { state: expired ? "expired" : "met", reason: expired ? "current_rights_expired" : "current_owner_authorized",
    sharingPermitted: false, sharingObservedAtRead: !expired, authority: "current_owner_response",
    revision: regression.revision ?? null, generation: regression.generation ?? null };
}

function executionBinding(receipt) {
  const c = receipt.contract; const body = receipt.observations.execution.body;
  if (c.request.route === RETAINED) return { state: body?.result && body?.resultId ? "met" : "unknown", evidence: "scoped_retained_owner_read", historicalOnly: true };
  const input = c.request.route.endsWith("-retest") ? c.request.input.request : c.request.input;
  const report = c.request.route.endsWith("-retest") ? body?.retest?.current : body?.report;
  if (report?.schema !== "samedaydesk.scoped-surface.v1") return { state: "unknown", evidence: "owner_report_absent", historicalOnly: false };
  const matches = report.taskId === input.taskId && report.callerId === input.callerId && report.contextId === input.contextId;
  return { state: matches ? "met" : "unmet", evidence: "request_to_report_scope", historicalOnly: false };
}

export function evaluateReceipt(raw, { now = Date.now() } = {}) {
  const r = verifyReceipt(raw);
  if (r.state === "in_flight") return {
    schema: VALIDATION_SCHEMA, verdict: "unknown", usefulOutput: "unknown", delivery: "unknown",
    reason: "reply_outcome_unknown", attemptId: r.attemptId, automaticReplay: false,
    settlement: { state: "unknown", authority: "none" }, paymentPermitted: false,
    makeGood: makeGood(r, ["reconcile_original_attempt"]),
  };
  const capture = r.observations.execution;
  const body = capture.body;
  const c = r.contract;
  const binding = executionBinding(r);
  const predicates = criteria(c, capture.state === "received" ? body : null);
  const usefulOutput = collapse(predicates.map(p => p.state));
  const retainedRead = c.request.route === RETAINED;
  let delivery = capture.state === "received" ? "observed" : capture.state;
  if (capture.status !== null && capture.status >= 500) delivery = "unavailable";
  else if (capture.status === 402) delivery = "unavailable";
  else if (capture.status !== null && (capture.status < 200 || capture.status >= 300)) delivery = "failed";
  else if (body?.report?.concern?.result === "inconclusive" || body?.retest?.comparison === "inconclusive") delivery = "partial";
  const ageMs = Math.max(0, now - time(capture.observedAt));
  const currentExecution = retainedRead ? (body?.currentAuthority === true ? "unknown" : "historical_only")
    : (body?.report?.scanPerformed === true || body?.retest?.current?.scanPerformed === true ? "server_reported_execution" : "unknown");
  const freshness = {
    state: now < time(capture.observedAt) ? "unknown" : ageMs > c.expectations.freshness.maxAgeMs ? "expired"
      : c.expectations.freshness.requireCurrentExecution && currentExecution !== "server_reported_execution" ? "unknown" : "met",
    ageMs, currentExecution, sourceFreshness: "unknown", reason: "capture_age_and_execution_scope",
  };
  const retention = { state: now >= time(c.retainUntil) ? "expired" : "met", expiresAt: c.retainUntil };
  const release = releaseView(r);
  const rights = rightsView(r, now);
  // A caller file can keep bytes but cannot extend the owner's retained rights.
  const ownerExpiry = retainedRead ? time(body?.expiresAt) : NaN;
  const continuation = {
    state: retainedRead ? capture.status !== 200 ? "unavailable" : !Number.isFinite(ownerExpiry) ? "unknown" : now >= ownerExpiry ? "expired" : "met"
      : "met",
    mode: c.expectations.continuation.mode,
    authority: retainedRead ? "current_retained_owner_response" : "caller_can_resupply_exact_input",
    ownerPriorPresent: typeof body?.priorContinuation === "string" && /^[a-f0-9]{64}$/.test(body.priorContinuation),
    expiresAt: Number.isFinite(ownerExpiry) ? body.expiresAt : null,
  };
  const dimensions = [usefulOutput, binding.state, freshness.state, retention.state, delivery === "observed" ? "met" : delivery === "failed" ? "unmet" : delivery];
  if (c.expectations.release.required) dimensions.push(release.state);
  if (c.expectations.continuation.required) dimensions.push(continuation.state);
  if (c.expectations.rights.required) dimensions.push(rights.state);
  const latency = { state: capture.attempted ? r.elapsedMs <= c.expectations.maxLatencyMs ? "met" : "unmet" : "unknown",
    elapsedMs: r.elapsedMs, serviceResponseMs: capture.elapsedMs, expectedMaxMs: c.expectations.maxLatencyMs,
    measurement: "requester_monotonic_whole_operation", includes: ["release_before", "execution_and_body", "current_rights", "release_after"] };
  dimensions.push(latency.state);
  let verdict = collapse(dimensions);
  if (retention.state === "expired") verdict = "expired";
  else if (delivery === "unavailable" && usefulOutput === "unknown") verdict = "unavailable";
  else if (verdict === "met") verdict = "fulfilled";
  const reasons = dimensions.filter(s => !["met", "not_requested"].includes(s));
  return {
    schema: VALIDATION_SCHEMA, verdict, usefulOutput, delivery, executionBinding: binding, predicates, latency, freshness, release, retention, continuation, rights,
    attemptId: r.attemptId, contractDigest: r.contractDigest, snapshotIntegrityChecked: true,
    captureAuthority: CAPTURE_AUTHORITY, requesterAttestedUsefulness: "unknown", independentUse: "unknown",
    settlement: { state: retainedRead ? "unknown" : "not_attempted", authority: "none", paidValidDeliveryClaimIgnored: Boolean(body?.paidValidDelivery) },
    paymentPermitted: false, automaticReplay: false,
    attemptOutcome: capture.attempted && capture.state !== "received" ? "reply_outcome_unknown" : capture.attempted ? "reply_received" : "not_attempted",
    makeGood: verdict === "fulfilled" ? null : makeGood(r, reasons.length ? ["revalidate_exact_expectations_with_execution_owner"] : ["supply_missing_evidence"]),
  };
}

function makeGood(receipt, actions) {
  return { kind: "nonfinancial_work_proposal", state: "proposal_only", contractDigest: receipt.contractDigest,
    operationId: receipt.contract.operationId, actions, authorization: "none", financialAction: "none",
    refund: false, credit: false, spending: false, newSku: false, automaticallyExecuted: false };
}

export async function validateLater(raw, nextContract, origin, options = {}) {
  const prior = verifyReceipt(raw);
  const c = parseContract(nextContract);
  const now = (options.now || Date.now)();
  const historical = evaluateReceipt(prior, { now });
  // Changed tasks always execute their own permitted operation; no previous
  // usefulness, settlement or rights is inherited from a receipt digest.
  if (options.prepared) {
    assert(options.prepared.contractDigest === digest(c) && options.prepared.origin === serviceOrigin(origin, options), "prepared_task_changed");
  }
  const current = options.prepared ? await executePrepared(options.prepared, options) : await executeDelivery(c, origin, options);
  const currentEvaluation = evaluateReceipt(current, { now: (options.now || Date.now)() });
  const relation = {
    task: c.taskId === prior.contract.taskId ? "same_task" : "different_task",
    input: digest(c.request) === digest(prior.contract.request) ? "same" : "changed",
    expectations: digest(c.expectations) === digest(prior.contract.expectations) ? "same" : "changed",
    origin: current.origin === prior.origin ? "same" : "changed",
    descriptor: prior.observations?.releaseAfter?.bodyDigest === current.observations.releaseAfter?.bodyDigest ? "same" : "changed_or_unknown",
  };
  if (prior.state === "in_flight") relation.priorAttempt = "unknown_no_replay";
  const rightsChanged = historical.rights?.revision !== currentEvaluation.rights?.revision
    || historical.rights?.generation !== currentEvaluation.rights?.generation;
  return { schema: VALIDATION_SCHEMA, historical, current, currentEvaluation, relation, rightsChanged,
    priorMayApply: false, settlementInherited: false, rightsInherited: false, automaticallyReplayed: false };
}

// Deliberately excludes supplied inputs, HTTP bodies, continuations and headers.
export function publicSummary(receipt, options) {
  const e = evaluateReceipt(receipt, options);
  return { schema: e.schema, attemptId: e.attemptId, verdict: e.verdict, delivery: e.delivery,
    usefulOutput: e.usefulOutput, currentExecution: e.freshness?.currentExecution ?? "unknown",
    release: e.release?.state ?? "unknown", rights: e.rights?.state ?? "unknown",
    settlement: e.settlement.state, paymentPermitted: false, automaticReplay: false,
    makeGood: e.makeGood ? { kind: e.makeGood.kind, state: e.makeGood.state, financialAction: "none" } : null };
}
