import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = dirname(fileURLToPath(import.meta.url));

export const EXAMPLE_ROOT = join(SRC, "..");
export const MERCHANT_ROOT = join(EXAMPLE_ROOT, "..", "..");
export const FIXTURES = join(EXAMPLE_ROOT, "fixtures");
export const SEEDED_FAILURE_DIR = join(FIXTURES, "seeded-failure");
export const DIGEST_MISMATCH_PINS = join(SEEDED_FAILURE_DIR, "digest-mismatch.json");
export const DEFAULT_SKILLS_ROOT = join(
  MERCHANT_ROOT,
  "plugins",
  "samedaydesk-x402",
  "skills",
);

export function skillMdRelativePath(name) {
  return `plugins/samedaydesk-x402/skills/${name}/SKILL.md`;
}
