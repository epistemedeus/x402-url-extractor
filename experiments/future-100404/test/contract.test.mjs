import test from "node:test";
import assert from "node:assert/strict";
import { parseContract, criteria, CONTRACT_SCHEMA } from "../src/contract.mjs";

export function contract(overrides = {}) {
  return {
    schema: CONTRACT_SCHEMA, taskId: "caller-task", operationId: "caller-scan",
    request: { method: "POST", route: "/commerce/scoped-surface-scan", input: {
      taskId: "caller-task", callerId: "caller-one", contextId: "private-one",
      concern: { id: "rule:env-exfil", statement: "Check supplied text for environment exfiltration." },
      files: [{ path: "index.js", text: "export const add = (a, b) => a + b;\n" }],
    } },
    expectations: {
      usefulOutput: [
        { id: "ran", pointer: "/report/scanPerformed", op: "equals", value: true },
        { id: "concern", pointer: "/report/concern/result", op: "equals", value: "no_match" },
      ], maxLatencyMs: 5000, deadlineMs: 10000, maxResponseBytes: 262144,
      freshness: { maxAgeMs: 3600000, requireCurrentExecution: true },
      release: { resource: "/api/actions", expectedVersion: "1.23.49", required: true },
      continuation: { mode: "reexecute", required: true },
      rights: { purpose: "private-evaluation", regressionId: null, contextId: null, required: false },
    }, retainUntil: "2026-11-01T00:00:00.000Z", ...overrides,
  };
}
test("caller task, input and all expectation dimensions are frozen", () => {
  const input = contract(); const parsed = parseContract(input);
  input.request.input.files[0].text = "changed";
  assert.notEqual(parsed.request.input.files[0].text, "changed");
  assert.ok(Object.isFrozen(parsed.request.input.files));
});
test("nonfree routes, arbitrary predicates, hidden authority and unbounded work are rejected", () => {
  for (const change of [
    c => { c.request.route = "/extract"; c.request.method = "GET"; },
    c => { c.expectations.usefulOutput[0].op = "eval"; },
    c => { c.expectations.usefulOutput[0].pointer = "/__proto__/x"; },
    c => { c.expectations.deadlineMs = Infinity; },
    c => { c.expectations.rights.authorized = true; },
    c => { c.request.authorization = "unaccepted"; },
    c => { c.expectations.usefulOutput = []; },
  ]) { const c = contract(); change(c); assert.throws(() => parseContract(c)); }
});
test("HTTP-shaped claims do not answer a caller predicate; useful negatives can", () => {
  assert.deepEqual(criteria(parseContract(contract()), { status: 200, paidValidDelivery: true }).map(p => p.state), ["unknown", "unknown"]);
  const c = contract(); c.expectations.usefulOutput[1].value = "match";
  assert.deepEqual(criteria(parseContract(c), { report: { scanPerformed: true, concern: { result: "match" } } }).map(p => p.state), ["met", "met"]);
});
