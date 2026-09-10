import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const PACK_ROOT = join(here, "..", "..");
export const RECIPES_DIR = join(PACK_ROOT, "recipes");
export const FIXTURES_DIR = join(PACK_ROOT, "fixtures");
export const EVIDENCE_DIR = join(PACK_ROOT, "evidence", "snapshots");
