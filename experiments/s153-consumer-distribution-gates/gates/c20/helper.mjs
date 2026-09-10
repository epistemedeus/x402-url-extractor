import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256File } from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/table-reconcile/hash.mjs";
import { INPUT_EXIT, USAGE_EXIT } from "../../../s137-consumer-evidence-jobs/scripts/cli.mjs";

export const GATE_ROOT = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(GATE_ROOT, "../../../..");
export const PIN_PATH = join(GATE_ROOT, "PIN.json");
export const CLI = join(
  REPO_ROOT,
  "experiments/s137-consumer-evidence-jobs/scripts/cli.mjs",
);
export const CLOCK = "2026-09-10T12:00:00.000Z";

export { sha256File, INPUT_EXIT, USAGE_EXIT };

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function repoFile(relPath) {
  return join(REPO_ROOT, relPath);
}

export function runCli(args, { timeout = 15000, cwd = REPO_ROOT } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd,
    env: { ...process.env },
  });
}

export function parseCliJson(proc) {
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

export function analyzeTableReconcile(inPath, extra = []) {
  return runCli([
    "analyze",
    "table-reconcile",
    "--clock",
    CLOCK,
    "--in",
    inPath,
    "--compact",
    ...extra,
  ]);
}
