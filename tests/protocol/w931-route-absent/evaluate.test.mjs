import assert from "node:assert/strict";
import { test } from "node:test";

import { CODES, SDS } from "./constants.mjs";
import {
  classifyCatalogObservation,
  classifyMerchantObservation,
} from "./classify.mjs";
import {
  classifyFixture,
  evaluateCatalogEmpty,
  evaluateFixture,
  evaluateFixtureCorpus,
  evaluateMerchant,
  evaluateOriginFound,
} from "./evaluate.mjs";
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

test("empty catalog lockfile route is route_absent, not demand", () => {
  const fixture = loadFixture("pass/catalog-empty-route-absent.json");
  const classified = classifyCatalogObservation(fixture.observation, fixture.request);
  assert.equal(classified.kind, "catalog_route_absent");
  assert.equal(classified.allPriceAbsent, true);
  assert.equal(classified.allIdentityAbsent, true);
  assert.equal(classified.expectedRouteFound, false);
  assert.equal(classified.route, SDS.lockfilePath);
  const evaluated = evaluateCatalogEmpty(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.code, CODES.ROUTE_ABSENT);
});

test("origin found with expected route absent stays route_absent", () => {
  const fixture = loadFixture("pass/origin-found-expected-route-absent.json");
  const classified = classifyCatalogObservation(fixture.observation, fixture.request);
  assert.equal(classified.kind, "origin_found_expected_route_absent");
  assert.equal(classified.targetFound, true);
  assert.equal(classified.expectedRouteFound, false);
  const evaluated = evaluateOriginFound(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.code, CODES.ORIGIN_FOUND_EXPECTED_ROUTE_ABSENT);
});

test("flag-off lockfile POST is merchant_route_absent HTTP 404", () => {
  const fixture = loadFixture("pass/merchant-flag-off-404.json");
  const classified = classifyMerchantObservation(fixture.observation, fixture.request);
  assert.equal(classified.kind, "merchant_route_absent");
  assert.equal(classified.httpStatus, 404);
  assert.equal(classified.extractHttpStatus, 402);
  assert.equal(classified.hasPaymentRequiredHeader, false);
  const evaluated = evaluateMerchant(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.code, CODES.MERCHANT_ROUTE_ABSENT);
});

test("seeded route_absent as demand is rejected", () => {
  const fixture = loadFixture("reject/seeded-route-absent-as-demand.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND);
  assert.equal(evaluated.claimsRejected, true);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded route_absent as matched price is rejected", () => {
  const fixture = loadFixture("reject/seeded-route-absent-as-matched.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ROUTE_ABSENT_CLASSIFIED_AS_MATCHED);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded route_absent as charged is rejected", () => {
  const fixture = loadFixture("reject/seeded-route-absent-as-charged.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ROUTE_ABSENT_CLASSIFIED_AS_CHARGED);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded HTTP 404 treated as 402 is rejected", () => {
  const fixture = loadFixture("reject/seeded-404-as-402.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ABSENCE_TREATED_AS_402);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded origin_found_expected_route_absent as demand is rejected", () => {
  const fixture = loadFixture("reject/seeded-origin-found-as-demand.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("fixture corpus classifies every pass and reject file", () => {
  const report = evaluateFixtureCorpus(loadFixtures("pass"), loadFixtures("reject"));
  assert.equal(report.ok, true, JSON.stringify(report.failed));
  assert.equal(report.counted, 8);
});
