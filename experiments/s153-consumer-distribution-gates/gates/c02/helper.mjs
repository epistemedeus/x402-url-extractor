import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(GATE_DIR, "../../../..");
export const PACK_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const SYNTHETIC_ROOT = join(PACK_ROOT, "fixtures/synthetic/migration");
export const CLI = join(PACK_ROOT, "scripts/cli.mjs");

export function loadPin() {
  return JSON.parse(readFileSync(join(GATE_DIR, "PIN.json"), "utf8"));
}

export function absFromRepo(rel) {
  return join(REPO_ROOT, rel);
}

export function loadJson(absPath) {
  return JSON.parse(readFileSync(absPath, "utf8"));
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function runCli(args, { timeout = 15000 } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd: REPO_ROOT,
    env: { ...process.env },
  });
}

export function parseStdoutJson(proc) {
  if (proc.error) throw proc.error;
  const text = proc.stdout || "";
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `CLI stdout was not JSON: ${error.message}\nstatus=${proc.status}\nstdout=${text}\nstderr=${proc.stderr}`,
    );
  }
}

export function findingById(packet, id) {
  return (packet.findings || []).find((row) => row.id === id) || null;
}
