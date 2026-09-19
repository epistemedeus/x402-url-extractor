import assert from "node:assert/strict";
import test from "node:test";

import { classifyCommerceResult } from "../../../commerce-events.mjs";
import {
  KIND,
  classifyMcpHttpResponse,
  rejectPaidClaimIfHttp200IsError,
} from "./classify-mcp-http.mjs";

test("classifyCommerceResult HTTP 200 + paymentPresent is not the MCP paid predicate", () => {
  const httpOnly = classifyCommerceResult({
    route: "/mcp",
    kind: "paid",
    matched: true,
    paymentPresent: true,
    status: 200,
  });
  assert.equal(httpOnly, "paid_success");

  const observation = {
    httpStatus: 200,
    requestPaymentPresent: true,
    body: {
      jsonrpc: "2.0",
      id: 1,
      result: {
        isError: true,
        content: [{ type: "text", text: "{\"ok\":false,\"error\":\"handler failed\"}" }],
      },
    },
  };
  const protocol = classifyMcpHttpResponse(observation);
  assert.equal(protocol.paid, false);
  assert.equal(protocol.isError, true);
  assert.notEqual(protocol.kind, KIND.PAID_SUCCESS);
  const rejected = rejectPaidClaimIfHttp200IsError(observation, {
    paid: true,
    result: httpOnly,
  });
  assert.equal(rejected.rejected, true);
  assert.equal(rejected.code, "mcp_200_iserror_must_not_be_paid");
});

test("MCP unpaid challenge is protocol_discovery or paid_success under HTTP-only commerce, never protocol paid", () => {
  const noPaymentHeader = classifyCommerceResult({
    route: "/mcp",
    kind: "paid",
    matched: true,
    paymentPresent: false,
    status: 200,
  });
  assert.equal(noPaymentHeader, "protocol_discovery");

  const challenge = classifyMcpHttpResponse({
    httpStatus: 200,
    requestPaymentPresent: false,
    body: {
      jsonrpc: "2.0",
      id: 1,
      result: {
        isError: true,
        structuredContent: { x402Version: 2, accepts: [{ scheme: "exact" }] },
        content: [{ type: "text", text: "{\"x402Version\":2,\"accepts\":[]}" }],
      },
    },
  });
  assert.equal(challenge.kind, KIND.CHALLENGE);
  assert.equal(challenge.paid, false);
});
