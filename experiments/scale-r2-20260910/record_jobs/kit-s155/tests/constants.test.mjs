import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILTIN_JOB_IDS,
  FORBIDDEN_FIELDS,
  HEAVY_JOB_IDS,
  HEAVY_PIN_SHA,
  NATIVE_JOB_IDS,
  SCHEMA,
} from "../src/constants.mjs";

test("schemas and pins", () => {
  assert.match(SCHEMA, /source_record_kit/);
  assert.equal(HEAVY_PIN_SHA, "65ce1867f1b4339cc708bfb72a7d9a5942785632");
  assert.equal(HEAVY_JOB_IDS.length, 4);
  assert.ok(HEAVY_JOB_IDS.includes("csv-drift"));
  assert.equal(NATIVE_JOB_IDS.length, 3);
  assert.equal(BUILTIN_JOB_IDS.length, 8);
});

test("forbidden fields include investmentRecommendation", () => {
  assert.ok(FORBIDDEN_FIELDS.includes("investmentRecommendation"));
  assert.ok(FORBIDDEN_FIELDS.includes("seoRank"));
});
