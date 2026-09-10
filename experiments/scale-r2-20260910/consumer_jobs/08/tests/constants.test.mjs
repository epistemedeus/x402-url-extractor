import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILTIN_RECIPE_IDS,
  FORBIDDEN_FIELDS,
  RECIPE_STATUS,
  SCHEMA,
} from "../src/constants.mjs";

test("schema id is customer_result_package.v1", () => {
  assert.equal(SCHEMA, "x402.r2.consumer.customer_result_package.v1");
});

test("builtin recipes include procurement-brief and six heavy slots", () => {
  assert.ok(BUILTIN_RECIPE_IDS.includes("procurement-brief"));
  assert.equal(BUILTIN_RECIPE_IDS.filter((id) => id.startsWith("heavy-")).length, 6);
});

test("unavailable_pending_heavy is distinct from empty/no-users", () => {
  assert.equal(RECIPE_STATUS.UNAVAILABLE_PENDING_HEAVY, "unavailable_pending_heavy");
  assert.ok(!Object.values(RECIPE_STATUS).includes("empty"));
  assert.ok(!Object.values(RECIPE_STATUS).includes("no_users"));
});

test("forbidden fields include investmentRecommendation", () => {
  assert.ok(FORBIDDEN_FIELDS.includes("investmentRecommendation"));
});
