import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { TEN_MINUTE_MS } from "./derive.mjs";
import { BIN, FIXTURE_ROOT } from "./paths.mjs";

function runBin(args, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: FIXTURE_ROOT,
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
  assert.ok(text.startsWith("{") || text.startsWith("ok "), `unexpected output: ${text.slice(0, 200)}`);
  if (text.startsWith("{")) return JSON.parse(text);
  return { text };
}

test("cli help exits 0", async () => {
  const result = await runBin(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /seeded-failure/);
});

test("cli unknown flag exits 2", async () => {
  const result = await runBin(["--case"]);
  assert.equal(result.code, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.error.code, "unknown_flag");
});

test("cold run finishes far under 10 minutes and catches the seed", async () => {
  const started = Date.now();
  const result = await runBin(["--json"]);
  const elapsed = Date.now() - started;
  const report = parseReport(result.stdout);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.status, "pass");
  assert.equal(report.capSeconds, 600);
  assert.equal(report.counts.caught, 1);
  assert.equal(report.counts.missed, 0);
  assert.equal(report.counts.fail, 0);
  assert.equal(report.boundary.paymentSent, false);
  assert.equal(report.boundary.settled, false);
  assert.equal(report.waitedTenMinutes, false);
  assert.ok(report.wallMs < 5_000, `wallMs ${report.wallMs}`);
  assert.ok(elapsed < 5_000, `elapsed ${elapsed}ms`);
  assert.ok(elapsed < TEN_MINUTE_MS);
  assert.equal(report.exercise.ok, true);
  assert.equal(report.exercise.calls[1].timeout, 600_000);
});

test("seeded-failure exits 1 and quotes the 900s uncapped claim", async () => {
  const result = await runBin(["--seeded-failure", "--json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr || result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "SEED_REJECT");
  assert.equal(report.error.kind, "false_accept");
  assert.equal(report.result.claimedTimeoutMs, 900_000);
  assert.equal(report.result.derivedTimeoutMs, 600_000);
  assert.equal(report.result.paid, false);
  assert.equal(report.result.settled, false);
  assert.match(report.error.message, /uncapped-900s/);
});

test("fixture seeded wait-15m-settled exits 1 without paying", async () => {
  const result = await runBin(["--fixture", "fixtures/seeded/wait-15m-settled.json", "--json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1);
  assert.equal(report.error.code, "SEED_REJECT");
  assert.equal(report.result.claimedTimeoutMs, 900_000);
  assert.equal(report.result.derivedTimeoutMs, 600_000);
  assert.equal(report.boundary.paymentSent, false);
  assert.equal(report.boundary.settled, false);
});

test("fixture SDS 300s exits 0", async () => {
  const result = await runBin(["--fixture", "fixtures/sds-enrich-300s.json", "--json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.cases[0].derived.timeoutMs, 300_000);
});
