import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FEED_SCHEMA,
  FEED_STATUS,
  RECOMMENDATION,
  CONFIDENCE,
  USABLE_BY,
  PINS,
  SCOPE_NOTE,
  buildDistRepairFeed,
  validateDistRepairFeed,
  ROUTE_DELTA,
} from "../src/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(join(root, "fixtures", name), "utf8"));
const FIXED = () => Date.parse("2026-09-10T12:00:00.000Z");

test("positive: complete pair yields actionable repairs", () => {
  const feed = buildDistRepairFeed(load("positive.json"), { clock: FIXED });
  assert.equal(feed.schema, FEED_SCHEMA);
  assert.equal(feed.status, FEED_STATUS.READY);
  assert.equal(feed.generatedAt, "2026-09-10T12:00:00.000Z");
  assert.equal(feed.currentCaptureIncomplete, false);
  assert.deepEqual(feed.usableBy, [...USABLE_BY]);
  assert.equal(feed.pins.merchantRecord05, PINS.merchantRecord05);
  assert.equal(feed.pins.samedaydeskDist08, PINS.samedaydeskDist08);
  assert.match(feed.scopeNote, /cannot prove global removal/i);

  const byKey = Object.fromEntries(feed.repairRecommendations.map((r) => [r.routeKey, r]));
  assert.equal(byKey["/old-blog"].delta, ROUTE_DELTA.REMOVED);
  assert.equal(byKey["/old-blog"].recommendation, RECOMMENDATION.RECOMMEND_DISTRIBUTION_RECHECK);
  assert.equal(byKey["/old-blog"].confidence, CONFIDENCE.HIGH);
  assert.equal(byKey["/old-blog"].coveragePreserved, false);
  assert.ok(byKey["/old-blog"].notes.includes(RECOMMENDATION.SURFACE_BROKEN_OR_REMOVED_ROUTE));

  assert.equal(byKey["/docs"].recommendation, RECOMMENDATION.UPDATE_LISTED_ROUTE_OR_REDIRECT_TARGET);
  assert.equal(byKey["/pricing"].recommendation, RECOMMENDATION.DIAGNOSE_ACCESS_OR_LISTING_PATH);
  assert.equal(byKey["/maintenance"].recommendation, RECOMMENDATION.CONFIRM_RESTORED_ROUTE_IN_LISTING);
  assert.equal(byKey["/changelog"].recommendation, RECOMMENDATION.CONSIDER_LISTING_NEW_ROUTE);
  assert.equal(byKey["/"].recommendation, RECOMMENDATION.NO_ACTION_UNCHANGED);

  assert.equal(Object.prototype.hasOwnProperty.call(feed, "seoRank"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(feed, "trafficProjection"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(feed, "rankingScore"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(feed, "revenue"), false);

  validateDistRepairFeed(feed);
});

test("partial: incomplete current maps removed → cannot_prove_global_removal", () => {
  const feed = buildDistRepairFeed(load("partial-incomplete-current.json"), { clock: FIXED });
  assert.equal(feed.status, FEED_STATUS.PARTIAL_INPUT);
  assert.equal(feed.currentCaptureIncomplete, true);
  assert.ok(feed.partialReasons.includes("current_capture_incomplete"));

  const byKey = Object.fromEntries(feed.repairRecommendations.map((r) => [r.routeKey, r]));
  assert.equal(byKey["/old-blog"].delta, ROUTE_DELTA.REMOVED);
  assert.equal(byKey["/old-blog"].recommendation, RECOMMENDATION.CANNOT_PROVE_GLOBAL_REMOVAL);
  assert.equal(byKey["/old-blog"].confidence, CONFIDENCE.LOW);
  assert.equal(byKey["/old-blog"].coveragePreserved, true);
  assert.equal(
    byKey["/old-blog"].secondaryRecommendation,
    RECOMMENDATION.RECHECK_WITH_COMPLETE_CAPTURE,
  );
  assert.equal(byKey["/pricing"].recommendation, RECOMMENDATION.CANNOT_PROVE_GLOBAL_REMOVAL);

  // Must never claim SEO/traffic/global crawler proof
  const blob = JSON.stringify(feed);
  assert.equal(/seoRank|trafficProjection|globally removed and confirmed/i.test(blob), false);
  assert.match(SCOPE_NOTE, /incomplete current capture/i);
});

test("negative: forbidden fields refuse", () => {
  const feed = buildDistRepairFeed(load("negative-forbidden.json"), { clock: FIXED });
  assert.equal(feed.status, FEED_STATUS.REJECTED);
  assert.equal(feed.error.code, "forbidden_claim");
  assert.equal(feed.schema, FEED_SCHEMA);
  assert.ok(Array.isArray(feed.usableBy));
});

test("accepts { routeRegressionInput } wrapper shape", () => {
  const inner = load("positive.json");
  const feed = buildDistRepairFeed(
    {
      routeRegressionInput: inner,
      distributionCite: { note: "cite-only", pin: PINS.samedaydeskDist08 },
      feedId: "wrapped-feed",
    },
    { clock: FIXED },
  );
  assert.equal(feed.status, FEED_STATUS.READY);
  assert.equal(feed.feedId, "wrapped-feed");
  assert.equal(feed.distributionCite.pin, PINS.samedaydeskDist08);
});

test("schema validateDistRepairFeed accepts positive feed", () => {
  const feed = buildDistRepairFeed(load("positive.json"), { clock: FIXED });
  const ok = validateDistRepairFeed(feed);
  assert.equal(ok.schema, FEED_SCHEMA);
  assert.ok(ok.repairRecommendations.length >= 1);
});
