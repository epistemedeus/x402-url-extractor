import { CODES, SDS, SOURCE_ORDER } from "./constants.mjs";
import {
  claimsDemandCharge,
  classifyCatalogObservation,
  classifyMerchantObservation,
  inventedHits,
  isMerchantFixture,
  isOriginFoundFixture,
} from "./classify.mjs";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function violation(code, message, extra = {}) {
  return { code, message, ...extra };
}

function observationOf(fixture) {
  return isRecord(fixture?.observation) ? fixture.observation : fixture;
}

function requestOf(fixture) {
  return isRecord(fixture?.request) ? fixture.request : {};
}

function claimsOf(fixture) {
  return isRecord(fixture?.claims) ? fixture.claims : {};
}

function countersOf(fixture) {
  return isRecord(fixture?.counters) ? fixture.counters : {};
}

function sharedBoundaryViolations(classified, request, claims, counters, observation) {
  const violations = [];
  const invented = classified.invented?.length
    ? classified.invented
    : inventedHits({ observation, request, claims });
  if (invented.length) {
    violations.push(violation(
      CODES.INVENTED_RECEIPT_FIELD,
      `invented receipt field without live schema: ${invented.join(",")}`,
      { invented },
    ));
  }
  if (classified.paymentSignatureSent || request.paymentSignatureSent === true) {
    violations.push(violation(
      CODES.PAYMENT_SIGNATURE_SENT,
      "PAYMENT-SIGNATURE / x402/payment was sent; this suite is unpaid route_absent only",
    ));
  }
  if (Number(counters.settle) > 0 || Number(classified.facilitatorSettle) > 0) {
    violations.push(violation(CODES.SETTLE_ON_ABSENT, "absent route called facilitator settle"));
  }
  if (classified.paymentSent === true || request.paymentSent === true) {
    violations.push(violation(
      CODES.PAYMENT_SIGNATURE_SENT,
      "payment was sent; route_absent observations are unpaid",
    ));
  }
  if (claimsDemandCharge(claims)) {
    if (claims.matched === true && claims.demand !== true && claims.charged !== true) {
      violations.push(violation(
        CODES.ROUTE_ABSENT_CLASSIFIED_AS_MATCHED,
        "route_absent catalog observation is not a matched listing or matched price",
        { claims: { matched: claims.matched } },
      ));
    } else if (claims.charged === true || claims.paidDelivery === true || claims.successProven === true || claims.settlement === true) {
      violations.push(violation(
        CODES.ROUTE_ABSENT_CLASSIFIED_AS_CHARGED,
        "route_absent is not charged, paid delivery, or settlement",
        {
          claims: {
            charged: claims.charged ?? null,
            paidDelivery: claims.paidDelivery ?? null,
            successProven: claims.successProven ?? null,
            settlement: claims.settlement ?? claims.settled ?? null,
          },
        },
      ));
    } else {
      violations.push(violation(
        CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND,
        "route_absent is a checked miss, not demand, conversion, listing, or a sale",
        {
          claims: {
            demand: claims.demand ?? null,
            listed: claims.listed ?? null,
            routePresent: claims.routePresent ?? null,
            conversion: claims.conversion ?? null,
            sale: claims.sale ?? null,
          },
        },
      ));
    }
  }
  return violations;
}

