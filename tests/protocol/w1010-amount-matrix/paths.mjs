import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
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

function fixtureError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function underFixtures(realPath) {
  const root = realpathSync(FIXTURES);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return realPath === root || realPath.startsWith(prefix);
}

export function resolveBoundedFixture(input) {
  if (!input || typeof input !== "string") {
    throw fixtureError("FIXTURE_ESCAPE", "fixture path required");
  }
  const fromCwd = resolve(input);
  const candidate = existsSync(fromCwd) ? fromCwd : resolve(ROOT, input);
  let real;
  try {
    real = realpathSync(candidate);
  } catch {
    throw fixtureError("FIXTURE_NOT_FOUND", `fixture not found: ${input}`);
  }
  if (!underFixtures(real) || !real.endsWith(".json")) {
    throw fixtureError("FIXTURE_ESCAPE", `fixture path is outside tests/protocol/w1010-amount-matrix/fixtures: ${input}`);
  }
  return real;
}

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadBoundedFixture(input) {
  const path = resolveBoundedFixture(input);
  try {
    return { path, document: loadJson(path) };
  } catch (error) {
    if (error?.code === "FIXTURE_ESCAPE" || error?.code === "FIXTURE_NOT_FOUND") throw error;
    throw fixtureError("MALFORMED_FIXTURE", error?.message || "malformed fixture JSON");
  }
}

export const PASS_FIXTURES = Object.freeze([CANONICAL]);
export const REJECT_FIXTURES = Object.freeze([
  SEEDED_EXTRACT_ONTO_SCAN,
  SEEDED_INVENTED_FIELD,
  SEEDED_ABSENCE_AS_DEMAND,
  SEEDED_UNIT_CONVERSION,
]);
