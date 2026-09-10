import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../../../..");
export const PIN_PATH = join(HERE, "PIN.json");
export const CLI_PATH = join(
  REPO_ROOT,
  "experiments/s137-consumer-evidence-jobs/scripts/cli.mjs",
);

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function absFromRepo(rel) {
  return join(REPO_ROOT, rel);
}

export function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

export function readJson(abs) {
  return JSON.parse(readFileSync(abs, "utf8"));
}

export function runCli(args, { timeout = 20000, cwd = REPO_ROOT, env = {} } = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    timeout,
    cwd,
    env: { ...process.env, ...env },
  });
}

export function parseStdoutJson(proc) {
  const text = (proc.stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "s153-c12-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function writeTemp(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}
