import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyFixture, evaluateTrace, evaluateFixtureCorpus } from "./evaluate.mjs";
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

test("pass traces hold the route-absent guard", () => {
  for (const entry of loadFixtures("pass")) {
    const evaluated = evaluateTrace(entry.fixture);
    assert.equal(evaluated.ok, true, `${entry.id}: ${evaluated.code} ${JSON.stringify(evaluated.violations)}`);
    assert.equal(evaluated.code, "route-absent-holds");
    assert.equal(evaluated.boundary.paymentSent, false);
    assert.equal(evaluated.absentAs402, 0);
    assert.equal(evaluated.settleCount, 0);
  }
});

test("seeded absent-route HTTP 402 is rejected as absent_route_classified_as_402", () => {
  const fixture = loadFixture("reject/seeded-absent-route-as-402.json");
  const evaluated = evaluateTrace(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "absent_route_classified_as_402");
  assert.equal(evaluated.settleCount, 1);
  assert.equal(evaluated.absentAs402, 1);
  assert.equal(evaluated.claimsRejected, true);
  assert.ok(evaluated.violations.some((item) => item.code === "absent_route_settle"));
});

test("seeded settle, charged, free-as-absent, paid-as-absent, and catalog-matched are rejected", () => {
  const settle = evaluateTrace(loadFixture("reject/seeded-absent-route-settled.json"));
  assert.equal(settle.ok, false);
  assert.equal(settle.code, "absent_route_settle");

  const charged = evaluateTrace(loadFixture("reject/seeded-absent-route-charged.json"));
  assert.equal(charged.ok, false);
  assert.equal(charged.code, "absent_route_classified_as_charged");

  const healthz = evaluateTrace(loadFixture("reject/seeded-healthz-as-absent.json"));
  assert.equal(healthz.ok, false);
  assert.equal(healthz.code, "free_surface_classified_as_absent");

  const paid = evaluateTrace(loadFixture("reject/seeded-extract-402-as-absent.json"));
  assert.equal(paid.ok, false);
  assert.equal(paid.code, "declared_paid_classified_as_absent");

  const catalog = evaluateTrace(loadFixture("reject/seeded-catalog-route-absent-as-matched.json"));
  assert.equal(catalog.ok, false);
  assert.equal(catalog.code, "catalog_route_absent_classified_as_matched");
});

test("claims.ok cannot override an undeclared path that returned 402", () => {
  const evaluated = evaluateTrace({
    id: "lie",
    route: "/w811-absent-route",
    claims: { ok: true, payable: true, charged: true },
    settleCount: 1,
    attempts: [
      {
        seq: 1,
        phase: "absent-unpaid",
        role: "absent",
        path: "/w811-absent-route",
        httpStatus: 402,
        hasPaymentRequired: true,
        settleDelta: 1,
        verifyDelta: 1,
        charged: true,
        payable: true,
      },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "absent_route_classified_as_402");
  assert.equal(evaluated.claimsRejected, true);
});

test("fixture corpus classifies pass and reject files", () => {
  const report = evaluateFixtureCorpus(loadFixtures("pass"), loadFixtures("reject"));
  assert.equal(report.ok, true, JSON.stringify(report.failed, null, 2));
  assert.equal(report.counted, 10);
  for (const entry of loadFixtures("reject")) {
    const classified = classifyFixture(entry.fixture);
    assert.equal(classified.classified, true, entry.id);
    assert.equal(classified.verdict, "rejected");
  }
});

test("claims.settled is rejected even when settleDelta and settleCount are 0", () => {
  const evaluated = evaluateTrace({
    id: "lie-settled",
    route: "/w811-absent-route",
    claims: { ok: true, routeAbsent: true, payable: false, charged: false, settled: true },
    settleCount: 0,
    attempts: [{
      seq: 1,
      phase: "absent-unpaid",
      role: "absent",
      path: "/w811-absent-route",
      httpStatus: 404,
      hasPaymentRequired: false,
      charged: false,
      payable: false,
      settleDelta: 0,
      verifyDelta: 0,
    }],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "absent_route_settle");
  assert.equal(evaluated.claimsRejected, true);
});

test("catalog origin-found without expected route requires the finding even when status is route_absent", () => {
  const evaluated = evaluateTrace({
    id: "catalog-missing-finding",
    route: "/extract",
    claims: { ok: true, routeAbsent: true, payable: false, charged: false, settled: false },
    catalog: {
      targetFound: true,
      expectedRouteFound: false,
      priceObservationStatus: "route_absent",
      findings: [],
      matched: false,
      payable: false,
      charged: false,
    },
    attempts: [],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "catalog_missing_route_absent_status");
});

test("HTTP 402 on the absent path is rejected even when role and phase are omitted", () => {
  const evaluated = evaluateTrace({
    id: "unknown-role-402",
    route: "/w811-absent-route",
    claims: { ok: true, payable: true, charged: false, settled: false },
    attempts: [{
      seq: 1,
      path: "/w811-absent-route",
      httpStatus: 402,
      hasPaymentRequired: true,
      payable: true,
      settleDelta: 0,
      verifyDelta: 0,
    }],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "absent_route_classified_as_402");
  assert.equal(evaluated.absentAs402, 1);
});

test("paid-control role cannot relabel an absent-path HTTP 402", () => {
  const evaluated = evaluateTrace({
    id: "relabel-absent-402",
    route: "/w811-absent-route",
    claims: { ok: true, routeAbsent: false, payable: true },
    attempts: [{
      seq: 1,
      role: "paid-control",
      path: "/w811-absent-route",
      httpStatus: 402,
      hasPaymentRequired: true,
      payable: true,
      settleDelta: 0,
      verifyDelta: 0,
    }],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "absent_route_classified_as_402");
});

test("declared verifyCount that does not match attempt verifyDelta is rejected", () => {
  const evaluated = evaluateTrace({
    id: "verify-inconsistent",
    route: "/w811-absent-route",
    claims: { ok: true, routeAbsent: true, payable: false, charged: false, settled: false },
    verifyCount: 3,
    settleCount: 0,
    attempts: [{
      seq: 1,
      phase: "absent-unpaid",
      role: "absent",
      path: "/w811-absent-route",
      httpStatus: 404,
      hasPaymentRequired: false,
      charged: false,
      payable: false,
      settleDelta: 0,
      verifyDelta: 0,
    }],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "verify_count_inconsistent");
});
