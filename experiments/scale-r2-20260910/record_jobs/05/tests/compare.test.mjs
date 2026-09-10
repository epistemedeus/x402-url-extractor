import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  REPORT_STATUS,
  REUSE_FROM,
  ROUTE_DELTA,
  SCHEMA,
  SCOPE_NOTE,
  buildRouteRegressionReport,
} from "../src/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(join(root, "fixtures", name), "utf8"));
const FIXED = () => Date.parse("2026-09-10T12:00:00.000Z");

test("positive: classifies removed, redirected, inaccessible, restored, added, unchanged", () => {
  const report = buildRouteRegressionReport(load("positive.json"), { clock: FIXED });
  assert.equal(report.schema, SCHEMA);
  assert.equal(report.status, REPORT_STATUS.READY);
  assert.equal(report.generatedAt, "2026-09-10T12:00:00.000Z");
  assert.equal(report.reuseFrom, REUSE_FROM);
  assert.equal(report.scopeNote, SCOPE_NOTE);
  assert.match(report.scopeNote, /not a claim about the entire internet/i);

  const byKey = Object.fromEntries(report.diffs.map((d) => [d.routeKey, d]));
  assert.equal(byKey["/"].delta, ROUTE_DELTA.UNCHANGED);
  assert.equal(byKey["/docs"].delta, ROUTE_DELTA.REDIRECTED);
  assert.equal(byKey["/old-blog"].delta, ROUTE_DELTA.REMOVED);
  assert.equal(byKey["/pricing"].delta, ROUTE_DELTA.INACCESSIBLE);
  assert.equal(byKey["/legacy"].delta, ROUTE_DELTA.INACCESSIBLE);
  assert.equal(byKey["/maintenance"].delta, ROUTE_DELTA.RESTORED);
  assert.equal(byKey["/changelog"].delta, ROUTE_DELTA.ADDED);

  assert.equal(report.summary.deltaCounts[ROUTE_DELTA.REMOVED], 1);
  assert.equal(report.summary.deltaCounts[ROUTE_DELTA.REDIRECTED], 1);
  assert.equal(report.summary.deltaCounts[ROUTE_DELTA.INACCESSIBLE], 2);
  assert.equal(report.summary.deltaCounts[ROUTE_DELTA.RESTORED], 1);
  assert.equal(report.summary.deltaCounts[ROUTE_DELTA.ADDED], 1);
  assert.equal(report.summary.deltaCounts[ROUTE_DELTA.UNCHANGED], 1);

  assert.equal(Object.prototype.hasOwnProperty.call(report, "seoRank"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "trafficProjection"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "investmentRecommendation"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "siteHealthScore"), false);
  assert.match(report.dryRun, /never crawl/i);
});

test("negative: forbidden fields yield rejected report", () => {
  const report = buildRouteRegressionReport(load("negative-malformed.json"), { clock: FIXED });
  assert.equal(report.status, REPORT_STATUS.REJECTED);
  assert.equal(report.error.code, "forbidden_claim");
  assert.equal(report.scopeNote, SCOPE_NOTE);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "siteHealthScore"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "seoRank"), false);
});

test("partial: incomplete observations yield partial_input", () => {
  const report = buildRouteRegressionReport(load("partial-incomplete.json"), { clock: FIXED });
  assert.equal(report.status, REPORT_STATUS.PARTIAL_INPUT);
  assert.ok(report.partialReasons.includes("incomplete_route_observations"));
  const byKey = Object.fromEntries(report.diffs.map((d) => [d.routeKey, d]));
  assert.equal(byKey["/a"].delta, ROUTE_DELTA.UNCHANGED);
  assert.equal(byKey["/c"].delta, ROUTE_DELTA.ADDED);
  assert.equal(byKey["/b"].baseline.incomplete, true);
  assert.equal(byKey["/b"].current.incomplete, true);
});

test("status_changed when codes differ without redirect/inaccessible flip", () => {
  const report = buildRouteRegressionReport(
    {
      reportId: "status-change-demo",
      baseline: {
        routes: [{ path: "/x", url: "https://example.test/x", status: 200, accessibility: "ok" }],
      },
      current: {
        routes: [{ path: "/x", url: "https://example.test/x", status: 204, accessibility: "ok" }],
      },
    },
    { clock: FIXED },
  );
  assert.equal(report.status, REPORT_STATUS.READY);
  assert.equal(report.diffs[0].delta, ROUTE_DELTA.STATUS_CHANGED);
});

test("scopeNote always present and bounds the claim", () => {
  const report = buildRouteRegressionReport(load("positive.json"), { clock: FIXED });
  assert.ok(report.scopeNote.includes("supplied baseline+current"));
  assert.ok(!/entire internet is healthy/i.test(JSON.stringify(report)));
});
