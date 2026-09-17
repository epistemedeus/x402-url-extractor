import {
  CANONICAL_ASSET_NAME,
  CANONICAL_ASSET_VERSION,
  CANONICAL_BASE_USDC,
  NETWORK,
} from "./paths.mjs";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function loopbackUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(String(value));
    return LOOPBACK.has(url.hostname);
  } catch {
    return false;
  }
}

function attemptsOf(trace) {
  return Array.isArray(trace?.attempts) ? trace.attempts.filter(isRecord) : [];
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeAddress(value) {
  const raw = String(value || "").trim();
  if (!EVM_ADDRESS.test(raw)) return null;
  return raw.toLowerCase();
}

function firstString(...candidates) {
  for (const value of candidates) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function violation(code, message, extra = {}) {
  return { code, message, ...extra };
}

function advertisedAssetOf(trace) {
  return normalizeAddress(
    firstString(trace?.advertisedAsset, trace?.challengeAsset, CANONICAL_BASE_USDC),
  ) || CANONICAL_BASE_USDC.toLowerCase();
}

function payloadAssetOf(trace, attempts) {
  const fromAttempts = attempts.map((attempt) => attempt.payloadAsset);
  return firstString(
    trace?.payloadAsset,
    trace?.paymentIdentity?.asset,
    ...fromAttempts,
  );
}

function extraNameOf(trace, attempts) {
  return firstString(
    trace?.payloadAssetName,
    trace?.paymentIdentity?.extra?.name,
    ...attempts.map((attempt) => attempt.payloadAssetName),
  );
}

function extraVersionOf(trace, attempts) {
  return firstString(
    trace?.payloadAssetVersion,
    trace?.paymentIdentity?.extra?.version,
    ...attempts.map((attempt) => attempt.payloadAssetVersion),
  );
}

function advertisedNameOf(trace) {
  return firstString(
    trace?.advertisedAssetName,
    trace?.paymentIdentity?.advertisedExtra?.name,
    CANONICAL_ASSET_NAME,
  );
}

function advertisedVersionOf(trace) {
  return firstString(
    trace?.advertisedAssetVersion,
    trace?.paymentIdentity?.advertisedExtra?.version,
    CANONICAL_ASSET_VERSION,
  );
}

function paidAttempts(attempts) {
  return attempts.filter((attempt) => {
    if (attempt.paymentPresent === false || attempt.phase === "unpaid") return false;
    return attempt.paymentPresent === true
      || Boolean(attempt.payloadAsset)
      || Number(attempt.httpStatus) !== 402
      || numberOrZero(attempt.settleDelta) > 0;
  });
}

function attemptSucceeded(attempt) {
  const status = Number(attempt.httpStatus);
  return status >= 200 && status < 300 && attempt.hasPaymentResponse === true;
}

/**
 * A payload is the wrong asset when its ERC-20 address is not the advertised
 * canonical Base USDC, or when the EIP-712 token domain (name/version) drifted.
 */
export function classifyAsset(trace = {}) {
  const attempts = attemptsOf(trace);
  const advertisedAsset = advertisedAssetOf(trace);
  const payloadRaw = payloadAssetOf(trace, attempts);
  const payloadAsset = normalizeAddress(payloadRaw);
  const advertisedName = advertisedNameOf(trace);
  const advertisedVersion = advertisedVersionOf(trace);
  const payloadName = extraNameOf(trace, attempts);
  const payloadVersion = extraVersionOf(trace, attempts);
  const addressWrong = Boolean(payloadRaw) && payloadAsset !== advertisedAsset;
  const unparseable = Boolean(payloadRaw) && payloadAsset == null;
  const nameWrong = Boolean(payloadName) && payloadName !== advertisedName;
  const versionWrong = Boolean(payloadVersion) && payloadVersion !== advertisedVersion;
  const networkWrong = Boolean(trace.paymentIdentity?.network)
    && String(trace.paymentIdentity.network) !== (trace.advertisedNetwork || NETWORK);
  const wrong = addressWrong || unparseable || nameWrong || versionWrong;
  return {
    advertisedAsset,
    advertisedName,
    advertisedVersion,
    payloadAsset: payloadAsset || payloadRaw,
    payloadName,
    payloadVersion,
    addressWrong: addressWrong || unparseable,
    nameWrong,
    versionWrong,
    networkWrong,
    wrong,
  };
}

/**
 * Evaluate one x402 payment-identity trace.
 * Wrong-asset payloads must never invoke facilitator /settle and must not
 * be treated as a paid success.
 */
export function evaluateTrace(trace = {}) {
  const violations = [];
  const attempts = attemptsOf(trace);
  const settleFromAttempts = attempts.reduce((sum, attempt) => sum + numberOrZero(attempt.settleDelta), 0);
  const declaredSettle = trace.settleCount == null ? settleFromAttempts : numberOrZero(trace.settleCount);
  const settleCount = Math.max(settleFromAttempts, declaredSettle);
  const boundary = isRecord(trace.boundary) ? trace.boundary : {};
  const claims = isRecord(trace.claims) ? trace.claims : {};
  const asset = classifyAsset(trace);
  const kind = String(trace.kind || (asset.wrong ? "wrong-asset" : "canonical-control"));

  if (boundary.paymentSent === true) {
    violations.push(violation("payment_sent", "trace sent a live payment; wrong-asset fixtures must not pay"));
  }
  if (boundary.liveFacilitator === true || (boundary.facilitatorUrl && !loopbackUrl(boundary.facilitatorUrl))) {
    violations.push(violation(
      "live_facilitator",
      "trace used a non-loopback facilitator; this suite never settles on xpay/CDP",
    ));
  }
  if (boundary.published === true) {
    violations.push(violation("published", "trace published or deployed; this suite is local loopback only"));
  }
  if (boundary.neoTouched === true) {
    violations.push(violation("neo_touched", "trace touched neomorphic-io; this suite must not"));
  }
  if (trace.settleCount != null && settleFromAttempts !== declaredSettle && attempts.length > 0) {
    violations.push(violation(
      "settle_count_inconsistent",
      `declared settleCount ${declaredSettle} does not match attempt settleDelta sum ${settleFromAttempts}`,
    ));
  }

  for (const attempt of attempts) {
    const settleDelta = numberOrZero(attempt.settleDelta);
    const unpaid = attempt.phase === "unpaid" || attempt.paymentPresent === false;
    if (unpaid && settleDelta > 0) {
      violations.push(violation("unpaid_settle", "unpaid 402 must not call facilitator settle", { seq: attempt.seq }));
    }
  }

  const paid = paidAttempts(attempts);
  if (asset.wrong) {
    if (settleCount > 0) {
      violations.push(violation(
        "wrong_asset_settled",
        "facilitator settle ran for a payload whose asset is not the advertised canonical Base USDC",
        {
          advertisedAsset: asset.advertisedAsset,
          payloadAsset: asset.payloadAsset,
          settleCount,
        },
      ));
    }
    for (const attempt of paid) {
      if (attemptSucceeded(attempt) || attempt.charged === true) {
        violations.push(violation(
          "wrong_asset_delivered",
          "wrong-asset payment was treated as a paid success",
          { seq: attempt.seq, httpStatus: attempt.httpStatus },
        ));
      }
    }
    if (claims.ok === true || claims.settled === true) {
      violations.push(violation(
        "seeded_lie_wrong_asset_ok",
        "product claimed ok/settled while the payload asset is not canonical Base USDC",
      ));
    }
  } else if (kind === "canonical-control" || trace.mustSettle === true) {
    if (settleCount !== 1) {
      violations.push(violation(
        "control_did_not_settle",
        `canonical USDC control must settle exactly once; settleCount=${settleCount}`,
      ));
    }
  }

  const primary = violations[0];
  const ok = violations.length === 0 && attempts.length > 0;
  return {
    ok,
    code: violations.length === 0 ? "guard-holds" : primary.code,
    id: trace.id ?? null,
    expect: trace.expect ?? null,
    rejectCode: trace.rejectCode ?? null,
    kind,
    settleCount,
    verifyCount: numberOrZero(trace.verifyCount),
    asset,
    violations,
    claimsRejected: Boolean(claims.ok === true || claims.settled === true) && violations.length > 0,
    boundary: {
      paymentSent: boundary.paymentSent === true,
      liveFacilitator: boundary.liveFacilitator === true,
      checkoutMutated: boundary.checkoutMutated === true,
      published: boundary.published === true,
      neoTouched: boundary.neoTouched === true,
    },
  };
}

export function classifyFixture(fixture) {
  const evaluated = evaluateTrace(fixture);
  const expect = fixture?.expect;
  if (expect === "pass") {
    return {
      ...evaluated,
      classified: evaluated.ok,
      verdict: evaluated.ok ? "pass" : "fail",
    };
  }
  if (expect === "reject") {
    const codeOk = !fixture.rejectCode
      || evaluated.code === fixture.rejectCode
      || evaluated.violations.some((item) => item.code === fixture.rejectCode);
    const classified = evaluated.ok === false && codeOk;
    return {
      ...evaluated,
      classified,
      verdict: evaluated.ok ? "accepted" : "rejected",
      ok: classified,
    };
  }
  return {
    ...evaluated,
    classified: false,
    verdict: "malformed_fixture",
    ok: false,
    code: "malformed_fixture",
  };
}

export function evaluateColdSuite(scenarios = []) {
  const rows = scenarios.map((scenario) => {
    const evaluated = evaluateTrace(scenario);
    return {
      id: scenario.id,
      rail: scenario.rail ?? "x402",
      kind: evaluated.kind,
      ok: evaluated.ok,
      code: evaluated.code,
      settleCount: evaluated.settleCount,
      verifyCount: evaluated.verifyCount,
      asset: evaluated.asset,
      violations: evaluated.violations,
      attempts: scenario.attempts,
      origin: scenario.origin ?? null,
    };
  });
  const failed = rows.filter((row) => !row.ok);
  const settleCounts = rows.map((row) => row.settleCount);
  const paymentSent = scenarios.some((scenario) => scenario.boundary?.paymentSent === true);
  const control = rows.filter((row) => row.kind === "canonical-control");
  const wrong = rows.filter((row) => row.kind !== "canonical-control");
  if (control.length === 0) {
    failed.push({
      id: "missing-canonical-control",
      code: "control_did_not_settle",
      violations: [violation("control_did_not_settle", "cold suite must include a canonical USDC control that settles once")],
    });
  }
  if (wrong.length === 0) {
    failed.push({
      id: "missing-wrong-asset",
      code: "no_wrong_asset_scenario",
      violations: [violation("no_wrong_asset_scenario", "cold suite must include a wrong-asset payload that never settles")],
    });
  }
  const controlMiss = control.filter((row) => row.settleCount !== 1);
  const wrongSettled = wrong.filter((row) => row.settleCount > 0);
  return {
    ok: failed.length === 0
      && rows.length > 0
      && !paymentSent
      && controlMiss.length === 0
      && wrongSettled.length === 0,
    code: failed[0]?.code
      ?? (controlMiss[0] ? "control_did_not_settle" : wrongSettled[0] ? "wrong_asset_settled" : rows.length ? "guard-holds" : "no_scenarios"),
    mode: "cold",
    artifact: "server.js",
    counted: rows.length,
    passed: rows.filter((row) => row.ok).length,
    failed: failed.map((row) => ({ id: row.id, code: row.code, violations: row.violations })),
    settleCounts,
    paymentSent,
    scenarios: rows,
  };
}

export function evaluateFixtureCorpus(passFixtures, rejectFixtures) {
  const pass = passFixtures.map((entry) => ({
    id: entry.id,
    path: entry.relativePath,
    expect: "pass",
    ...classifyFixture(entry.fixture),
  }));
  const reject = rejectFixtures.map((entry) => ({
    id: entry.id,
    path: entry.relativePath,
    expect: "reject",
    rejectCode: entry.rejectCode,
    ...classifyFixture(entry.fixture),
  }));
  const rows = [...pass, ...reject];
  const failed = rows.filter((row) => row.classified !== true);
  return {
    ok: failed.length === 0 && rows.length > 0,
    code: failed[0]?.code ?? "fixtures-match",
    counted: rows.length,
    passed: rows.filter((row) => row.classified).length,
    failed: failed.map((row) => ({
      id: row.id,
      path: row.path,
      expect: row.expect,
      code: row.code,
      verdict: row.verdict,
    })),
    rows,
  };
}
