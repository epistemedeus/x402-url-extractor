import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(GATE_DIR, "..", "..", "..", "..");
export const S137_ROOT = join(REPO_ROOT, "experiments", "s137-consumer-evidence-jobs");
export const CLI = join(S137_ROOT, "scripts", "cli.mjs");
export const PIN_PATH = join(GATE_DIR, "PIN.json");

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function repoFile(rel) {
  return join(REPO_ROOT, rel);
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function runCli(args, { timeout = 20000, cwd = REPO_ROOT, env } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd,
    env: env ? { ...process.env, ...env } : { ...process.env },
  });
}

export function parseStdoutJson(proc) {
  if (proc.error) throw proc.error;
  const text = proc.stdout || "";
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `CLI stdout was not JSON (${error.message}); status=${proc.status} stdout=${text} stderr=${proc.stderr}`,
    );
  }
}
