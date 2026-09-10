import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILTIN_JOB_IDS,
  FORBIDDEN_FIELDS,
  NATIVE_JOB_IDS,
  SCHEMA,
  INPUT_SCHEMA,
  MANIFEST_SCHEMA,
} from "../src/constants.mjs";

test("schemas are stable", () => {
  assert.equal(SCHEMA, "x402.r2.record.recurring_job_bundle.v1");
  assert.equal(INPUT_SCHEMA, "x402.r2.record.bundle_request.v1");
  assert.equal(MANIFEST_SCHEMA, "x402.r2.record.job_manifest.v1");
});

test("native jobs are exactly 05..07 ids", () => {
  assert.deepEqual([...NATIVE_JOB_IDS], [
    "route-regression",
    "deadline-calendar",
    "dependency-footprint",
  ]);
  assert.equal(BUILTIN_JOB_IDS.length, 7);
});

test("forbidden fields cover SEO/traffic/invest/security/legal/revenue", () => {
  for (const f of [
    "seoRank",
    "trafficProjection",
    "investmentRecommendation",
    "revenue",
    "buyerCount",
    "cveScore",
    "securityCertification",
    "legalAdvice",
    "complianceScore",
  ]) {
    assert.ok(FORBIDDEN_FIELDS.includes(f), f);
  }
});
