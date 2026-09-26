import assert from "node:assert/strict";
import test from "node:test";

import { applySeededFalseSuccess, KIND } from "../src/classify.mjs";
import { CrewaiUnpaidCallError } from "../src/errors.mjs";
import { loadSeededFalseSuccess, runSeededFailure, runUnpaidCall } from "../src/run.mjs";

test("seeded fixture claims paid_success against observed unpaid isError", () => {
  const seed = loadSeededFalseSuccess();
  assert.equal(seed.id, "seeded.false-success.dropped-iserror");
  assert.equal(seed.claimed.kind, KIND.PAID_SUCCESS);
  assert.equal(seed.observed.kind, KIND.UNPAID_TOOLS_CALL_IS_ERROR);
  assert.equal(seed.productReject, "SEED_REJECT");
});

test("applySeededFalseSuccess rejects the call_tool drop claim", async () => {
  const { report } = await runUnpaidCall();
  assert.throws(
    () => applySeededFalseSuccess(report.classification, report.crewai.call_tool_result.content),
    (error) => error instanceof CrewaiUnpaidCallError
      && error.code === "SEED_REJECT"
      && error.kind === KIND.FALSE_SUCCESS
      && error.details.claimed.kind === KIND.PAID_SUCCESS
      && error.details.observed.kind === KIND.UNPAID_TOOLS_CALL_IS_ERROR,
  );
});

test("runSeededFailure always rejects", async () => {
  await assert.rejects(
    () => runSeededFailure(),
    (error) => error instanceof CrewaiUnpaidCallError && error.code === "SEED_REJECT",
  );
});
