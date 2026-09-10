import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(GATE_DIR, "..", "..", "..", "..");

export function loadPin() {
  return JSON.parse(readFileSync(join(GATE_DIR, "PIN.json"), "utf8"));
}

export function absFromRepo(rel) {
  return join(REPO_ROOT, rel);
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function readJsonRel(rel) {
  return JSON.parse(readFileSync(absFromRepo(rel), "utf8"));
}

export function verifyPrimaryFixtures(pin) {
  const mismatches = [];
  for (const row of pin.primaryFixtures || []) {
    const actual = sha256File(absFromRepo(row.path));
    if (actual !== row.sha256) {
      mismatches.push({ path: row.path, expected: row.sha256, actual });
    }
  }
  return mismatches;
}
