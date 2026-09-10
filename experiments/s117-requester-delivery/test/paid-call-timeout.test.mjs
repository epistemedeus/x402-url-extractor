import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { classifyPaidCallTimeout } from "../src/paid-call-timeout.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("MCP SDK 60s default aborts before a 300s accept window", () => {
  const report = classifyPaidCallTimeout({ acceptMaxTimeoutSeconds: 300 });
  assert.equal(report.effectiveClientTimeoutSeconds, 60);
  assert.equal(report.abortBeforeAdvertisedSettlementWindow, true);
  assert.equal(report.retryAfterTimeoutWithoutSettlement.safe, false);
});

test("a caller deadline still overrides the accept window", () => {
  const report = classifyPaidCallTimeout({
    acceptMaxTimeoutSeconds: 300,
    clientTimeoutSeconds: 15,
  });
  assert.equal(report.callerSetTimeout, true);
  assert.equal(report.abortBeforeAdvertisedSettlementWindow, true);
});

test("vibewatch independently observed 45s window is covered by the 60s MCP default", async () => {
  const observation = JSON.parse(
    await readFile(join(ROOT, "fixtures/unpaid-observations/vibewatch-unpaid-402.json"), "utf8"),
  );
  assert.equal(observation.settlementObserved, false);
  const window = observation.accepts[0].maxTimeoutSeconds;
  const report = classifyPaidCallTimeout({ acceptMaxTimeoutSeconds: window });
  assert.equal(report.advertisedSettlementWindowSeconds, 45);
  assert.equal(report.abortBeforeAdvertisedSettlementWindow, false);
});

test("retry becomes safe only after settlement is observed", () => {
  const unsafe = classifyPaidCallTimeout({ acceptMaxTimeoutSeconds: 300, settlementObserved: false });
  const safe = classifyPaidCallTimeout({ acceptMaxTimeoutSeconds: 300, settlementObserved: true });
  assert.equal(unsafe.retryAfterTimeoutWithoutSettlement.safe, false);
  assert.equal(safe.retryAfterTimeoutWithoutSettlement.safe, true);
});
