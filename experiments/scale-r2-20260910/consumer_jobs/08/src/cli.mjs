#!/usr/bin/env node
/**
 * Fresh-consumer CLI for R2-CONSUMER-JOBS-08 (thin customer result package).
 *
 *   node src/cli.mjs manifest
 *   node src/cli.mjs assemble <request.json|->
 *   node src/cli.mjs journey
 *   node src/cli.mjs demo
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleCustomerResultPackage,
  buildRecipeManifest,
  runCleanInstallJourney,
} from "./assemble.mjs";
import { PACKAGE_STATUS, SCHEMA } from "./constants.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadJson(path) {
  if (path === "-" || path === "/dev/stdin") {
    return JSON.parse(readFileSync(0, "utf8"));
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function usage() {
  console.error(`Usage:
  node src/cli.mjs manifest
  node src/cli.mjs assemble <request.json|->
  node src/cli.mjs journey
  node src/cli.mjs demo`);
  process.exit(2);
}

const [cmd, a] = process.argv.slice(2);
if (!cmd) usage();

const clock = () => Date.parse("2026-09-10T18:00:00.000Z");

try {
  if (cmd === "manifest") {
    console.log(JSON.stringify(buildRecipeManifest({ clock }), null, 2));
  } else if (cmd === "assemble") {
    if (!a) usage();
    const pkg = assembleCustomerResultPackage(loadJson(a), { clock });
    console.log(JSON.stringify(pkg, null, 2));
    if (pkg.status === PACKAGE_STATUS.REJECTED) process.exit(1);
  } else if (cmd === "journey") {
    const journey = runCleanInstallJourney({ clock });
    console.log(
      JSON.stringify(
        {
          schema: SCHEMA,
          journey: true,
          wrote: [
            "demo-out/journey.json",
            "demo-out/manifest.json",
            "demo-out/positive.json",
            "demo-out/partial.json",
            "demo-out/negative.json",
          ],
          summary: {
            positiveStatus: journey.steps.find((s) => s.name === "positive-journey")?.result
              ?.status,
            partialStatus: journey.steps.find((s) => s.name === "partial-missing-heavy")?.result
              ?.status,
            negativeStatus: journey.steps.find((s) => s.name === "negative-unknown-recipe")
              ?.result?.status,
            readyRecipes: journey.steps.find((s) => s.name === "manifest")?.result?.summary
              ?.readyCount,
            pendingHeavy: journey.steps.find((s) => s.name === "manifest")?.result?.summary
              ?.pendingHeavyCount,
            hasInvestmentRecommendation: false,
          },
          note: journey.note,
        },
        null,
        2,
      ),
    );
  } else if (cmd === "demo") {
    const journey = runCleanInstallJourney({ clock });
    const manifest = journey.steps.find((s) => s.name === "manifest").result;
    const positive = journey.steps.find((s) => s.name === "positive-journey").result;
    const partial = journey.steps.find((s) => s.name === "partial-missing-heavy").result;
    const negative = journey.steps.find((s) => s.name === "negative-unknown-recipe").result;
    console.log(
      JSON.stringify(
        {
          schema: SCHEMA,
          demo: true,
          note: "Synthetic fixtures only; no live paid calls; Heavy 01–06 unavailable_pending_heavy.",
          results: {
            "manifest.readyCount": manifest.summary.readyCount,
            "manifest.pendingHeavyCount": manifest.summary.pendingHeavyCount,
            "positive-journey.json": {
              status: positive.status,
              recipeStatuses: positive.recipes.map((r) => ({
                id: r.recipeId,
                status: r.status,
              })),
              hasInvestmentRecommendation: positive.hasInvestmentRecommendation,
            },
            "partial-missing-heavy.json": {
              status: partial.status,
              recipeStatuses: partial.recipes.map((r) => ({
                id: r.recipeId,
                status: r.status,
              })),
              hasInvestmentRecommendation: partial.hasInvestmentRecommendation,
            },
            "negative-unknown-recipe.json": {
              status: negative.status,
              recipeStatuses: negative.recipes.map((r) => ({
                id: r.recipeId,
                status: r.status,
              })),
              hasInvestmentRecommendation: negative.hasInvestmentRecommendation,
            },
          },
        },
        null,
        2,
      ),
    );
  } else {
    usage();
  }
} catch (err) {
  console.error(
    JSON.stringify({
      error: err.code || "error",
      message: err.message,
      details: err.details || null,
    }),
  );
  process.exit(1);
}
