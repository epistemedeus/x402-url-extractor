import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyFixture, classifyUnpaidCall } from "../src/classify.mjs";
import { loadFixture } from "../src/fixture.mjs";
import { unpaidCallToolResult } from "../src/mock-mcp.mjs";
import { UnpaidCallError } from "../src/errors.mjs";
import { OUTCOMES, REJECTION_KINDS } from "../src/constants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("canonical unpaid callToolResult is isError:true payment_required", () => {
  const report = loadFixture(join(ROOT, "fixtures", "unpaid-call-is-error.json"));
  assert.equal(report.ok, true);
  assert.equal(report.outcome, OUTCOMES.UNPAID_CALL_IS_ERROR);
  assert.equal(report.isError, true);
  assert.equal(report.paid, false);
  assert.equal(report.charged, false);
  assert.equal(report.protocolError, false);
  assert.equal(report.kind, "payment_required");
  assert.equal(report.challenge.x402Version, 2);
  assert.equal(report.challenge.acceptCount, 1);
  assert.equal(report.sdk.callToolDropsIsError, true);
});

test("loopback mock result classifies without a fixture wrapper", () => {
  const report = classifyUnpaidCall({
    result: unpaidCallToolResult(),
    source: "mock",
    toolName: "extract",
    args: { url: "https://example.com/" },
  });
  assert.equal(report.isError, true);
  assert.equal(report.outcome, OUTCOMES.UNPAID_CALL_IS_ERROR);
});

test("classifyFixture reads jsonrpc result envelopes", () => {
  const report = classifyFixture({
    jsonrpc: "2.0",
    id: 1,
    result: unpaidCallToolResult(),
  });
  assert.equal(report.isError, true);
});

test("empty-object accepts and non-v2 x402Version are not unpaid challenges", () => {
  assert.throws(
    () => classifyUnpaidCall({
      result: {
        isError: true,
        structuredContent: { x402Version: 2, accepts: [{}] },
      },
    }),
    (error) => error instanceof UnpaidCallError && error.kind === REJECTION_KINDS.EMPTY_ACCEPTS,
  );
  assert.throws(
    () => classifyUnpaidCall({
      result: {
        isError: true,
        structuredContent: {
          x402Version: 99,
          accepts: [{ scheme: "exact", network: "eip155:8453", amount: "5000" }],
        },
      },
    }),
    (error) => error instanceof UnpaidCallError && error.kind === REJECTION_KINDS.MISSING_PAYMENT_REQUIRED,
  );
});

test("loadFixture pins source to fixture even when the file claims loopback", () => {
  const report = loadFixture(join(ROOT, "fixtures", "spoof-loopback-source.json"));
  assert.equal(report.ok, true);
  assert.equal(report.outcome, OUTCOMES.UNPAID_CALL_IS_ERROR);
  assert.equal(report.source, "fixture");
});
