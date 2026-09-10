/**
 * Tiny c42 helpers: PIN load, fixture hashes, offline CLI spawn.
 * Does not implement freshness-receipt.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(GATE_DIR, "../../../..");
export const PIN_PATH = join(GATE_DIR, "PIN.json");

export function loadJson(absPath) {
  return JSON.parse(readFileSync(absPath, "utf8"));
}

export function loadPin() {
  return loadJson(PIN_PATH);
}

export function absFromRepo(rel) {
  return join(REPO_ROOT, rel);
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function runCli(args, { timeout = 20000 } = {}) {
  const pin = loadPin();
  return spawnSync(process.execPath, [absFromRepo(pin.cli), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout,
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

export function datasetById(packet, id) {
  return (packet.datasets || []).find((row) => row.id === id) || null;
}
