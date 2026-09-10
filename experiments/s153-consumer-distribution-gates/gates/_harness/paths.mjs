import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const S153_ROOT = join(HERE, "..", "..");
export const S137_ROOT = join(S153_ROOT, "..", "s137-consumer-evidence-jobs");
export const KIT_ROOT = join(S153_ROOT, "kit");
export const CLI = join(S137_ROOT, "scripts", "cli.mjs");
export const KIT_CLI = join(KIT_ROOT, "bin", "cli.mjs");
export const MATRIX = join(S153_ROOT, "docs", "CELL-MATRIX.json");
export const PIN = "fa6878de125cfdcfd77f4b47037c88667090d293";
export const CLOCK = "2026-09-10T12:00:00.000Z";
export const EXCLUDED_JOBS = Object.freeze(["R2-CONSUMER-JOBS-07", "R2-CONSUMER-JOBS-08"]);
