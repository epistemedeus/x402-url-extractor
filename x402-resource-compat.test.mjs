import assert from "node:assert/strict";
import test from "node:test";

import {
  CDP_RESOURCE_DESCRIPTION_MAX_CODE_POINTS,
  assertCdpResourceDescriptionCompatibility,
} from "./x402-resource-compat.mjs";

test("accepts the measured CDP resource-description boundary", () => {
  assert.deepEqual(
    assertCdpResourceDescriptionCompatibility([
      { url: "https://seller.example/pay", description: "x".repeat(500) },
    ]),
    { maxDescriptionCodePoints: 500, resourceCount: 1 },
  );
});

test("rejects a resource description beyond the measured CDP boundary", () => {
  assert.equal(CDP_RESOURCE_DESCRIPTION_MAX_CODE_POINTS, 500);
  assert.throws(
    () => assertCdpResourceDescriptionCompatibility([
      { url: "https://seller.example/pay", description: "x".repeat(501) },
    ]),
    /exceeds CDP's 500-character limit.*501/,
  );
});

test("counts Unicode code points and rejects missing descriptions", () => {
  assert.doesNotThrow(() => assertCdpResourceDescriptionCompatibility([
    { url: "https://seller.example/pay", description: "💳".repeat(500) },
  ]));
  assert.throws(
    () => assertCdpResourceDescriptionCompatibility([{ url: "https://seller.example/pay" }]),
    /description is missing/,
  );
});
