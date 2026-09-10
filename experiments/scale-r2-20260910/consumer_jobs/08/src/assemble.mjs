/**
 * Assemble a thin customer result package from independent CLI recipes.
 *
 * Ready recipe: procurement-brief → shells out to sibling consumer_jobs/07
 * (or uses an embedded fixture path documented in the recipe JSON).
 * Heavy 01–06: return explicit unavailable_pending_heavy slots — never fake demos.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_RECIPE_IDS,
  DRY_RUN_NOTE,
  ERROR_CODES,
  FORBIDDEN_FIELDS,
  HEAVY_PENDING_NOTE,
  INPUT_SCHEMA,
  MANIFEST_SCHEMA,
  MUTATION_BOUNDARY,
  PACKAGE_STATUS,
  RECIPE_STATUS,
  SCHEMA,
} from "./constants.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = join(__dirname, "..");
export const RECIPES_DIR = join(PACKAGE_ROOT, "recipes");
export const FIXTURES_DIR = join(PACKAGE_ROOT, "fixtures");
export const DEMO_OUT_DIR = join(PACKAGE_ROOT, "demo-out");

/** Sibling 07 package (preferred when both trees are present on the branch). */
export const SIBLING_07_ROOT = resolve(PACKAGE_ROOT, "..", "07");
/** Sibling S137 evidence pack (composed on S178; optional on thin Bot-08 branch). */
export const SIBLING_S137_ROOT = resolve(PACKAGE_ROOT, "..", "..", "..", "s137-consumer-evidence-jobs");
export const SIBLING_S137_CLI = join(SIBLING_S137_ROOT, "scripts", "cli.mjs");


function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function hasForbiddenField(obj, path = "") {
  if (!isPlainObject(obj) && !Array.isArray(obj)) return null;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const hit = hasForbiddenField(obj[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_FIELDS.includes(key)) {
      return path ? `${path}.${key}` : key;
    }
    const hit = hasForbiddenField(obj[key], path ? `${path}.${key}` : key);
    if (hit) return hit;
  }
  return null;
}

function packageError(code, message, details = null) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function loadJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Load all recipe JSON files from recipes/.
 * @returns {Map<string, object>}
 */
export function loadRecipeCatalog(recipesDir = RECIPES_DIR) {
  const catalog = new Map();
  if (!existsSync(recipesDir)) return catalog;
  for (const name of readdirSync(recipesDir).sort()) {
    if (!name.endsWith(".json")) continue;
    const recipe = loadJsonFile(join(recipesDir, name));
    if (!recipe?.id || typeof recipe.id !== "string") {
      throw packageError(
        ERROR_CODES.INVALID_INPUT,
        `Recipe file ${name} missing string id`,
        { file: name },
      );
    }
    catalog.set(recipe.id, { ...recipe, _sourceFile: name });
  }
  return catalog;
}

/**
 * Build the recipe manifest (independent CLI recipes + Heavy placeholders).
 */
export function buildRecipeManifest(options = {}) {
  const catalog = options.catalog || loadRecipeCatalog(options.recipesDir || RECIPES_DIR);
  const recipes = [];
  for (const id of BUILTIN_RECIPE_IDS) {
    const r = catalog.get(id);
    if (!r) {
      recipes.push({
        id,
        status: RECIPE_STATUS.UNKNOWN,
        note: "Builtin id declared but recipe JSON missing from recipes/",
      });
      continue;
    }
    recipes.push({
      id: r.id,
      title: r.title || r.id,
      status: r.status,
      jobRef: r.jobRef || null,
      schema: r.schema || null,
      cli: r.cli || null,
      note: r.note || null,
    });
  }
  // Any extra recipes beyond builtins
  for (const [id, r] of catalog) {
    if (BUILTIN_RECIPE_IDS.includes(id)) continue;
    recipes.push({
      id: r.id,
      title: r.title || r.id,
      status: r.status,
      jobRef: r.jobRef || null,
      schema: r.schema || null,
      cli: r.cli || null,
      note: r.note || null,
    });
  }
  return {
    schema: MANIFEST_SCHEMA,
    generatedAt: (options.clock || (() => Date.now()))(),
    dryRunNote: DRY_RUN_NOTE,
    heavyPendingNote: HEAVY_PENDING_NOTE,
    recipes,
    summary: {
      readyCount: recipes.filter((x) => x.status === RECIPE_STATUS.READY).length,
      pendingHeavyCount: recipes.filter(
        (x) => x.status === RECIPE_STATUS.UNAVAILABLE_PENDING_HEAVY,
      ).length,
      unknownCount: recipes.filter((x) => x.status === RECIPE_STATUS.UNKNOWN).length,
    },
  };
}

