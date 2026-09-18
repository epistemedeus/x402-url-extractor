import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { OUTCOMES } from "../src/constants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin", "cli.mjs");

function run(args, { expectStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, OPENAI_AGENTS_DISABLE_TRACING: "1" },
    timeout: 30_000,
  });
  assert.equal(result.status, expectStatus, result.stderr || result.stdout);
  return result;
}

function parseJsonStream(text) {
  const start = text.indexOf("{");
  assert.ok(start >= 0, text);
  const end = text.lastIndexOf("}");
  assert.ok(end > start, text);
  return JSON.parse(text.slice(start, end + 1));
}

test("fixture replay prints unpaid_call_is_error", () => {
  const result = run(["--fixture", "./fixtures/unpaid-call-is-error.json"]);
  const report = parseJsonStream(result.stdout);
  assert.equal(report.outcome, OUTCOMES.UNPAID_CALL_IS_ERROR);
  assert.equal(report.isError, true);
  assert.equal(report.paid, false);
  assert.equal(report.charged, false);
});

test("seeded isError:false fixture exits 1", () => {
  const result = run(["--fixture", "./fixtures/hostile/is-error-false.json"], { expectStatus: 1 });
  const report = parseJsonStream(result.stdout || result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.outcome, "rejected");
  assert.equal(report.paid, false);
  assert.match(report.message, /isError:true/);
});

test("help lists copyable commands and refuses live payment", () => {
  const result = run(["--help"]);
  assert.match(result.stdout, /npm start/);
  assert.match(result.stdout, /callToolResult/);
  assert.match(result.stdout, /isError:true/);
  assert.match(result.stdout, /--live/);
  assert.doesNotMatch(result.stdout, /OPENAI_API_KEY=sk-/);
});

test("forbidden flags fail closed", () => {
  for (const flag of ["--live", "--pay", "--approve", "--payment", "--neo", "--publish", "--wallet"]) {
    const result = run([flag], { expectStatus: 1 });
    const report = parseJsonStream(result.stdout || result.stderr);
    assert.equal(report.error, "forbidden_flag");
    assert.match(report.message, /refused flag/);
  }
});

test("unknown arguments fail closed", () => {
  const result = run(["--private-key-env", "X"], { expectStatus: 1 });
  const report = parseJsonStream(result.stdout);
  assert.equal(report.ok, false);
  assert.match(report.message, /refused flag|--private-key-env|unknown argument/);
});

test("--fixture --live is a refused flag, not a missing file", () => {
  const result = run(["--fixture", "--live"], { expectStatus: 1 });
  const report = parseJsonStream(result.stdout);
  assert.equal(report.error, "forbidden_flag");
  assert.match(report.message, /refused flag/);
});

test("fixture path outside this example is rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "x170-unpaid-"));
  const outside = join(dir, "spoof.json");
  writeFileSync(outside, JSON.stringify({
    result: {
      isError: true,
      structuredContent: {
        x402Version: 2,
        accepts: [{ scheme: "exact", network: "eip155:8453", amount: "5000" }],
      },
    },
  }));
  const result = run(["--fixture", outside], { expectStatus: 1 });
  const report = parseJsonStream(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.error, "forbidden_url");
});

test("spoofed loopback source still prints source=fixture", () => {
  const result = run(["--fixture", "./fixtures/spoof-loopback-source.json"]);
  const report = parseJsonStream(result.stdout);
  assert.equal(report.outcome, OUTCOMES.UNPAID_CALL_IS_ERROR);
  assert.equal(report.source, "fixture");
});
