import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pickActionableRepair,
  buildBeforeAfterFixture,
  buildDist08BundleFromFeed,
  runHandoff,
  DEFAULT_FEED,
} from "../src/handoff.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const feed = JSON.parse(readFileSync(DEFAULT_FEED, "utf8"));

test("picks high-confidence redirected repair from actual 04 feed", () => {
  const r = pickActionableRepair(feed);
  assert.equal(r.routeKey, "/docs");
  assert.equal(r.delta, "redirected");
  assert.equal(r.recommendation, "update_listed_route_or_redirect_target");
});

test("before/after fixture is actionable and scoped", () => {
  const r = pickActionableRepair(feed);
  const fx = buildBeforeAfterFixture(feed, r);
  assert.equal(fx.schema, "pilot.nl.record.route_repair_before_after.v1");
  assert.equal(fx.after.recommendation, r.recommendation);
  assert.match(fx.after.actionableStep, /Update distribution listing/);
  assert.match(fx.scopeNote, /Not a crawl/);
});

test("Dist08 bundle cites feed without invented revenue", () => {
  const r = pickActionableRepair(feed);
  const b = buildDist08BundleFromFeed(feed, r);
  assert.equal(b.schema, "pilot.r2.distribution.conversion_bundle.v1");
  assert.equal(b.captureStatus, "ok");
  assert.ok(!JSON.stringify(b).includes("buyerCount"));
  assert.ok(b.usefulOutputEvidence[0].routeRepair);
});

test("full handoff writes outputs and gets Dist08 diagnosis", async () => {
  const outDir = join(__dirname, "..", "out-test");
  const result = await runHandoff({ outDir });
  assert.equal(result.status, "ready");
  assert.ok(result.joinCount >= 1);
  assert.ok(existsSync(result.outputs.beforeAfterPath));
  assert.ok(existsSync(result.outputs.diagnosisPath));
  const diag = JSON.parse(readFileSync(result.outputs.diagnosisPath, "utf8"));
  assert.ok(["available", "partial", "unavailable", "no_users"].includes(diag.status));
});
