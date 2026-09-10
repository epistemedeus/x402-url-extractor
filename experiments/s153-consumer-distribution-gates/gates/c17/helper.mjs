import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCase,
  toSchemaInput,
} from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/table-reconcile/load-case.mjs";

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

export function citationHash(citation) {
  return citation?.contentSha256 || citation?.sha256 || null;
}

export function loadPinnedCase(caseId) {
  return loadCase(caseId);
}

export function writeTempSchemaInput(loaded) {
  const dir = mkdtempSync(join(tmpdir(), "s153-c17-"));
  const path = join(dir, "input.json");
  const input = toSchemaInput(loaded.spec, loaded.tables);
  writeFileSync(path, `${JSON.stringify(input)}\n`);
  return { dir, path, input };
}
