import assert from "node:assert/strict";
import test from "node:test";

import {
  CDP_X402_RESOURCE_DESCRIPTION_MAX_CHARS,
  assertCdpX402ResourceDescriptionCompatibility,
} from "./x402-resource-compat.mjs";

test("accepts the exact CDP x402 resource-description boundary", () => {
  const resources = [{ url: "https://seller.example/paid", description: "a".repeat(500) }];
  assert.equal(CDP_X402_RESOURCE_DESCRIPTION_MAX_CHARS, 500);
  assert.equal(assertCdpX402ResourceDescriptionCompatibility(resources), resources);
});

test("rejects descriptions above the CDP x402 compatibility boundary", () => {
  assert.throws(
    () => assertCdpX402ResourceDescriptionCompatibility([
      { url: "https://seller.example/paid", description: "a".repeat(501) },
    ]),
    /description has 501 characters; CDP facilitator accepts at most 500/,
  );
});

test("counts Unicode code points rather than UTF-8 bytes", () => {
  assert.doesNotThrow(() => assertCdpX402ResourceDescriptionCompatibility([
    { url: "https://seller.example/paid", description: "é".repeat(500) },
  ]));
});

test("rejects absent descriptions", () => {
  assert.throws(
    () => assertCdpX402ResourceDescriptionCompatibility([{ url: "https://seller.example/paid" }]),
    /requires a description/,
  );
});

