import assert from "node:assert/strict";
import test from "node:test";

import {
  compareRouteTemplatePolicies,
  isValidRouteTemplateFixedPoint,
  isValidRouteTemplateSinglePass,
} from "../src/route-template.mjs";

test("double-encoded traversal is accepted by single-pass and rejected by fixed-point", () => {
  const value = "/foo/%252e%252e%252fsecret";
  assert.equal(isValidRouteTemplateSinglePass(value), true);
  assert.equal(isValidRouteTemplateFixedPoint(value), false);
  const report = compareRouteTemplatePolicies(value);
  assert.equal(report.drift, true);
  assert.equal(report.catalogPoisoningIfSinglePassAccepts, true);
});

test("double-encoded scheme injection is rejected only after fixed-point decode", () => {
  const value = "/foo%253a%252f%252fevil.example.com/bar";
  assert.equal(isValidRouteTemplateSinglePass(value), true);
  assert.equal(isValidRouteTemplateFixedPoint(value), false);
});

test("legitimate templates still pass both policies", () => {
  for (const value of ["/users/:userId", "/weather/:country/:city", "/api/v1/items", "/caf%C3%A9"]) {
    assert.equal(isValidRouteTemplateFixedPoint(value), true, value);
    assert.equal(isValidRouteTemplateSinglePass(value), true, value);
    assert.equal(compareRouteTemplatePolicies(value).drift, false, value);
  }
});

test("pathologically deep encoding is rejected by the decode budget", () => {
  let encoded = "..";
  for (let i = 0; i < 6; i += 1) encoded = encodeURIComponent(encoded);
  const value = `/${encoded}`;
  assert.equal(isValidRouteTemplateFixedPoint(value), false);
});

test("malformed percent-encoding is rejected", () => {
  assert.equal(isValidRouteTemplateFixedPoint("/foo/%zz"), false);
  assert.equal(isValidRouteTemplateSinglePass("/foo/%zz"), false);
});
