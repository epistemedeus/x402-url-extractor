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

test("settlement CLI recovers the provided-report fixture and keeps aibtc main null", () => {
  const result = run(["settlement", "--fixture", "fixtures/settlement/aibtc666-provided-report.json"]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.decision, "settled");
  assert.equal(report.lookups.aibtc_main, null);
  assert.equal(report.lookups.portable, report.txid);
});

test("route-template CLI flags catalog-poisoning drift", () => {
  const result = run(["route-template", "--value", "/foo/%252e%252e%252fsecret"]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.catalogPoisoningIfSinglePassAccepts, true);
});

test("timeout CLI marks an unobserved retry unsafe", () => {
  const result = run(["timeout", "--accept-max-timeout", "300"]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.abortBeforeAdvertisedSettlementWindow, true);
  assert.equal(report.retryAfterTimeoutWithoutSettlement.safe, false);
});

test("spend-limit CLI reports not ready on an unreadable cap", () => {
  const result = run(["spend-limit", "--fixture", "fixtures/spend-limit/unreadable.json"]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, false);
});

test("validate-index CLI keeps valid distinct from indexed", () => {
  const result = run(["validate-index", "--fixture", "fixtures/unpaid-observations/fractalai-validate-summary.json"]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.decision, "validates_but_not_indexed");
});

test("hung-upstream CLI proves a local stalled origin aborts", () => {
  const result = run(["hung-upstream", "--timeout-ms", "80"]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.errorName, "TimeoutError");
  assert.equal(report.abortedInsideBudget, true);
});
