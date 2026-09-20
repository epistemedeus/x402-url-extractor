import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  KIND,
  classifyMcpHttpResponse,
  holdsMcp200IsErrorNeverPaid,
  naiveHttp2xxPaidInference,
  rejectPaidClaimIfHttp200IsError,
} from "./classify-mcp-http.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(await readFile(path.join(here, "fixtures/corpus.json"), "utf8"));

test("corpus: HTTP 200 + isError is never paid, including payment-looking bodies", () => {
  assert.equal(corpus.cases.length >= 8, true);
  for (const testCase of corpus.cases) {
    const observation = {
      httpStatus: testCase.httpStatus,
      body: testCase.body,
      contentType: testCase.contentType || "",
      requestPaymentPresent: testCase.requestPaymentPresent === true,
    };
    const classified = classifyMcpHttpResponse(observation);
    assert.equal(classified.paid, testCase.expected.paid, testCase.id);
    assert.equal(classified.kind, testCase.expected.kind, testCase.id);
    assert.equal(classified.isError, testCase.expected.isError, testCase.id);
    assert.equal(holdsMcp200IsErrorNeverPaid(observation), true, testCase.id);
    if (classified.isError === true) {
      assert.equal(classified.paid, false, testCase.id);
      assert.notEqual(classified.kind, KIND.PAID_SUCCESS, testCase.id);
    }
  }
});

test("naive HTTP 2xx inference labels isError as paid_success and is rejected", () => {
  const observation = {
    httpStatus: 200,
    requestPaymentPresent: true,
    body: {
      jsonrpc: "2.0",
      id: 7,
      result: { isError: true, content: [{ type: "text", text: "x402/payment" }] },
    },
  };
  assert.equal(naiveHttp2xxPaidInference(observation), "paid_success");
  const classified = classifyMcpHttpResponse(observation);
  assert.equal(classified.paid, false);
  assert.equal(classified.kind, KIND.APPLICATION_ERROR);
  const rejected = rejectPaidClaimIfHttp200IsError(observation, { paid: true, result: "paid_success" });
  assert.equal(rejected.rejected, true);
  assert.equal(rejected.code, "mcp_200_iserror_must_not_be_paid");
});

test("unpaid PaymentRequired challenge is HTTP 200 isError, not paid", () => {
  const challenge = corpus.cases.find((item) => item.id === "unpaid-challenge");
  const classified = classifyMcpHttpResponse(challenge);
  assert.equal(classified.httpStatus, 200);
  assert.equal(classified.isError, true);
  assert.equal(classified.paid, false);
  assert.equal(classified.kind, KIND.CHALLENGE);
});

test("settlement proof does not override isError into paid_success", () => {
  const observation = corpus.cases.find((item) => item.id === "output-schema-failure-after-settle-proof");
  const classified = classifyMcpHttpResponse(observation);
  assert.equal(classified.paid, false);
  assert.equal(classified.isError, true);
  assert.notEqual(classified.kind, KIND.PAID_SUCCESS);
  assert.equal(
    rejectPaidClaimIfHttp200IsError(observation, { paid: true, kind: KIND.PAID_SUCCESS }).rejected,
    true,
  );
});

test("true paid_success requires a non-error tool result plus settlement", () => {
  const success = corpus.cases.find((item) => item.id === "paid-success");
  const classified = classifyMcpHttpResponse(success);
  assert.equal(classified.paid, true);
  assert.equal(classified.isError, false);
  assert.equal(classified.kind, KIND.PAID_SUCCESS);
  const withoutSettlement = classifyMcpHttpResponse({
    ...success,
    body: {
      jsonrpc: "2.0",
      id: 7,
      result: { content: [{ type: "text", text: "{\"ok\":true}" }] },
    },
  });
  assert.equal(withoutSettlement.paid, false);
  assert.equal(withoutSettlement.kind, KIND.UNSETTLED_TOOL_RESULT);
});

test("SSE payment-required envelope is still not paid", () => {
  const sse = corpus.cases.find((item) => item.id === "sse-unpaid-challenge");
  const classified = classifyMcpHttpResponse(sse);
  assert.equal(classified.isError, true);
  assert.equal(classified.paid, false);
  assert.equal(classified.kind, KIND.CHALLENGE);
});

test("sibling JSON-RPC error does not drop result.isError into a paid claim", () => {
  const observation = corpus.cases.find((item) => item.id === "dual-jsonrpc-error-and-iserror");
  const classified = classifyMcpHttpResponse(observation);
  assert.equal(classified.isError, true);
  assert.equal(classified.paid, false);
  assert.notEqual(classified.kind, KIND.PAID_SUCCESS);
  assert.equal(classified.kind, KIND.APPLICATION_ERROR);
  assert.equal(naiveHttp2xxPaidInference(observation), "paid_success");
  assert.equal(
    rejectPaidClaimIfHttp200IsError(observation, { paid: true, result: "paid_success" }).rejected,
    true,
  );
});

test("SSE ping plus message still exposes isError and rejects a paid claim", () => {
  const observation = corpus.cases.find((item) => item.id === "sse-ping-then-iserror");
  const classified = classifyMcpHttpResponse(observation);
  assert.equal(classified.isError, true);
  assert.equal(classified.paid, false);
  assert.equal(classified.kind, KIND.CHALLENGE);
  assert.equal(naiveHttp2xxPaidInference(observation), "paid_success");
  assert.equal(
    rejectPaidClaimIfHttp200IsError(observation, { paid: true, result: "paid_success" }).rejected,
    true,
  );
});

test("pretty-printed JSON with a data field is not treated as concatenated SSE", () => {
  const observation = {
    httpStatus: 200,
    requestPaymentPresent: true,
    contentType: "application/json",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 12,
      result: {
        isError: true,
        structuredContent: { data: { note: "not sse" }, x402Version: 2, accepts: [{ scheme: "exact" }] },
      },
    }, null, 2),
  };
  const classified = classifyMcpHttpResponse(observation);
  assert.equal(classified.isError, true);
  assert.equal(classified.kind, KIND.CHALLENGE);
  assert.equal(classified.paid, false);
});

test("settle() success:false without isError is settlement_failure, not paid", () => {
  const observation = corpus.cases.find((item) => item.id === "settlement-failed");
  const classified = classifyMcpHttpResponse(observation);
  assert.equal(classified.isError, false);
  assert.equal(classified.paid, false);
  assert.equal(classified.kind, KIND.SETTLEMENT_FAILURE);
  assert.equal(
    rejectPaidClaimIfHttp200IsError(observation, { paid: true, result: "paid_success" }).rejected,
    false,
  );
});
