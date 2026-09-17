import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const NEGATIVE_ROOT = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(NEGATIVE_ROOT, "fixtures");
export const BIN = join(NEGATIVE_ROOT, "bin.mjs");
export const REPO_ROOT = join(NEGATIVE_ROOT, "..", "..", "..");
export const FIXTURE_SCHEMA = "samedaydesk.x402-protocol-fixtures.negative-tools-call.v1";

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadFixture(name) {
  return loadJson(join(FIXTURES_DIR, name));
}

export function loadManifest() {
  return loadFixture("manifest.json");
}

export function listRejectFixtureFiles() {
  const dir = join(FIXTURES_DIR, "reject");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join("reject", name))
    .sort();
}

export function loadRejectFixtures() {
  return listRejectFixtureFiles().map((relativePath) => {
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
