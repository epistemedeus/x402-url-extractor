import assert from "node:assert/strict";
import test from "node:test";

import { exposeAgenticTradeProxyDiagnostics, summarizeAgenticTradeProxyHeaders } from "./agentictrade-proxy-diagnostics.mjs";

test("reports only AgenticTrade header names and boolean proof signals", () => {
  const summary = summarizeAgenticTradeProxyHeaders({
    authorization: "Bearer must-not-leak",
    "x-acf-signature": "secret-looking-signature",
    "x-acf-usage-id": "usage-1",
    "x-acf-amount": "0.01",
  });
  assert.deepEqual(summary, {
    headerNames: ["x-acf-amount", "x-acf-signature", "x-acf-usage-id"],
    signaturePresent: true,
    timestampPresent: false,
    usageIdPresent: true,
    amountPresent: true,
  });
  assert.doesNotMatch(JSON.stringify(summary), /must-not-leak|secret-looking-signature|usage-1/);
});

test("sets no-store diagnostics only when AgenticTrade headers are present", () => {
  const set = new Map();
  const response = { set: (name, value) => set.set(name, value) };
  assert.equal(exposeAgenticTradeProxyDiagnostics({ headers: { accept: "application/json" } }, response), null);
  assert.equal(set.size, 0);
  assert.deepEqual(exposeAgenticTradeProxyDiagnostics({
    headers: { "x-acf-signature": "abc", "x-acf-timestamp": "123" },
  }, response), {
    headerNames: ["x-acf-signature", "x-acf-timestamp"],
    signaturePresent: true,
    timestampPresent: true,
    usageIdPresent: false,
    amountPresent: false,
  });
  assert.equal(set.get("Cache-Control"), "private, no-store");
  assert.equal(set.get("X-SameDayDesk-AgenticTrade-Headers"), "x-acf-signature,x-acf-timestamp");
  assert.equal(set.get("X-SameDayDesk-AgenticTrade-Signature"), "present");
  assert.equal(set.get("X-SameDayDesk-AgenticTrade-Timestamp"), "present");
  assert.equal(set.get("X-SameDayDesk-AgenticTrade-Usage"), "absent");
});
