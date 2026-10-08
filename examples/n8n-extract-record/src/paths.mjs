import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const exampleRoot = join(here, "..");
export const repoRoot = join(exampleRoot, "..", "..");
export const customerRoot = join(repoRoot, "examples", "customer-x402");
export const recordCli = join(customerRoot, "bin", "record.mjs");
