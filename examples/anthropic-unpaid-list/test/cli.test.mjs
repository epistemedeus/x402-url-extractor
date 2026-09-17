import assert from "node:assert/strict";
import test from "node:test";

import { run, runJson } from "./helpers.mjs";

test("fixture CLI prints unpaid extract inventory and refuses live-wallet assurance", () => {
  const { report } = runJson(["--fixture", "./fixtures/recorded"]);
  assert.equal(report.ok, true);
  assert.equal(report.paymentAttempted, false);
  assert.equal(report.walletAccessed, false);
  assert.equal(report.checkoutAttempted, false);
  assert.equal(report.published, false);
  assert.equal(report.neoTouched, false);
  assert.equal(report.extractInventory.mcp.includes("extract"), true);
  assert.equal(report.extractInventory.mcp.includes("extract_batch"), true);
  assert.match(JSON.stringify(report), /Not authorization to pay/);
});

test("CLI help lists copyable unpaid commands and seeded failures", () => {
  const result = run(["--help"]);
  assert.match(result.stdout, /never pay/);
  assert.match(result.stdout, /npm start/);
  assert.match(result.stdout, /--fixture/);
  assert.match(result.stdout, /--approve/);
  assert.match(result.stdout, /http:\/\/127\.0\.0\.1/);
  assert.match(result.stdout, /no wallet/);
});

test("unknown CLI arguments fail closed", () => {
  run(["--wallet-please"], { expectStatus: 2 });
});

test("missing extract fixture exits 1 without paying", () => {
  const { report } = runJson(["--fixture", "./fixtures/hostile/missing-extract.json"], { expectStatus: 1 });
  assert.equal(report.ok, false);
  assert.equal(report.paymentAttempted, false);
});

test("paid-delivery fixture is rejected", () => {
  const { report } = runJson(["--fixture", "./fixtures/hostile/paid-delivery.json"], { expectStatus: 1 });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "unexpected_delivery");
  assert.equal(report.paymentAttempted, false);
});
