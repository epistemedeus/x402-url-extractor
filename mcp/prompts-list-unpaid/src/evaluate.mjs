import { classifyPaymentRequired } from "./classify.mjs";

function promptHasForbiddenPayment(prompt, keys) {
  if (!prompt || typeof prompt !== "object") return true;
  for (const key of keys) {
    if (Object.hasOwn(prompt, key)) return true;
    if (prompt._meta && typeof prompt._meta === "object" && Object.hasOwn(prompt._meta, key)) return true;
  }
  return Boolean(prompt._meta?.x402);
}

export function evaluatePromptsList(listed, fixture, { payment = { paymentRequired: false } } = {}) {
  if (fixture?.paymentRequired === true) {
    return {
      ok: false,
      method: "prompts/list",
      reason: "prompts/list fixture must declare paymentRequired false",
    };
  }
  if (payment?.paymentRequired === true) {
    return {
      ok: false,
      method: "prompts/list",
      paymentRequired: true,
      names: [],
      count: 0,
      reason: `prompts/list required payment (${payment.reason || "challenge"})`,
    };
  }

  const prompts = Array.isArray(listed?.prompts) ? listed.prompts : [];
  const names = prompts.map((prompt) => prompt?.name).filter((name) => typeof name === "string");
  const missing = (fixture.mustInclude ?? []).filter((name) => !names.includes(name));
  const forbiddenPresent = (fixture.mustExclude ?? []).filter((name) => names.includes(name));
  const countOk = fixture.count == null || names.length === fixture.count;
  const paymentKeys = fixture.forbiddenPaymentKeys ?? [];
  const paymentBearing = prompts.filter((prompt) => promptHasForbiddenPayment(prompt, paymentKeys)).map((prompt) => prompt?.name ?? "(unnamed)");

  const ok = missing.length === 0 && forbiddenPresent.length === 0 && countOk && paymentBearing.length === 0;

  return {
    ok,
    method: "prompts/list",
    paymentRequired: false,
    names: [...names],
    count: names.length,
    missing,
    forbiddenPresent,
    paymentBearing,
    reason: ok
      ? "unpaid prompts/list matched the public skill catalog"
      : [
          missing.length ? `missing prompts: ${missing.join(", ")}` : null,
          forbiddenPresent.length ? `forbidden prompts present: ${forbiddenPresent.join(", ")}` : null,
          countOk ? null : `expected ${fixture.count} prompts, got ${names.length}`,
          paymentBearing.length ? `prompts advertised payment fields: ${paymentBearing.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("; "),
  };
}

export function evaluateNegativeCase(fixtureCase, observation) {
  if (!fixtureCase || typeof fixtureCase !== "object") {
    return { ok: false, reason: "negative fixture case is missing" };
  }
  if (fixtureCase.expect && fixtureCase.expect !== "rejected") {
    return {
      ok: false,
      id: fixtureCase.id,
      reason: `negative prompts/get fixture ${fixtureCase.id} must expect "rejected" (got ${JSON.stringify(fixtureCase.expect)})`,
    };
  }
  if (observation?.paymentRequired === true && fixtureCase.seededFailure === true) {
    return {
      ok: false,
      id: fixtureCase.id,
      seededFailure: true,
      reason: `seeded prompts/get ${fixtureCase.name} returned a payment challenge; unknown prompts must be protocol-rejected, not billed`,
      observation,
    };
  }
  if (!observation?.rejected) {
    return {
      ok: false,
      id: fixtureCase.id,
      seededFailure: fixtureCase.seededFailure === true,
      reason: `negative prompts/get ${fixtureCase.id} (${fixtureCase.name}) must be rejected; surface accepted it`,
      observation,
    };
  }
  return {
    ok: true,
    id: fixtureCase.id,
    seededFailure: fixtureCase.seededFailure === true,
    name: fixtureCase.name,
    reason: fixtureCase.reason,
    observation,
  };
}

export function evaluateNegativeSuite(fixture, observationsById) {
  if (fixture.expect !== "rejected") {
    return {
      ok: false,
      reason: `negative suite must expect "rejected" (got ${JSON.stringify(fixture.expect)})`,
    };
  }
  const cases = Array.isArray(fixture.cases) ? fixture.cases : [];
  const results = cases.map((fixtureCase) => evaluateNegativeCase(fixtureCase, observationsById[fixtureCase.id]));
  const seededFailure = results.find((item) => item.seededFailure === true) ?? null;
  const failed = results.filter((item) => item.ok !== true);
  return {
    ok: failed.length === 0,
    method: "prompts/get",
    passed: results.filter((item) => item.ok === true).length,
    total: results.length,
    seededFailure,
    results,
    reason: failed.length === 0
      ? "all negative prompts/get cases rejected"
      : failed.map((item) => item.reason).join("; "),
  };
}

export function evaluateRawListHttp(status, payload, headers, fixture) {
  const payment = classifyPaymentRequired(status, payload, headers);
  if (payload?.error && !payload?.result) {
    return {
      ok: false,
      method: "prompts/list",
      httpStatus: status,
      paymentRequired: payment.paymentRequired,
      reason: `raw prompts/list JSON-RPC error ${payload.error.code}: ${payload.error.message}`,
    };
  }
  return {
    ...evaluatePromptsList(payload?.result, fixture, { payment }),
    httpStatus: status,
  };
}
