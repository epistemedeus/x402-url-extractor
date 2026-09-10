/**
 * c09 helpers: pin load, fixture hash check, S137 CLI spawn.
 * Offline. Does not fetch, pay, or invent clock/facts.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCase } from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/load.mjs";

export const CELL = dirname(fileURLToPath(import.meta.url));
export const REPO = join(CELL, "..", "..", "..", "..");
export const PIN_PATH = join(CELL, "PIN.json");

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

export function repoAbs(rel) {
  return join(REPO, rel);
}

export function verifyPinnedFiles(pin = loadPin()) {
  return (pin.primaryFixtures || []).map((row) => {
    const abs = repoAbs(row.path);
    const sha256 = sha256File(abs);
    return {
      id: row.id,
      path: row.path,
      expected: row.sha256,
      actual: sha256,
      ok: sha256 === row.sha256,
    };
  });
}

export function loadPinnedCase(pin = loadPin()) {
  const caseId = pin.caseIds[0];
  const spec = loadCase(caseId);
  return { caseId, spec, input: spec.input };
}

export function runCli(args, pin = loadPin()) {
  return spawnSync(process.execPath, [repoAbs(pin.cli), ...args], {
    encoding: "utf8",
    cwd: REPO,
    timeout: 20000,
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
      `CLI stdout was not JSON: ${error instanceof Error ? error.message : String(error)}\nstdout=${text}\nstderr=${proc.stderr}`,
    );
  }
}
