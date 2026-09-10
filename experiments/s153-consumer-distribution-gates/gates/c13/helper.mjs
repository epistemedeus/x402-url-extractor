/**
 * c13 helpers: spawn S137 CLI, materialize case.input, parse stdout JSON.
 * Offline only. Does not fetch, pay, or publish.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { INPUT_EXIT, PACKET_SCHEMA, USAGE_EXIT } from "../../../s137-consumer-evidence-jobs/scripts/cli.mjs";

export { INPUT_EXIT, PACKET_SCHEMA, USAGE_EXIT };

const HERE = dirname(fileURLToPath(import.meta.url));
export const CELL_ROOT = HERE;
export const REPO_ROOT = join(HERE, "../../../..");
export const PACK_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const CLI = join(PACK_ROOT, "scripts/cli.mjs");
export const PIN_PATH = join(CELL_ROOT, "PIN.json");
export const FIXTURE_ROOT = join(PACK_ROOT, "fixtures/synthetic/release-brief");
export const CLOCK = "2026-09-10T12:00:00.000Z";

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

export function absFromRepo(rel) {
  return join(REPO_ROOT, rel);
}

export function loadCaseSpec(caseId) {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, "cases", `${caseId}.json`), "utf8"));
}

/** Write nested case.input (INPUT_SCHEMA) to a temp file; caller must dispose. */
export function materializeCaseInput(caseId) {
  const spec = loadCaseSpec(caseId);
  if (!spec.input || typeof spec.input !== "object") {
    throw new Error(`case ${caseId} has no .input object`);
  }
  const dir = mkdtempSync(join(tmpdir(), "s153-c13-"));
  const path = join(dir, "input.json");
  writeFileSync(path, `${JSON.stringify(spec.input, null, 2)}\n`);
  return {
    dir,
    path,
    spec,
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function runCli(args, { timeout = 20000, cwd = REPO_ROOT, env = {} } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd,
    env: { ...process.env, ...env },
  });
}

export function parseCliJson(proc) {
  if (proc.error) throw proc.error;
  const text = proc.stdout || "";
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `stdout was not JSON: ${error instanceof Error ? error.message : String(error)}\nstdout=${text}\nstderr=${proc.stderr}`,
    );
  }
}

export function packetBrief(packet) {
  const artifact = packet?.artifact;
  if (artifact && typeof artifact === "object" && artifact.brief && typeof artifact.brief === "object") {
    return artifact.brief;
  }
  return null;
}

export function analyzeReleaseBrief(inPath, extraArgs = []) {
  return runCli([
    "analyze",
    "release-brief",
    "--clock",
    CLOCK,
    "--in",
    inPath,
    "--compact",
    ...extraArgs,
  ]);
}
