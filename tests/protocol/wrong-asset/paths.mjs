import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GUARD_ROOT = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(GUARD_ROOT, "fixtures");
export const CHECK = join(GUARD_ROOT, "check.mjs");
export const REPO_ROOT = join(GUARD_ROOT, "..", "..", "..");
export const FIXTURE_SCHEMA = "samedaydesk.x402-protocol-fixtures.wrong-asset.v1";
export const HOST = "agents.samedaydesk.com";
export const NETWORK = "eip155:8453";
export const ROUTE = "/work/opportunity-preflight?rewardUsd=10&hours=1&hourlyCostUsd=1";

/** Canonical Base mainnet USDC advertised by this merchant. */
export const CANONICAL_BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const CANONICAL_ASSET_NAME = "USD Coin";
export const CANONICAL_ASSET_VERSION = "2";

/** Well-known non-USDC Base assets used as seeded wrong-asset payloads. */
export const BASE_WETH = "0x4200000000000000000000000000000000000006";
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const NATIVE_ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const SEEDED_WRONG_ASSET = join(FIXTURES_DIR, "reject", "seeded-wrong-asset-settled.json");

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
