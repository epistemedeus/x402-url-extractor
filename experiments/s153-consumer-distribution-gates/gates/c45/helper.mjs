import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CELL_ROOT = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(CELL_ROOT, "../../../..");
export const PIN = JSON.parse(readFileSync(join(CELL_ROOT, "PIN.json"), "utf8"));
export const CLI = join(REPO_ROOT, PIN.cli);

export function abs(rel) {
  return join(REPO_ROOT, rel);
}

export function sha256File(rel) {
  return createHash("sha256").update(readFileSync(abs(rel))).digest("hex");
}

export function readJson(rel) {
  return JSON.parse(readFileSync(abs(rel), "utf8"));
}

export function runCli(args, { timeout = 20000 } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd: REPO_ROOT,
    env: { ...process.env },
  });
}

export function parseStdoutJson(proc) {
  if (proc.error) throw proc.error;
  try {
    return JSON.parse(proc.stdout);
  } catch (error) {
    throw new Error(
      `stdout was not JSON: ${error.message}\nstatus=${proc.status}\nstdout=${proc.stdout}\nstderr=${proc.stderr}`,
    );
  }
}

export function assertOfflineEnvelope(assert, doc) {
  assert.equal(doc.offline, true);
  assert.equal(doc.execute, false);
  assert.equal(doc.posted, false);
  assert.equal(doc.payment?.attempted, false);
  assert.equal(doc.cost?.assignmentSpendUsd, 0);
  assert.equal(doc.claims?.inventsFacts, false);
  assert.equal(doc.claims?.paidEndpoint, false);
  assert.equal(doc.claims?.assertsCustomerDemand, false);
}
