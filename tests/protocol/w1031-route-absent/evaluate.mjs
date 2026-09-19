import {
  ABSENT_PROBES,
  CODES,
  PRESENT_CONTROL,
  SDS,
  isRegisteredRoute,
} from "./constants.mjs";
import {
  catalogListsRoute,
  claimsTreatAbsenceAsDemand,
  classifyCatalogObservation,
  classifyHttpObservation,
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

function kindOf(fixture) {
  return fixture?.kind || null;
}

function isCatalog(fixture) {
  const kind = kindOf(fixture);
  return kind === "catalog" || kind === "catalog-omits-absent" || fixture?.method === "catalog";
}

export function evaluateHttp(fixture = {}) {
  const observation = observationOf(fixture);
  const request = requestOf(fixture);
  const claims = claimsOf(fixture);
  const counters = countersOf(fixture);
  const classified = classifyHttpObservation(observation, request);
  const violations = [];

  if (!isRecord(fixture) || !isRecord(observation)) {
    violations.push(violation(CODES.MALFORMED_FIXTURE, "http fixture is missing observation"));
  }
  if (classified.invented?.length) {
    violations.push(violation(
      CODES.INVENTED_RECEIPT_FIELD,
      `invented receipt field without live schema: ${classified.invented.join(",")}`,
      { invented: classified.invented },
    ));
  }

  const settle = Number(counters.settle || 0);
  const verify = Number(counters.verify || 0);

  if (classified.kind === "present_unpaid_402") {
    if (classified.paymentSignatureSent || request.paymentSignatureSent === true) {
      violations.push(violation(
        CODES.PAYMENT_SIGNATURE_SENT,
        "PAYMENT-SIGNATURE on a present route is refused; this suite is unpaid",
      ));
    }
    if (classified.path === PRESENT_CONTROL.path) {
      if (classified.amount && classified.amount !== SDS.amountAtomic) {
        violations.push(violation(
          CODES.AMOUNT_MISMATCH,
          `GET /extract accepts[].amount ${JSON.stringify(classified.amount)} is not ${SDS.amountAtomic}`,
          { expected: SDS.amountAtomic, actual: classified.amount },
        ));
      }
      if (classified.payTo && classified.payTo !== SDS.payTo) {
        violations.push(violation(
          CODES.AMOUNT_MISMATCH,
          `accepts[].payTo ${classified.payTo} does not match SDS payTo`,
        ));
      }
      if (classified.network && classified.network !== SDS.network) {
        violations.push(violation(
          CODES.AMOUNT_MISMATCH,
          `accepts[].network ${classified.network} does not match SDS ${SDS.network}`,
        ));
      }
      if (!classified.amount) {
        violations.push(violation(CODES.AMOUNT_MISMATCH, "GET /extract accepts[].amount is missing"));
      }
    }
    if (claimsTreatAbsenceAsDemand(claims) && (claims.charged === true || claims.paidDelivery === true || claims.settlement === true)) {
      violations.push(violation(
        CODES.ABSENT_ROUTE_AS_CHARGED,
        "unpaid HTTP 402 on a present route is a challenge, not charged delivery",
      ));
    }
  } else if (classified.kind === "route_absent") {
    if (isRegisteredRoute(classified.method, classified.path)) {
      violations.push(violation(CODES.MALFORMED_FIXTURE, "registered route classified as route_absent"));
    }
    if (classified.httpStatus !== 404) {
      violations.push(violation(
        CODES.ABSENT_ROUTE_AS_402,
        `absent ${classified.method} ${classified.path} HTTP ${classified.httpStatus} is not 404`,
      ));
    }
    if (classified.paymentRequiredHeader || classified.acceptsCount > 0) {
      violations.push(violation(
        CODES.ABSENT_ROUTE_AS_402,
        `absent ${classified.method} ${classified.path} advertised a 402 challenge`,
      ));
    }
    if (settle > 0) {
      violations.push(violation(CODES.SETTLE_ON_ABSENT, "facilitator settle ran for an absent route"));
    }
    if (verify > 0) {
      violations.push(violation(CODES.VERIFY_ON_ABSENT, "facilitator verify ran for an absent route"));
    }
    if (claimsTreatAbsenceAsDemand(claims)) {
      const charged = claims.charged === true || claims.paidDelivery === true || claims.settlement === true || claims.settled === true;
      violations.push(violation(
        charged ? CODES.ABSENT_ROUTE_AS_CHARGED : CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND,
        "HTTP 404 on an unregistered x402 method+path is route_absent, not demand/402/charged/listed",
        {
          claims: {
            treatAbsenceAsDemand: claims.treatAbsenceAsDemand ?? null,
            charged: claims.charged ?? null,
            paidDelivery: claims.paidDelivery ?? null,
            listed: claims.listed ?? null,
            http402: claims.http402 ?? null,
          },
        },
      ));
    }
  } else if (classified.kind === "absent_as_402") {
    violations.push(violation(
      CODES.ABSENT_ROUTE_AS_402,
      `unregistered ${classified.method} ${classified.path} must not return a 402 challenge`,
    ));
  } else if (classified.kind === "absent_as_paid_delivery") {
    violations.push(violation(
      CODES.ABSENT_ROUTE_AS_CHARGED,
      `unregistered ${classified.method} ${classified.path} HTTP 200 is not paid delivery`,
    ));
  } else if (classified.kind === "present_unexpected") {
    violations.push(violation(
      CODES.PRESENT_NOT_402,
      `registered ${classified.method} ${classified.path} unpaid hop is HTTP ${classified.httpStatus}, not 402`,
    ));
  } else {
    violations.push(violation(CODES.MALFORMED_FIXTURE, `http observation is ${classified.kind}`));
  }

  const primary = violations[0];
  const ok = violations.length === 0;
  return {
    ok,
    code: ok
      ? (classified.kind === "present_unpaid_402" ? CODES.PRESENT_UNPAID_402 : CODES.ROUTE_ABSENT)
      : primary.code,
    id: fixture.id ?? null,
    expect: fixture.expect ?? null,
    rejectCode: fixture.rejectCode ?? null,
    method: classified.method,
    path: classified.path,
    classified,
    violations,
    claimsRejected: classified.kind === "route_absent" && claimsTreatAbsenceAsDemand(claims)
      && violations.some((item) => item.code === CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND
        || item.code === CODES.ABSENT_ROUTE_AS_CHARGED),
  };
}

export function evaluateCatalog(fixture = {}) {
  const observation = observationOf(fixture);
  const request = requestOf(fixture);
  const claims = claimsOf(fixture);
  const classified = classifyCatalogObservation(observation, request);
  const violations = [];
  const route = classified.route;

  if (!route) {
    violations.push(violation(CODES.MALFORMED_FIXTURE, "catalog fixture is missing route"));
  }

  const listed = catalogListsRoute(observation, route) || classified.listed;
  if (ABSENT_PROBES.some((probe) => probe.path === route)) {
    if (listed) {
      violations.push(violation(
        CODES.CATALOG_LISTS_ABSENT,
        `well-known x402 / actions listed absent route ${route}`,
      ));
    }
    if (classified.identityStatus && classified.identityStatus !== "route_absent") {
      violations.push(violation(
        CODES.IDENTITY_NOT_ROUTE_ABSENT,
        `listing identity for ${route} is ${classified.identityStatus}, not route_absent`,
      ));
    }
    if (claimsTreatAbsenceAsDemand(claims)) {
      violations.push(violation(
        CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND,
        "catalog omission is route_absent, not demand",
      ));
    }
  } else if (route === PRESENT_CONTROL.path) {
    if (!listed) {
      violations.push(violation(
        CODES.PRESENT_NOT_402,
        "GET /extract must remain listed on well-known x402 while absent routes stay omitted",
      ));
    }
  }

  const primary = violations[0];
  const ok = violations.length === 0;
  return {
    ok,
    code: ok ? CODES.ROUTE_ABSENT : primary.code,
    id: fixture.id ?? null,
    expect: fixture.expect ?? null,
    rejectCode: fixture.rejectCode ?? null,
    method: "catalog",
    path: route,
    classified,
    violations,
    claimsRejected: claimsTreatAbsenceAsDemand(claims)
      && violations.some((item) => item.code === CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND),
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
  return isCatalog(fixture) ? evaluateCatalog(fixture) : evaluateHttp(fixture);
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

export function evaluateColdSuite({ present, absent, catalog, signatureAbsent, counters, origin }) {
  const presentEval = evaluateHttp(present);
  const absentEvals = (absent || []).map((fixture) => evaluateHttp(fixture));
  const catalogEvals = (catalog || []).map((fixture) => evaluateCatalog(fixture));
  const signatureEval = signatureAbsent ? evaluateHttp(signatureAbsent) : { ok: true, code: CODES.ROUTE_ABSENT };
  const settle = Number(counters?.settle || 0);
  const verify = Number(counters?.verify || 0);
  const ok = presentEval.ok === true
    && absentEvals.every((item) => item.ok === true)
    && catalogEvals.every((item) => item.ok === true)
    && signatureEval.ok === true
    && settle === 0
    && verify === 0;
  const firstFail = [presentEval, ...absentEvals, ...catalogEvals, signatureEval].find((item) => !item.ok);
  return {
    ok,
    mode: "cold",
    artifact: "server.js",
    code: ok ? CODES.ROUTE_ABSENT : (firstFail?.code || CODES.MALFORMED_FIXTURE),
    origin,
    paymentSent: false,
    paymentSignatureSent: Boolean(signatureAbsent?.request?.paymentSignatureSent),
    present: presentEval,
    absent: absentEvals,
    catalog: catalogEvals,
    signatureAbsent: signatureEval,
    counters,
    boundary: {
      paymentSent: false,
      liveFacilitator: false,
      published: false,
      ownerCdp: false,
      extractBatchEnabled: false,
      lockfilePinDeltaEnabled: false,
    },
  };
}
