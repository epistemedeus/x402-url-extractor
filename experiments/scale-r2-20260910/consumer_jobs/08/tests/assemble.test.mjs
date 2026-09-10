import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assembleCustomerResultPackage,
  assertSafeLocalPath,
  buildRecipeManifest,
  loadRecipeCatalog,
  runHeavyAnalyzeRecipe,
  validateResultRequest,
} from "../src/assemble.mjs";
import {
  ERROR_CODES,
  HEAVY_PACKET_SCHEMA,
  PACKAGE_STATUS,
  RECIPE_STATUS,
  SCHEMA,
} from "../src/constants.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "fixtures");
const clock = () => Date.parse("2026-09-10T18:00:00.000Z");
const operatorClock = "2026-09-10T18:00:00.000Z";

function load(name) {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8"));
}

test("manifest: seven ready recipes and zero unavailable_pending_heavy", () => {
  const catalog = loadRecipeCatalog();
  assert.equal(catalog.get("procurement-brief").status, RECIPE_STATUS.READY);
  assert.equal(catalog.get("migration-checklist").status, RECIPE_STATUS.READY);
  const manifest = buildRecipeManifest({ clock });
  assert.equal(manifest.summary.readyCount, 7);
  assert.equal(manifest.summary.pendingHeavyCount, 0);
  for (const r of manifest.recipes) {
    assert.equal(r.status, RECIPE_STATUS.READY);
    assert.notEqual(r.status, "empty");
    assert.notEqual(r.status, "no_users");
  }
});

test("positive journey: seven recipes produce real Heavy packets + 07 brief", () => {
  const pkg = assembleCustomerResultPackage(load("positive-journey.json"), {
    clock,
    operatorClock,
  });
  assert.equal(pkg.schema, SCHEMA);
  assert.ok(
    pkg.status === PACKAGE_STATUS.READY || pkg.status === PACKAGE_STATUS.PARTIAL,
    `expected ready|partial got ${pkg.status}`,
  );
  assert.equal(pkg.recipes.length, 7);
  assert.equal(pkg.hasInvestmentRecommendation, false);

  const brief = pkg.recipes.find((r) => r.recipeId === "procurement-brief");
  assert.ok(brief);
  assert.equal(brief.status, RECIPE_STATUS.READY);
  assert.equal(brief.output?.schema, "x402.r2.consumer.procurement_brief.v1");

  const heavy = pkg.recipes.filter((r) => r.recipeId !== "procurement-brief");
  assert.equal(heavy.length, 6);
  for (const slot of heavy) {
    assert.ok(slot.output, `${slot.recipeId} missing output`);
    assert.equal(slot.output.schema, HEAVY_PACKET_SCHEMA);
    assert.equal(slot.output.payment?.attempted, false);
    assert.ok(slot.decision, `${slot.recipeId} missing decision`);
    // Do not invent pass — record whatever Heavy returned
    assert.ok(
      ["pass", "fail", "partial", "conflict", "unknown"].includes(slot.decision),
      `${slot.recipeId} unexpected decision ${slot.decision}`,
    );
  }
});

test("partial conflict: Heavy conflict decisions preserved; journey not forced to pass", () => {
  const pkg = assembleCustomerResultPackage(load("partial-conflict-heavy.json"), {
    clock,
    operatorClock,
  });
  assert.equal(pkg.status, PACKAGE_STATUS.PARTIAL);
  const migration = pkg.recipes.find((r) => r.recipeId === "migration-checklist");
  assert.ok(migration?.output);
  assert.equal(migration.output.schema, HEAVY_PACKET_SCHEMA);
  assert.equal(migration.decision, "conflict");
  assert.equal(migration.status, RECIPE_STATUS.CONFLICT);
  const freshness = pkg.recipes.find((r) => r.recipeId === "freshness-receipt");
  assert.ok(freshness?.output);
  assert.equal(freshness.decision, "conflict");
  const brief = pkg.recipes.find((r) => r.recipeId === "procurement-brief");
  assert.equal(brief.status, RECIPE_STATUS.READY);
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

test("refusal: path-escape / unsafe CLI path rejected", () => {
  assert.throws(
    () => assertSafeLocalPath("https://evil.example/x.json"),
    (err) => err.code === ERROR_CODES.UNSAFE_PATH,
  );
  assert.throws(
    () => assertSafeLocalPath("../../../../../../etc/passwd"),
    (err) => err.code === ERROR_CODES.UNSAFE_PATH,
  );
  const run = runHeavyAnalyzeRecipe("migration-checklist", {
    clockIso: operatorClock,
    inPath: "https://example.com/fixture.json",
  });
  assert.equal(run.status, RECIPE_STATUS.REJECTED);
  assert.equal(run.error?.code, ERROR_CODES.UNSAFE_PATH);
  assert.equal(run.output, null);
});

test("refusal: missing clock rejected without inventing time", () => {
  const run = runHeavyAnalyzeRecipe("migration-checklist", {
    clockIso: null,
    inPath:
      "../../../s137-consumer-evidence-jobs/fixtures/synthetic/migration/cases/positive-complete.json",
  });
  assert.equal(run.status, RECIPE_STATUS.REJECTED);
  assert.equal(run.error?.code, ERROR_CODES.MISSING_CLOCK);
  assert.equal(run.output, null);
});

test("refusal: missing --in rejected", () => {
  const catalog = loadRecipeCatalog();
  const recipe = catalog.get("migration-checklist");
  const stripped = {
    ...recipe,
    cli: { ...recipe.cli, defaultIn: null },
  };
  catalog.set("migration-checklist", stripped);
  const run = runHeavyAnalyzeRecipe("migration-checklist", {
    catalog,
    clockIso: operatorClock,
    inPath: null,
  });
  assert.equal(run.status, RECIPE_STATUS.REJECTED);
  assert.equal(run.error?.code, ERROR_CODES.MISSING_IN);
});
