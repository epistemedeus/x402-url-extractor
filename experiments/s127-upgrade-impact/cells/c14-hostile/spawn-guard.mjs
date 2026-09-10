/**
 * In-process guard: record and optionally block child_process launches.
 * Restores originals in `finally`. Tests that patch process-global state
 * should run with concurrency 1.
 */

import childProcess from "node:child_process";
import { isPackageManagerInvocation } from "./script-policy.mjs";

const METHODS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"];

export function withSpawnGuard(fn, { block = true } = {}) {
  const invocations = [];
  const originals = {};
  for (const method of METHODS) {
    originals[method] = childProcess[method];
    childProcess[method] = (...args) => {
      const command = args[0];
      const rest = args[1];
      const argv = Array.isArray(rest) ? rest : [];
      invocations.push({
        method,
        command: String(command),
        args: argv.map(String).slice(0, 8),
        packageManager: isPackageManagerInvocation(command, argv),
      });
      if (block) {
        const err = new Error(`c14 spawn blocked: ${method} ${command}`);
        err.code = "c14_spawn_blocked";
        throw err;
      }
      return originals[method](...args);
    };
  }
  try {
    const value = fn();
    return { value, invocations };
  } finally {
    for (const method of METHODS) {
      childProcess[method] = originals[method];
    }
  }
}

export async function withSpawnGuardAsync(fn, { block = true } = {}) {
  const invocations = [];
  const originals = {};
  for (const method of METHODS) {
    originals[method] = childProcess[method];
    childProcess[method] = (...args) => {
      const command = args[0];
      const rest = args[1];
      const argv = Array.isArray(rest) ? rest : [];
      invocations.push({
        method,
        command: String(command),
        args: argv.map(String).slice(0, 8),
        packageManager: isPackageManagerInvocation(command, argv),
      });
      if (block) {
        const err = new Error(`c14 spawn blocked: ${method} ${command}`);
        err.code = "c14_spawn_blocked";
        throw err;
      }
      return originals[method](...args);
    };
  }
  try {
    const value = await fn();
    return { value, invocations };
  } finally {
    for (const method of METHODS) {
      childProcess[method] = originals[method];
    }
  }
}
