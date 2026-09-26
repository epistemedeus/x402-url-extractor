import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin/cli.mjs");

function run(args, { expectStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, expectStatus, result.stderr || result.stdout);
  return result;
}

test("cold run unpaid tools/call prints isError and unpaid_tools_call_is_error", () => {
  const result = run([]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.kind, "unpaid_tools_call_is_error");
  assert.equal(report.mcp.httpStatus, 200);
  assert.equal(report.mcp.isError, true);
  assert.equal(report.mcp.handlerRan, false);
  assert.equal(report.call.paid, false);
  assert.equal(report.boundary.paymentSent, false);
  assert.equal(report.boundary.live, false);
  assert.equal(report.boundary.kickoff, false);
  assert.equal(report.boundary.settlement, false);
  assert.equal(report.boundary.isErrorMeansPaid, false);
  assert.equal(report.crewai.call_tool_result.is_error, true);
  assert.equal(report.adapter.pin, "1.15.22");
  assert.equal(report.adapter.api, "MCPClient.call_tool_result");
  assert.ok(report.adapter.not.includes("MCPClient.call_tool"));
  assert.ok(report.adapter.not.includes("Agent.kickoff"));
});

test("help lists pins, call_tool trap, and copyable commands", () => {
  const result = run(["--help"]);
  assert.match(result.stdout, /1\.15\.22/);
  assert.match(result.stdout, /call_tool_result/);
  assert.match(result.stdout, /seeded-failure/);
  assert.match(result.stdout, /never pays/);
  assert.match(result.stdout, /isError:true/);
  assert.match(result.stdout, /Agent.kickoff/);
});

test("seeded false-success (dropped isError claimed paid) exits 1", () => {
  const result = run(["--seeded-failure"], { expectStatus: 1 });
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "SEED_REJECT");
  assert.equal(payload.kind, "false_success");
  assert.match(payload.error, /claimed paid_success/);
  assert.equal(payload.details.observed.kind, "unpaid_tools_call_is_error");
  assert.equal(payload.details.claimed.kind, "paid_success");
  assert.match(payload.details.trap, /call_tool drops isError/);
});

test("unknown and forbidden flags fail closed", () => {
  const unknown = run(["--wallet-key"], { expectStatus: 1 });
  assert.match(unknown.stdout, /unknown argument|--wallet/);
  for (const flag of ["--live", "--kickoff", "--approve", "--pay", "--neo", "--publish"]) {
    const refused = run([flag], { expectStatus: 1 });
    const payload = JSON.parse(refused.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "BOUNDARY_REFUSED");
  }
});

test("live SDS MCP URL is refused even via --mcp-url", () => {
  const result = run(["--mcp-url", "https://agents.samedaydesk.com/mcp"], { expectStatus: 1 });
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.ok(["LIVE_URL_REFUSED", "NON_LOOPBACK_REFUSED"].includes(payload.code));
});
