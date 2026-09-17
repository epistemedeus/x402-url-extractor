/**
 * Pure fixture evaluation. A negative tools/call that was accepted is never a pass.
 */

export function evaluateToolsList(listed, fixture) {
  const tools = Array.isArray(listed?.tools) ? listed.tools : [];
  const names = tools.map((tool) => tool.name).filter((name) => typeof name === "string");
  const missing = (fixture.mustInclude ?? []).filter((name) => !names.includes(name));
  const forbiddenPresent = (fixture.mustExclude ?? []).filter((name) => names.includes(name));
  const countOk = fixture.count == null || names.length === fixture.count;
  const schemaType = fixture.inputSchemaType ?? "object";
  const schemaFailures = tools
    .filter((tool) => !tool?.inputSchema || tool.inputSchema.type !== schemaType)
    .map((tool) => tool?.name ?? "(unnamed)");

  const ok =
    missing.length === 0 && forbiddenPresent.length === 0 && countOk && schemaFailures.length === 0;

  return {
    ok,
    method: "tools/list",
    names: [...names].sort(),
    count: names.length,
    missing,
    forbiddenPresent,
    schemaFailures,
    reason: ok
      ? "ordinary discovery matched the negative-call catalog fixture"
      : [
          missing.length ? `missing tools: ${missing.join(", ")}` : null,
          forbiddenPresent.length ? `forbidden tools present: ${forbiddenPresent.join(", ")}` : null,
          countOk ? null : `expected ${fixture.count} tools, got ${names.length}`,
          schemaFailures.length ? `tools missing object inputSchema: ${schemaFailures.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("; "),
  };
}

export function evaluateNegativeCase(fixtureCase, observation, counters = {}) {
  if (!fixtureCase || typeof fixtureCase !== "object") {
    return { ok: false, reason: "negative fixture case is missing" };
  }
  if (fixtureCase.expect && fixtureCase.expect !== "rejected") {
    return {
      ok: false,
      id: fixtureCase.id,
      reason: `negative tools/call fixture ${fixtureCase.id} must expect "rejected" (got ${JSON.stringify(fixtureCase.expect)})`,
    };
  }
  if (!observation?.rejected) {
    return {
      ok: false,
      id: fixtureCase.id,
      seededFailure: fixtureCase.seededFailure === true,
      reason: `negative tools/call ${fixtureCase.id} (${fixtureCase.name}) must be rejected; surface accepted it`,
      observation,
    };
  }
  if (fixtureCase.expectedLayer && observation.layer !== fixtureCase.expectedLayer) {
    return {
      ok: false,
      id: fixtureCase.id,
      seededFailure: fixtureCase.seededFailure === true,
      reason: `negative tools/call ${fixtureCase.id} expected layer ${fixtureCase.expectedLayer}, got ${observation.layer}`,
      observation,
    };
  }
  if (fixtureCase.expectedCode != null && observation.code !== fixtureCase.expectedCode) {
    return {
      ok: false,
      id: fixtureCase.id,
      seededFailure: fixtureCase.seededFailure === true,
      reason: `negative tools/call ${fixtureCase.id} expected code ${fixtureCase.expectedCode}, got ${observation.code}`,
      observation,
    };
  }
  if (fixtureCase.mustNotRunHandler === true && counters.handler > 0) {
    return {
      ok: false,
      id: fixtureCase.id,
      seededFailure: fixtureCase.seededFailure === true,
      reason: `negative tools/call ${fixtureCase.id} ran the paid handler`,
      observation,
    };
  }
  if (fixtureCase.mustNotSettle === true && counters.settle > 0) {
    return {
      ok: false,
      id: fixtureCase.id,
      seededFailure: fixtureCase.seededFailure === true,
      reason: `negative tools/call ${fixtureCase.id} settled; negative fixtures must not settle`,
      observation,
    };
  }
  if (fixtureCase.mustNotVerify === true && counters.verify > 0) {
    return {
      ok: false,
      id: fixtureCase.id,
      seededFailure: fixtureCase.seededFailure === true,
      reason: `negative tools/call ${fixtureCase.id} reached facilitator verify`,
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

export function evaluateNegativeSuite(fixture, observationsById, countersById = {}) {
  if (fixture.expect !== "rejected") {
    return {
      ok: false,
      reason: 'negative-tools-call fixture must declare expect: "rejected"',
      cases: [],
    };
  }
  const cases = [];
  for (const fixtureCase of fixture.cases ?? []) {
    cases.push(
      evaluateNegativeCase(fixtureCase, observationsById[fixtureCase.id], countersById[fixtureCase.id] ?? {}),
    );
  }
  const failed = cases.filter((item) => !item.ok);
  const seeded = cases.find((item) => item.seededFailure);
  return {
    ok: failed.length === 0 && cases.length > 0,
    method: "tools/call",
    expect: "rejected",
    passed: cases.filter((item) => item.ok).length,
    total: cases.length,
    seededFailure: seeded
      ? {
          id: seeded.id,
          rejected: seeded.ok === true,
          reason: seeded.reason,
          layer: seeded.observation?.layer ?? null,
          code: seeded.observation?.code ?? null,
          message: seeded.observation?.message ?? null,
        }
      : null,
    cases,
    reason:
      failed.length === 0
        ? `all ${cases.length} negative tools/call fixtures were rejected`
        : `${failed.length}/${cases.length} negative tools/call fixtures were not rejected`,
  };
}