export function evaluateCatalogEmpty(fixture = {}) {
  const observation = observationOf(fixture);
  const request = requestOf(fixture);
  const claims = claimsOf(fixture);
  const counters = countersOf(fixture);
  const classified = classifyCatalogObservation(observation, request);
  const violations = [
    ...sharedBoundaryViolations(classified, request, claims, counters, observation),
  ];

  if (!isRecord(fixture) || !observation) {
    violations.push(violation(CODES.MALFORMED_FIXTURE, "catalog fixture is missing"));
  }
  if (classified.kind !== "catalog_route_absent") {
    if (classified.kind === "catalog_route_present") {
      violations.push(violation(
        CODES.ROUTE_ABSENT_CLASSIFIED_AS_MATCHED,
        "catalog observation is not route_absent (a present/matched route was recorded)",
      ));
    } else if (!violations.length) {
      violations.push(violation(
        CODES.MALFORMED_FIXTURE,
        `catalog observation is ${classified.kind}, not catalog_route_absent`,
      ));
    }
  }
  if (classified.expectedRouteFound === true) {
    violations.push(violation(
      CODES.ROUTE_ABSENT_CLASSIFIED_AS_MATCHED,
      "expectedRouteFound=true is not route_absent",
    ));
  }
  const missingPrices = SOURCE_ORDER.filter((source) => classified.priceStatuses[source] && classified.priceStatuses[source] !== "route_absent");
  if (missingPrices.length) {
    violations.push(violation(
      CODES.ROUTE_ABSENT_CLASSIFIED_AS_MATCHED,
      `priceObservation is not route_absent for ${missingPrices.join(",")}`,
      { sources: missingPrices },
    ));
  }
  if (!Object.keys(classified.priceStatuses).length && !Object.keys(classified.identityStatuses).length) {
    violations.push(violation(CODES.MALFORMED_FIXTURE, "catalog fixture omitted price and identity statuses"));
  }

  const primary = violations[0];
  return {
    ok: violations.length === 0,
    code: violations.length === 0 ? CODES.ROUTE_ABSENT : primary.code,
    id: fixture.id ?? null,
    expect: fixture.expect ?? null,
    rejectCode: fixture.rejectCode ?? null,
    method: "catalog-empty-route-absent",
    classified,
    violations,
    claimsRejected: claimsDemandCharge(claims)
      && violations.some((item) => [
        CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND,
        CODES.ROUTE_ABSENT_CLASSIFIED_AS_MATCHED,
        CODES.ROUTE_ABSENT_CLASSIFIED_AS_CHARGED,
      ].includes(item.code)),
  };
}

export function evaluateOriginFound(fixture = {}) {
  const observation = observationOf(fixture);
  const request = requestOf(fixture);
  const claims = claimsOf(fixture);
  const counters = countersOf(fixture);
  const classified = classifyCatalogObservation(observation, request);
  const violations = [
    ...sharedBoundaryViolations(classified, request, claims, counters, observation),
  ];

  if (!isRecord(fixture) || !observation) {
    violations.push(violation(CODES.MALFORMED_FIXTURE, "origin-found fixture is missing"));
  }
  if (classified.kind !== "origin_found_expected_route_absent") {
    if (!violations.some((item) => item.code === CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND)) {
      violations.push(violation(
        CODES.MALFORMED_FIXTURE,
        `observation is ${classified.kind}, not origin_found_expected_route_absent`,
      ));
    }
  }
  if (classified.expectedRouteFound === true) {
    violations.push(violation(
      CODES.ROUTE_ABSENT_CLASSIFIED_AS_MATCHED,
      "expected route was found; this is not origin_found_expected_route_absent",
    ));
  }
  if (classified.allPriceAbsent !== true) {
    violations.push(violation(
      CODES.ROUTE_ABSENT_CLASSIFIED_AS_MATCHED,
      "origin-found miss must still report priceObservation.status=route_absent for the requested route",
    ));
  }

  const primary = violations[0];
  return {
    ok: violations.length === 0,
    code: violations.length === 0 ? CODES.ORIGIN_FOUND_EXPECTED_ROUTE_ABSENT : primary.code,
    id: fixture.id ?? null,
    expect: fixture.expect ?? null,
    rejectCode: fixture.rejectCode ?? null,
    method: "origin-found-expected-route-absent",
    classified,
    violations,
    claimsRejected: claimsDemandCharge(claims)
      && violations.some((item) => [
        CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND,
        CODES.ROUTE_ABSENT_CLASSIFIED_AS_MATCHED,
        CODES.ROUTE_ABSENT_CLASSIFIED_AS_CHARGED,
      ].includes(item.code)),
  };
}

