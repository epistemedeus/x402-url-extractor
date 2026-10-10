import assert from "node:assert/strict";
import test from "node:test";

import {
  CALLER_RESULT_DISPOSITIONS as SERVER_DISPOSITIONS,
  CALLER_RESULT_USEFULNESS,
  callerResultFeedbackPublicContract as serverHttpContract,
  mcpCallerResultFeedbackPublicContract as serverMcpContract,
} from "./caller-result-feedback.mjs";
import { USEFULNESS_UNKNOWN } from "./http-delivery-evidence/classify.mjs";
import {
  CALLER_RESULT_DISPOSITIONS,
  CALLER_RESULT_USEFULNESS as PACKAGE_USEFULNESS,
  callerResultFeedbackPublicContract,
  mcpCallerResultFeedbackPublicContract,
} from "./caller-result-client/src/contract.mjs";
import {
  CALLER_RESULT_DISPOSITIONS as HTTP_DISPOSITIONS,
} from "./examples/customer-x402/src/caller-result.mjs";

test("server and installed clients share one public capability contract", () => {
  assert.equal(serverMcpContract, mcpCallerResultFeedbackPublicContract);
  assert.equal(serverHttpContract, callerResultFeedbackPublicContract);
  assert.equal(SERVER_DISPOSITIONS, CALLER_RESULT_DISPOSITIONS);
  assert.equal(HTTP_DISPOSITIONS, CALLER_RESULT_DISPOSITIONS);
  assert.equal(CALLER_RESULT_USEFULNESS, USEFULNESS_UNKNOWN);
  assert.equal(PACKAGE_USEFULNESS, USEFULNESS_UNKNOWN);
  assert.equal(JSON.stringify(serverMcpContract()).includes("http"), false);
});
