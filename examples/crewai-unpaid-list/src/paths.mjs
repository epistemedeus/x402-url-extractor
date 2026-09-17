import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
export const EXAMPLE_ROOT = join(SRC_DIR, "..");
export const CREWAI_CONFIG_PATH = join(EXAMPLE_ROOT, "fixtures", "crewai.mcp.json");
export const SEEDED_DIR = join(EXAMPLE_ROOT, "fixtures", "seeded");
export const DESIGNATED_SEED_PATH = join(SEEDED_DIR, "missing-extract.json");
export const TOOLS_CALL_SEED_PATH = join(SEEDED_DIR, "tools-call-attempt.json");
export const PAYMENT_HEADER_SEED_PATH = join(SEEDED_DIR, "payment-header.json");
export const OK_INVENTORY_PATH = join(EXAMPLE_ROOT, "fixtures", "ok-inventory.json");
