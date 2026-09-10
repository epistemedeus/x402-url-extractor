import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sha256Canonical,
  sha256Hex,
} from "../../../s137-consumer-evidence-jobs/src/common/hash.mjs";

export const CELL_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(CELL_DIR, "../../../..");
export const PIN_PATH = join(CELL_DIR, "PIN.json");

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function abs(rel) {
  return join(REPO_ROOT, rel);
}

export function sha256File(rel) {
  return sha256Hex(readFileSync(abs(rel)));
}

export function loadJson(rel) {
  return JSON.parse(readFileSync(abs(rel), "utf8"));
}

export function jsonRoundtrip(value) {
  return JSON.parse(JSON.stringify(value));
}

export { sha256Canonical, sha256Hex };
