import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const ROOT = HERE;
export const REPO_ROOT = join(HERE, "../../..");
export const FIXTURES = join(HERE, "fixtures");
export const CHECK = join(HERE, "check.mjs");

export const CANONICAL = join(FIXTURES, "pass/canonical-matrix.json");
export const SEEDED_EXTRACT_ONTO_SCAN = join(FIXTURES, "reject/seeded-extract-onto-scan.json");
export const SEEDED_INVENTED_FIELD = join(FIXTURES, "reject/seeded-invented-field.json");
export const SEEDED_ABSENCE_AS_DEMAND = join(FIXTURES, "reject/seeded-absence-as-demand.json");
export const SEEDED_UNIT_CONVERSION = join(FIXTURES, "reject/seeded-unit-conversion.json");
export const MANIFEST = join(FIXTURES, "manifest.json");

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export const PASS_FIXTURES = Object.freeze([CANONICAL]);
export const REJECT_FIXTURES = Object.freeze([
  SEEDED_EXTRACT_ONTO_SCAN,
  SEEDED_INVENTED_FIELD,
  SEEDED_ABSENCE_AS_DEMAND,
  SEEDED_UNIT_CONVERSION,
]);
