import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const CELL_ROOT = join(here, "..");
export const PACK_ROOT = join(CELL_ROOT, "..", "..");
export const FIXTURES = join(PACK_ROOT, "fixtures", "real-c");
export const OWNED_WRITE_PATHS = Object.freeze([
  join(PACK_ROOT, "cells", "c23-real-c-ms"),
  join(PACK_ROOT, "fixtures", "real-c"),
]);
