import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildReport, classifyCheck, loadCorpus, loadProfile, UNEXPLAINED } from "../src/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(readFileSync(join(root, "fixtures/runner/server-legs.synthetic-shape.json"), "utf8"));
const profile = loadProfile();
const cases = loadCorpus();
const check = (id, status, extra = {}) => ({ id, name: id, description: id, status, timestamp: "2026-11-12T12:00:00.000Z", ...extra });
const classify = (revision, scenario, value, options = {}) => classifyCheck({ revision, scenario, check: value }, { profile, cases, ...options });

test("fixture is honestly marked synthetic-shape", () => {
  assert.equal(fixture.synthetic, true);
  assert.match(fixture.honesty, /not produced by running the official runner/);
});

test("successful: a passing applicable check", () => {
  const result = classify("2025-11-25", "tools-list", check("tools-list", "SUCCESS"));
  assert.equal(result.outcomeClass, "successful");
  assert.equal(result.blocking, false);
});

test("not_applicable: a fixture-tool scenario outside the free profile, and a runner SKIPPED check", () => {
  const fixtureTool = classify("2025-11-25", "tools-call-simple-text", check("tools-call-simple-text", "FAILURE", { errorMessage: "Unknown tool" }));
  assert.equal(fixtureTool.outcomeClass, "not_applicable");
  assert.match(fixtureTool.reason, /fixture tool/);
  const skipped = classify("2025-11-25", "server-session-lifecycle", check("session-delete-accepted", "SKIPPED"));
  assert.equal(skipped.outcomeClass, "not_applicable");
});

test("unsupported: the refused 2026-07-28 wire and the undeclared Tasks extension", () => {
  const stateless = classify("2026-07-28", "server-stateless", check("sep-2575-server-implements-discover", "FAILURE"));
  assert.equal(stateless.outcomeClass, "unsupported");
  assert.equal(stateless.caseRef, "CK-N12-002");
  const tasks = classify("2026-07-28", "tasks-lifecycle", check("tasks-lifecycle", "FAILURE"));
  assert.equal(tasks.outcomeClass, "unsupported");
  assert.match(tasks.reason, /Tasks extension is not declared/);
});

test("known_failure: a failing check that matches a corpus case's recorded negative", () => {
  const injected = structuredClone(cases[0]);
  injected.runnerMatch = { revision: "2025-11-25", scenario: "ping", checkId: "ping", errorPattern: "Unknown tool" };
  const result = classify("2025-11-25", "ping", check("ping", "FAILURE", { errorMessage: "MCP error -32602: Unknown tool" }), { cases: [injected] });
  assert.equal(result.outcomeClass, "known_failure");
  assert.equal(result.caseRef, "CK-N12-001");
  const other = classify("2025-11-25", "ping", check("ping", "FAILURE", { errorMessage: "socket hang up" }), { cases: [injected] });
  assert.equal(other.outcomeClass, UNEXPLAINED);
});

test("harness_failure: synthetic runner timeout, harness wire error, failed-to-run, and an unknown status", () => {
  assert.equal(classify("2025-11-25", "ping", check("scenario-timeout", "FAILURE")).outcomeClass, "harness_failure");
  assert.equal(classify("2025-11-25", "ping", check("wire-schema-harness-error", "FAILURE")).outcomeClass, "harness_failure");
  assert.equal(classify("2025-11-25", "ping", check("ping", "FAILURE", { description: "Failed to run scenario" })).outcomeClass, "harness_failure");
  assert.equal(classify("2025-11-25", "ping", check("ping", "MAYBE")).outcomeClass, "harness_failure");
});

test("unexplained: an applicable failure is never excused and blocks the baseline", () => {
  const result = classify("2025-11-25", "ping", check("ping", "FAILURE", { errorMessage: "timeout" }));
  assert.equal(result.outcomeClass, UNEXPLAINED);
  assert.equal(result.blocking, true);
  const warning = classify("2025-11-25", "tools-list", check("tools-list-deterministic-order", "WARNING"));
  assert.equal(warning.outcomeClass, UNEXPLAINED);
  assert.equal(warning.blocking, false);
});

test("report: exit 0 on the recorded baseline is baseline-relative, not universal conformance", () => {
  const report = buildReport(fixture.legs, { profile, cases });
  assert.equal(report.exitCode, 0);
  assert.equal(report.scope, "baseline-relative");
  assert.equal(report.universalConformance, false);
  assert.equal(report.certification, false);
  assert.match(report.statement, /not universal conformance/);
  assert.equal(report.runner.version, "0.2.0-alpha.12");
  assert.ok(report.totals.successful > 0);
  assert.ok(report.totals.not_applicable > 0);
  assert.ok(report.totals.unsupported > 0);
  assert.equal(report.totals.harness_failure, 0);
  const stateless = report.revisions.find((rev) => rev.revision === "2026-07-28");
  assert.equal(stateless.served, false);
  assert.equal(stateless.runnerExitCodeIsVerdict, false);
  const tasks = stateless.scenarios.find((item) => item.scenario === "tasks-lifecycle");
  assert.equal(tasks.outcomeClass, "unsupported");
  assert.equal(tasks.scored, false);
});

test("report: a served scenario with no checks.json is a harness failure and fails the run", () => {
  const legs = structuredClone(fixture.legs);
  legs[0].scenarios = legs[0].scenarios.filter((item) => item.scenario !== "ping");
  const report = buildReport(legs, { profile, cases });
  assert.equal(report.exitCode, 1);
  const ping = report.revisions[0].scenarios.find((item) => item.scenario === "ping");
  assert.equal(ping.outcomeClass, "harness_failure");
});

test("report: a runner that produced nothing is a harness failure, not a pass", () => {
  const report = buildReport([{ revision: "2025-11-25", exitCode: 0, scenarios: [] }], { profile, cases });
  assert.equal(report.exitCode, 1);
  assert.equal(report.totals.harness_failure, 1);
});
