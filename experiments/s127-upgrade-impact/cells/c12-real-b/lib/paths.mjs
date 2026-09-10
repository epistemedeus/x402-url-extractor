import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const CELL_ROOT = join(here, "..");
export const PACK_ROOT = join(CELL_ROOT, "..", "..");
export const FIXTURES = join(PACK_ROOT, "fixtures", "real-b");
export const EVIDENCE = join(PACK_ROOT, "evidence", "real-b");
