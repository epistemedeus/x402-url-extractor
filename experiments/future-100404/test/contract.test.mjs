import test from "node:test";
import assert from "node:assert/strict";
import { parseContract, criteria } from "../src/contract.mjs";
import { contract } from "./caller.mjs";
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
    c => { c.expectations.usefulOutput[0].pointer = "/missing/constructor/x"; },
    c => { c.retainUntil = "2026-02-31T00:00:00.000Z"; },
    c => { c.expectations.deadlineMs = Infinity; },
    c => { c.expectations.rights.authorized = true; },
    c => { c.request.authorization = "unaccepted"; },
    c => { c.expectations.usefulOutput = []; },
    c => { c.taskId = null; c.request.input.taskId = null; },
    c => { c.operationId = 123; },
    c => { c.expectations.usefulOutput[0].id = null; },
    c => { c.expectations.rights = { purpose: "shared-reuse", regressionId: null, contextId: 123, required: true }; },
  ]) { const c = contract(); change(c); assert.throws(() => parseContract(c)); }
});
test("HTTP-shaped claims do not answer a caller predicate; useful negatives can", () => {
  assert.deepEqual(criteria(parseContract(contract()), { status: 200, paidValidDelivery: true }).map(p => p.state), ["unknown", "unknown"]);
  const c = contract(); c.expectations.usefulOutput[1].value = "match";
  assert.deepEqual(criteria(parseContract(c), { report: { scanPerformed: true, concern: { result: "match" } } }).map(p => p.state), ["met", "met"]);
});