export function evaluateMerchant(fixture = {}) {
  const observation = observationOf(fixture);
  const request = requestOf(fixture);
  const claims = claimsOf(fixture);
  const counters = countersOf(fixture);
  const classified = classifyMerchantObservation(observation, request);
  const violations = [
    ...sharedBoundaryViolations(classified, request, claims, counters, observation),
  ];

  if (!isRecord(fixture) || !observation) {
    violations.push(violation(CODES.MALFORMED_FIXTURE, "merchant fixture is missing"));
  }
  if (classified.kind === "merchant_402" || classified.challenge === true || classified.httpStatus === 402) {
    violations.push(violation(
      CODES.ABSENCE_TREATED_AS_402,
      "flag-off POST /lockfile-pin-delta is HTTP 404 route_absent, not HTTP 402 demand",
      { httpStatus: classified.httpStatus },
    ));
  }
  if (classified.advertised === true) {
    violations.push(violation(
      CODES.LOCKFILE_ADVERTISED_WHILE_ABSENT,
      "flag-off lockfile-pin-delta must be omitted from OpenAPI, /api/actions, and /.well-known/x402",
    ));
  }
  if (classified.extractHttpStatus && classified.extractHttpStatus !== 402) {
    violations.push(violation(
      CODES.EXTRACT_CONTROL_NOT_402,
      `GET /extract control must remain unpaid HTTP 402, got ${classified.extractHttpStatus}`,
    ));
  }
  if (classified.kind !== "merchant_route_absent") {
    if (!violations.some((item) => [
      CODES.ABSENCE_TREATED_AS_402,
      CODES.LOCKFILE_ADVERTISED_WHILE_ABSENT,
      CODES.ROUTE_ABSENT_CLASSIFIED_AS_CHARGED,
      CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND,
    ].includes(item.code))) {
      violations.push(violation(
        CODES.MALFORMED_FIXTURE,
        `merchant observation is ${classified.kind}, not merchant_route_absent`,
      ));
    }
  }

  const primary = violations[0];
  return {
    ok: violations.length === 0,
    code: violations.length === 0 ? CODES.MERCHANT_ROUTE_ABSENT : primary.code,
    id: fixture.id ?? null,
    expect: fixture.expect ?? null,
    rejectCode: fixture.rejectCode ?? null,
    method: "POST /lockfile-pin-delta",
    classified,
    violations,
    claimsRejected: claimsDemandCharge(claims)
      && violations.some((item) => [
        CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND,
        CODES.ROUTE_ABSENT_CLASSIFIED_AS_CHARGED,
        CODES.ABSENCE_TREATED_AS_402,
      ].includes(item.code)),
  };
}

export function evaluateFixture(fixture = {}) {
  if (!isRecord(fixture)) {
    return {
      ok: false,
      code: CODES.MALFORMED_FIXTURE,
      id: null,
      expect: null,
      rejectCode: null,
      method: null,
      classified: null,
      violations: [violation(CODES.MALFORMED_FIXTURE, "fixture is not an object")],
      claimsRejected: false,
    };
  }
  if (isMerchantFixture(fixture)) return evaluateMerchant(fixture);
  if (isOriginFoundFixture(fixture)) return evaluateOriginFound(fixture);
  return evaluateCatalogEmpty(fixture);
}

export function classifyFixture(fixture) {
  const evaluated = evaluateFixture(fixture);
  const expect = fixture?.expect;
  if (expect === "pass") {
    return {
      ...evaluated,
      classifiedOk: evaluated.ok,
      verdict: evaluated.ok ? "pass" : "fail",
    };
  }
  if (expect === "reject") {
    const codeOk = !fixture.rejectCode
      || evaluated.code === fixture.rejectCode
      || evaluated.violations.some((item) => item.code === fixture.rejectCode);
    const rejected = evaluated.ok === false && codeOk;
    return {
      ...evaluated,
      classifiedOk: rejected,
      verdict: rejected ? "rejected" : "not-rejected",
    };
  }
  return {
    ...evaluated,
    classifiedOk: evaluated.ok,
    verdict: evaluated.ok ? "pass" : "fail",
  };
}

