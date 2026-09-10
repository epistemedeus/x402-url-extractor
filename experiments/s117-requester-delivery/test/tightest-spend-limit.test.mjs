import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { diagnoseSpendLimits } from "../src/tightest-spend-limit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("an unreadable allowance binds as zero and is not skipped for a healthy next limit", async () => {
  const fixture = JSON.parse(await readFile(join(ROOT, "fixtures/spend-limit/unreadable.json"), "utf8"));
  const report = diagnoseSpendLimits(fixture.limits);
  assert.equal(report.ready, false);
  assert.equal(report.unreadablePresent, true);
  assert.equal(report.bindingLimitId, "unreadable-period");
  assert.equal(report.bindingRemaining, "0");
});

test("the smallest readable remaining is the tightest limit", () => {
  const report = diagnoseSpendLimits([
    { id: "daily", remaining: "5000" },
    { id: "weekly", remaining: "2000" },
    { id: "monthly", remaining: "9000" },
  ]);
  assert.equal(report.ready, true);
  assert.equal(report.bindingLimitId, "weekly");
  assert.equal(report.bindingRemaining, "2000");
});

test("whitespace around a numeric remaining stays readable", () => {
  const report = diagnoseSpendLimits([{ id: "token", remaining: " 12 " }]);
  assert.equal(report.ready, true);
  assert.equal(report.bindingRemaining, "12");
});
