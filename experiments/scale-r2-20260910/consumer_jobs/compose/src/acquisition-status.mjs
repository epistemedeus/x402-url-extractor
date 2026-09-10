/**
 * Buyer acquisition status interface for S152 compose / S159.
 *
 * Surfaces exact per-recipe slotStatus + heavyDecision from a journey or
 * customer-result package JSON. Partial packageStatus is acquisition-ok
 * (exit 0 from CLI); rejected/invalid are the only failures for this tool.
 *
 * Does not re-run Heavy analyze, invent pass, or claim ready packages.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRecipeCatalog } from "../../08/src/assemble.mjs";
import {
  PACKAGE_STATUS,
  RECIPE_STATUS,
} from "../../08/src/constants.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const COMPOSE_ROOT = join(__dirname, "..");
export const EIGHT_ROOT = join(__dirname, "..", "..", "08");

export const ACQUISITION_STATUS_SCHEMA = "x402.r2.consumer.acquisition_status.v1";

/** Exact S152 positive integrated journey matrix (Heavy CLI truth; not invented). */
export const S152_POSITIVE_PARTIAL_MATRIX = Object.freeze([
  { id: "migration-checklist", jobRef: "R2-CONSUMER-JOBS-01", slotStatus: "ready", heavyDecision: "pass" },
  { id: "release-brief", jobRef: "R2-CONSUMER-JOBS-02", slotStatus: "ready", heavyDecision: "pass" },
  { id: "table-reconcile", jobRef: "R2-CONSUMER-JOBS-03", slotStatus: "failed", heavyDecision: "fail" },
  { id: "link-index", jobRef: "R2-CONSUMER-JOBS-04", slotStatus: "failed", heavyDecision: "fail" },
  { id: "replay-pack", jobRef: "R2-CONSUMER-JOBS-05", slotStatus: "failed", heavyDecision: "fail" },
  { id: "freshness-receipt", jobRef: "R2-CONSUMER-JOBS-06", slotStatus: "ready", heavyDecision: "pass" },
  { id: "procurement-brief", jobRef: "R2-CONSUMER-JOBS-07", slotStatus: "ready", heavyDecision: null },
]);

export const KNOWN_EXTERNAL_HEAVY_DEFECTS = Object.freeze([
  {
    ids: ["table-reconcile", "link-index", "replay-pack"],
    kind: "heavy_cli_analyze_fail",
    note: "Heavy CLI analyze on synthetic positive cases returns fail (external defect). Compose records real fail — not unavailable_pending_heavy.",
  },
  {
    ids: ["release-brief"],
    kind: "heavy_cli_conflict_misreport",
    note: "Some release-brief conflict fixtures via CLI return pass instead of conflict (external defect deferred to Heavy).",
  },
]);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Default journey search order (compose + 08 demo-out).
 */
export function defaultJourneyCandidates(options = {}) {
  const composeRoot = options.composeRoot || COMPOSE_ROOT;
  const eightRoot = options.eightRoot || EIGHT_ROOT;
  return [
    join(eightRoot, "demo-out", "s152", "journey.json"),
    join(composeRoot, "demo-out", "s152", "journey.json"),
    join(eightRoot, "demo-out", "journey.json"),
    join(composeRoot, "demo-out", "journey.json"),
  ];
}

export function findDefaultJourneyPath(options = {}) {
  for (const p of defaultJourneyCandidates(options)) {
    if (existsSync(p)) return p;
  }
  return null;
}

function catalogJobRef(recipeId, catalog) {
  const r = catalog?.get?.(recipeId);
  return r?.jobRef || null;
}

/**
 * Normalize a customer result package into acquisition recipe rows.
 */
export function recipesFromPackage(pkg, options = {}) {
  const catalog = options.catalog || loadRecipeCatalog(options.recipesDir);
  const recipes = Array.isArray(pkg?.recipes) ? pkg.recipes : [];
  return recipes.map((slot) => {
    const id = slot.recipeId || slot.id;
    return {
      id,
      jobRef: slot.jobRef || catalogJobRef(id, catalog) || null,
      slotStatus: slot.status || null,
      heavyDecision: slot.decision ?? slot.output?.decision ?? null,
    };
  });
}

/**
 * Extract the primary package from a journey JSON (prefers positive-journey step).
 */
export function packageFromJourney(journey, options = {}) {
  const preferStep = options.step || "positive-journey";
  if (!isPlainObject(journey)) {
    const err = new Error("Journey must be a plain object");
    err.code = "invalid_input";
    throw err;
  }
  if (Array.isArray(journey.steps)) {
    const step =
      journey.steps.find((s) => s?.name === preferStep) ||
      journey.steps.find((s) => s?.name === "positive") ||
      journey.steps.find((s) => s?.result?.recipes);
    if (step?.result) {
      return { pkg: step.result, stepName: step.name };
    }
  }
  // Allow a bare customer-result package shaped object
  if (Array.isArray(journey.recipes) && journey.status) {
    return { pkg: journey, stepName: null };
  }
  const err = new Error(
    `Journey missing step "${preferStep}" (or package.recipes); cannot derive acquisition status`,
  );
  err.code = "invalid_input";
  throw err;
}

