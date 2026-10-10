import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { parseAtomicAmount, parseCount } from "../src/counts.mjs";
import { reportedCalls } from "../src/construct.mjs";
import { observeCall, observeFilterHonor } from "../src/observe.mjs";
import { FROZEN_SERVICE, SOURCE } from "../src/pins.mjs";
import { assessValue, DIALECT, VALIDATOR } from "../src/value-schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const fullGet = JSON.parse(readFileSync(join(root, "fixtures/full-get-constructible.json"), "utf8"));
const DIGIT52 = `1${"0".repeat(51)}`;
const NINES52 = "9".repeat(52);
const PAY = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const OTHER = "0x1111111111111111111111111111111111111111";

function payment(amount = "5000", payTo = PAY) {
  return {
    scheme: "exact",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount,
    payTo,
  };
}

function queryCall(querySchema, queryExample, extra = {}) {
  return {
    status: 200,
    partialResults: false,
    url: extra.url || `${SOURCE.searchUrl}?query=synthetic&type=http&limit=20`,
    itemCount: extra.itemCount,
    resources: [
      {
        resource: extra.resource || FROZEN_SERVICE,
        quality: extra.quality,
        accepts: extra.accepts || [payment(extra.amount, extra.payTo)],
        extensions: {
          bazaar: {
            info: {
              input: {
                type: "http",
                method: "GET",
                queryParams: queryExample,
              },
            },
            schema: {
              $schema: extra.dialect === undefined ? DIALECT : extra.dialect,
              type: "object",
              properties: {
                input: {
                  type: "object",
                  properties: { queryParams: querySchema },
                },
              },
            },
          },
        },
      },
    ],
  };
}

function bodyCall(bodySchema, bodyExample, method = "POST") {
  return {
    status: 200,
    partialResults: false,
    url: `${SOURCE.searchUrl}?query=synthetic&type=http&limit=20`,
    resources: [
      {
        resource: FROZEN_SERVICE,
        accepts: [payment()],
        extensions: {
          bazaar: {
            info: {
              input: {
                type: "http",
                method,
                bodyType: "json",
                body: bodyExample,
              },
            },
            schema: {
              $schema: DIALECT,
              type: "object",
              properties: {
                input: {
                  type: "object",
                  properties: { body: bodySchema },
                },
              },
            },
          },
        },
      },
    ],
  };
}

const urlSchema = {
  type: "object",
  properties: { url: { type: "string" } },
  required: ["url"],
  additionalProperties: false,
};

test("known counts keep zero distinct and reject unsafe values", () => {
  assert.deepEqual(parseCount(0), { state: "measured", value: 0, reason: null });
  assert.deepEqual(parseCount("0"), { state: "measured", value: 0, reason: null });
  assert.equal(parseCount(undefined).state, "unknown");
  assert.equal(parseCount(null).state, "unknown");
  for (const value of [-1, 0.5, 9007199254740992, DIGIT52, NINES52, "1e52", "00", "-1"]) {
    const parsed = parseCount(value);
    assert.equal(parsed.state, "invalid", String(value));
    assert.equal(parsed.value, null, String(value));
  }
  assert.equal(parseCount(DIGIT52).reason, "overflow");
  assert.equal(parseCount(NINES52).reason, "overflow");
  assert.equal(Number(NINES52), 1e52);
  assert.equal(parseCount("9007199254740991").state, "measured");
  assert.equal(parseCount("9007199254740992").state, "invalid");
  assert.equal(parseAtomicAmount(DIGIT52).state, "exact");
  assert.equal(parseAtomicAmount(DIGIT52).value, DIGIT52);
  assert.equal(parseAtomicAmount("5.0").state, "invalid");
  assert.equal(parseAtomicAmount(0.5).state, "invalid");
});

test("reported calls do not measure a negative or overflow count", () => {
  for (const value of [-1, 0.5, 9007199254740992, DIGIT52, NINES52]) {
    const calls = reportedCalls({ quality: { l30DaysTotalCalls: value } });
    assert.equal(calls.state, "invalid");
    assert.equal(calls.value, null);
  }
  const zero = reportedCalls({ quality: { l30DaysTotalCalls: "0" } });
  assert.equal(zero.state, "measured");
  assert.equal(zero.value, "0");
  const missing = reportedCalls({ quality: {} });
  assert.equal(missing.state, "unknown");
  assert.equal(missing.value, null);
});

