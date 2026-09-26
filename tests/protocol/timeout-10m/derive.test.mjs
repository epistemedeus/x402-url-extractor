import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MAX_REQUEST_TIMEOUT_SECONDS,
  TEN_MINUTE_MS,
  TEN_MINUTE_SECONDS,
  deriveTimeout,
  paidTimeoutMs,
  probeTimeoutMs,
  resolveMaxRequestTimeoutSeconds,
} from "./derive.mjs";

test("default cap is 10 minutes", () => {
  assert.equal(DEFAULT_MAX_REQUEST_TIMEOUT_SECONDS, 600);
  assert.equal(TEN_MINUTE_SECONDS, 600);
  assert.equal(TEN_MINUTE_MS, 600_000);
  assert.equal(resolveMaxRequestTimeoutSeconds(undefined), 600);
});

test("invalid cap throws instead of paying", () => {
  assert.throws(() => resolveMaxRequestTimeoutSeconds(0), /positive finite number, got 0/);
  assert.throws(() => resolveMaxRequestTimeoutSeconds(-1), /positive finite number, got -1/);
  assert.throws(() => resolveMaxRequestTimeoutSeconds(Number.NaN), /positive finite number/);
});

test("paid retry caps accept maxTimeoutSeconds at 10 minutes", () => {
  const cap = resolveMaxRequestTimeoutSeconds(undefined);
  assert.equal(paidTimeoutMs(undefined, 300, cap), 300_000);
  assert.equal(paidTimeoutMs(undefined, 600, cap), 600_000);
  assert.equal(paidTimeoutMs(undefined, 900, cap), 600_000);
  assert.equal(paidTimeoutMs(undefined, 604_900, cap), 600_000);
  assert.equal(paidTimeoutMs(undefined, undefined, cap), 300_000);
});

test("probe uses min(300s, cap) unless per-call override", () => {
  assert.equal(probeTimeoutMs(undefined, 600), 300_000);
  assert.equal(probeTimeoutMs(undefined, 60), 60_000);
  assert.equal(probeTimeoutMs(12_000, 600), 12_000);
});

test("per-call timeout wins over a 900s accept", () => {
  const derived = deriveTimeout({
    kind: "paid-retry",
    accept: { maxTimeoutSeconds: 900 },
    perCallTimeoutMs: 120_000,
  });
  assert.equal(derived.timeoutMs, 120_000);
  assert.equal(derived.exceedsTenMinutes, false);
  assert.equal(derived.paid, false);
  assert.equal(derived.settled, false);
});

test("900s accept is capped and never marked paid", () => {
  const derived = deriveTimeout({ kind: "paid-retry", accept: { maxTimeoutSeconds: 900 } });
  assert.equal(derived.timeoutMs, TEN_MINUTE_MS);
  assert.equal(derived.capped, true);
  assert.equal(derived.exceedsTenMinutes, false);
  assert.equal(derived.paid, false);
  assert.equal(derived.settled, false);
});