export function evaluateFixtureCorpus(passEntries, rejectEntries) {
  const rows = [];
  for (const entry of passEntries) {
    const classified = classifyFixture(entry.fixture);
    rows.push({
      id: entry.id,
      path: entry.relativePath,
      expect: "pass",
      ok: classified.verdict === "pass",
      code: classified.code,
      verdict: classified.verdict,
    });
  }
  for (const entry of rejectEntries) {
    const classified = classifyFixture(entry.fixture);
    rows.push({
      id: entry.id,
      path: entry.relativePath,
      expect: "reject",
      rejectCode: entry.rejectCode,
      ok: classified.verdict === "rejected",
      code: classified.code,
      verdict: classified.verdict,
    });
  }
  const failed = rows.filter((row) => !row.ok);
  return {
    ok: failed.length === 0 && rows.length > 0,
    counted: rows.length,
    passed: rows.filter((row) => row.ok).length,
    failed,
    rows,
  };
}

function auditToCatalogFixture(audit, { id, kind, expect = "pass" }) {
  const priceStatuses = {};
  const identityStatuses = {};
  const identityDecisions = {};
  const sources = audit?.sources || {};
  for (const name of SOURCE_ORDER) {
    const source = sources[name];
    if (source?.priceObservation?.status) priceStatuses[name] = source.priceObservation.status;
    if (source?.identityObservation?.status) identityStatuses[name] = source.identityObservation.status;
    if (source?.identityObservation?.decision) identityDecisions[name] = source.identityObservation.decision;
  }
  return {
    id,
    expect,
    kind,
    request: {
      origin: SDS.origin,
      route: SDS.lockfilePath,
      paymentSignatureSent: false,
      paymentSent: false,
    },
    observation: {
      route: SDS.lockfilePath,
      expectedPriceAtomic: SDS.amountAtomic,
      sources,
      priceStatuses,
      identityStatuses,
      identityDecisions,
      findings: Array.isArray(audit?.findings) ? audit.findings.map((item) => item.finding) : [],
      targetFound: Object.values(sources).some((source) => source?.targetFound === true),
      expectedRouteFound: Object.values(sources).some((source) => source?.expectedRouteFound === true),
      paymentSent: audit?.safety?.paymentSentToCatalogs === true,
      paymentSignatureSent: audit?.safety?.paymentSignedToCatalogs === true,
    },
    claims: {
      demand: false,
      charged: false,
      matched: false,
      settlement: false,
    },
    counters: { verify: 0, settle: 0 },
  };
}

export function evaluateColdSuite({ catalogAudit, originFoundAudit, merchant, origin }) {
  const catalogFixture = auditToCatalogFixture(catalogAudit, {
    id: "cold-catalog-empty",
    kind: "catalog-empty-route-absent",
  });
  const originFixture = auditToCatalogFixture(originFoundAudit, {
    id: "cold-origin-found",
    kind: "origin-found-expected-route-absent",
  });
  const catalog = evaluateCatalogEmpty(catalogFixture);
  const originFound = evaluateOriginFound(originFixture);
  const merchantResult = evaluateMerchant({
    id: "cold-merchant-flag-off",
    expect: "pass",
    kind: "merchant-flag-off",
    request: { method: "POST /lockfile-pin-delta", paymentSignatureSent: false },
    observation: merchant,
    claims: { demand: false, charged: false, settlement: false },
    counters: {
      verify: merchant?.facilitatorVerify || 0,
      settle: merchant?.facilitatorSettle || 0,
    },
  });
  const ok = catalog.ok === true && originFound.ok === true && merchantResult.ok === true;
  return {
    ok,
    mode: "cold",
    artifact: "agent-discoverability-audit.mjs+server.js",
    code: ok
      ? CODES.ROUTE_ABSENT
      : (catalog.ok ? (originFound.ok ? merchantResult.code : originFound.code) : catalog.code),
    origin,
    route: SDS.lockfilePath,
    paymentSent: false,
    paymentSignatureSent: false,
    catalog,
    originFound,
    merchant: merchantResult,
    boundary: {
      paymentSent: false,
      paymentSignatureSent: false,
      liveFacilitator: false,
      published: false,
      ownerCdp: false,
      neoTouched: false,
    },
    safety: {
      paymentSentToCatalogs: catalogAudit?.safety?.paymentSentToCatalogs === true,
      paymentSignedToCatalogs: catalogAudit?.safety?.paymentSignedToCatalogs === true,
      credentialsUsed: catalogAudit?.safety?.credentialsUsed === true,
    },
  };
}