function summarizeRecipes(recipes, packageStatus) {
  const readyIds = recipes.filter((r) => r.slotStatus === RECIPE_STATUS.READY).map((r) => r.id);
  const failedIds = recipes
    .filter((r) => r.slotStatus === RECIPE_STATUS.FAILED || r.heavyDecision === "fail")
    .map((r) => r.id);
  const conflictIds = recipes
    .filter((r) => r.slotStatus === RECIPE_STATUS.CONFLICT || r.heavyDecision === "conflict")
    .map((r) => r.id);
  const passHeavy = recipes
    .filter((r) => r.heavyDecision === "pass")
    .map((r) => r.id);
  const failHeavy = recipes
    .filter((r) => r.heavyDecision === "fail")
    .map((r) => r.id);
  return {
    readyCount: readyIds.length,
    failedCount: failedIds.length,
    conflictCount: conflictIds.length,
    readyIds,
    failedIds,
    conflictIds,
    passHeavy,
    failHeavy,
    packageStatus,
  };
}

/**
 * Build acquisition status document from a package (+ optional source meta).
 */
export function buildAcquisitionStatus(pkg, options = {}) {
  if (!isPlainObject(pkg)) {
    const err = new Error("Package must be a plain object");
    err.code = "invalid_input";
    throw err;
  }
  const packageStatus = pkg.status || null;
  if (!packageStatus) {
    const err = new Error("Package missing status");
    err.code = "invalid_input";
    throw err;
  }
  const recipes = recipesFromPackage(pkg, options);
  const summary = summarizeRecipes(recipes, packageStatus);
  const acquisitionOk =
    packageStatus === PACKAGE_STATUS.READY || packageStatus === PACKAGE_STATUS.PARTIAL;

  return {
    schema: ACQUISITION_STATUS_SCHEMA,
    packageStatus,
    acquisitionOk,
    source: options.source || null,
    recipes,
    summary,
    knownExternalHeavyDefects: [...KNOWN_EXTERNAL_HEAVY_DEFECTS],
    hasInvestmentRecommendation: pkg.hasInvestmentRecommendation === true,
    notes: [
      "Partial packageStatus is acquisition-ok for this status tool (eyes open).",
      "Heavy CLI fail slots are external defects — not unavailable_pending_heavy.",
      "No investment, revenue, ranking, escrow, or custody claims.",
      "Fixture URLs/commands stay data; do not auto-fetch.",
    ],
  };
}

/**
 * Load journey or package path and build acquisition status.
 */
export function acquisitionStatusFromPath(path, options = {}) {
  if (!path || typeof path !== "string") {
    const err = new Error("Missing journey/package path");
    err.code = "missing_file";
    throw err;
  }
  const abs = resolve(path);
  if (!existsSync(abs)) {
    const err = new Error(`Journey/package file not found: ${abs}`);
    err.code = "missing_file";
    throw err;
  }
  let raw;
  try {
    raw = loadJson(abs);
  } catch (e) {
    const err = new Error(`Invalid JSON at ${abs}: ${e.message}`);
    err.code = "invalid_input";
    throw err;
  }

  let pkg;
  let stepName = null;
  if (Array.isArray(raw.steps) || raw.journey === true) {
    const extracted = packageFromJourney(raw, options);
    pkg = extracted.pkg;
    stepName = extracted.stepName;
  } else if (Array.isArray(raw.recipes) && raw.status) {
    pkg = raw;
  } else {
    const err = new Error(
      "Input is neither a journey (steps[]) nor a customer result package (status + recipes)",
    );
    err.code = "invalid_input";
    throw err;
  }

  return buildAcquisitionStatus(pkg, {
    ...options,
    source: {
      kind: stepName ? "journey" : "package",
      path: abs,
      step: stepName,
    },
  });
}

/**
 * Resolve input: --journey / --package / default journey path.
 * Does not spawn Heavy.
 */
export function resolveAcquisitionInput(options = {}) {
  if (options.journeyPath) {
    return { path: resolve(options.journeyPath), via: "journey" };
  }
  if (options.packagePath) {
    return { path: resolve(options.packagePath), via: "package" };
  }
  const found = findDefaultJourneyPath(options);
  if (found) return { path: found, via: "default_journey" };
  const err = new Error(
    "No journey.json found under demo-out/s152 (run 08 journey first, or pass --journey <path>)",
  );
  err.code = "missing_file";
  throw err;
}

/**
 * Human-readable table for acquisition operators.
 */
export function formatAcquisitionStatusTable(status) {
  const rows = [
    "recipe id                  jobRef                   slotStatus   heavyDecision",
    "-------------------------  -----------------------  -----------  -------------",
  ];
  for (const r of status.recipes || []) {
    const id = String(r.id || "").padEnd(25);
    const job = String(r.jobRef || "—").padEnd(23);
    const slot = String(r.slotStatus || "—").padEnd(11);
    const dec = r.heavyDecision == null ? "—" : String(r.heavyDecision);
    rows.push(`${id}  ${job}  ${slot}  ${dec}`);
  }
  rows.push("");
  rows.push(
    `packageStatus: ${status.packageStatus}   acquisitionOk: ${status.acquisitionOk}   schema: ${status.schema}`,
  );
  if (status.summary?.failHeavy?.length) {
    rows.push(`failHeavy (external Heavy CLI defects): ${status.summary.failHeavy.join(", ")}`);
  }
  return rows.join("\n");
}

/**
 * Exit code for status CLI: 0 for ready/partial; 1 for rejected or tool errors.
 */
export function acquisitionStatusExitCode(statusOrError) {
  if (statusOrError && statusOrError.schema === ACQUISITION_STATUS_SCHEMA) {
    return statusOrError.acquisitionOk ? 0 : 1;
  }
  return 1;
}

export {
  isPlainObject,
  loadJson,
  PACKAGE_STATUS,
  RECIPE_STATUS,
};
