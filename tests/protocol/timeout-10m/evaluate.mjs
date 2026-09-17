import {
  DEFAULT_MAX_REQUEST_TIMEOUT_SECONDS,
  TEN_MINUTE_MS,
  deriveTimeout,
  resolveMaxRequestTimeoutSeconds,
} from "./derive.mjs";

export function evaluateProductCase(item) {
  if (!item || typeof item !== "object") {
    return { ok: false, status: "fail", reason: "case is missing" };
  }

  if (item.kind === "invalid-cap") {
    let threw = false;
    let message = null;
    try {
      resolveMaxRequestTimeoutSeconds(item.maxRequestTimeoutSeconds);
    } catch (error) {
      threw = true;
      message = String(error?.message || error);
    }
    const paid = item.paid === true;
    const ok = item.expectThrow !== false && threw === true && paid === false;
    return {
      ok,
      status: ok ? "pass" : "fail",
      id: item.id,
      kind: item.kind,
      threw,
      paid: false,
      settled: false,
      reason: ok
        ? `invalid cap ${item.maxRequestTimeoutSeconds} threw and did not pay`
        : `invalid cap ${item.maxRequestTimeoutSeconds} must throw and never pay (threw=${threw}, paid=${paid})`,
      message,
    };
  }

  let derived;
  try {
    derived = deriveTimeout(item);
  } catch (error) {
    return {
      ok: false,
      status: "fail",
      id: item.id,
      kind: item.kind,
      reason: String(error?.message || error),
    };
  }

  const expectMs = item.expectTimeoutMs;
  const timeoutOk = expectMs == null || derived.timeoutMs === expectMs;
  const capOk = item.expectCapped == null || derived.capped === item.expectCapped;
  const tenMinuteOk = item.perCallTimeoutMs !== undefined || derived.timeoutMs <= TEN_MINUTE_MS;
  const paidOk = derived.paid === false && derived.settled === false;
  const ok = timeoutOk && capOk && tenMinuteOk && paidOk;

  return {
    ok,
    status: ok ? "pass" : "fail",
    id: item.id,
    kind: item.kind,
    derived,
    expectTimeoutMs: expectMs ?? null,
    paid: false,
    settled: false,
    reason: ok
      ? item.reason || `derived ${derived.timeoutMs}ms (cap ${derived.capSeconds}s)`
      : [
          timeoutOk ? null : `expected ${expectMs}ms, derived ${derived.timeoutMs}ms`,
          capOk ? null : `expected capped=${item.expectCapped}, got ${derived.capped}`,
          tenMinuteOk ? null : `derived ${derived.timeoutMs}ms exceeds the 10m cap without a per-call override`,
          paidOk ? null : "timeout derivation must not pay or settle",
        ]
          .filter(Boolean)
          .join("; "),
  };
}

export function evaluateSeededClaim(seed) {
  if (!seed || typeof seed !== "object") {
    return { ok: false, status: "missed", kind: "false_accept", reason: "seeded fixture is missing" };
  }

  let derived;
  try {
    derived = deriveTimeout({
      kind: seed.deriveKind ?? (seed.kind === "probe" ? "probe" : "paid-retry"),
      accept: seed.accept,
      maxRequestTimeoutSeconds: seed.maxRequestTimeoutSeconds,
      perCallTimeoutMs: seed.perCallTimeoutMs,
    });
  } catch (error) {
    derived = { timeoutMs: null, capped: false, paid: false, settled: false, error: String(error?.message || error) };
  }

  const claimedTimeoutMs = seed.claimedTimeoutMs;
  const productRejectsClaim = claimedTimeoutMs !== derived.timeoutMs
    || (seed.claimedCapped != null && seed.claimedCapped !== derived.capped)
    || seed.claimedPaid === true
    || seed.claimedSettled === true
    || (claimedTimeoutMs != null && claimedTimeoutMs > TEN_MINUTE_MS && seed.perCallTimeoutMs === undefined);

  if (seed.kind === "false_accept" || seed.expect === "reject") {
    return {
      ok: productRejectsClaim,
      status: productRejectsClaim ? "caught" : "missed",
      id: seed.id,
      kind: seed.kind || "false_accept",
      claimedTimeoutMs,
      derivedTimeoutMs: derived.timeoutMs,
      claimedCapped: seed.claimedCapped ?? null,
      derivedCapped: derived.capped,
      claimedPaid: seed.claimedPaid === true,
      claimedSettled: seed.claimedSettled === true,
      paid: false,
      settled: false,
      reason: productRejectsClaim
        ? seed.reason || `claimed ${claimedTimeoutMs}ms, product derived ${derived.timeoutMs}ms`
        : `seeded claim ${seed.id} was not rejected (claimed ${claimedTimeoutMs}ms matched product)`,
    };
  }

  return {
    ok: false,
    status: "fail",
    id: seed.id,
    reason: `seeded fixture ${seed.id} must be kind false_accept`,
  };
}

export function evaluateCatalog(catalog) {
  const cases = [];
  for (const item of catalog.cases ?? []) {
    cases.push(evaluateProductCase(item));
  }
  const seeded = [];
  for (const seed of catalog.seeded ?? []) {
    seeded.push(evaluateSeededClaim(seed));
  }

  const failed = cases.filter((row) => !row.ok);
  const missed = seeded.filter((row) => row.status === "missed" || !row.ok);
  const caught = seeded.filter((row) => row.status === "caught");
  const capSeconds = catalog.capSeconds ?? DEFAULT_MAX_REQUEST_TIMEOUT_SECONDS;
  const ok = failed.length === 0 && missed.length === 0 && cases.length > 0 && caught.length === seeded.length;

  return {
    ok,
    capSeconds,
    cases,
    seeded,
    counts: {
      total: cases.length + seeded.length,
      pass: cases.filter((row) => row.ok).length,
      fail: failed.length,
      caught: caught.length,
      missed: missed.length,
    },
    reason: ok
      ? `pass ${cases.length} product cases; caught ${caught.length} seeded claims; never paid`
      : [
          failed.length ? `${failed.length} product cases failed` : null,
          missed.length ? `${missed.length} seeded claims missed` : null,
          cases.length ? null : "catalog has no product cases",
        ]
          .filter(Boolean)
          .join("; "),
  };
}

export function seededAsRequiredTruth(seed) {
  const judged = evaluateSeededClaim(seed);
  const derived = judged.derivedTimeoutMs;
  const claimed = judged.claimedTimeoutMs;
  const rejected = judged.status === "caught";
  return {
    ok: false,
    rejected,
    code: "SEED_REJECT",
    kind: seed.kind || "false_accept",
    id: seed.id,
    claimedTimeoutMs: claimed,
    derivedTimeoutMs: derived,
    message: rejected
      ? `seeded false_accept caught: ${seed.id} claimed ${claimed}ms, product derived ${derived}ms`
      : `seeded claim ${seed.id} was not rejected`,
    paid: false,
    settled: false,
  };
}