function resolve07Cli(recipe, options = {}) {
  const siblingRoot = options.sibling07Root || SIBLING_07_ROOT;
  const siblingCli = join(siblingRoot, "src", "cli.mjs");
  if (existsSync(siblingCli)) {
    return { mode: "sibling", cliPath: siblingCli, cwd: siblingRoot };
  }
  // Thin fallback: embedded recipe documents fixture-demo path under recipes/procurement-brief/
  const embeddedDir = join(
    options.packageRoot || PACKAGE_ROOT,
    "recipes",
    "procurement-brief",
  );
  const embeddedCli = join(embeddedDir, "cli.mjs");
  if (existsSync(embeddedCli)) {
    return { mode: "embedded", cliPath: embeddedCli, cwd: embeddedDir };
  }
  return {
    mode: "missing",
    cliPath: null,
    cwd: null,
    searched: [siblingCli, embeddedCli],
    recipeCliHint: recipe?.cli || null,
  };
}

/**
 * Run the ready procurement-brief recipe offline against a fixture path.
 */
export function runProcurementBriefRecipe(inputPath, options = {}) {
  const catalog = options.catalog || loadRecipeCatalog(options.recipesDir || RECIPES_DIR);
  const recipe = catalog.get("procurement-brief");
  if (!recipe) {
    throw packageError(ERROR_CODES.UNKNOWN_RECIPE, "procurement-brief recipe missing");
  }
  if (recipe.status !== RECIPE_STATUS.READY) {
    throw packageError(
      ERROR_CODES.RECIPE_UNAVAILABLE,
      `procurement-brief status is ${recipe.status}, expected ready`,
    );
  }
  const resolved = resolve07Cli(recipe, options);
  if (resolved.mode === "missing") {
    return {
      recipeId: "procurement-brief",
      status: RECIPE_STATUS.UNAVAILABLE_PENDING_HEAVY,
      error: {
        code: ERROR_CODES.MISSING_DEPENDENCY,
        message:
          "R2-CONSUMER-JOBS-07 CLI not found at sibling ../07 or embedded recipes/procurement-brief/",
        searched: resolved.searched,
      },
      output: null,
    };
  }

  const absInput = resolve(inputPath);
  if (!existsSync(absInput)) {
    throw packageError(ERROR_CODES.INVALID_INPUT, `Input fixture not found: ${absInput}`);
  }

  const result = spawnSync(process.execPath, [resolved.cliPath, "brief", absInput], {
    encoding: "utf8",
    cwd: resolved.cwd,
    env: { ...process.env },
  });

  let output = null;
  let parseError = null;
  try {
    output = JSON.parse(result.stdout || "{}");
  } catch (e) {
    parseError = e.message;
  }

  const ok =
    result.status === 0 &&
    output &&
    (output.status === "ready" || output.status === "partial_input");

  return {
    recipeId: "procurement-brief",
    status: ok
      ? RECIPE_STATUS.READY
      : output?.status === "rejected"
        ? "rejected"
        : result.status === 0
          ? RECIPE_STATUS.READY
          : "failed",
    dependencyMode: resolved.mode,
    exitCode: result.status,
    stderr: (result.stderr || "").trim() || null,
    parseError,
    output,
  };
}

