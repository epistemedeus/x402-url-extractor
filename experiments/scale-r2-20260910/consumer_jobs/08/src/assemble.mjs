/**
 * Assemble a thin customer result package from independent CLI recipes.
 *
 * Ready recipes:
 *   - procurement-brief → sibling consumer_jobs/07
 *   - Heavy 01–06 (migration-checklist … freshness-receipt) → S137 scripts/cli.mjs
 *
 * Never invents Heavy packet bodies. URLs in fixtures stay data (no fetch).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_RECIPE_IDS,
  DEFAULT_OPERATOR_CLOCK,
  DRY_RUN_NOTE,
  ERROR_CODES,
  FORBIDDEN_FIELDS,
  HEAVY_PACKET_SCHEMA,
  HEAVY_PENDING_NOTE,
  HEAVY_RECIPE_IDS,
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

/** Heavy S137 pack at experiments/s137-consumer-evidence-jobs (from 08). */
export const SIBLING_S137_ROOT = resolve(PACKAGE_ROOT, "..", "..", "..", "s137-consumer-evidence-jobs");

const CLOCK_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

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

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

/**
 * Resolve a path relative to base and refuse URLs / escapes outside allowRoots.
 */
export function assertSafeLocalPath(rawPath, options = {}) {
  if (rawPath == null || typeof rawPath !== "string" || !rawPath.trim()) {
    throw packageError(ERROR_CODES.UNSAFE_PATH, "Path must be a non-empty local string", {
      path: rawPath,
    });
  }
  if (looksLikeUrl(rawPath)) {
    throw packageError(ERROR_CODES.UNSAFE_PATH, "URLs refused as paths (stay data; no fetch)", {
      path: rawPath,
    });
  }
  const base = options.base || PACKAGE_ROOT;
  const resolved = resolve(base, rawPath);
  const normalized = normalize(resolved);
  // Soft refuse obvious traversal payloads that still resolve oddly
  if (String(rawPath).includes("\0")) {
    throw packageError(ERROR_CODES.UNSAFE_PATH, "NUL byte in path refused", { path: rawPath });
  }
  const allowRoots = (options.allowRoots || [PACKAGE_ROOT, SIBLING_07_ROOT, SIBLING_S137_ROOT]).map((r) =>
    normalize(resolve(r)),
  );
  const ok = allowRoots.some((root) => {
    const rel = relative(root, normalized);
    return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(".."));
  });
  if (!ok) {
    throw packageError(ERROR_CODES.UNSAFE_PATH, "Path escapes allowed package roots", {
      path: rawPath,
      resolved: normalized,
      allowRoots,
    });
  }
  return normalized;
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
 * Build the recipe manifest (independent CLI recipes).
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
      artifact: r.artifact || null,
      cli: r.cli || null,
      note: r.note || null,
    });
  }
  for (const [id, r] of catalog) {
    if (BUILTIN_RECIPE_IDS.includes(id)) continue;
    recipes.push({
      id: r.id,
      title: r.title || r.id,
      status: r.status,
      jobRef: r.jobRef || null,
      schema: r.schema || null,
      artifact: r.artifact || null,
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
 * Resolve Heavy S137 CLI path from recipe; refuse unsafe / non-cli paths.
 */
export function resolveHeavyCli(recipe, options = {}) {
  const packageRoot = options.packageRoot || PACKAGE_ROOT;
  const s137Root = options.s137Root || SIBLING_S137_ROOT;
  const hint = recipe?.cli?.path || "../../../s137-consumer-evidence-jobs/scripts/cli.mjs";
  let cliPath;
  try {
    cliPath = assertSafeLocalPath(hint, {
      base: packageRoot,
      allowRoots: [packageRoot, s137Root, resolve(packageRoot, "..", "..", "..")],
    });
  } catch (err) {
    return {
      mode: "refused",
      cliPath: null,
      cwd: null,
      error: { code: err.code || ERROR_CODES.UNSAFE_PATH, message: err.message, details: err.details },
    };
  }
  if (!cliPath.endsWith(`${sep}scripts${sep}cli.mjs`) && !cliPath.endsWith("/scripts/cli.mjs")) {
    return {
      mode: "refused",
      cliPath: null,
      cwd: null,
      error: {
        code: ERROR_CODES.UNSAFE_PATH,
        message: "Heavy CLI path must resolve to scripts/cli.mjs",
        details: { cliPath },
      },
    };
  }
  if (!existsSync(cliPath)) {
    return {
      mode: "missing",
      cliPath,
      cwd: dirname(dirname(cliPath)),
      error: {
        code: ERROR_CODES.MISSING_DEPENDENCY,
        message: `Heavy S137 CLI not found at ${cliPath}`,
      },
    };
  }
  // Prefer realpath so we can compare against known pack
  let realCli = cliPath;
  try {
    realCli = realpathSync(cliPath);
  } catch {
    /* keep */
  }
  return {
    mode: "s137",
    cliPath: realCli,
    cwd: dirname(dirname(realCli)),
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
        ? RECIPE_STATUS.REJECTED
        : result.status === 0
          ? RECIPE_STATUS.READY
          : RECIPE_STATUS.FAILED,
    dependencyMode: resolved.mode,
    exitCode: result.status,
    stderr: (result.stderr || "").trim() || null,
    parseError,
    output,
  };
}

function mapHeavyDecisionToSlotStatus(decision) {
  if (decision === "pass") return RECIPE_STATUS.READY;
  if (decision === "conflict") return RECIPE_STATUS.CONFLICT;
  if (decision === "partial") return RECIPE_STATUS.PARTIAL;
  if (decision === "fail" || decision === "unknown") return RECIPE_STATUS.FAILED;
  return RECIPE_STATUS.FAILED;
}

/**
 * Spawn S137 Heavy CLI analyze for one ready Heavy recipe.
 * Requires operator clock + local --in. Does not invent packet bodies.
 */
export function runHeavyAnalyzeRecipe(recipeId, options = {}) {
  const catalog = options.catalog || loadRecipeCatalog(options.recipesDir || RECIPES_DIR);
  const recipe = catalog.get(recipeId);
  if (!recipe) {
    throw packageError(ERROR_CODES.UNKNOWN_RECIPE, `Unknown Heavy recipe: ${recipeId}`);
  }
  if (recipe.status !== RECIPE_STATUS.READY) {
    throw packageError(
      ERROR_CODES.RECIPE_UNAVAILABLE,
      `${recipeId} status is ${recipe.status}, expected ready`,
    );
  }

  const clock = options.clockIso || options.operatorClock || null;
  if (!clock || typeof clock !== "string" || !CLOCK_RE.test(clock)) {
    return {
      recipeId,
      status: RECIPE_STATUS.REJECTED,
      error: {
        code: ERROR_CODES.MISSING_CLOCK,
        message: "Heavy analyze requires operator --clock (ISO-8601); do not invent",
        details: { clock },
      },
      output: null,
    };
  }

  const packageRoot = options.packageRoot || PACKAGE_ROOT;
  const s137Root = options.s137Root || SIBLING_S137_ROOT;
  const resolvedCli = resolveHeavyCli(recipe, { packageRoot, s137Root });
  if (resolvedCli.mode === "refused") {
    return {
      recipeId,
      status: RECIPE_STATUS.REJECTED,
      error: resolvedCli.error,
      output: null,
    };
  }
  if (resolvedCli.mode === "missing") {
    return {
      recipeId,
      status: RECIPE_STATUS.UNAVAILABLE_PENDING_HEAVY,
      error: resolvedCli.error,
      output: null,
    };
  }

  const inHint =
    options.inPath ||
    recipe.cli?.defaultIn ||
    null;
  if (!inHint || typeof inHint !== "string") {
    return {
      recipeId,
      status: RECIPE_STATUS.REJECTED,
      error: {
        code: ERROR_CODES.MISSING_IN,
        message: "Heavy analyze requires --in (local fixture path)",
      },
      output: null,
    };
  }

  let absIn;
  try {
    absIn = assertSafeLocalPath(inHint, {
      base: packageRoot,
      allowRoots: [packageRoot, s137Root, SIBLING_07_ROOT],
    });
  } catch (err) {
    return {
      recipeId,
      status: RECIPE_STATUS.REJECTED,
      error: {
        code: err.code || ERROR_CODES.UNSAFE_PATH,
        message: err.message,
        details: err.details || null,
      },
      output: null,
    };
  }
  if (!existsSync(absIn)) {
    return {
      recipeId,
      status: RECIPE_STATUS.REJECTED,
      error: {
        code: ERROR_CODES.INVALID_INPUT,
        message: `Heavy --in fixture not found: ${absIn}`,
      },
      output: null,
    };
  }

  const artifact = recipe.artifact || recipeId;
  const args = [resolvedCli.cliPath, "analyze", artifact, "--in", absIn, "--clock", clock];
  if (options.outPath) {
    let absOut;
    try {
      const outAllow = [packageRoot, s137Root];
      if (options.heavyOutDir) outAllow.push(resolve(options.heavyOutDir));
      // Allow writing packet dumps under an explicit out path parent (compose demo-out).
      outAllow.push(dirname(resolve(packageRoot, options.outPath)));
      absOut = assertSafeLocalPath(options.outPath, {
        base: packageRoot,
        allowRoots: outAllow,
      });
    } catch (err) {
      return {
        recipeId,
        status: RECIPE_STATUS.REJECTED,
        error: {
          code: err.code || ERROR_CODES.UNSAFE_PATH,
          message: err.message,
          details: err.details || null,
        },
        output: null,
      };
    }
    mkdirSync(dirname(absOut), { recursive: true });
    args.push("--out", absOut);
  }

  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    cwd: resolvedCli.cwd,
    env: { ...process.env },
    maxBuffer: 8 * 1024 * 1024,
  });

  // Heavy CLI: usage/input refusals go to stderr with non-zero exit and often no JSON stdout.
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  let output = null;
  let parseError = null;
  if (stdout) {
    try {
      output = JSON.parse(stdout);
    } catch (e) {
      parseError = e.message;
    }
  }

  if (result.status !== 0 && !output) {
    const refused =
      /requires --clock|requires --in|URLs refused|must be a local path|unknown artifact|unknown subcommand/i.test(
        stderr,
      );
    return {
      recipeId,
      status: RECIPE_STATUS.REJECTED,
      dependencyMode: resolvedCli.mode,
      exitCode: result.status,
      stderr: stderr || null,
      parseError,
      error: {
        code: refused ? ERROR_CODES.HEAVY_REFUSED : ERROR_CODES.INVALID_INPUT,
        message: stderr.split("\n")[0] || `Heavy CLI exited ${result.status}`,
      },
      output: null,
      argv: args.slice(1),
      inPath: absIn,
      clock,
    };
  }

  const decision = output?.decision || null;
  const slotStatus = mapHeavyDecisionToSlotStatus(decision);
  // pass → ready slot; non-pass decisions stay as conflict/partial/failed — never invent pass
  return {
    recipeId,
    status: slotStatus,
    dependencyMode: resolvedCli.mode,
    exitCode: result.status,
    stderr: stderr || null,
    parseError,
    error: null,
    output,
    decision,
    packetSchema: output?.schema || null,
    argv: ["analyze", artifact, "--in", absIn, "--clock", clock],
    inPath: absIn,
    clock,
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
  const heavyInputs = isPlainObject(raw.heavyInputs) ? raw.heavyInputs : {};
  return {
    schema: raw.schema || INPUT_SCHEMA,
    requestId: typeof raw.requestId === "string" ? raw.requestId : "anonymous",
    recipeIds: [...recipeIds],
    procurementInputPath:
      typeof raw.procurementInputPath === "string" ? raw.procurementInputPath : null,
    operatorClock: typeof raw.clock === "string" ? raw.clock : null,
    heavyInputs,
    note: typeof raw.note === "string" ? raw.note : null,
  };
}

function resolveProcurementInput(request, options) {
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
    else if (request.procurementInputPath) {
      resolvedInput = resolve(options.packageRoot || PACKAGE_ROOT, request.procurementInputPath);
    }
  }
  return resolvedInput;
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

  const operatorClockIso =
    request.operatorClock ||
    options.operatorClock ||
    (typeof options.clockIso === "string" ? options.clockIso : null) ||
    DEFAULT_OPERATOR_CLOCK;

  const slots = [];
  let readyCount = 0;
  let pendingCount = 0;
  let unknownCount = 0;
  let rejectedRecipe = false;
  let nonPassHeavy = 0;

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
      const resolvedInput = resolveProcurementInput(request, options);
      const run = runProcurementBriefRecipe(resolvedInput, { ...options, catalog });
      if (run.status === RECIPE_STATUS.READY) readyCount += 1;
      else if (run.status === RECIPE_STATUS.REJECTED) rejectedRecipe = true;
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

    if (recipe.status === RECIPE_STATUS.READY && HEAVY_RECIPE_IDS.includes(id)) {
      const heavySpec = request.heavyInputs[id] || {};
      const inPath =
        (typeof heavySpec.in === "string" && heavySpec.in) ||
        (typeof heavySpec.inPath === "string" && heavySpec.inPath) ||
        (options.heavyFixtureOverride && options.heavyFixtureOverride[id]) ||
        recipe.cli?.defaultIn ||
        null;
      const clockIso =
        (typeof heavySpec.clock === "string" && heavySpec.clock) || operatorClockIso;
      const outPath =
        (typeof heavySpec.out === "string" && heavySpec.out) ||
        (options.heavyOutDir ? join(options.heavyOutDir, `${id}.packet.json`) : null);

      const run = runHeavyAnalyzeRecipe(id, {
        ...options,
        catalog,
        inPath,
        clockIso,
        outPath,
        heavyOutDir: options.heavyOutDir || null,
      });

      if (run.status === RECIPE_STATUS.READY) readyCount += 1;
      else if (run.status === RECIPE_STATUS.REJECTED) rejectedRecipe = true;
      else if (run.status === RECIPE_STATUS.UNAVAILABLE_PENDING_HEAVY) pendingCount += 1;
      else nonPassHeavy += 1;

      slots.push({
        recipeId: id,
        title: recipe.title || id,
        status: run.status,
        dependencyMode: run.dependencyMode || null,
        jobRef: recipe.jobRef || null,
        schema: recipe.schema || HEAVY_PACKET_SCHEMA,
        decision: run.decision || run.output?.decision || null,
        exitCode: run.exitCode ?? null,
        error: run.error || null,
        inPath: run.inPath || inPath,
        clock: run.clock || clockIso,
        output: run.output,
      });
      continue;
    }

    slots.push({
      recipeId: id,
      title: recipe.title || id,
      status: recipe.status,
      note: "Recipe marked ready but no thin runner is wired in assemble.mjs yet.",
      output: null,
    });
  }

  let status = PACKAGE_STATUS.READY;
  if (unknownCount > 0 && readyCount === 0 && pendingCount === 0 && nonPassHeavy === 0) {
    status = PACKAGE_STATUS.REJECTED;
  } else if (rejectedRecipe && readyCount === 0 && pendingCount === 0 && nonPassHeavy === 0) {
    status = PACKAGE_STATUS.REJECTED;
  } else if (pendingCount > 0 || unknownCount > 0 || rejectedRecipe || nonPassHeavy > 0) {
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
      nonPassHeavyCount: nonPassHeavy,
      note: "Factual recipe slot counts only. No investment recommendation. Heavy decisions recorded as returned.",
    },
    dryRunNote: DRY_RUN_NOTE,
    heavyPendingNote: HEAVY_PENDING_NOTE,
    mutationBoundary: MUTATION_BOUNDARY,
    hasInvestmentRecommendation: false,
  };
}

