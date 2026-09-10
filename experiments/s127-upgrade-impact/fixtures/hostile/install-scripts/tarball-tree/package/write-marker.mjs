/**
 * Side effect if executed: write SCRIPT_RAN.marker in this directory only.
 * No network, no deletes, no writes outside this folder.
 * Analyzer and tests must never import or spawn this file.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

globalThis.__C14_SCRIPT_RAN = true;
const dir = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(dir, "SCRIPT_RAN.marker"), `ran at ${new Date().toISOString()}\n`);
