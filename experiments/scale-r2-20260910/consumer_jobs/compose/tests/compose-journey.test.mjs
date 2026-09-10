import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assembleCustomerResultPackage,
  buildRecipeManifest,
  runCleanInstallJourney,
  runHeavyAnalyzeRecipe,
  DEFAULT_OPERATOR_CLOCK,
  HEAVY_RECIPE_IDS,
  EIGHT_ROOT,
  S137_ROOT,
} from "../src/journey.mjs";
import {
  ERROR_CODES,
  HEAVY_PACKET_SCHEMA,
  PACKAGE_STATUS,
  RECIPE_STATUS,
} from "../../08/src/constants.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const eightFixtures = join(EIGHT_ROOT, "fixtures");
const clock = () => Date.parse(DEFAULT_OPERATOR_CLOCK);

function loadEight(name) {
  return JSON.parse(readFileSync(join(eightFixtures, name), "utf8"));
}

test("compose manifest lists seven ready recipes", () => {
  const manifest = buildRecipeManifest({ clock });
  assert.equal(manifest.summary.readyCount, 7);
  assert.equal(manifest.summary.pendingHeavyCount, 0);
  assert.equal(HEAVY_RECIPE_IDS.length, 6);
});

test("compose buyer journey: 01-06 + 07 + package status", () => {
  const demoOut = join(root, "demo-out");
  mkdirSync(demoOut, { recursive: true });
  const journey = runCleanInstallJourney({
    clock,
    operatorClock: DEFAULT_OPERATOR_CLOCK,
    demoOutDir: demoOut,
    fixturesDir: eightFixtures,
  });
  const manifest = journey.steps.find((s) => s.name === "manifest").result;
  const positive = journey.steps.find((s) => s.name === "positive-journey").result;
  assert.equal(manifest.summary.readyCount, 7);
  assert.equal(positive.recipes.length, 7);
  assert.ok(["ready", "partial"].includes(positive.status));

  const brief = positive.recipes.find((r) => r.recipeId === "procurement-brief");
  assert.equal(brief.status, RECIPE_STATUS.READY);
  assert.equal(brief.output?.schema, "x402.r2.consumer.procurement_brief.v1");

  for (const id of HEAVY_RECIPE_IDS) {
    const slot = positive.recipes.find((r) => r.recipeId === id);
    assert.ok(slot, `missing ${id}`);
    assert.ok(slot.output, `${id} missing Heavy packet`);
    assert.equal(slot.output.schema, HEAVY_PACKET_SCHEMA);
    assert.equal(slot.output.payment?.attempted, false);
    assert.ok(slot.decision);
  }

  writeFileSync(
    join(demoOut, "compose-positive-summary.json"),
    JSON.stringify(
      {
        status: positive.status,
        recipes: positive.recipes.map((r) => ({
          id: r.recipeId,
          status: r.status,
          decision: r.decision || null,
          schema: r.output?.schema || null,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  assert.ok(existsSync(join(demoOut, "s152", "positive.json")));
});

test("compose refusal: conflict Heavy fixture keeps conflict decision", () => {
  const pkg = assembleCustomerResultPackage(loadEight("partial-conflict-heavy.json"), {
    clock,
    operatorClock: DEFAULT_OPERATOR_CLOCK,
  });
  assert.equal(pkg.status, PACKAGE_STATUS.PARTIAL);
  const mig = pkg.recipes.find((r) => r.recipeId === "migration-checklist");
  assert.equal(mig.decision, "conflict");
  assert.notEqual(mig.decision, "pass");
});

test("compose refusal: unknown recipe + forbidden field", () => {
  const unknown = assembleCustomerResultPackage(loadEight("negative-unknown-recipe.json"), {
    clock,
  });
  assert.equal(unknown.status, PACKAGE_STATUS.REJECTED);

  const forbidden = assembleCustomerResultPackage(loadEight("negative-forbidden-field.json"), {
    clock,
  });
  assert.equal(forbidden.status, PACKAGE_STATUS.REJECTED);
  assert.equal(forbidden.error?.code, ERROR_CODES.FORBIDDEN_CLAIM);
});

test("compose refusal: unsafe path + missing clock + missing in", () => {
  const unsafe = runHeavyAnalyzeRecipe("migration-checklist", {
    clockIso: DEFAULT_OPERATOR_CLOCK,
    inPath: "https://example.test/do-not-fetch.json",
  });
  assert.equal(unsafe.status, RECIPE_STATUS.REJECTED);
  assert.equal(unsafe.error?.code, ERROR_CODES.UNSAFE_PATH);

  const escape = runHeavyAnalyzeRecipe("migration-checklist", {
    clockIso: DEFAULT_OPERATOR_CLOCK,
    inPath: "/etc/passwd",
  });
  assert.equal(escape.status, RECIPE_STATUS.REJECTED);
  assert.equal(escape.error?.code, ERROR_CODES.UNSAFE_PATH);

  const noClock = runHeavyAnalyzeRecipe("freshness-receipt", {
    clockIso: "",
    inPath: join(S137_ROOT, "fixtures/synthetic/freshness/cases/positive-complete.json"),
  });
  assert.equal(noClock.status, RECIPE_STATUS.REJECTED);
  assert.equal(noClock.error?.code, ERROR_CODES.MISSING_CLOCK);
});

test("compose confirms S137 pack present at resolvedInputCommit tree", () => {
  assert.ok(existsSync(join(S137_ROOT, "scripts/cli.mjs")));
  assert.ok(existsSync(join(S137_ROOT, "src/packet.mjs")));
  assert.ok(existsSync(join(S137_ROOT, "RESOLVED-INPUT-COMMIT.txt")));
  const pin = readFileSync(join(S137_ROOT, "RESOLVED-INPUT-COMMIT.txt"), "utf8");
  assert.match(pin, /fa6878de125cfdcfd77f4b47037c88667090d293/);
});
