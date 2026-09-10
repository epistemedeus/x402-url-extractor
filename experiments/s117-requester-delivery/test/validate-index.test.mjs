import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { classifyValidateVsIndex } from "../src/validate-index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("independently observed FractalAI still validates without an index", async () => {
  const fixture = JSON.parse(
    await readFile(join(ROOT, "fixtures/unpaid-observations/fractalai-validate-summary.json"), "utf8"),
  );
  const report = classifyValidateVsIndex(fixture);
  assert.equal(report.evidenceClass, "independently_observed");
  assert.equal(report.valid, true);
  assert.equal(report.indexed, false);
  assert.equal(report.bazaarPresent, true);
  assert.equal(report.decision, "validates_but_not_indexed");
});

test("independently observed HyperXosist 402 now carries Bazaar and still has no index", async () => {
  const fixture = JSON.parse(
    await readFile(join(ROOT, "fixtures/unpaid-observations/hyperxosist-validate-summary.json"), "utf8"),
  );
  const report = classifyValidateVsIndex(fixture);
  assert.equal(report.decision, "validates_but_not_indexed");
  assert.equal(report.bazaarPresent, true);
});

test("a failed validate is not treated as an indexing bug", () => {
  const report = classifyValidateVsIndex({
    evidenceClass: "independently_observed",
    resource: "https://api.vibewatch.io/api/v1/public/stacks-index/pro/projects/bitflow-finance-af3b",
    method: "GET",
    cdpValidate: {
      valid: false,
      index: null,
      bazaarPresent: false,
      simulationOutcome: "rejected",
      preflightFailed: ["accepts[0].network"],
    },
  });
  assert.equal(report.decision, "not_valid");
});
