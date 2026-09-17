import assert from "node:assert/strict";
import test from "node:test";

import { runJson } from "./helpers.mjs";

const CASES = [
  ["--approve", "operation_refused"],
  ["--pay", "operation_refused"],
  ["--purchase", "operation_refused"],
  ["--checkout", "operation_refused"],
  ["--publish", "operation_refused"],
  ["--neo", "operation_refused"],
  ["--wallet", "operation_refused"],
  ["--private-key-env", "operation_refused"],
  ["--payment-signature", "operation_refused"],
];

for (const [flag, code] of CASES) {
  test(`seeded failure ${flag} is refused before any fetch`, () => {
    const { report } = runJson([flag], { expectStatus: 2 });
    assert.equal(report.ok, false);
    assert.equal(report.paymentAttempted, false);
    assert.equal(report.walletAccessed, false);
    assert.equal(report.checkoutAttempted, false);
    assert.equal(report.published, false);
    assert.equal(report.neoTouched, false);
    assert.equal(report.error.code, code);
    assert.match(report.error.message, /refused/i);
  });
}

test("seeded failure private origin is refused", () => {
  const { report } = runJson(["--origin", "http://127.0.0.1"], { expectStatus: 2 });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "invalid_protocol");
  assert.equal(report.paymentAttempted, false);
});

test("seeded failure loopback HTTPS origin is refused", () => {
  const { report } = runJson(["--origin", "https://127.0.0.1"], { expectStatus: 2 });
  assert.equal(report.error.code, "ssrf_blocked");
});

test("seeded failure mcp:// origin is refused", () => {
  const { report } = runJson(["--origin", "mcp://agents.samedaydesk.com/mcp"], { expectStatus: 2 });
  assert.equal(report.error.code, "invalid_protocol");
  assert.match(report.error.message, /mcp:\/\//);
});
