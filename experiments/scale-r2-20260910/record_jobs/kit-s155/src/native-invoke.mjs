/**
 * Invoke native RECORD 05..07 via dynamic import (preferred) or CLI spawn.
 * Absolute worktree paths by default; never invent native report outputs.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_NATIVE_ROOTS,
  ERROR_CODES,
  JOB_STATUS,
  NATIVE_BUILD_EXPORT,
  NATIVE_CLI_CMD,
} from "./constants.mjs";

export function resolveNativeRoot(jobId, options = {}) {
  const overrides = options.nativeRoots || {};
  const candidates = [];
  if (Object.prototype.hasOwnProperty.call(overrides, jobId)) {
    if (typeof overrides[jobId] === "string") {
      candidates.push({ mode: "override", root: resolve(overrides[jobId]) });
    }
  } else if (DEFAULT_NATIVE_ROOTS[jobId]) {
    candidates.push({ mode: "absolute_worktree", root: DEFAULT_NATIVE_ROOTS[jobId] });
  }

  const searched = [];
  for (const c of candidates) {
    const indexPath = join(c.root, "src", "index.mjs");
    const cliPath = join(c.root, "src", "cli.mjs");
    searched.push(indexPath);
    if (existsSync(indexPath)) {
      return {
        found: true,
        mode: c.mode,
        root: c.root,
        indexPath,
        cliPath: existsSync(cliPath) ? cliPath : null,
        searched,
      };
    }
  }
  return { found: false, mode: "missing", root: null, indexPath: null, cliPath: null, searched };
}

export function defaultNativeFixture(jobId, nativeRoot) {
  return join(nativeRoot, "fixtures", "positive.json");
}

export function partialNativeFixture(jobId, nativeRoot) {
  // Prefer documented partial fixtures when present
  const candidates = [
    join(nativeRoot, "fixtures", "partial-incomplete.json"),
    join(nativeRoot, "fixtures", "partial.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export async function runNativeJob(jobId, inputPath, options = {}) {
  const sibling = resolveNativeRoot(jobId, options);
  if (!sibling.found) {
    return {
      jobId,
      status: JOB_STATUS.UNAVAILABLE_NATIVE,
      error: {
        code: ERROR_CODES.MISSING_NATIVE,
        message: `Native package missing for ${jobId}`,
        searched: sibling.searched,
      },
      output: null,
      dependencyMode: "missing",
    };
  }

  let fixturePath = inputPath ? resolve(inputPath) : defaultNativeFixture(jobId, sibling.root);
  if (!existsSync(fixturePath)) {
    return {
      jobId,
      status: JOB_STATUS.PARTIAL_INPUT,
      dependencyMode: sibling.mode,
      siblingRoot: sibling.root,
      error: {
        code: ERROR_CODES.MISSING_FIXTURE,
        message: `Native fixture not found: ${fixturePath}`,
      },
      output: null,
    };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(fixturePath, "utf8"));
  } catch (e) {
    return {
      jobId,
      status: JOB_STATUS.REJECTED,
      dependencyMode: sibling.mode,
      siblingRoot: sibling.root,
      fixturePath,
      error: {
        code: ERROR_CODES.INVALID_INPUT,
        message: `Failed to parse native fixture: ${e.message}`,
      },
      output: null,
    };
  }

  let mod;
  try {
    mod = await import(pathToFileURL(sibling.indexPath).href);
  } catch (e) {
    return {
      jobId,
      status: JOB_STATUS.UNAVAILABLE_NATIVE,
      dependencyMode: sibling.mode,
      siblingRoot: sibling.root,
      fixturePath,
      error: {
        code: ERROR_CODES.MISSING_NATIVE,
        message: `Failed to import native index: ${e.message}`,
      },
      output: null,
    };
  }

  const exportName = NATIVE_BUILD_EXPORT[jobId];
  const buildFn = exportName && typeof mod[exportName] === "function" ? mod[exportName] : null;
  if (!buildFn) {
    return {
      jobId,
      status: JOB_STATUS.UNAVAILABLE_NATIVE,
      dependencyMode: sibling.mode,
      siblingRoot: sibling.root,
      fixturePath,
      error: {
        code: ERROR_CODES.MISSING_NATIVE,
        message: `Native missing build export ${exportName}`,
      },
      output: null,
    };
  }

  const clock = options.clock || (() => Date.parse("2026-09-10T20:00:00.000Z"));
  let output;
  try {
    output = buildFn(raw, { clock });
  } catch (e) {
    return {
      jobId,
      status: JOB_STATUS.REJECTED,
      dependencyMode: sibling.mode,
      siblingRoot: sibling.root,
      fixturePath,
      error: {
        code: e.code || ERROR_CODES.NATIVE_INVOKE_FAILED,
        message: e.message,
        details: e.details || null,
      },
      output: null,
    };
  }

  const nested = output?.status;
  let status = JOB_STATUS.READY;
  if (nested === "rejected") status = JOB_STATUS.REJECTED;
  else if (nested === "partial_input") status = JOB_STATUS.PARTIAL_INPUT;

  return {
    jobId,
    status,
    dependencyMode: sibling.mode,
    siblingRoot: sibling.root,
    fixturePath,
    buildExport: exportName,
    output,
  };
}

export function spawnNativeCli(jobId, fixturePath, options = {}) {
  const sibling = resolveNativeRoot(jobId, options);
  if (!sibling.found || !sibling.cliPath) {
    return {
      jobId,
      status: JOB_STATUS.UNAVAILABLE_NATIVE,
      error: { code: ERROR_CODES.MISSING_NATIVE, message: `Native CLI missing for ${jobId}` },
      output: null,
    };
  }
  const cmd = NATIVE_CLI_CMD[jobId] || "report";
  const result = spawnSync(process.execPath, [sibling.cliPath, cmd, fixturePath], {
    encoding: "utf8",
    cwd: sibling.root,
  });
  let output = null;
  try {
    output = JSON.parse(result.stdout || "");
  } catch {
    /* leave null */
  }
  return {
    jobId,
    status: result.status === 0 && output ? JOB_STATUS.READY : JOB_STATUS.REJECTED,
    exitCode: result.status,
    dependencyMode: sibling.mode,
    siblingRoot: sibling.root,
    output,
  };
}
