/**
 * Invoke Heavy S134 modules via spawn/import from HEAVY_S134_ROOT.
 * Never invent OpenAPI/pricing/CSV/feed results when Heavy is missing.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_HEAVY_S134_ROOT,
  ERROR_CODES,
  HEAVY_CLI_REL,
  HEAVY_ENV_KEY,
  JOB_STATUS,
} from "./constants.mjs";

export function resolveHeavyRoot(options = {}) {
  const fromOpt = options.heavyRoot;
  const fromEnv = process.env[HEAVY_ENV_KEY];
  const root = resolve(fromOpt || fromEnv || DEFAULT_HEAVY_S134_ROOT);
  const packageJson = join(root, "package.json");
  const ok = existsSync(packageJson) && existsSync(join(root, "modules"));
  return { root, found: ok, packageJson, source: fromOpt ? "option" : fromEnv ? "env" : "default" };
}

export function resolveHeavyCli(jobId, options = {}) {
  const heavy = resolveHeavyRoot(options);
  const rel = HEAVY_CLI_REL[jobId];
  if (!rel) {
    return { ...heavy, cliPath: null, found: false, reason: "unknown_heavy_job" };
  }
  const cliPath = join(heavy.root, rel);
  if (!heavy.found || !existsSync(cliPath)) {
    return { ...heavy, cliPath, found: false, reason: "missing_cli" };
  }
  return { ...heavy, cliPath, found: true, reason: null };
}

/**
 * Default fixture paths under Heavy fixtures/ for positive examples.
 */
export function defaultHeavyFixtureArgs(jobId, heavyRoot) {
  const fx = join(heavyRoot, "fixtures");
  if (jobId === "openapi-impact") {
    return [
      "--before", join(fx, "openapi/positive/before.json"),
      "--after", join(fx, "openapi/positive/after.json"),
      "--used", join(fx, "openapi/positive/used.json"),
    ];
  }
  if (jobId === "pricing-table-change") {
    return [
      "--before", join(fx, "pricing/positive/before.json"),
      "--after", join(fx, "pricing/positive/after.json"),
    ];
  }
  if (jobId === "csv-drift") {
    return [
      "--before", join(fx, "csv/positive/before.csv"),
      "--after", join(fx, "csv/positive/after.csv"),
      "--key", "sku",
    ];
  }
  if (jobId === "rss-atom-brief") {
    return [
      "--before", join(fx, "rss/positive/before.xml"),
      "--after", join(fx, "rss/positive/after.xml"),
    ];
  }
  return null;
}

export function partialHeavyFixtureArgs(jobId, heavyRoot) {
  const fx = join(heavyRoot, "fixtures");
  if (jobId === "openapi-impact") {
    return [
      "--before", join(fx, "openapi/partial/before.json"),
      "--after", join(fx, "openapi/partial/after.json"),
      "--used", join(fx, "openapi/partial/used.json"),
    ];
  }
  if (jobId === "pricing-table-change") {
    return [
      "--before", join(fx, "pricing/partial/before.json"),
      "--after", join(fx, "pricing/partial/after.json"),
    ];
  }
  if (jobId === "csv-drift") {
    return [
      "--before", join(fx, "csv/partial/before.csv"),
      "--after", join(fx, "csv/partial/after.csv"),
      "--key", "sku",
    ];
  }
  if (jobId === "rss-atom-brief") {
    return [
      "--before", join(fx, "rss/partial/before.xml"),
      "--after", join(fx, "rss/partial/after.xml"),
    ];
  }
  return null;
}

/**
 * Spawn a Heavy CLI. Returns structured kit slot (never fakes report).
 */
export function spawnHeavyJob(jobId, argv, options = {}) {
  const resolved = resolveHeavyCli(jobId, options);
  if (!resolved.found) {
    return {
      jobId,
      status: JOB_STATUS.UNAVAILABLE_HEAVY,
      error: {
        code: ERROR_CODES.MISSING_HEAVY,
        message: `Heavy S134 root/CLI unavailable for ${jobId}`,
        heavyRoot: resolved.root,
        cliPath: resolved.cliPath,
        reason: resolved.reason,
      },
      output: null,
      dependencyMode: "missing_heavy",
    };
  }

  const args = argv || defaultHeavyFixtureArgs(jobId, resolved.root);
  if (!args) {
    return {
      jobId,
      status: JOB_STATUS.REJECTED,
      error: {
        code: ERROR_CODES.INVALID_INPUT,
        message: `No argv/fixture mapping for heavy job ${jobId}`,
      },
      output: null,
    };
  }

  // Verify fixture paths exist (partial when a sibling path missing)
  const pathArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && args[i + 1] && !args[i + 1].startsWith("--") && args[i] !== "--key") {
      pathArgs.push(args[i + 1]);
    }
  }
  const missing = pathArgs.filter((p) => !existsSync(p));
  if (missing.length) {
    return {
      jobId,
      status: JOB_STATUS.PARTIAL_INPUT,
      error: {
        code: ERROR_CODES.MISSING_FIXTURE,
        message: `Missing Heavy fixture path(s) for ${jobId}`,
        missing,
      },
      output: null,
      dependencyMode: "heavy_cli",
      heavyRoot: resolved.root,
      argv: args,
    };
  }

  const result = spawnSync(process.execPath, [resolved.cliPath, ...args], {
    encoding: "utf8",
    cwd: resolved.root,
    env: { ...process.env, [HEAVY_ENV_KEY]: resolved.root },
    maxBuffer: 8 * 1024 * 1024,
  });

  let output = null;
  let parseError = null;
  try {
    output = JSON.parse(result.stdout || "");
  } catch (e) {
    parseError = e.message;
  }

  if (result.status === 0 && output) {
    return {
      jobId,
      status: JOB_STATUS.READY,
      dependencyMode: "heavy_cli",
      heavyRoot: resolved.root,
      cliPath: resolved.cliPath,
      argv: args,
      exitCode: result.status,
      output,
    };
  }

  // Heavy may exit 2 on parse failure — treat as rejected with real stderr/stdout, not invented
  if (output) {
    return {
      jobId,
      status: JOB_STATUS.REJECTED,
      dependencyMode: "heavy_cli",
      heavyRoot: resolved.root,
      cliPath: resolved.cliPath,
      argv: args,
      exitCode: result.status,
      stderr: (result.stderr || "").trim() || null,
      output,
      error: {
        code: ERROR_CODES.HEAVY_INVOKE_FAILED,
        message: `Heavy CLI exited ${result.status} for ${jobId}`,
      },
    };
  }

  return {
    jobId,
    status: JOB_STATUS.REJECTED,
    dependencyMode: "heavy_cli",
    heavyRoot: resolved.root,
    cliPath: resolved.cliPath,
    argv: args,
    exitCode: result.status,
    stderr: (result.stderr || "").trim() || null,
    parseError,
    output: null,
    error: {
      code: ERROR_CODES.HEAVY_INVOKE_FAILED,
      message: `Heavy CLI failed for ${jobId}: ${parseError || result.stderr || "no output"}`,
    },
  };
}

/**
 * Dynamic import of a Heavy module CLI file (for wrapper-level option passthrough).
 */
export async function importHeavyModule(jobId, options = {}) {
  const resolved = resolveHeavyCli(jobId, options);
  if (!resolved.found) {
    return { ok: false, ...resolved, mod: null };
  }
  const mod = await import(pathToFileURL(resolved.cliPath).href);
  return { ok: true, ...resolved, mod };
}

export function readText(path) {
  return readFileSync(path, "utf8");
}