/**
 * Validate a customer result request (thin journey input).
 */
export function validateResultRequest(raw) {
  if (!isPlainObject(raw)) {
    throw packageError(ERROR_CODES.INVALID_INPUT, "Request must be a plain object");
  }
  const forbidden = hasForbiddenField(raw);
  if (forbidden) {
    throw packageError(
      ERROR_CODES.FORBIDDEN_CLAIM,
      `Forbidden field present: ${forbidden}`,
      { field: forbidden },
    );
  }
  const recipeIds = raw.recipeIds;
  if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
    throw packageError(
      ERROR_CODES.INVALID_INPUT,
      "recipeIds must be a non-empty string array",
    );
  }
  for (const id of recipeIds) {
    if (typeof id !== "string" || !id.trim()) {
      throw packageError(ERROR_CODES.INVALID_INPUT, "Each recipeId must be a non-empty string");
    }
  }
  return {
    schema: raw.schema || INPUT_SCHEMA,
    requestId: typeof raw.requestId === "string" ? raw.requestId : "anonymous",
    recipeIds: [...recipeIds],
    procurementInputPath:
      typeof raw.procurementInputPath === "string" ? raw.procurementInputPath : null,
    note: typeof raw.note === "string" ? raw.note : null,
  };
}

/**
 * Assemble a customer result package for the requested recipe ids.
 */
export function assembleCustomerResultPackage(rawRequest, options = {}) {
  const clock = options.clock || (() => Date.now());
  const catalog = options.catalog || loadRecipeCatalog(options.recipesDir || RECIPES_DIR);
  const manifest = buildRecipeManifest({ ...options, catalog, clock });

  let request;
  try {
    request = validateResultRequest(rawRequest);
  } catch (err) {
    return {
      schema: SCHEMA,
      status: PACKAGE_STATUS.REJECTED,
      generatedAt: clock(),
      requestId: isPlainObject(rawRequest) ? rawRequest.requestId || null : null,
      error: {
        code: err.code || ERROR_CODES.INVALID_INPUT,
        message: err.message,
        details: err.details || null,
      },
      recipes: [],
      dryRunNote: DRY_RUN_NOTE,
      mutationBoundary: MUTATION_BOUNDARY,
      hasInvestmentRecommendation: false,
    };
  }

  const slots = [];
  let readyCount = 0;
  let pendingCount = 0;
  let unknownCount = 0;
  let rejectedRecipe = false;

  for (const id of request.recipeIds) {
    const recipe = catalog.get(id);
    if (!recipe) {
      unknownCount += 1;
      slots.push({
        recipeId: id,
        status: RECIPE_STATUS.UNKNOWN,
        error: {
          code: ERROR_CODES.UNKNOWN_RECIPE,
          message: `Unknown recipe id: ${id}`,
        },
        output: null,
      });
      continue;
    }

    if (recipe.status === RECIPE_STATUS.UNAVAILABLE_PENDING_HEAVY) {
      pendingCount += 1;
      slots.push({
        recipeId: id,
        title: recipe.title || id,
        status: RECIPE_STATUS.UNAVAILABLE_PENDING_HEAVY,
        jobRef: recipe.jobRef || null,
        note: recipe.note || HEAVY_PENDING_NOTE,
        output: null,
      });
      continue;
    }

    if (recipe.status === RECIPE_STATUS.READY && id === "procurement-brief") {
      const inputPath =
        request.procurementInputPath ||
        join(
          options.fixturesDir || FIXTURES_DIR,
          "..",
          "..",
          "07",
          "fixtures",
          "positive.json",
        );
      // Prefer explicit path; fall back to sibling 07 positive fixture.
      let resolvedInput = request.procurementInputPath
        ? resolve(options.packageRoot || PACKAGE_ROOT, request.procurementInputPath)
        : null;
      if (!resolvedInput || !existsSync(resolvedInput)) {
        const siblingPositive = join(SIBLING_07_ROOT, "fixtures", "positive.json");
        const localPositive = join(
          options.packageRoot || PACKAGE_ROOT,
          "fixtures",
          "procurement-brief-positive.json",
        );
        if (existsSync(siblingPositive)) resolvedInput = siblingPositive;
        else if (existsSync(localPositive)) resolvedInput = localPositive;
        else resolvedInput = inputPath;
      }

      const run = runProcurementBriefRecipe(resolvedInput, { ...options, catalog });
      if (run.status === RECIPE_STATUS.READY) readyCount += 1;
      else if (run.status === "rejected") rejectedRecipe = true;
      else if (run.status === RECIPE_STATUS.UNAVAILABLE_PENDING_HEAVY) pendingCount += 1;
      slots.push({
        recipeId: id,
        title: recipe.title || id,
        status: run.status,
        dependencyMode: run.dependencyMode || null,
        jobRef: recipe.jobRef || null,
        exitCode: run.exitCode ?? null,
        error: run.error || null,
        output: run.output,
      });
      continue;
    }

    // Ready but no runner wired yet
    slots.push({
      recipeId: id,
      title: recipe.title || id,
      status: recipe.status,
      note: "Recipe marked ready but no thin runner is wired in assemble.mjs yet.",
      output: null,
    });
  }

  let status = PACKAGE_STATUS.READY;
  if (unknownCount > 0 && readyCount === 0 && pendingCount === 0) {
    status = PACKAGE_STATUS.REJECTED;
  } else if (rejectedRecipe && readyCount === 0 && pendingCount === 0) {
    status = PACKAGE_STATUS.REJECTED;
  } else if (pendingCount > 0 || unknownCount > 0 || rejectedRecipe) {
    status = PACKAGE_STATUS.PARTIAL;
  } else if (readyCount === 0) {
    status = PACKAGE_STATUS.PARTIAL;
  }

  return {
    schema: SCHEMA,
    status,
    generatedAt: clock(),
    requestId: request.requestId,
    requestedRecipeIds: request.recipeIds,
    recipes: slots,
    manifestSummary: manifest.summary,
    summary: {
      readyCount,
      pendingHeavyCount: pendingCount,
      unknownCount,
      note: "Factual recipe slot counts only. No investment recommendation.",
    },
    dryRunNote: DRY_RUN_NOTE,
    heavyPendingNote: HEAVY_PENDING_NOTE,
    mutationBoundary: MUTATION_BOUNDARY,
    hasInvestmentRecommendation: false,
  };
}

