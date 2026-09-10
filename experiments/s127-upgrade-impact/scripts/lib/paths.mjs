import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = resolve(LIB_DIR, "..");
export const PACK_ROOT = resolve(SCRIPTS_DIR, "..");
export const DEFAULT_SRC_ROOT = resolve(PACK_ROOT, "src");
export const PACK_REL = "experiments/s127-upgrade-impact";
export const SRC_ROOT_ENV = "S127_UPGRADE_IMPACT_SRC";

export function resolveSrcRoot(explicit) {
  if (explicit) return resolve(explicit);
  if (process.env[SRC_ROOT_ENV]) return resolve(process.env[SRC_ROOT_ENV]);
  return DEFAULT_SRC_ROOT;
}
