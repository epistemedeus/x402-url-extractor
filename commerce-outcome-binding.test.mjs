import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";

import { authorizeOutcomeBinding, isSchemaValidDeliveryEvidence } from "./commerce-outcome-binding.mjs";
import { produceForwardOutcome } from "./scripts/forward-outcome-integration.mjs";

const TOKEN = "forward-outcome-internal-token-32b-min";

test("outcome binding requires the internal token and an opaque operation id", () => {
  const headers = {
    "x-samedaydesk-internal": TOKEN,
    "x-samedaydesk-outcome-operation": "op-controlled",
    "x-samedaydesk-outcome-cohort": "controlled_test",
  };
  assert.deepEqual(authorizeOutcomeBinding(headers, TOKEN), {
    brand: "samedaydesk",
    operationId: "op-controlled",
    cohort: "controlled_test",
  });
  assert.equal(authorizeOutcomeBinding({ ...headers, "x-samedaydesk-internal": "forged-internal-token-not-the-real-one" }, TOKEN), null);
  assert.equal(authorizeOutcomeBinding(headers, "short-token"), null);
  assert.equal(authorizeOutcomeBinding({
    "x-samedaydesk-outcome-operation": "op-controlled",
    "x-samedaydesk-outcome-cohort": "controlled_test",
  }, TOKEN), null);
  assert.equal(authorizeOutcomeBinding({ ...headers, "x-samedaydesk-outcome-operation": "ClientChosen/../x" }, TOKEN), null);
  assert.equal(authorizeOutcomeBinding({ ...headers, "x-samedaydesk-outcome-cohort": "organic" }, TOKEN), null);
});

test("disposable HTTP through createCommerceTelemetry persists schema-valid delivery only", async () => {
  const produced = await produceForwardOutcome();
  try {
    assert.equal(produced.ok, true, produced.errors.join("\n"));
    let torn = 0;
    const parsed = [];
    for (const line of produced.forwardBytes.toString("utf8").split("\n")) {
      if (!line) continue;
      try {
        parsed.push(JSON.parse(line));
      } catch {
        torn += 1;
      }
    }
    assert.ok(torn >= 1);
    assert.equal(parsed.filter(isSchemaValidDeliveryEvidence).some((row) => row.operationId === "op-controlled"), true);
    assert.equal(parsed.some((row) => row.settlementReference && String(row.settlementReference).includes("ababab")), false);
    assert.equal(parsed.some((row) => row.operationId === "op-forged" || row.operationId === "op-absent" || row.operationId === "op-short"), false);
  } finally {
    if (produced?.dataDir) await rm(produced.dataDir, { recursive: true, force: true });
  }
});
