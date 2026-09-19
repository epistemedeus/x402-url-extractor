import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  KIND,
  classifyMcpHttpResponse,
  holdsMcp200IsErrorNeverPaid,
  naiveHttp2xxPaidInference,
  rejectPaidClaimIfHttp200IsError,
} from "./classify-mcp-http.mjs";
import { NETWORK, paidCall, postMcp, startMounted, unpaidAccepts } from "./helpers.mjs";

test("mounted unpaid tools/call is HTTP 200 isError challenge, not paid", { timeout: 20_000 }, async () => {
  const mounted = await startMounted();
  try {
    const { unpaid, accepts } = await unpaidAccepts(mounted.origin, "enrich", "domain", "example.invalid", 11);
    await mounted.drain();
    assert.ok(accepts);
    assert.equal(unpaid.status, 200);
    assert.equal(unpaid.json?.result?.isError, true);
    assert.equal(unpaid.headers["payment-required"] == null, true);
    assert.equal(unpaid.headers["payment-response"] == null, true);
    const observation = {
      httpStatus: unpaid.status,
      body: unpaid.body,
      contentType: unpaid.contentType,
      requestPaymentPresent: false,
    };
    const classified = classifyMcpHttpResponse(observation);
    assert.equal(classified.paid, false);
    assert.equal(classified.isError, true);
    assert.equal(classified.kind, KIND.CHALLENGE);
    assert.equal(holdsMcp200IsErrorNeverPaid(observation), true);
    assert.equal(mounted.events.length, 1);
    assert.equal(mounted.events[0].result, "challenge");
    assert.notEqual(mounted.events[0].result, "paid_success");
    assert.equal(mounted.calls.settle, 0);
    assert.equal(mounted.calls.handler.enrich || 0, 0);
    assert.equal(mounted.calls.external, 0);
  } finally {
    await mounted.close();
  }
});

test("mounted handler isError is HTTP 200 application_failure, never paid_success", { timeout: 20_000 }, async () => {
  const mounted = await startMounted();
  try {
    const { accepts } = await unpaidAccepts(mounted.origin, "read", "url", "https://example.invalid", 20);
    await mounted.drain();
    mounted.events.length = 0;
    const paid = await postMcp(mounted.origin, paidCall(21, "read", "url", "https://example.invalid", accepts));
    await mounted.drain();
    assert.equal(paid.status, 200);
    assert.equal(paid.json?.result?.isError, true);
    const observation = {
      httpStatus: paid.status,
      body: paid.body,
      contentType: paid.contentType,
      requestPaymentPresent: true,
    };
    const classified = classifyMcpHttpResponse(observation);
    assert.equal(classified.paid, false);
    assert.equal(classified.isError, true);
    assert.notEqual(classified.kind, KIND.PAID_SUCCESS);
    assert.equal(holdsMcp200IsErrorNeverPaid(observation), true);
    assert.equal(naiveHttp2xxPaidInference(observation), "paid_success");
    assert.equal(
      rejectPaidClaimIfHttp200IsError(observation, { paid: true, result: "paid_success" }).rejected,
      true,
    );
    assert.equal(mounted.events.length, 1);
    assert.equal(mounted.events[0].result, "application_failure");
    assert.notEqual(mounted.events[0].result, "paid_success");
    assert.equal(mounted.calls.handler.read, 1);
    assert.equal(mounted.calls.settle, 0);
    assert.equal(mounted.calls.external, 0);
  } finally {
    await mounted.close();
  }
});

test("mounted verified success remains paid_success and isError is not true", { timeout: 20_000 }, async () => {
  const mounted = await startMounted();
  try {
    const { accepts } = await unpaidAccepts(mounted.origin, "enrich", "domain", "example.invalid", 30);
    await mounted.drain();
    mounted.events.length = 0;
    const paid = await postMcp(mounted.origin, paidCall(31, "enrich", "domain", "example.invalid", accepts));
    await mounted.drain();
    assert.equal(paid.status, 200);
    assert.equal(Boolean(paid.json?.result?.isError), false);
    const observation = {
      httpStatus: paid.status,
      body: paid.json,
      requestPaymentPresent: true,
    };
    assert.equal(holdsMcp200IsErrorNeverPaid(observation), true);
    const classified = classifyMcpHttpResponse(observation);
    assert.notEqual(classified.kind, KIND.APPLICATION_ERROR);
    assert.equal(
      rejectPaidClaimIfHttp200IsError(observation, { paid: true, result: "paid_success" }).rejected,
      false,
    );
    assert.equal(mounted.events.length, 1);
    assert.equal(mounted.events[0].result, "paid_success");
    assert.equal(mounted.calls.settle, 1);
    assert.equal(mounted.calls.external, 0);
  } finally {
    await mounted.close();
  }
});

