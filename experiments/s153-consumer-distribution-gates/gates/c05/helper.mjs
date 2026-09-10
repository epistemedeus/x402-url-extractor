/**
 * Tiny S5 helpers: spawn S137 CLI, parse stdout JSON, hash pinned fixtures.
 * Offline only. Does not fetch, pay, or invent clock/facts.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CELL_ROOT = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(CELL_ROOT, "../../../..");
export const PACK_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const CLI = join(PACK_ROOT, "scripts/cli.mjs");
export const PIN_PATH = join(CELL_ROOT, "PIN.json");

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function absFromRepo(relPath) {
  return join(REPO_ROOT, relPath);
}

export function runCli(args, { timeout = 20000, cwd = REPO_ROOT, env = {} } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd,
    env: {
      ...process.env,
      HTTP_PROXY: "http://127.0.0.1:1",
      HTTPS_PROXY: "http://127.0.0.1:1",
      ALL_PROXY: "http://127.0.0.1:1",
      NO_PROXY: "",
      ...env,
    },
  });
}

export function parseCliJson(proc) {
  if (proc.error) throw proc.error;
  const text = proc.stdout || "";
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `stdout was not JSON: ${error.message}\nstatus=${proc.status}\nstdout=${text}\nstderr=${proc.stderr}`,
    );
  }
}

export function findingIds(packet) {
  return (packet?.findings || []).map((row) => row.id).filter(Boolean);
}
