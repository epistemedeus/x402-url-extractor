import assert from "node:assert/strict";
import test from "node:test";
import { listUnpaidResources } from "../src/list.mjs";
import { HOSTILE_FIXTURES } from "../src/paths.mjs";
import { UnpaidListError } from "../src/errors.mjs";
import { runCliProcess } from "./helpers.mjs";

const CASES = [
  ["malformed catalog JSON", HOSTILE_FIXTURES.malformed, "catalog_malformed"],
  ["missing items array", HOSTILE_FIXTURES.missingItems, "catalog_missing_items"],
  ["loopback resource URL", HOSTILE_FIXTURES.privateUrl, "invalid_discovery_url"],
  ["mcp:// resource", HOSTILE_FIXTURES.mcpResource, "invalid_discovery_url"],
  ["URL credentials", HOSTILE_FIXTURES.credentialsUrl, "invalid_discovery_url"],
  ["x402 v1 catalog", HOSTILE_FIXTURES.wrongVersion, "unsupported_x402_version"],
  ["paid extract body", HOSTILE_FIXTURES.paidBody, "catalog_malformed"],
  ["402 challenge as catalog", HOSTILE_FIXTURES.challengeAsCatalog, "catalog_malformed"],
  ["plain HTTP resource", HOSTILE_FIXTURES.httpResource, "invalid_discovery_url"],
];

for (const [name, path, code] of CASES) {
  test(`seeded failure rejects ${name}`, async () => {
    await assert.rejects(() => listUnpaidResources({ catalogPath: path }), (error) => {
      assert.equal(error instanceof UnpaidListError, true, error.stack);
      assert.equal(error.code, code, error.message);
      return true;
    });
  });
}

test("CLI seeded malformed catalog exits 1 and does not list items", () => {
  const result = runCliProcess(["--catalog", "./fixtures/hostile/malformed.json"], { expectStatus: 1 });
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "catalog_malformed");
  assert.equal(result.stdout.trim(), "");
});

test("CLI seeded private URL exits 1", () => {
  const result = runCliProcess(["--catalog", "./fixtures/hostile/private-url.json"], { expectStatus: 1 });
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "invalid_discovery_url");
});
