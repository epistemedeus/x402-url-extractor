import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_ROOT = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(GATE_ROOT, "../../../..");
export const PIN_PATH = join(GATE_ROOT, "PIN.json");
export const CLI = join(
  REPO_ROOT,
  "experiments/s137-consumer-evidence-jobs/scripts/cli.mjs",
);

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function repoFile(relPath) {
  return join(REPO_ROOT, relPath);
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function runCli(args, { timeout = 20000, cwd = REPO_ROOT } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd,
    env: { ...process.env },
  });
}

export function parseCliJson(proc) {
  if (proc.error) throw proc.error;
  try {
    return JSON.parse(proc.stdout || "");
  } catch (error) {
    throw new Error(
      `CLI stdout was not JSON: ${error.message}\nstdout=${proc.stdout}\nstderr=${proc.stderr}`,
    );
  }
}
