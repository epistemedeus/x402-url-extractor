import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluateCatalog, evaluateProductCase, evaluateSeededClaim, seededAsRequiredTruth } from "./evaluate.mjs";
import { CATALOG_PATH, SEEDED_DIR } from "./paths.mjs";

const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));

test("catalog product cases pass and the designated seed is caught", () => {
  const judged = evaluateCatalog(catalog);
  assert.equal(judged.ok, true, judged.reason);
  assert.equal(judged.counts.fail, 0);
  assert.equal(judged.counts.missed, 0);
  assert.equal(judged.counts.caught, 1);
  assert.equal(judged.seeded[0].id, "seeded.false-accept.uncapped-900s");
  assert.equal(judged.seeded[0].claimedTimeoutMs, 900_000);
  assert.equal(judged.seeded[0].derivedTimeoutMs, 600_000);
});

test("SDS 300s fixture stays under the cap", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/sds-enrich-300s.json", import.meta.url), "utf8"));
  const judged = evaluateProductCase(fixture);
  assert.equal(judged.ok, true, judged.reason);
  assert.equal(judged.derived.timeoutMs, 300_000);
  assert.equal(judged.paid, false);
});

test("over-cap 900s fixture is clamped to 10m", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/over-cap-900s.json", import.meta.url), "utf8"));
  const judged = evaluateProductCase(fixture);
  assert.equal(judged.ok, true, judged.reason);
  assert.equal(judged.derived.timeoutMs, 600_000);
  assert.equal(judged.derived.capped, true);
});

test("seeded uncapped 900s claim is caught", () => {
  const seed = JSON.parse(readFileSync(`${SEEDED_DIR}/uncapped-900s.json`, "utf8"));
  const judged = evaluateSeededClaim(seed);
  assert.equal(judged.status, "caught");
  assert.equal(judged.claimedTimeoutMs, 900_000);
  assert.equal(judged.derivedTimeoutMs, 600_000);
  const truth = seededAsRequiredTruth(seed);
  assert.equal(truth.code, "SEED_REJECT");
  assert.equal(truth.rejected, true);
  assert.match(truth.message, /claimed 900000ms, product derived 600000ms/);
});

test("local constants match recorded @x402/mcp@2.26.0", async () => {
  const recorded = JSON.parse(readFileSync(new URL("./fixtures/upstream-mcp-2.26.0-constants.json", import.meta.url), "utf8"));
  const derive = await import("./derive.mjs");
  assert.equal(derive.MAX_TIMEOUT_MS, recorded.recorded.MAX_TIMEOUT_MS);
  assert.equal(derive.DEFAULT_PROBE_TIMEOUT_SECONDS, recorded.recorded.DEFAULT_PROBE_TIMEOUT_SECONDS);
  assert.equal(derive.DEFAULT_ACCEPT_TIMEOUT_SECONDS, recorded.recorded.DEFAULT_ACCEPT_TIMEOUT_SECONDS);
  assert.equal(derive.DEFAULT_MAX_REQUEST_TIMEOUT_SECONDS, recorded.recorded.DEFAULT_MAX_REQUEST_TIMEOUT_SECONDS);
});

test("seeded 15m settled claim is caught and not treated as payment", () => {
  const seed = JSON.parse(readFileSync(`${SEEDED_DIR}/wait-15m-settled.json`, "utf8"));
  const judged = evaluateSeededClaim(seed);
  assert.equal(judged.status, "caught");
  assert.equal(judged.claimedPaid, true);
  assert.equal(judged.claimedSettled, true);
  assert.equal(judged.paid, false);
  assert.equal(judged.settled, false);
});
