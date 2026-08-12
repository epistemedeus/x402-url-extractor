import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PAID_ACTION_EFFECT_PROFILE_PATH,
  READ_ONLY_PAID_POST_OPERATIONS,
  attachPaidActionEffectContracts,
  buildPaidActionEffectProfile,
  isReadOnlyPaidPost,
  paidActionEffectExtension,
  paidActionEffectHeaders,
} from "./paid-action-effect-profile.mjs";

test("publishes one explicit read-only contract for every paid JSON POST route", () => {
  const profile = buildPaidActionEffectProfile({
    origin: "https://agents.samedaydesk.com/path-ignored",
    serviceVersion: "1.23.7",
  });
  assert.equal(profile.status, "experimental");
  assert.equal(profile.service.origin, "https://agents.samedaydesk.com");
  assert.equal(profile.operations.length, 4);
  assert.deepEqual(
    profile.operations.map(({ method, path }) => ({ method, path })),
    READ_ONLY_PAID_POST_OPERATIONS,
  );
  for (const operation of profile.operations) {
    assert.equal(operation.classification, "read_only");
    assert.equal(operation.unpaidRequest.applicationEffects, "none");
    assert.equal(operation.unpaidRequest.telemetryPersisted, false);
    assert.equal(operation.retry.applicationEffectAtMostOnce, "not_applicable_read_only");
  }
  assert.match(profile.interoperability.adoptionClaim, /dogfood only/);
});

test("effect selection and headers are exact method-route bindings", () => {
  assert.equal(isReadOnlyPaidPost("POST", "/commerce/payment-offer-preflight"), true);
  assert.equal(isReadOnlyPaidPost("GET", "/commerce/payment-offer-preflight"), false);
  assert.equal(isReadOnlyPaidPost("POST", "/commerce/payment-offer-preflight/extra"), false);

  const headers = {};
  let nextRuns = 0;
  paidActionEffectHeaders(
    { method: "POST", path: "/commerce/payment-offer-preflight" },
    { set(name, value) { headers[name.toLowerCase()] = value; } },
    () => { nextRuns += 1; },
  );
  assert.equal(nextRuns, 1);
  assert.equal(headers["x-samedaydesk-paid-effect"], "read_only");
  assert.equal(headers["x-samedaydesk-paid-effect-profile"], PAID_ACTION_EFFECT_PROFILE_PATH);
  assert.equal(paidActionEffectExtension().profile, PAID_ACTION_EFFECT_PROFILE_PATH);
});

test("the declared paid POST set matches every payment-gated JSON POST operation", () => {
  const source = readFileSync(new URL("./server.js", import.meta.url), "utf8");
  const routeKeys = [...source.matchAll(/^\s+"POST (\/[^\"]+)": \{$/gm)].map((match) => `POST ${match[1]}`);
  assert.deepEqual(
    routeKeys.sort(),
    READ_ONLY_PAID_POST_OPERATIONS.map(({ method, path }) => `${method} ${path}`).sort(),
  );
});

test("OpenAPI attachment is generated from the exact declared operation set", () => {
  const document = { paths: Object.fromEntries(READ_ONLY_PAID_POST_OPERATIONS.map(({ path }) => [
    path,
    { post: { responses: {} } },
  ])) };
  assert.equal(attachPaidActionEffectContracts(document), document);
  for (const { path } of READ_ONLY_PAID_POST_OPERATIONS) {
    assert.equal(document.paths[path].post["x-paid-effect"].classification, "read_only");
  }
  delete document.paths[READ_ONLY_PAID_POST_OPERATIONS[0].path];
  assert.throws(() => attachPaidActionEffectContracts(document), /Missing paid action operation/);
});
