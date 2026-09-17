import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runLoopbackUnpaidCall } from "../src/loopback.mjs";
import { OUTCOMES } from "../src/constants.mjs";
import { SDK_METHOD, SDK_PACKAGE } from "../src/pins.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin", "cli.mjs");

test("OpenAI Agents callToolResult against loopback mock is isError:true", { timeout: 25_000 }, async () => {
  const report = await runLoopbackUnpaidCall();
  assert.equal(report.ok, true);
  assert.equal(report.outcome, OUTCOMES.UNPAID_CALL_IS_ERROR);
  assert.equal(report.isError, true);
  assert.equal(report.paid, false);
  assert.equal(report.charged, false);
  assert.equal(report.liveMerchantCall, false);
  assert.equal(report.protocolError, false);
  assert.equal(report.source, "openai_agents_loopback");
  assert.equal(report.sdk.package, SDK_PACKAGE);
  assert.equal(report.sdk.method, SDK_METHOD);
  assert.equal(report.challenge.acceptCount >= 1, true);
});

test("default CLI cold path uses the real SDK loopback", { timeout: 30_000 }, () => {
  const result = spawnSync(process.execPath, [CLI], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, OPENAI_AGENTS_DISABLE_TRACING: "1" },
    timeout: 25_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
  assert.equal(report.outcome, OUTCOMES.UNPAID_CALL_IS_ERROR);
  assert.equal(report.isError, true);
  assert.equal(report.source, "openai_agents_loopback");
  assert.equal(report.paid, false);
});
