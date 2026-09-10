import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assembleCustomerResultPackage,
  buildRecipeManifest,
  loadRecipeCatalog,
  validateResultRequest,
} from "../src/assemble.mjs";
import {
  PACKAGE_STATUS,
  RECIPE_STATUS,
  SCHEMA,
} from "../src/constants.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "fixtures");
const clock = () => Date.parse("2026-09-10T18:00:00.000Z");

function load(name) {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8"));
}

test("manifest: one ready recipe and six unavailable_pending_heavy slots", () => {
  const catalog = loadRecipeCatalog();
  assert.equal(catalog.get("procurement-brief").status, RECIPE_STATUS.READY);
  const manifest = buildRecipeManifest({ clock });
  assert.equal(manifest.summary.readyCount, 1);
  assert.equal(manifest.summary.pendingHeavyCount, 6);
  const heavy = manifest.recipes.filter(
    (r) => r.status === RECIPE_STATUS.UNAVAILABLE_PENDING_HEAVY,
  );
  assert.equal(heavy.length, 6);
  for (const h of heavy) {
    assert.notEqual(h.status, "empty");
    assert.notEqual(h.status, "no_users");
  }
});

test("positive journey: procurement-brief ready with nested 07 brief", () => {
  const pkg = assembleCustomerResultPackage(load("positive-journey.json"), { clock });
  assert.equal(pkg.schema, SCHEMA);
  assert.equal(pkg.status, PACKAGE_STATUS.READY);
  assert.equal(pkg.recipes.length, 1);
  assert.equal(pkg.recipes[0].recipeId, "procurement-brief");
  assert.equal(pkg.recipes[0].status, RECIPE_STATUS.READY);
  assert.equal(pkg.recipes[0].output?.schema, "x402.r2.consumer.procurement_brief.v1");
  assert.equal(pkg.recipes[0].output?.status, "ready");
  assert.equal(pkg.hasInvestmentRecommendation, false);
  assert.equal(Object.prototype.hasOwnProperty.call(pkg, "investmentRecommendation"), false);
});

test("partial: ready + heavy slots stay unavailable_pending_heavy", () => {
  const pkg = assembleCustomerResultPackage(load("partial-missing-heavy.json"), { clock });
  assert.equal(pkg.status, PACKAGE_STATUS.PARTIAL);
  assert.equal(pkg.summary.readyCount, 1);
  assert.equal(pkg.summary.pendingHeavyCount, 2);
  const heavySlots = pkg.recipes.filter((r) => r.recipeId.startsWith("heavy-"));
  assert.equal(heavySlots.length, 2);
  for (const s of heavySlots) {
    assert.equal(s.status, RECIPE_STATUS.UNAVAILABLE_PENDING_HEAVY);
    assert.equal(s.output, null);
  }
  assert.equal(pkg.hasInvestmentRecommendation, false);
});

test("negative: unknown recipe rejects", () => {
  const pkg = assembleCustomerResultPackage(load("negative-unknown-recipe.json"), { clock });
  assert.equal(pkg.status, PACKAGE_STATUS.REJECTED);
  assert.equal(pkg.recipes[0].status, RECIPE_STATUS.UNKNOWN);
  assert.equal(pkg.recipes[0].error?.code, "unknown_recipe");
});

test("validateResultRequest rejects forbidden investment fields", () => {
  assert.throws(
    () =>
      validateResultRequest({
        recipeIds: ["procurement-brief"],
        investmentRecommendation: "buy",
      }),
    /Forbidden field/,
  );
});

test("validateResultRequest requires non-empty recipeIds", () => {
  assert.throws(() => validateResultRequest({ recipeIds: [] }), /recipeIds/);
});