/**
 * Clean-install journey: run positive fixture, write demo-out artifacts.
 */
export function runCleanInstallJourney(options = {}) {
  const outDir = options.demoOutDir || DEMO_OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const clock = options.clock || (() => Date.parse("2026-09-10T18:00:00.000Z"));

  const positivePath = join(options.fixturesDir || FIXTURES_DIR, "positive-journey.json");
  const partialPath = join(options.fixturesDir || FIXTURES_DIR, "partial-missing-heavy.json");
  const negativePath = join(options.fixturesDir || FIXTURES_DIR, "negative-unknown-recipe.json");

  const positive = assembleCustomerResultPackage(loadJsonFile(positivePath), {
    ...options,
    clock,
  });
  const partial = assembleCustomerResultPackage(loadJsonFile(partialPath), {
    ...options,
    clock,
  });
  const negative = assembleCustomerResultPackage(loadJsonFile(negativePath), {
    ...options,
    clock,
  });
  const manifest = buildRecipeManifest({ ...options, clock });

  const journey = {
    schema: SCHEMA,
    journey: true,
    generatedAt: clock(),
    note: "Clean-install offline journey. Synthetic fixtures only; Heavy 01–06 pending.",
    steps: [
      { name: "manifest", result: manifest },
      { name: "positive-journey", result: positive },
      { name: "partial-missing-heavy", result: partial },
      { name: "negative-unknown-recipe", result: negative },
    ],
    hasInvestmentRecommendation: false,
  };

  writeFileSync(join(outDir, "journey.json"), JSON.stringify(journey, null, 2) + "\n");
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(outDir, "positive.json"), JSON.stringify(positive, null, 2) + "\n");
  writeFileSync(join(outDir, "partial.json"), JSON.stringify(partial, null, 2) + "\n");
  writeFileSync(join(outDir, "negative.json"), JSON.stringify(negative, null, 2) + "\n");

  return journey;
}



