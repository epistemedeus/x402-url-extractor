import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILTIN_RECIPE_IDS,
  FORBIDDEN_FIELDS,
  HEAVY_PACKET_SCHEMA,
  HEAVY_RECIPE_IDS,
  RECIPE_STATUS,
  SCHEMA,
} from "../src/constants.mjs";

test("constants: seven builtin recipes include Heavy artifact ids", () => {
  assert.equal(BUILTIN_RECIPE_IDS.length, 7);
  assert.ok(BUILTIN_RECIPE_IDS.includes("procurement-brief"));
  assert.equal(HEAVY_RECIPE_IDS.length, 6);
  for (const id of HEAVY_RECIPE_IDS) {
    assert.ok(BUILTIN_RECIPE_IDS.includes(id));
  }
  assert.equal(SCHEMA, "x402.r2.consumer.customer_result_package.v1");
  assert.equal(HEAVY_PACKET_SCHEMA, "s137.consumer-evidence.packet.v1");
  assert.equal(RECIPE_STATUS.UNAVAILABLE_PENDING_HEAVY, "unavailable_pending_heavy");
  assert.ok(FORBIDDEN_FIELDS.includes("investmentRecommendation"));
});
