import assert from "node:assert/strict";
import test from "node:test";

import {
  GLAMA_CONNECTOR_SCHEMA,
  X402_JOBS_VERIFICATION_CODE,
  glamaConnectorVerification,
  x402JobsVerification,
} from "./directory-verification.mjs";

test("Glama verification uses the public SameDayDesk business identity", () => {
  assert.deepEqual(glamaConnectorVerification(), {
    $schema: GLAMA_CONNECTOR_SCHEMA,
    maintainers: [{ email: "contact@samedaydesk.com" }],
  });
});

test("Glama verification normalizes and validates the maintainer email", () => {
  assert.deepEqual(
    glamaConnectorVerification({ maintainerEmail: " Contact@SameDayDesk.com " }),
    {
      $schema: GLAMA_CONNECTOR_SCHEMA,
      maintainers: [{ email: "contact@samedaydesk.com" }],
    },
  );
  assert.throws(() => glamaConnectorVerification({ maintainerEmail: "invalid" }), /invalid/);
});

test("x402.jobs verification publishes the exact server-ownership challenge", () => {
  assert.deepEqual(x402JobsVerification(), {
    x402: X402_JOBS_VERIFICATION_CODE,
  });
  assert.deepEqual(x402JobsVerification({ code: " AC7A83614A55 " }), {
    x402: "ac7a83614a55",
  });
  assert.throws(() => x402JobsVerification({ code: "invalid" }), /invalid/);
});
