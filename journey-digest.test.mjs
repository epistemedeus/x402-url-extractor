import test from "node:test";
import assert from "node:assert/strict";
import { journeyDigest, journeyDigestFromHeaders, carryJourney } from "./journey-digest.mjs";
const S = "k".repeat(32);
test("digest matches J9-LOG format and hides the token", () => {
  const d = journeyDigest("tok_abcdefghijklmnop", S);
  assert.match(d, /^hmac-sha256:[0-9a-f]{64}$/); assert.ok(!d.includes("tok_abcdefghijklmnop"));
  assert.equal(journeyDigestFromHeaders({ "x-samedaydesk-journey": "tok_abcdefghijklmnop" }, S), d);
});
test("no join: missing token, bad token, unset secret, duplicated header => null", () => {
  assert.equal(journeyDigest(undefined, S), null); assert.equal(journeyDigest("short", S), null);
  assert.equal(journeyDigest("tok_abcdefghijklmnop", ""), null);
  assert.equal(journeyDigestFromHeaders({ "x-samedaydesk-journey": ["a".repeat(20), "b".repeat(20)] }, S), null);
});
test("carry through quote/mandate/capture; conflicting digest refused", () => {
  const d = journeyDigest("tok_abcdefghijklmnop", S), e = journeyDigest("tok_zzzzzzzzzzzzzzzz", S);
  assert.equal(carryJourney(carryJourney(d, null), d), d);
  assert.throws(() => carryJourney(d, e), /JOURNEY-DIGEST-CONFLICT/);
});
