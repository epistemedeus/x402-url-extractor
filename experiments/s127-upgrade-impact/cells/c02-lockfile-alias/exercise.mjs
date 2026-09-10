#!/usr/bin/env node
/**
 * Exercise c02 lockfile identity resolution.
 *
 * Usage:
 *   node cells/c02-lockfile-alias/exercise.mjs <manifestPath> <name> [lockfilePath]
 */
import { resolveCallerDependency } from "../../src/lockfile.mjs";

const [manifestPath, name, lockfilePath] = process.argv.slice(2);
if (!manifestPath || !name) {
  process.stderr.write("usage: node exercise.mjs <manifestPath> <name> [lockfilePath]\n");
  process.exit(2);
}

const result = resolveCallerDependency({
  manifestPath,
  lockfilePath,
  name,
  clock: "2026-09-10T00:00:00.000Z",
  evidenceClass: "synthetic",
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.decisionHint === "unknown" && result.ok === false) process.exit(1);
