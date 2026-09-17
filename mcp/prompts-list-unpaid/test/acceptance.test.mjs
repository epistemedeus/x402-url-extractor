import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { CONFORMANCE_BIN, PACK_ROOT } from "../src/paths.mjs";

function runBin(args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CONFORMANCE_BIN, ...args], {
      cwd: PACK_ROOT,
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

test("cli cold-run: unpaid prompts/list against mounted mountMcp", { timeout: 60_000 }, async () => {
  const result = await runBin(["cold-run"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(report.status, "pass");
  assert.equal(report.paymentAttempted, false);
  assert.equal(report.promptsList.ok, true);
  assert.equal(report.promptsList.sdk.count, 3);
  assert.deepEqual(report.promptsList.sdk.names, ["web-extract", "page-change", "explicit-record"]);
  assert.equal(report.promptsList.raw.httpStatus, 200);
  assert.equal(report.promptsList.initialize.promptsAdvertised, true);
  assert.equal(report.toolsCallUnpaid.gated, true);
  assert.equal(report.toolsCallUnpaid.handlerRan, false);
  assert.match(result.stderr, /prompts\/list=3/);
  assert.match(result.stderr, /tools\/call-unpaid=gated/);
});

test("cli seeded-failure: prompts/get __seeded_unknown_prompt__ is rejected", { timeout: 60_000 }, async () => {
  const result = await runBin(["seeded-failure"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(report.seededFailure.rejected, true);
  assert.equal(report.seededFailure.layer, "mcp-protocol");
  assert.equal(report.seededFailure.code, -32602);
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
  assert.match(result.stderr, /__seeded_unknown_prompt__/);
  assert.match(result.stderr, /code=-32602/);
});

test("cli run: cold prompts/list plus seeded unknown prompt rejection", { timeout: 60_000 }, async () => {
  const result = await runBin(["run"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(report.status, "pass");
  assert.equal(report.promptsList.sdk.ok, true);
  assert.equal(report.negativePromptsGet.ok, true);
  assert.equal(report.negativePromptsGet.seededFailure.observation.rejected, true);
  assert.equal(report.toolsCallUnpaid.handlerRan, false);
  assert.match(result.stderr, /seeded-failure=rejected/);
});
