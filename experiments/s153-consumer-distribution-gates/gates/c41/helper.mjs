/**
 * c41 helpers: load PIN, hash fixtures, spawn S137 CLI. Offline only.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../../../..");
export const PIN_PATH = join(HERE, "PIN.json");
export const CLI_REL = "experiments/s137-consumer-evidence-jobs/scripts/cli.mjs";

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function repoPath(rel) {
  return join(REPO_ROOT, rel);
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function loadJson(rel) {
  const abs = repoPath(rel);
  return { abs, rel, sha256: sha256File(abs), value: JSON.parse(readFileSync(abs, "utf8")) };
}

export function loadPositiveCase(pin = loadPin()) {
  const row = pin.primaryFixtures[0];
  return loadJson(row.path);
}

export function runCli(args, { clock } = {}) {
  const pin = loadPin();
  const argv = [
    repoPath(CLI_REL),
    ...args,
  ];
  if (clock !== false && !args.includes("--clock")) {
    argv.push("--clock", clock || pin.clock);
  }
  return spawnSync(process.execPath, argv, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_NETWORK: "1" },
  });
}

export function parseCliJson(proc) {
  const text = String(proc.stdout || "").trim();
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`CLI stdout is not JSON (status=${proc.status}): ${text.slice(0, 240)}`);
  return JSON.parse(text.slice(start));
}
