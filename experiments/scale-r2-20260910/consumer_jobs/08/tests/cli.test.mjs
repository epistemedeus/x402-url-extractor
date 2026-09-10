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
    maxBuffer: 16 * 1024 * 1024,
  });
}

test("cli manifest: readyCount 7 and pendingHeavyCount 0", () => {
  const r = run(["manifest"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.summary.readyCount, 7);
  assert.equal(out.summary.pendingHeavyCount, 0);
});

test("cli demo: positive/partial/negative without investmentRecommendation", () => {
  const r = run(["demo"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.demo, true);
  assert.equal(out.results["manifest.readyCount"], 7);
  assert.equal(out.results["manifest.pendingHeavyCount"], 0);
  assert.ok(["ready", "partial"].includes(out.results["positive-journey.json"].status));
  assert.equal(out.results["partial-conflict-heavy.json"].status, "partial");
  assert.equal(out.results["negative-unknown-recipe.json"].status, "rejected");
  for (const key of [
    "positive-journey.json",
    "partial-conflict-heavy.json",
    "negative-unknown-recipe.json",
  ]) {
    assert.equal(out.results[key].hasInvestmentRecommendation, false);
  }
  const heavySlots = out.results["positive-journey.json"].recipeStatuses.filter(
    (s) => s.id !== "procurement-brief",
  );
  assert.equal(heavySlots.length, 6);
  for (const s of heavySlots) {
    assert.ok(s.decision, `${s.id} missing decision`);
  }
});

test("cli journey: writes demo-out and s152 artifacts", () => {
  const r = run(["journey"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.journey, true);
  assert.equal(out.summary.readyRecipes, 7);
  assert.equal(out.summary.pendingHeavy, 0);
  for (const name of [
    "journey.json",
    "manifest.json",
    "positive.json",
    "partial.json",
    "negative.json",
    "s152/journey.json",
    "s152/manifest.json",
    "s152/positive.json",
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
  assert.ok(["ready", "partial"].includes(pkg.status));
  assert.equal(pkg.schema, "x402.r2.consumer.customer_result_package.v1");
  assert.equal(pkg.recipes.length, 7);
});

test("cli assemble negative exits 1", () => {
  const r = run(["assemble", join(root, "fixtures", "negative-unknown-recipe.json")]);
  assert.equal(r.status, 1);
  const pkg = JSON.parse(r.stdout);
  assert.equal(pkg.status, "rejected");
});

test("cli assemble stdin works for procurement-brief", () => {
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
