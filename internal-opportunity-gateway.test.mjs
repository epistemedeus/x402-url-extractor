import test from "node:test";
import assert from "node:assert/strict";
import {
  createInternalPaymentOfferPreflightHandler,
  createInternalSolanaTransactionReceiptHandler,
  createInternalOpportunityPreflightHandler,
  internalGatewayAuthorized,
} from "./internal-opportunity-gateway.mjs";

const TOKEN = "test-only-internal-gateway-token-1234567890";

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("gateway authorization fails closed on absent, short, or mismatched tokens", () => {
  assert.equal(internalGatewayAuthorized({}, TOKEN), false);
  assert.equal(internalGatewayAuthorized({ "x-samedaydesk-internal": TOKEN }, "short"), false);
  assert.equal(internalGatewayAuthorized({ "X-SameDayDesk-Internal": `${TOKEN}x` }, TOKEN), false);
  assert.equal(internalGatewayAuthorized({ "X-SameDayDesk-Internal": TOKEN }, TOKEN), true);
});

test("unauthorized request falls through to the ordinary paid route", async () => {
  let nextCalls = 0;
  const handler = createInternalOpportunityPreflightHandler({
    token: TOKEN,
    getPlatformHealthCard: () => null,
    opportunityPreflight: () => ({ ok: true }),
  });
  const res = responseRecorder();
  await handler({ headers: {}, query: {} }, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(res.body, null);
});

test("authorized gateway receives deterministic result with an explicit evidence boundary", async () => {
  let captured;
  const handler = createInternalOpportunityPreflightHandler({
    token: TOKEN,
    getPlatformHealthCard: (platform) => ({ platform_id: platform }),
    opportunityPreflight: (query, options) => {
      captured = { query, options };
      return { ok: true, decision: "attempt" };
    },
  });
  const res = responseRecorder();
  await handler({
    headers: { "x-samedaydesk-internal": TOKEN },
    query: { platform: "  Frantic  ", rewardUsd: "8" },
  }, res, () => assert.fail("authorized request must not fall through"));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(captured.options.platformCard, { platform_id: "frantic" });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.delivery.transport, "pay-solana-gateway");
  assert.equal(res.body.delivery.upstreamAuthenticated, true);
  assert.match(res.body.delivery.paymentEvidenceBoundary, /gateway owns payment verification/);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["x-robots-tag"], "noindex, nofollow");
});

test("authorized gateway returns a bounded delivery error", async () => {
  const handler = createInternalOpportunityPreflightHandler({
    token: TOKEN,
    getPlatformHealthCard: () => null,
    opportunityPreflight: () => { throw new TypeError("rewardUsd is required"); },
  });
  const res = responseRecorder();
  await handler({
    headers: { "x-samedaydesk-internal": TOKEN },
    query: {},
  }, res, () => assert.fail("authorized request must not fall through"));
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    ok: false,
    error: "rewardUsd is required",
    boundary: "No source-platform account, claim, bid, payment, or submission was touched.",
  });
});

test("authorized Solana payment-offer delivery bypasses the duplicate Base gate", async () => {
  let captured;
  const handler = createInternalPaymentOfferPreflightHandler({
    token: TOKEN,
    paymentOfferPreflight: async (input) => {
      captured = input;
      return {
        ok: true,
        product: "samedaydesk-payment-offer-preflight",
        decision: "authorize",
      };
    },
  });
  const res = responseRecorder();
  await handler({
    headers: { "x-samedaydesk-internal": TOKEN },
    query: { url: "https://example.com/paid" },
  }, res, () => assert.fail("authorized request must not reach the Base paywall"));

  assert.deepEqual(captured, { url: "https://example.com/paid" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.product, "samedaydesk-payment-offer-preflight");
  assert.equal(res.body.delivery.transport, "pay-solana-gateway");
  assert.equal(res.body.delivery.upstreamAuthenticated, true);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["x-robots-tag"], "noindex, nofollow");
});

test("unauthorized payment-offer delivery still reaches the ordinary Base gate", async () => {
  let nextCalls = 0;
  const handler = createInternalPaymentOfferPreflightHandler({
    token: TOKEN,
    paymentOfferPreflight: async () => assert.fail("unauthorized request must not run work"),
  });
  const res = responseRecorder();
  await handler({ headers: {}, query: {} }, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(res.body, null);
});

test("authorized payment-offer errors preserve a bounded target-payment boundary", async () => {
  const error = new Error("target challenge was malformed");
  error.code = "invalid_challenge";
  error.statusCode = 502;
  const handler = createInternalPaymentOfferPreflightHandler({
    token: TOKEN,
    paymentOfferPreflight: async () => { throw error; },
  });
  const res = responseRecorder();
  await handler({
    headers: { "x-samedaydesk-internal": TOKEN },
    query: { url: "https://example.com/paid" },
  }, res, () => assert.fail("authorized request must not reach the Base paywall"));

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, "invalid_challenge");
  assert.equal(res.body.boundary.targetPaymentSent, false);
  assert.match(res.body.boundary.gatewayPayment, /gateway owns/);
});

test("Solana receipt internal gateway delivers only after exact internal authorization", async () => {
  const handler = createInternalSolanaTransactionReceiptHandler({
    token: TOKEN,
    solanaTransactionReceipt: async (input) => ({
      ok: true,
      product: "samedaydesk-solana-transaction-receipt",
      decision: "verified",
      request: input,
    }),
  });
  let nextCalls = 0;
  await handler({ headers: {}, query: { signature: "sig" } }, responseRecorder(), () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);

  const res = responseRecorder();
  await handler({
    headers: { "x-samedaydesk-internal": TOKEN },
    query: { signature: "sig" },
  }, res, () => assert.fail("authorized request must not reach the Base paywall"));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.decision, "verified");
  assert.equal(res.body.delivery.transport, "pay-solana-gateway");
  assert.equal(res.body.delivery.upstreamAuthenticated, true);
});
