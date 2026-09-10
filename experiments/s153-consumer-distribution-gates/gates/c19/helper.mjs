/**
 * c19 helpers: pin load, fixture hashes, CLI analyze, kit listing.
 * Offline. Does not fetch, pay, publish, or invent merges.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { loadCase } from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/table-reconcile/load-case.mjs";

export const GATE_ROOT = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(GATE_ROOT, "../../../..");
export const PACK_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const CLI = join(PACK_ROOT, "scripts/cli.mjs");
export const KIT_ROOT = join(REPO_ROOT, "experiments/s153-consumer-distribution-gates/kit");
export const CLOCK = "2026-09-10T12:00:00.000Z";
export const PIN_PATH = join(GATE_ROOT, "PIN.json");

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function repoFile(relPath) {
  return join(REPO_ROOT, relPath);
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function loadConflictCase(id) {
  return loadCase(id);
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
      `CLI stdout was not JSON: ${error.message}\nstatus=${proc.status}\nstdout=${text}\nstderr=${proc.stderr}`,
    );
  }
}

/**
 * Materialize `{ spec, tables }` from load-case so CLI --in carries table bodies.
 * Bare case JSON only has path refs; the transform does not fetch.
 */
export function withMaterializedCase(id, fn) {
  const dir = mkdtempSync(join(tmpdir(), "s153-c19-"));
  const inPath = join(dir, `${id}.json`);
  writeFileSync(inPath, `${JSON.stringify(loadCase(id))}\n`);
  try {
    return fn(inPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function analyzeTableReconcile(inPath) {
  const proc = runCli([
    "analyze",
    "table-reconcile",
    "--clock",
    CLOCK,
    "--in",
    inPath,
    "--compact",
  ]);
  return { proc, packet: parseCliJson(proc) };
}

export function listKitEntries() {
  let st;
  try {
    st = statSync(KIT_ROOT);
  } catch {
    return { exists: false, isDirectory: false, names: [] };
  }
  if (!st.isDirectory()) return { exists: true, isDirectory: false, names: [] };
  return { exists: true, isDirectory: true, names: readdirSync(KIT_ROOT) };
}

export function roundtrip(value) {
  return JSON.parse(JSON.stringify(value));
}
