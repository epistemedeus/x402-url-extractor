/**
 * c21 S5 helper: spawn S137 CLI and materialize table-reconcile schema input.
 * Does not fetch, pay, or rewrite S137 modules.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  INPUT_EXIT,
  PACKET_SCHEMA,
  USAGE_EXIT,
} from "../../../s137-consumer-evidence-jobs/scripts/cli.mjs";
import {
  CLOCK,
  loadCase,
  toSchemaInput,
} from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/table-reconcile/load-case.mjs";

export const GATE_ROOT = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(GATE_ROOT, "../../../..");
export const CLI = join(
  REPO_ROOT,
  "experiments/s137-consumer-evidence-jobs/scripts/cli.mjs",
);
export const PIN = JSON.parse(readFileSync(join(GATE_ROOT, "PIN.json"), "utf8"));
export { CLOCK, INPUT_EXIT, PACKET_SCHEMA, USAGE_EXIT, loadCase, toSchemaInput };

export const FAMILY_SCHEMA = "s137.consumer-evidence.family.v1";
export const SYNTHETIC_ROOT = join(
  REPO_ROOT,
  "experiments/s137-consumer-evidence-jobs/fixtures/synthetic",
);

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function repoPath(rel) {
  return join(REPO_ROOT, rel);
}

export function schemaInputFor(caseId) {
  const loaded = loadCase(caseId);
  return { loaded, input: toSchemaInput(loaded.spec, loaded.tables) };
}

export function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "s153-c21-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function writeJson(dir, name, value) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return path;
}

export function runCli(args, { timeout = 20000, env = {} } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
  });
}

export function analyzeTable(inPath, extra = []) {
  return runCli([
    "analyze",
    "table-reconcile",
    "--in",
    inPath,
    "--clock",
    CLOCK,
    "--compact",
    ...extra,
  ]);
}

export function parseStdoutJson(proc) {
  if (proc.error) throw proc.error;
  const text = (proc.stdout || "").trim();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `stdout was not JSON: ${error.message}\nstatus=${proc.status}\nstdout=${proc.stdout}\nstderr=${proc.stderr}`,
    );
  }
}
