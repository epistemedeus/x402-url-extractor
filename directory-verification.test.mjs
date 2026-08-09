import assert from "node:assert/strict";
import test from "node:test";

import {
  GLAMA_CONNECTOR_SCHEMA,
  glamaConnectorVerification,
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
