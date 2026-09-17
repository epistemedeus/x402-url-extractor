import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { BIN, NEGATIVE_ROOT } from "./paths.mjs";

function runBin(args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: NEGATIVE_ROOT,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out: ${args.join(" ")}\n${stderr}`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function parseReport(stdout) {
  const text = stdout.trim();
  assert.ok(text.startsWith("{"), `expected JSON report, got: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

test("cli help exits 0", async () => {
  const result = await runBin(["help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /seeded-failure/);
});

test(
  "cli run: tools/list + negative tools/call against the real mounted MCP client",
  { timeout: 90_000 },
  async () => {
    const result = await runBin(["run"]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(report.status, "pass");
    assert.equal(report.toolsList.ok, true);
    assert.equal(report.toolsList.count, 1);
    assert.equal(report.negativeToolsCall.ok, true);
    assert.equal(report.negativeToolsCall.seededFailure.rejected, true);
    assert.match(result.stderr, /seeded-failure=rejected/);
    assert.equal(report.counters.handler, 0);
    assert.equal(report.counters.settle, 0);
  },
);

test(
  "cli seeded-failure: real client tools/call __seeded_unknown_tool__ is rejected (exit 0)",
  { timeout: 60_000 },
  async () => {
    const result = await runBin(["seeded-failure"]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(report.seededFailure.rejected, true);
    assert.match(result.stderr, /SEEDED_FAILURE rejected/);
    assert.match(result.stderr, /__seeded_unknown_tool__/);
    assert.match(result.stderr, /code=-32602/);
    assert.equal(report.seededFailure.layer, "mcp-protocol");
    assert.equal(report.seededFailure.code, -32602);
    assert.match(String(report.seededFailure.wire.resultText), /Tool __seeded_unknown_tool__ not found/);
  },
);

test(
  "cli classify --strict-rejected rejects the seeded accepted-unknown-tool fixture (exit 1)",
  { timeout: 15_000 },
  async () => {
    const result = await runBin([
      "classify",
      "--strict-rejected",
      "fixtures/reject/accepted-unknown-tool.json",
    ]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 1, result.stderr);
    assert.equal(report.observation.rejected, false);
    assert.equal(report.verdict, "accepted");
    assert.match(String(report.observation.message), /__seeded_unknown_tool__/);
  },
);

test("cli classify --all-reject treats paid-as-accepted unknown-tool bodies as reject fixtures", async () => {
  const result = await runBin(["classify", "--all-reject"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(report.ok, true);
  assert.ok(report.counted >= 2);
  assert.equal(report.rejectedAsExpected, report.counted);
});
