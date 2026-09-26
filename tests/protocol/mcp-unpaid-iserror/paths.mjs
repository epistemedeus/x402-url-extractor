import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SCHEMA_FIXTURE } from "./constants.mjs";

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(ROOT, "fixtures");
export const CHECK = join(ROOT, "check.mjs");
export const REPO_ROOT = join(ROOT, "..", "..", "..");
export const FIXTURE_SCHEMA = SCHEMA_FIXTURE;
export const SEEDED_HTTP_200_AS_CHARGED = join(
  FIXTURES_DIR,
  "reject",
  "seeded-http-200-as-charged.json",
);

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadFixture(name) {
  return loadJson(join(FIXTURES_DIR, name));
}

export function loadManifest() {
  return loadFixture("manifest.json");
}

function listJsonFiles(dir, prefix) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(prefix, name))
    .sort();
}

export function listPassFixtureFiles() {
  return listJsonFiles(join(FIXTURES_DIR, "pass"), "pass");
}

export function listRejectFixtureFiles() {
  return listJsonFiles(join(FIXTURES_DIR, "reject"), "reject");
}

export function loadFixtures(kind) {
  const files = kind === "pass" ? listPassFixtureFiles() : listRejectFixtureFiles();
  return files.map((relativePath) => {
    const fixture = loadFixture(relativePath);
    return {
      id: fixture.id,
      relativePath,
      expect: fixture.expect,
      rejectCode: fixture.rejectCode ?? null,
      fixture,
    };
  });
}
