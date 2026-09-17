import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GUARD_ROOT = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(GUARD_ROOT, "fixtures");
export const CHECK = join(GUARD_ROOT, "check.mjs");
export const REPO_ROOT = join(GUARD_ROOT, "..", "..", "..");
export const FIXTURE_SCHEMA = "samedaydesk.x402-protocol-fixtures.double-settle-guard.v1";
export const HOST = "agents.samedaydesk.com";
export const NETWORK = "eip155:8453";
export const ROUTE = "/work/opportunity-preflight?rewardUsd=10&hours=1&hourlyCostUsd=1";
export const SEEDED_DOUBLE_SETTLE = join(FIXTURES_DIR, "reject", "seeded-double-settle.json");

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