test("mounted verifier rejection is HTTP 200 isError challenge, never paid_success", { timeout: 20_000 }, async () => {
  const mounted = await startMounted({
    facilitator: { verify: () => ({ isValid: false, invalidReason: "synthetic-reject" }) },
  });
  try {
    const { accepts } = await unpaidAccepts(mounted.origin, "enrich", "domain", "example.invalid", 40);
    await mounted.drain();
    mounted.events.length = 0;
    const rejected = await postMcp(mounted.origin, paidCall(41, "enrich", "domain", "example.invalid", accepts));
    await mounted.drain();
    assert.equal(rejected.status, 200);
    assert.equal(rejected.json?.result?.isError, true);
    const observation = {
      httpStatus: rejected.status,
      body: rejected.body,
      contentType: rejected.contentType,
      requestPaymentPresent: true,
    };
    const classified = classifyMcpHttpResponse(observation);
    assert.equal(classified.paid, false);
    assert.equal(classified.isError, true);
    assert.notEqual(classified.kind, KIND.PAID_SUCCESS);
    assert.equal(holdsMcp200IsErrorNeverPaid(observation), true);
    assert.equal(naiveHttp2xxPaidInference(observation), "paid_success");
    assert.equal(
      rejectPaidClaimIfHttp200IsError(observation, { paid: true, result: "paid_success" }).rejected,
      true,
    );
    assert.equal(mounted.events.length, 1);
    assert.equal(mounted.events[0].result, "challenge");
    assert.notEqual(mounted.events[0].result, "paid_success");
    assert.equal(mounted.calls.handler.enrich || 0, 0);
    assert.equal(mounted.calls.settle, 0);
    assert.equal(mounted.calls.external, 0);
  } finally {
    await mounted.close();
  }
});

test("mounted settlement failure is HTTP 200 and never paid_success", { timeout: 20_000 }, async () => {
  const mounted = await startMounted({
    facilitator: {
      settle: () => ({ success: false, errorReason: "synthetic-fail", transaction: "", network: NETWORK }),
    },
  });
  try {
    const { accepts } = await unpaidAccepts(mounted.origin, "enrich", "domain", "example.invalid", 50);
    await mounted.drain();
    mounted.events.length = 0;
    const failed = await postMcp(mounted.origin, paidCall(51, "enrich", "domain", "example.invalid", accepts));
    await mounted.drain();
    assert.equal(failed.status, 200);
    const observation = {
      httpStatus: failed.status,
      body: failed.body,
      contentType: failed.contentType,
      requestPaymentPresent: true,
    };
    const classified = classifyMcpHttpResponse(observation);
    assert.equal(classified.paid, false);
    assert.notEqual(classified.kind, KIND.PAID_SUCCESS);
    assert.equal(holdsMcp200IsErrorNeverPaid(observation), true);
    if (classified.isError === true) {
      assert.equal(
        rejectPaidClaimIfHttp200IsError(observation, { paid: true, result: "paid_success" }).rejected,
        true,
      );
    }
    assert.equal(mounted.events.length, 1);
    assert.equal(mounted.events[0].result, "settlement_failure");
    assert.notEqual(mounted.events[0].result, "paid_success");
    assert.equal(mounted.calls.settle, 1);
    assert.equal(mounted.calls.external, 0);
  } finally {
    await mounted.close();
  }
});

test("mounted output-schema isError after settlement is never paid_success", { timeout: 20_000 }, async () => {
  const mounted = await startMounted({
    tools: [{
      name: "enrich",
      description: "synthetic enrich",
      price: "$0.02",
      inputSchema: { domain: z.string() },
      outputSchema: { ok: z.boolean() },
      run: async () => ({ ok: "wrong-type" }),
    }],
  });
  try {
    const { accepts } = await unpaidAccepts(mounted.origin, "enrich", "domain", "example.invalid", 60);
    await mounted.drain();
    mounted.events.length = 0;
    const failed = await postMcp(mounted.origin, paidCall(61, "enrich", "domain", "example.invalid", accepts));
    await mounted.drain();
    assert.equal(failed.status, 200);
    assert.equal(failed.json?.result?.isError, true);
    const observation = {
      httpStatus: failed.status,
      body: failed.body,
      contentType: failed.contentType,
      requestPaymentPresent: true,
    };
    const classified = classifyMcpHttpResponse(observation);
    assert.equal(classified.paid, false);
    assert.equal(classified.isError, true);
    assert.notEqual(classified.kind, KIND.PAID_SUCCESS);
    assert.equal(holdsMcp200IsErrorNeverPaid(observation), true);
    assert.equal(naiveHttp2xxPaidInference(observation), "paid_success");
    assert.equal(
      rejectPaidClaimIfHttp200IsError(observation, { paid: true, result: "paid_success" }).rejected,
      true,
    );
    assert.equal(mounted.events.length, 1);
    assert.equal(mounted.events[0].result, "application_failure");
    assert.notEqual(mounted.events[0].result, "paid_success");
    assert.equal(mounted.calls.external, 0);
  } finally {
    await mounted.close();
  }
});
