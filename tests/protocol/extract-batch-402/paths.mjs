import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SUITE_ROOT = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(SUITE_ROOT, "fixtures");
export const CHECK = join(SUITE_ROOT, "check.mjs");
export const REPO_ROOT = join(SUITE_ROOT, "..", "..", "..");
export const SEEDED_REWRITE = join(FIXTURES_DIR, "reject", "seeded-get-extract-rewrite.json");

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