test("a declared unsafe count stays invalid and is not a measured zero", () => {
  const observation = observeCall({
    status: 200,
    itemCount: -1,
    pagination: { total: 0.5 },
    resources: [],
  }, { serviceUrl: FROZEN_SERVICE });
  assert.equal(observation.coverage.declaredReturnedCount, "invalid");
  assert.equal(observation.coverage.countState, "invalid");
  assert.equal(observation.coverage.uninspectedCount, "unknown");
  assert.equal(observation.coverage.measuredZero, false);
  assert.equal(observation.coverage.reportedPageTotal, "invalid");
  assert.equal(observation.coverage.inspectedCount, 0);
  for (const itemCount of [-1, 0.5, 9007199254740992, NINES52]) {
    const coerced = observeCall({
      status: 200,
      itemCount,
      pagination: { total: itemCount },
      resources: [{ resource: "https://example.test/a", accepts: [], quality: { l30DaysTotalCalls: itemCount } }],
    }, { serviceUrl: FROZEN_SERVICE });
    assert.equal(coerced.coverage.declaredReturnedCount, "invalid", String(itemCount));
    assert.equal(coerced.coverage.reportedPageTotal, "invalid", String(itemCount));
    assert.equal(coerced.coverage.measuredZero, false, String(itemCount));
    assert.equal(coerced.rows[0].reportedCalls.state, "invalid", String(itemCount));
    assert.equal(coerced.rows[0].reportedCalls.value, null, String(itemCount));
    const coverageText = JSON.stringify(coerced.coverage);
    assert.equal(coverageText.includes("1e+52"), false, String(itemCount));
    assert.equal(coverageText.includes("1e+51"), false, String(itemCount));
  }
});

test("a body whose declared count contradicts its rows is a conflict", () => {
  const observation = observeCall({
    status: 200,
    itemCount: 2,
    resources: [
      { resource: "https://example.test/1", accepts: [] },
      { resource: "https://example.test/2", accepts: [] },
      { resource: "https://example.test/3", accepts: [] },
    ],
  }, { serviceUrl: FROZEN_SERVICE });
  assert.equal(observation.coverage.countConflict, true);
  assert.equal(observation.coverage.declaredReturnedCount, 2);
  assert.equal(observation.coverage.inspectedCount, 3);
  assert.equal(observation.coverage.uninspectedCount, "unknown");
  assert.equal(observation.coverage.measuredZero, false);
});

test("string and numeric zero counts are measured on an empty body", () => {
  for (const itemCount of [0, "0"]) {
    const observation = observeCall({
      status: 200,
      itemCount,
      resources: [],
    }, { serviceUrl: FROZEN_SERVICE });
    assert.equal(observation.coverage.declaredReturnedCount, 0);
    assert.equal(observation.coverage.measuredZero, true);
    assert.equal(observation.coverage.countState, "measured");
    assert.equal(observation.coverage.countConflict, false);
  }
});

test("wrong url examples are fields without a valid constructed request", () => {
  for (const value of [42, null, {}, false]) {
    const body = structuredClone(fullGet);
    body.resources[0].extensions.bazaar.info.input.queryParams.url = value;
    const observation = observeCall(body, { serviceUrl: FROZEN_SERVICE });
    const row = observation.rows[0];
    assert.equal(row.input.fieldsAvailable, true, JSON.stringify(value));
    assert.equal(row.input.valueSchemaValid, false, JSON.stringify(value));
    assert.equal(row.input.applicationConstructible, false, JSON.stringify(value));
    assert.equal(row.requestConstructible, false, JSON.stringify(value));
    assert.equal(row.constructedRequest, null, JSON.stringify(value));
    assert.equal(row.input.gaps.some((gap) => gap.includes("value-schema-invalid") && gap.endsWith(":type")), true);
  }
});

test("a supported GET example is inspectable and is not an official live read", () => {
  const observation = observeCall(fullGet, {
    serviceUrl: FROZEN_SERVICE,
    observedAt: "2026-10-10T18:32:35Z",
  });
  const row = observation.rows[0];
  assert.equal(row.input.fieldsAvailable, true);
  assert.equal(row.input.valueSchemaValid, true);
  assert.equal(row.input.applicationConstructible, true);
  assert.equal(row.input.schemaDialectAssumed, false);
  assert.equal(row.input.validator.package, "ajv");
  assert.equal(row.input.validator.version, VALIDATOR.version);
  assert.equal(row.input.validator.license, "MIT");
  assert.equal(row.input.validator.coerceTypes, false);
  assert.equal(row.input.validator.useDefaults, false);
  assert.equal(row.requestConstructible, true);
  assert.deepEqual(row.constructedRequest, {
    method: "GET",
    query: { url: "https://example.com" },
    body: null,
    bodyType: null,
    invoked: false,
    paid: false,
  });
  assert.equal(row.invoked, false);
  assert.equal(row.paid, false);
  assert.equal(row.payment.amount, "5000");
  assert.equal(row.payment.complete, true);
  assert.equal(observation.source.officialLiveRead, false);
  assert.equal(observation.source.networkSent, false);
  assert.equal(observation.provenance.officialLiveRead, false);
  assert.equal(observation.provenance.networkSent, false);
  assert.equal(observation.provenance.kind, "supplied-body");
  assert.equal(observation.provenance.pinnedRouteMatch, true);
});

