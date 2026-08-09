import assert from "node:assert/strict";
import test from "node:test";

import { BUYER_POLICY_REFERENCE } from "./buyer-policy-reference.mjs";

test("publishes one versioned credential-free buyer-policy reference", () => {
  assert.equal(BUYER_POLICY_REFERENCE.version, "0.1.0-candidate.1");
  assert.equal(BUYER_POLICY_REFERENCE.repository, "https://github.com/epistemedeus/agent-payment-policy");
  assert.match(BUYER_POLICY_REFERENCE.release, /\/releases\/tag\/v0\.1\.0-candidate\.1$/);
  assert.match(BUYER_POLICY_REFERENCE.boundary, /no wallet executor/);
  assert.match(BUYER_POLICY_REFERENCE.boundary, /payment signer/);
  assert.doesNotMatch(JSON.stringify(BUYER_POLICY_REFERENCE), /private key|wallet path|api key/i);
});
