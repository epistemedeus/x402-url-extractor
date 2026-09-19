import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMcpTypedTelemetryOutcome,
} from "../../../mcp-typed-telemetry-producer.mjs";
import {
  KIND,
  classifyMcpHttpResponse,
  naiveHttp2xxPaidInference,
  rejectPaidClaimIfHttp200IsError,
} from "./classify-mcp-http.mjs";

const DIGEST = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function typedInput(overrides = {}) {
  return {
    schemaVersion: "samedaydesk.mcp-typed-telemetry-input.v1",
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/enrich",
      issuedOfferDigest: DIGEST,
    },
    request: { jsonrpc: "2.0", hasId: true, id: 7, method: "tools/call" },
    response: { hasId: true, id: 7, kind: "tool_result" },
    credential: { state: "verified", offerDigest: DIGEST },
    execution: { state: "handler_success", handlerInvoked: true, resultIsError: false },
    settlement: { state: "succeeded", offerDigest: DIGEST },
    ...overrides,
  };
}

test("typed evaluator: handler_error is application_failure never paid_success", () => {
  const decision = evaluateMcpTypedTelemetryOutcome(typedInput({
    execution: { state: "handler_error", handlerInvoked: true, resultIsError: true },
    settlement: { state: "not_attempted", offerDigest: null },
  }));
  assert.equal(decision.result, "application_failure");
  assert.notEqual(decision.result, "paid_success");
  assert.equal(decision.reason, "typed_application_failure");
  assert.equal(decision.applicationOutcome, "error");
});

test("typed evaluator: handler_error stays not paid even if settlement succeeded", () => {
  const decision = evaluateMcpTypedTelemetryOutcome(typedInput({
    execution: { state: "handler_error", handlerInvoked: true, resultIsError: true },
    settlement: { state: "succeeded", offerDigest: DIGEST },
  }));
  assert.equal(decision.result, "application_failure");
  assert.notEqual(decision.result, "paid_success");
});

test("typed evaluator: contradictory handler_success + resultIsError is invalid, not paid", () => {
  const decision = evaluateMcpTypedTelemetryOutcome(typedInput({
    execution: { state: "handler_success", handlerInvoked: true, resultIsError: true },
  }));
  assert.equal(decision.result, "invalid");
  assert.notEqual(decision.result, "paid_success");
});

test("typed evaluator: unpaid payment_required is challenge, not paid_success", () => {
  const decision = evaluateMcpTypedTelemetryOutcome(typedInput({
    response: { hasId: true, id: 7, kind: "payment_required" },
    credential: { state: "absent", offerDigest: null },
    execution: { state: "not_invoked", handlerInvoked: false, resultIsError: null },
    settlement: { state: "not_attempted", offerDigest: null },
  }));
  assert.equal(decision.result, "challenge");
  assert.notEqual(decision.result, "paid_success");
});

test("typed evaluator paid_success still requires handler_success and not isError", () => {
  const decision = evaluateMcpTypedTelemetryOutcome(typedInput());
  assert.equal(decision.result, "paid_success");
  assert.equal(decision.applicationOutcome, "success");
});

test("wire 200 isError and typed handler_error agree: not paid; naive HTTP inference disagrees", () => {
  const observation = {
    httpStatus: 200,
    requestPaymentPresent: true,
    body: {
      jsonrpc: "2.0",
      id: 7,
      result: { isError: true, content: [{ type: "text", text: "x402/payment" }] },
    },
  };
  const wire = classifyMcpHttpResponse(observation);
  const typed = evaluateMcpTypedTelemetryOutcome(typedInput({
    execution: { state: "handler_error", handlerInvoked: true, resultIsError: true },
    settlement: { state: "not_attempted", offerDigest: null },
  }));
  assert.equal(wire.paid, false);
  assert.equal(wire.kind, KIND.APPLICATION_ERROR);
  assert.equal(typed.result, "application_failure");
  assert.equal(naiveHttp2xxPaidInference(observation), "paid_success");
  assert.equal(
    rejectPaidClaimIfHttp200IsError(observation, { paid: true, result: "paid_success" }).rejected,
    true,
  );
});