/**
 * S178/compose compatibility: spawn S137 analyze when the sibling pack is present.
 * Does not invent pass. Missing sibling → unavailable_pending_heavy style result.
 */
const HEAVY_ARTIFACT_BY_RECIPE = Object.freeze({
  "heavy-01-evidence-capture": "migration-checklist",
  "heavy-02-evidence-normalize": "release-brief",
  "heavy-03-evidence-link": "table-reconcile",
  "heavy-04-evidence-score-gate": "link-index",
  "heavy-05-evidence-package": "replay-pack",
  "heavy-06-evidence-publish-prep": "freshness-receipt",
  "migration-checklist": "migration-checklist",
  "release-brief": "release-brief",
  "table-reconcile": "table-reconcile",
  "link-index": "link-index",
  "replay-pack": "replay-pack",
  "freshness-receipt": "freshness-receipt",
});

export function runHeavyAnalyzeRecipe(recipeId, options = {}) {
  const artifactId = HEAVY_ARTIFACT_BY_RECIPE[recipeId] || recipeId;
  const s137Root = options.s137Root || SIBLING_S137_ROOT;
  const cliPath = options.cliPath || join(s137Root, "scripts", "cli.mjs");
  const clock = options.clock || "2026-09-10T12:00:00.000Z";
  const inputPath = options.inputPath || options.inPath || null;
  if (!existsSync(cliPath)) {
    return {
      recipeId,
      artifactId,
      status: RECIPE_STATUS.UNAVAILABLE_PENDING_HEAVY,
      decision: null,
      ok: false,
      error: {
        code: ERROR_CODES.MISSING_DEPENDENCY,
        message: `S137 CLI missing at ${cliPath}`,
      },
      output: null,
    };
  }
  if (!inputPath || !existsSync(inputPath)) {
    return {
      recipeId,
      artifactId,
      status: RECIPE_STATUS.FAILED,
      decision: "invalid",
      ok: false,
      error: {
        code: ERROR_CODES.INVALID_INPUT,
        message: "runHeavyAnalyzeRecipe requires a local inputPath",
      },
      output: null,
    };
  }
  const result = spawnSync(
    process.execPath,
    [cliPath, "analyze", artifactId, "--in", inputPath, "--clock", clock],
    { encoding: "utf8", cwd: s137Root, maxBuffer: 8 * 1024 * 1024 },
  );
  let output = null;
  try {
    output = JSON.parse(result.stdout || "");
  } catch (e) {
    return {
      recipeId,
      artifactId,
      status: RECIPE_STATUS.FAILED,
      decision: "fail",
      ok: false,
      error: { code: "cli_parse_failed", message: e.message, stderr: result.stderr },
      exitCode: result.status,
      output: null,
    };
  }
  const decision = output?.decision || "unknown";
  return {
    recipeId,
    artifactId,
    status: RECIPE_STATUS.READY,
    decision,
    ok: true,
    exitCode: result.status,
    output,
  };
}


export {
  isPlainObject,
  hasForbiddenField,
  packageError,
  loadJsonFile,
  resolve07Cli,
};

export function assertSafeLocalPath(p) {
  if (typeof p !== "string" || !p) throw Object.assign(new Error("path required"), { code: ERROR_CODES.INVALID_INPUT });
  if (/^https?:/i.test(p)) throw Object.assign(new Error("remote URLs refused"), { code: ERROR_CODES.INVALID_INPUT });
  return p;
}
