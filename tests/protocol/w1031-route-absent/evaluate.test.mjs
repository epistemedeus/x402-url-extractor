import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogIdentityForRoute, classifyHttpObservation } from "./classify.mjs";
import { ABSENT_PROBES, CODES, INVENTED_PATH, SDS } from "./constants.mjs";
import { classifyFixture, evaluateCatalog, evaluateFixture, evaluateFixtureCorpus, evaluateHttp } from "./evaluate.mjs";
import {
  FIXTURE_SCHEMA,
  loadFixture,
  loadFixtures,
  loadManifest,
  listPassFixtureFiles,
  listRejectFixtureFiles,
} from "./paths.mjs";

test("manifest lists every pass and reject fixture", () => {
  const manifest = loadManifest();
  assert.equal(manifest.schema, FIXTURE_SCHEMA);
  const listedPass = manifest.fixtures.filter((entry) => entry.expect === "pass").map((entry) => entry.path).sort();
  const listedReject = manifest.fixtures.filter((entry) => entry.expect === "reject").map((entry) => entry.path).sort();
  assert.deepEqual(listedPass, listPassFixtureFiles());
  assert.deepEqual(listedReject, listRejectFixtureFiles());
});

test("unpaid GET /extract is present_unpaid_402 amount 5000", () => {
  const fixture = loadFixture("pass/present-extract-402.json");
  const classified = classifyHttpObservation(fixture.observation, fixture.request);
  assert.equal(classified.kind, "present_unpaid_402");
  assert.equal(classified.httpStatus, 402);
  assert.equal(classified.amount, SDS.amountAtomic);
  assert.equal(classified.payTo, SDS.payTo);
  assert.equal(classified.charged, false);
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.code, CODES.PRESENT_UNPAID_402);
});

test("GET /w1031-route-absent is route_absent HTTP 404", () => {
  const fixture = loadFixture("pass/absent-invented-404.json");
  const classified = classifyHttpObservation(fixture.observation, fixture.request);
  assert.equal(classified.kind, "route_absent");
  assert.equal(classified.httpStatus, 404);
  assert.equal(classified.paymentRequiredHeader, false);
  assert.equal(classified.charged, false);
  const evaluated = evaluateHttp(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.code, CODES.ROUTE_ABSENT);
});

test("flag-off POST /extract/batch is route_absent", () => {
  const fixture = loadFixture("pass/absent-extract-batch-flag-off.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.classified.kind, "route_absent");
  assert.equal(evaluated.classified.path, "/extract/batch");
});

test("flag-off POST /lockfile-pin-delta is route_absent", () => {
  const fixture = loadFixture("pass/absent-lockfile-flag-off.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.code, CODES.ROUTE_ABSENT);
});

test("catalog omission of invented path is listing identity route_absent", () => {
  const fixture = loadFixture("pass/catalog-omits-absent-routes.json");
  const identity = catalogIdentityForRoute({
    route: INVENTED_PATH,
    items: fixture.observation.items,
  });
  assert.equal(identity.status, "route_absent");
  assert.equal(identity.exactRouteRecordCount, 0);
  assert.equal(identity.ownershipProven, false);
  const evaluated = evaluateCatalog(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.classified.identityStatus, "route_absent");
  assert.equal(evaluated.classified.listed, false);
});

test("PAYMENT-SIGNATURE on invented path still route_absent", () => {
  const fixture = loadFixture("pass/absent-payment-signature-still-404.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.classified.kind, "route_absent");
  assert.equal(evaluated.classified.paymentSignatureSent, true);
});

test("seeded route_absent as demand is rejected", () => {
  const fixture = loadFixture("reject/seeded-route-absent-as-demand.json");
  const evaluated = evaluateHttp(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND);
  assert.equal(evaluated.claimsRejected, true);
  assert.equal(evaluated.classified.kind, "route_absent");
  assert.equal(evaluated.classified.charged, false);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded route_absent as charged is rejected", () => {
  const fixture = loadFixture("reject/seeded-absent-as-charged.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ABSENT_ROUTE_AS_CHARGED);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded 402 on invented path is rejected", () => {
  const fixture = loadFixture("reject/seeded-absent-as-402.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ABSENT_ROUTE_AS_402);
  assert.equal(evaluated.classified.kind, "absent_as_402");
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded copy of extract 402 onto /extract/batch is rejected", () => {
  const fixture = loadFixture("reject/seeded-copy-extract-onto-batch.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ABSENT_ROUTE_AS_402);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded catalog listing of invented path is rejected", () => {
  const fixture = loadFixture("reject/seeded-catalog-lists-absent.json");
  const evaluated = evaluateCatalog(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.CATALOG_LISTS_ABSENT);
  assert.equal(evaluated.classified.listed, true);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded settle on absent route is rejected", () => {
  const fixture = loadFixture("reject/seeded-absent-settled.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.SETTLE_ON_ABSENT);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("fixture corpus classifies every pass and reject observation", () => {
  const report = evaluateFixtureCorpus(loadFixtures("pass"), loadFixtures("reject"));
  assert.equal(report.ok, true, JSON.stringify(report.failed));
  assert.equal(report.counted, 12);
  assert.ok(ABSENT_PROBES.some((probe) => probe.path === "/extract/batch"));
});
