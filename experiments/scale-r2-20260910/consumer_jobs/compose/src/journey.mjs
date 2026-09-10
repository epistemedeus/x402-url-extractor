/**
 * S152 compose helpers — thin wrappers around consumer_jobs/08 assemble.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleCustomerResultPackage,
  assertSafeLocalPath,
  buildRecipeManifest,
  runCleanInstallJourney,
  runHeavyAnalyzeRecipe,
} from "../../08/src/assemble.mjs";
import {
  DEFAULT_OPERATOR_CLOCK,
  HEAVY_RECIPE_IDS,
} from "../../08/src/constants.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const COMPOSE_ROOT = join(__dirname, "..");
export const EIGHT_ROOT = join(__dirname, "..", "..", "08");
export const S137_ROOT = join(__dirname, "..", "..", "..", "..", "s137-consumer-evidence-jobs");

export {
  assembleCustomerResultPackage,
  assertSafeLocalPath,
  buildRecipeManifest,
  runCleanInstallJourney,
  runHeavyAnalyzeRecipe,
  DEFAULT_OPERATOR_CLOCK,
  HEAVY_RECIPE_IDS,
};
