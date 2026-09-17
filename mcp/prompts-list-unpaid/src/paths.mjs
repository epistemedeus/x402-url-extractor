import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PACK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURES_DIR = join(PACK_ROOT, "fixtures");
export const CONFORMANCE_BIN = join(PACK_ROOT, "bin/prompts-list-unpaid.mjs");
export const REPO_ROOT = join(PACK_ROOT, "../..");

export function loadFixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
}
