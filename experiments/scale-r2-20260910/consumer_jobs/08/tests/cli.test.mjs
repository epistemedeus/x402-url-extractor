import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "src", "cli.mjs");

function run(args, { input } = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    input,
    cwd: root,
  });
}

test("cli manifest: readyCount 1 and pendingHeavyCount 6", () => {
  const r = run(["manifest"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.summary.readyCount, 1);
  assert.equal(out.summary.pendingHeavyCount, 6);
});

test("cli demo: positive/partial/negative statuses without investmentRecommendation", () => {
  const r = run(["demo"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.demo, true);
  assert.equal(out.results["manifest.readyCount"], 1);
  assert.equal(out.results["manifest.pendingHeavyCount"], 6);
  assert.equal(out.results["positive-journey.json"].status, "ready");
  assert.equal(out.results["partial-missing-heavy.json"].status, "partial");
  assert.equal(out.results["negative-unknown-recipe.json"].status, "rejected");
  for (const key of [
    "positive-journey.json",
    "partial-missing-heavy.json",
    "negative-unknown-recipe.json",
  ]) {
    assert.equal(out.results[key].hasInvestmentRecommendation, false);
  }
});

test("cli journey: writes demo-out artifacts", () => {
  const r = run(["journey"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.journey, true);
  assert.equal(out.summary.positiveStatus, "ready");
  assert.equal(out.summary.partialStatus, "partial");
  assert.equal(out.summary.negativeStatus, "rejected");
  assert.equal(out.summary.readyRecipes, 1);
  assert.equal(out.summary.pendingHeavy, 6);
  for (const name of [
    "journey.json",
    "manifest.json",
    "positive.json",
    "partial.json",
    "negative.json",
  ]) {
    const path = join(root, "demo-out", name);
    assert.ok(existsSync(path), `missing ${name}`);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    assert.ok(parsed);
  }
});

test("cli assemble positive exits 0", () => {
  const r = run(["assemble", join(root, "fixtures", "positive-journey.json")]);
  assert.equal(r.status, 0, r.stderr);
  const pkg = JSON.parse(r.stdout);
  assert.equal(pkg.status, "ready");
  assert.equal(pkg.schema, "x402.r2.consumer.customer_result_package.v1");
});

test("cli assemble negative exits 1", () => {
  const r = run(["assemble", join(root, "fixtures", "negative-unknown-recipe.json")]);
  assert.equal(r.status, 1);
  const pkg = JSON.parse(r.stdout);
  assert.equal(pkg.status, "rejected");
});

test("cli assemble stdin works", () => {
  const payload = JSON.stringify({
    requestId: "stdin-demo",
    recipeIds: ["procurement-brief"],
    procurementInputPath: "../07/fixtures/positive.json",
  });
  const r = run(["assemble", "-"], { input: payload });
  assert.equal(r.status, 0, r.stderr);
  const pkg = JSON.parse(r.stdout);
  assert.equal(pkg.status, "ready");
  assert.equal(pkg.requestId, "stdin-demo");
});
