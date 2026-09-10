/**
 * Tiny c03 helpers: PIN load, fixture hashes, offline CLI spawn.
 * No network. Does not implement migration-checklist.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(GATE_DIR, "../../../..");
export const PIN_PATH = join(GATE_DIR, "PIN.json");
export const CLI_REL = "experiments/s137-consumer-evidence-jobs/scripts/cli.mjs";

export function loadJson(absPath) {
  return JSON.parse(readFileSync(absPath, "utf8"));
}

export function loadPin() {
  return loadJson(PIN_PATH);
}

export function repoFile(relPath) {
  return join(REPO_ROOT, relPath);
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function runCli(args, { timeout = 20000 } = {}) {
  return spawnSync(process.execPath, [repoFile(CLI_REL), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout,
    env: { ...process.env },
  });
}

export function parseStdoutJson(proc) {
  const text = String(proc.stdout || "").trim();
  return JSON.parse(text);
}