test("blank payment identity is invalid and not a constructed request", () => {
  const body = structuredClone(fullGet);
  const accept = body.resources[0].accepts[0];
  for (const key of ["scheme", "network", "asset", "amount", "payTo"]) accept[key] = "";
  const observation = observeCall(body, { serviceUrl: FROZEN_SERVICE });
  const row = observation.rows[0];
  assert.equal(row.input.applicationConstructible, true);
  assert.equal(row.payment.complete, false);
  assert.equal(row.payment.state, "invalid");
  assert.equal(row.payment.amount, null);
  assert.equal(row.payment.payTo, null);
  assert.equal(row.requestConstructible, false);
  assert.equal(row.constructedRequest.query.url, "https://example.com");
  assert.equal(row.constructedRequest.invoked, false);
  assert.equal(row.constructedRequest.paid, false);
});

test("whitespace payment identity is invalid", () => {
  const body = structuredClone(fullGet);
  body.resources[0].accepts[0].payTo = "   ";
  const row = observeCall(body, { serviceUrl: FROZEN_SERVICE }).rows[0];
  assert.equal(row.payment.state, "invalid");
  assert.equal(row.payment.complete, false);
  assert.equal(row.requestConstructible, false);
});

test("an exact atomic amount keeps its string past the safe integer boundary", () => {
  const huge = "123456789012345678901";
  const observation = observeCall(queryCall(urlSchema, { url: "https://example.com" }, { amount: huge }), {
    serviceUrl: FROZEN_SERVICE,
  });
  const row = observation.rows[0];
  assert.equal(row.payment.amount, huge);
  assert.equal(row.payment.units, "source-atomic");
  assert.equal(row.payment.complete, true);
  assert.equal(row.payment.state, "single");
  assert.equal(row.requestConstructible, true);
  assert.equal(JSON.stringify(row.payment).includes("1.2345678901234568e+20"), false);
});

test("the same network and asset with two amounts stays contradictory", () => {
  const observation = observeCall(queryCall(urlSchema, { url: "https://example.com" }, {
    accepts: [payment("5000"), payment("9000")],
  }), { serviceUrl: FROZEN_SERVICE });
  const paymentRow = observation.rows[0].payment;
  assert.equal(paymentRow.state, "contradictory");
  assert.equal(paymentRow.collapsed, false);
  assert.equal(paymentRow.complete, false);
  assert.equal(paymentRow.identities[0].amount, "5000");
  assert.equal(paymentRow.identities[1].amount, "9000");
  assert.equal(observation.rows[0].requestConstructible, false);
});

test("enum and nested required values construct only when they validate", () => {
  const nested = {
    type: "object",
    additionalProperties: false,
    required: ["page"],
    properties: {
      page: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          url: { type: "string", enum: ["https://example.com", "https://example.org"] },
        },
      },
    },
  };
  const good = observeCall(bodyCall(nested, { page: { url: "https://example.com" } }), {
    serviceUrl: FROZEN_SERVICE,
  });
  const goodRow = good.rows[0];
  assert.equal(goodRow.input.valueSchemaValid, true);
  assert.equal(goodRow.requestConstructible, true);
  assert.deepEqual(goodRow.constructedRequest.body, { page: { url: "https://example.com" } });
  assert.equal(goodRow.constructedRequest.bodyType, "json");
  assert.equal(goodRow.constructedRequest.invoked, false);
  assert.equal(goodRow.constructedRequest.paid, false);
  assert.equal(good.source.networkSent, false);

  const wrongType = observeCall(bodyCall(nested, { page: { url: 42 } }), { serviceUrl: FROZEN_SERVICE });
  assert.equal(wrongType.rows[0].input.fieldsAvailable, true);
  assert.equal(wrongType.rows[0].input.valueSchemaValid, false);
  assert.equal(wrongType.rows[0].requestConstructible, false);
  assert.equal(wrongType.rows[0].constructedRequest, null);

  const wrongEnum = observeCall(bodyCall(nested, { page: { url: "https://nope.example" } }), {
    serviceUrl: FROZEN_SERVICE,
  });
  assert.equal(wrongEnum.rows[0].input.valueSchemaValid, false);
  assert.equal(wrongEnum.rows[0].input.gaps.some((gap) => gap.endsWith(":enum")), true);
});

