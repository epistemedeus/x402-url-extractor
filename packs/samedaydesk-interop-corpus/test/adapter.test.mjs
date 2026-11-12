import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseRequirementSet,
  readLegResults,
  resolveRunner,
  runLeg,
  runnerArgs,
  runOfficialConformance,
  buildReport,
  loadPin,
} from "../src/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(root, "fixtures/runner/server-legs.synthetic-shape.json");
const fakeEntry = join(root, "fixtures/runner/fake-runner.mjs");
const scratch = mkdtempSync(join(tmpdir(), "interop-corpus-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const REQUIREMENTS_SAMPLE = `# sample in the pinned runner's layout
server:
  - server-initialize
  - ping
client:
  - initialize
not_scored:
  - scenario: auth/dpop
    leg: client
    reason: extension
  - scenario: server-session-lifecycle
    leg: server
    reason: added-after-release
`;

function fakeRunner(name) {
  const requirementsDir = join(scratch, `${name}-requirements`);
  mkdirSync(requirementsDir, { recursive: true });
  writeFileSync(join(requirementsDir, "2025-11-25.yaml", ), "server:\n  - server-initialize\n  - ping\n  - tools-list\n  - tools-call-simple-text\n  - logging-set-level\n  - dns-rebinding-protection\nnot_scored:\n  - scenario: server-session-lifecycle\n    leg: server\n    reason: added-after-release\n");
  writeFileSync(join(requirementsDir, "2026-07-28.yaml"), "server:\n  - server-stateless\n  - tools-list\nnot_scored:\n  - scenario: tasks-lifecycle\n    leg: server\n    reason: extension\n");
  return { name: "@modelcontextprotocol/conformance", version: "0.2.0-alpha.12", entry: fakeEntry, requirementsDir };
}

function withEnv(values, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(values)) { saved[key] = process.env[key]; process.env[key] = value; }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test("parseRequirementSet reads the server leg and server not_scored entries only", () => {
  const set = parseRequirementSet(REQUIREMENTS_SAMPLE, "server");
  assert.deepEqual(set.scored, ["server-initialize", "ping"]);
  assert.deepEqual(set.notScored.map((item) => [item.scenario, item.reason]), [["server-session-lifecycle", "added-after-release"]]);
});

test("runnerArgs invokes the official server mode with a requirement set and an output dir", () => {
  const args = runnerArgs({ entry: "/x/dist/index.js", url: "http://127.0.0.1:1/mcp/page-change", revision: "2025-11-25", outDir: "/tmp/o", scenarioTimeoutMs: 5000 });
  assert.deepEqual(args, ["/x/dist/index.js", "server", "--url", "http://127.0.0.1:1/mcp/page-change", "--requirements", "2025-11-25", "--output-dir", "/tmp/o", "--timeout", "5000"]);
});

test("positive: adapter parses recorded-shape runner output for both wires into a baseline-relative report", async () => {
  const report = await withEnv({ FAKE_RUNNER_MODE: "fixture", FAKE_RUNNER_FIXTURE: fixturePath }, () => runOfficialConformance({
    url: "http://127.0.0.1:9/mcp/page-change",
    outRoot: join(scratch, "positive"),
    runner: fakeRunner("positive"),
    now: () => new Date("2026-11-12T12:00:00.000Z"),
  }));
  assert.equal(report.exitCode, 0);
  assert.equal(report.scope, "baseline-relative");
  assert.equal(report.universalConformance, false);
  assert.deepEqual(report.legs.map((leg) => [leg.revision, leg.exitCode, leg.parsedScenarios]), [["2025-11-25", 1, 7], ["2026-07-28", 1, 2]]);
  const served = report.revisions[0];
  assert.equal(served.scenarios.find((item) => item.scenario === "server-initialize").outcomeClass, "successful");
  assert.equal(served.scenarios.find((item) => item.scenario === "server-initialize").scored, true);
  assert.equal(served.scenarios.find((item) => item.scenario === "server-session-lifecycle").scored, false);
  assert.equal(served.scenarios.find((item) => item.scenario === "logging-set-level").outcomeClass, "not_applicable");
  const refused = report.revisions[1];
  assert.equal(refused.scenarios.every((item) => item.outcomeClass === "unsupported"), true);
  assert.equal(refused.scenarios.some((item) => item.scenario === "tasks-lifecycle"), true);
});

test("harness_failure: runner crash with an unexpected exit code", async () => {
  const report = await withEnv({ FAKE_RUNNER_MODE: "crash" }, () => runOfficialConformance({
    url: "http://127.0.0.1:9/mcp/page-change",
    outRoot: join(scratch, "crash"),
    runner: fakeRunner("crash"),
    revisions: ["2025-11-25"],
  }));
  assert.equal(report.exitCode, 1);
  assert.ok(report.totals.harness_failure >= 1);
  assert.match(report.legs[0].stderrTail, /simulated crash/);
});

test("harness_failure: runner hang is stopped at the leg timeout", async () => {
  const leg = await withEnv({ FAKE_RUNNER_MODE: "hang" }, () => runLeg({
    runner: fakeRunner("hang"),
    url: "http://127.0.0.1:9/mcp/page-change",
    revision: "2025-11-25",
    outDir: join(scratch, "hang"),
    legTimeoutMs: 500,
  }));
  assert.equal(leg.timedOut, true);
  const report = buildReport([leg]);
  assert.equal(report.exitCode, 1);
  assert.ok(report.totals.harness_failure >= 1);
});

test("harness_failure: unparseable checks.json", async () => {
  const leg = await withEnv({ FAKE_RUNNER_MODE: "garbled", FAKE_RUNNER_FIXTURE: fixturePath }, () => runLeg({
    runner: fakeRunner("garbled"),
    url: "http://127.0.0.1:9/mcp/page-change",
    revision: "2025-11-25",
    outDir: join(scratch, "garbled"),
  }));
  assert.equal(leg.scenarios.every((item) => typeof item.parseError === "string"), true);
  const report = buildReport([leg]);
  assert.equal(report.exitCode, 1);
});

test("recovery: classification can be rerun from saved result directories", async () => {
  const outRoot = join(scratch, "saved");
  await withEnv({ FAKE_RUNNER_MODE: "fixture", FAKE_RUNNER_FIXTURE: fixturePath }, () => runOfficialConformance({
    url: "http://127.0.0.1:9/mcp/page-change", outRoot, runner: fakeRunner("saved"),
  }));
  const scenarios = readLegResults(join(outRoot, "2025-11-25"));
  assert.equal(scenarios.length, 7);
  assert.equal(scenarios.every((item) => Array.isArray(item.checks)), true);
});

test("failure: a runner version other than the pin is refused and reported as a harness failure", async () => {
  const fakePkgDir = join(scratch, "wrong-runner");
  mkdirSync(fakePkgDir, { recursive: true });
  writeFileSync(join(fakePkgDir, "package.json"), JSON.stringify({ name: "@modelcontextprotocol/conformance", version: "0.1.16" }));
  assert.throws(() => resolveRunner({ resolve: () => join(fakePkgDir, "package.json") }), { code: "runner_version_mismatch" });
  const pin = structuredClone(loadPin());
  pin.officialRunner.package = "@samedaydesk/not-installed-runner";
  const report = await runOfficialConformance({
    url: "http://127.0.0.1:9/mcp/page-change",
    outRoot: join(scratch, "unresolved"),
    revisions: ["2025-11-25"],
    pin,
  });
  assert.equal(report.exitCode, 1);
  assert.ok(report.totals.harness_failure >= 1);
  assert.match(report.revisions[0].harness[0].reason, /runner did not start/);
});