/**
 * Clean-install journey: run fixtures, write demo-out artifacts.
 * S152: positive path exercises all seven ready recipes when Heavy pack is present.
 */
export function runCleanInstallJourney(options = {}) {
  const outDir = options.demoOutDir || DEMO_OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const clockMs = options.clock || (() => Date.parse(DEFAULT_OPERATOR_CLOCK));
  const operatorClock = options.operatorClock || DEFAULT_OPERATOR_CLOCK;
  const fixturesDir = options.fixturesDir || FIXTURES_DIR;

  const positivePath = join(fixturesDir, "positive-journey.json");
  const partialPath = join(fixturesDir, "partial-conflict-heavy.json");
  const partialLegacyPath = join(fixturesDir, "partial-missing-heavy.json");
  const negativePath = join(fixturesDir, "negative-unknown-recipe.json");

  const heavyOutDir = join(outDir, "s152", "packets");
  mkdirSync(heavyOutDir, { recursive: true });

  const assembleOpts = {
    ...options,
    clock: clockMs,
    operatorClock,
    heavyOutDir,
  };

  const positive = assembleCustomerResultPackage(loadJsonFile(positivePath), assembleOpts);
  const partialFixture = existsSync(partialPath) ? partialPath : partialLegacyPath;
  const partial = assembleCustomerResultPackage(loadJsonFile(partialFixture), assembleOpts);
  const negative = assembleCustomerResultPackage(loadJsonFile(negativePath), assembleOpts);
  const manifest = buildRecipeManifest({ ...options, clock: clockMs });

  const journey = {
    schema: SCHEMA,
    journey: true,
    generatedAt: clockMs(),
    operatorClock,
    note: "Clean-install offline journey. Real Heavy CLI packets + 07 brief; no invented pass; URLs not fetched.",
    steps: [
      { name: "manifest", result: manifest },
      { name: "positive-journey", result: positive },
      { name: "partial-conflict-heavy", result: partial },
      { name: "negative-unknown-recipe", result: negative },
    ],
    hasInvestmentRecommendation: false,
  };

  writeFileSync(join(outDir, "journey.json"), JSON.stringify(journey, null, 2) + "\n");
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(outDir, "positive.json"), JSON.stringify(positive, null, 2) + "\n");
  writeFileSync(join(outDir, "partial.json"), JSON.stringify(partial, null, 2) + "\n");
  writeFileSync(join(outDir, "negative.json"), JSON.stringify(negative, null, 2) + "\n");
  mkdirSync(join(outDir, "s152"), { recursive: true });
  writeFileSync(join(outDir, "s152", "journey.json"), JSON.stringify(journey, null, 2) + "\n");
  writeFileSync(join(outDir, "s152", "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(outDir, "s152", "positive.json"), JSON.stringify(positive, null, 2) + "\n");

  return journey;
}

export {
  isPlainObject,
  hasForbiddenField,
  packageError,
  loadJsonFile,
  resolve07Cli,
  looksLikeUrl,
  mapHeavyDecisionToSlotStatus,
};
