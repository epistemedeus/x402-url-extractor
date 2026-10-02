import { assert, checkedJson, digest, freeze, keys, pointer, time } from "./value.mjs";

export const CONTRACT_SCHEMA = "samedaydesk.service-delivery.contract.v1";
export const RECEIPT_SCHEMA = "samedaydesk.service-delivery.receipt.v1";
export const VALIDATION_SCHEMA = "samedaydesk.service-delivery.validation.v1";
export const SAFE_ROUTES = Object.freeze({
  "/commerce/scoped-surface-scan": "POST",
  "/commerce/scoped-surface-retest": "POST",
  "/.well-known/useful-result-reuse/retained": "GET",
});
export const RETAINED = "/.well-known/useful-result-reuse/retained";
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
function identity(value) { return typeof value === "string" && ID.test(value); }
function integer(n, min, max) { return Number.isSafeInteger(n) && n >= min && n <= max; }

export function parseContract(raw) {
  const c = checkedJson(raw);
  keys(c, ["schema", "taskId", "operationId", "request", "expectations", "retainUntil"]);
  assert(c.schema === CONTRACT_SCHEMA && identity(c.taskId) && identity(c.operationId), "contract_identity");
  keys(c.request, ["method", "route", "input"]);
  assert(SAFE_ROUTES[c.request.route] === c.request.method, "operation_not_free_or_supported");
  if (c.request.method === "GET") assert(c.request.input === null, "get_body_rejected");
  else assert(c.request.input && typeof c.request.input === "object" && !Array.isArray(c.request.input), "input_required");
  if (c.request.route === "/commerce/scoped-surface-scan") assert(c.request.input.taskId === c.taskId, "request_task_mismatch");
  if (c.request.route === "/commerce/scoped-surface-retest") assert(c.request.input.request?.taskId === c.taskId, "request_task_mismatch");
  const e = c.expectations;
  keys(e, ["usefulOutput", "maxLatencyMs", "deadlineMs", "maxResponseBytes", "freshness", "release", "continuation", "rights"]);
  assert(Array.isArray(e.usefulOutput) && e.usefulOutput.length >= 1 && e.usefulOutput.length <= 16, "criteria_required");
  const ids = new Set();
  for (const p of e.usefulOutput) {
    keys(p, ["id", "pointer", "op", "value"], ["id", "pointer", "op"]);
    assert(identity(p.id) && !ids.has(p.id), "criterion_identity"); ids.add(p.id);
    pointer({}, p.pointer);
    assert(["exists", "equals", "gte", "lte"].includes(p.op), "criterion_operator");
    if (p.op === "exists") assert(!Object.hasOwn(p, "value"), "criterion_value_rejected");
    else {
      assert(Object.hasOwn(p, "value") && (p.value === null || ["string", "boolean", "number"].includes(typeof p.value)), "scalar_criterion_required");
      assert(JSON.stringify(p.value).length <= 1024, "criterion_too_large");
      if (p.op !== "equals") assert(typeof p.value === "number", "numeric_criterion_required");
    }
  }
  assert(integer(e.maxLatencyMs, 1, 30000) && integer(e.deadlineMs, e.maxLatencyMs, 30000), "latency_bounds");
  assert(integer(e.maxResponseBytes, 1024, 512 * 1024), "response_bounds");
  keys(e.freshness, ["maxAgeMs", "requireCurrentExecution"]);
  assert(integer(e.freshness.maxAgeMs, 0, 30 * 86400000) && typeof e.freshness.requireCurrentExecution === "boolean", "freshness_bounds");
  keys(e.release, ["resource", "expectedVersion", "required"]);
  assert(e.release.resource === "/.well-known/agent-payment-evidence.json" && typeof e.release.required === "boolean", "release_resource");
  assert(e.release.expectedVersion === null || /^\d+\.\d+\.\d+$/.test(e.release.expectedVersion), "release_version");
  keys(e.continuation, ["mode", "required"]);
  assert(["reexecute", "retained-read"].includes(e.continuation.mode) && typeof e.continuation.required === "boolean", "continuation_mode");
  assert((c.request.route === RETAINED) === (e.continuation.mode === "retained-read"), "continuation_operation_mismatch");
  keys(e.rights, ["purpose", "regressionId", "contextId", "required"]);
  assert(["private-evaluation", "shared-reuse"].includes(e.rights.purpose) && typeof e.rights.required === "boolean", "rights_purpose");
  if (e.rights.purpose === "shared-reuse") assert(identity(e.rights.regressionId) && identity(e.rights.contextId), "rights_identity");
  else assert(e.rights.regressionId === null && e.rights.contextId === null, "rights_identity_rejected");
  assert(Number.isFinite(time(c.retainUntil)), "retention_time");
  return freeze(c);
}

export function criteria(contract, body) {
  return contract.expectations.usefulOutput.map(p => {
    const selected = pointer(body, p.pointer);
    if (!selected.present) return { id: p.id, state: "unknown", reason: "required_output_absent" };
    const met = p.op === "exists" || (p.op === "equals" && Object.is(selected.value, p.value))
      || (p.op === "gte" && typeof selected.value === "number" && selected.value >= p.value)
      || (p.op === "lte" && typeof selected.value === "number" && selected.value <= p.value);
    return { id: p.id, state: met ? "met" : "unmet", reason: met ? "caller_predicate_holds" : "caller_predicate_fails" };
  });
}
export function contractIdentity(contract) { return digest(parseContract(contract)); }
