import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_ROOT = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(FIXTURE_ROOT, "..", "..", "..");
export const BIN = join(FIXTURE_ROOT, "run.mjs");
export const CATALOG_PATH = join(FIXTURE_ROOT, "catalog.json");
export const FIXTURES_DIR = join(FIXTURE_ROOT, "fixtures");
export const SEEDED_DIR = join(FIXTURES_DIR, "seeded");
