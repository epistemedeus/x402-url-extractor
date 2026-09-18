import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const ROOT = HERE;
export const REPO_ROOT = resolve(HERE, "../../..");
export const FIXTURES = join(HERE, "fixtures");
export const MANIFEST = join(FIXTURES, "manifest.json");
export const CANONICAL = join(FIXTURES, "pass", "canonical-matrix.json");
export const SEEDED_EXTRACT_ONTO_SCAN = join(FIXTURES, "reject", "seeded-extract-onto-scan.json");
export const SEEDED_INVENTED_FIELD = join(FIXTURES, "reject", "seeded-invented-field.json");
export const TREAT_ABSENCE_AS_DEMAND = join(FIXTURES, "reject", "treat-absence-as-demand.json");
export const SEEDED_UNIT_CONVERSION = join(FIXTURES, "reject", "seeded-unit-conversion.json");

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function resolveFixture(input) {
  if (!input) return null;
  const aliases = {
    canonical: CANONICAL,
    "canonical-matrix": CANONICAL,
    "seeded-failure": SEEDED_EXTRACT_ONTO_SCAN,
    "seeded-extract-onto-scan": SEEDED_EXTRACT_ONTO_SCAN,
    "seeded-invented-field": SEEDED_INVENTED_FIELD,
    "treat-absence-as-demand": TREAT_ABSENCE_AS_DEMAND,
    "seeded-unit-conversion": SEEDED_UNIT_CONVERSION,
  };
  if (aliases[input]) return aliases[input];
  const fromCwd = resolve(input);
  if (existsSync(fromCwd)) return fromCwd;
  const fromRoot = resolve(REPO_ROOT, input);
  if (existsSync(fromRoot)) return fromRoot;
  const fromHere = resolve(HERE, input);
  if (existsSync(fromHere)) return fromHere;
  return fromCwd;
}

export function listFixtureFiles() {
  const out = [];
  for (const dir of ["pass", "reject"]) {
    const folder = join(FIXTURES, dir);
    for (const name of readdirSync(folder).sort()) {
      if (!name.endsWith(".json")) continue;
      out.push({
        expect: dir === "pass" ? "pass" : "reject",
        path: join(folder, name),
        relative: `fixtures/${dir}/${name}`,
      });
    }
  }
  return out;
}