test("defaults and schema examples are not copied into the request", () => {
  const secret = "super-secret";
  const schema = {
    type: "object",
    properties: {
      apiKey: { type: "string", default: secret },
      url: { type: "string", example: "https://from-schema.example" },
    },
    required: ["apiKey", "url"],
  };
  const observation = observeCall(queryCall(schema, {}), { serviceUrl: FROZEN_SERVICE });
  const row = observation.rows[0];
  assert.equal(row.input.fieldsAvailable, false);
  assert.equal(row.input.applicationConstructible, false);
  assert.equal(row.input.gaps.includes("secret-default-not-applied:apiKey"), true);
  assert.equal(row.input.gaps.includes("example-not-applied:url"), true);
  assert.equal(row.constructedRequest, null);
  assert.equal(JSON.stringify(observation).includes(secret), false);
  assert.equal(JSON.stringify(observation).includes("https://from-schema.example"), false);

  const supplied = observeCall(queryCall({
    type: "object",
    properties: { url: { type: "string", default: "https://from-default.example" } },
    required: ["url"],
  }, { url: "https://caller.example" }), { serviceUrl: FROZEN_SERVICE });
  assert.equal(supplied.rows[0].constructedRequest.query.url, "https://caller.example");
  assert.equal(JSON.stringify(supplied).includes("https://from-default.example"), false);
});

test("unsupported constraints and dialects stay unknown", () => {
  const formatSchema = {
    type: "object",
    properties: { url: { type: "string", format: "uri" } },
    required: ["url"],
  };
  const formatted = observeCall(queryCall(formatSchema, { url: "https://example.com" }), {
    serviceUrl: FROZEN_SERVICE,
  });
  assert.equal(formatted.rows[0].input.valueSchemaValid, "unknown");
  assert.equal(formatted.rows[0].input.applicationConstructible, "unknown");
  assert.equal(formatted.rows[0].input.gaps.includes("unsupported-constraint:format"), true);
  assert.equal(formatted.rows[0].requestConstructible, false);

  const foreign = observeCall(queryCall(urlSchema, { url: "https://example.com" }, {
    dialect: "https://json-schema.org/draft-07/schema",
  }), { serviceUrl: FROZEN_SERVICE });
  assert.equal(foreign.rows[0].input.valueSchemaValid, "unknown");
  assert.equal(foreign.rows[0].input.applicationConstructible, "unknown");
  assert.equal(foreign.rows[0].input.gaps[0].startsWith("unsupported-dialect:"), true);
  assert.equal(foreign.rows[0].requestConstructible, false);

  const open = assessValue(true, { url: "https://example.com" }, { dialect: DIALECT });
  assert.equal(open.valueSchemaValid, "unknown");
  assert.equal(open.applicationConstructible, "unknown");
  assert.equal(open.gaps.includes("unconstrained-schema"), true);
  const closed = assessValue(false, { url: "https://example.com" }, { dialect: DIALECT });
  assert.equal(closed.valueSchemaValid, false);
  assert.equal(closed.applicationConstructible, false);
});

test("an unsupported origin is not an official live read", () => {
  const observation = observeCall(queryCall(urlSchema, { url: "https://example.com" }, {
    url: "https://example.invalid/discovery/search?query=synthetic",
  }), { serviceUrl: FROZEN_SERVICE });
  assert.equal(observation.provenance.pinnedRouteMatch, false);
  assert.equal(observation.provenance.officialLiveRead, false);
  assert.equal(observation.provenance.networkSent, false);
  assert.equal(observation.source.officialLiveRead, false);
  assert.equal(observation.source.liveQueryIssued, false);
  assert.equal(observation.rows[0].requestConstructible, true);
  assert.equal(observation.rows[0].invoked, false);
});

test("a returned payTo outside the filter is the only unhonored page", () => {
  const baseline = {
    status: 200,
    bytes: 100,
    url: `${SOURCE.listUrl}?type=http&limit=20&offset=0`,
    pagination: { total: 2 },
    items: [{ resource: "https://example.test/a", accepts: [payment("5000", PAY)] }],
  };
  const outside = {
    status: 200,
    bytes: 100,
    url: `${SOURCE.listUrl}?type=http&limit=20&offset=0&payTo=${PAY}`,
    pagination: { total: 2 },
    items: [{ resource: "https://example.test/a", payTo: OTHER }],
  };
  const match = {
    ...outside,
    items: [{ resource: "https://example.test/a", payTo: PAY, payToMatchesDefault: false }],
  };
  const contradicted = observeFilterHonor(baseline, outside, "payTo");
  assert.equal(contradicted.pageUnchanged, true);
  assert.equal(contradicted.honored, false);
  assert.equal(contradicted.reason, "returned-identity-outside-filter");
  assert.equal(contradicted.identityContradiction, true);
  assert.equal(contradicted.documentedOnCdpList, false);
  const matched = observeFilterHonor(baseline, match, "payTo");
  assert.equal(matched.honored, "unknown");
  assert.equal(matched.reason, "page-unchanged-identities-match-filter");
  assert.equal(matched.pageUnchanged, true);
});
