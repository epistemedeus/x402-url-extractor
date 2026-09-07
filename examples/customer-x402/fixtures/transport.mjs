import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";

import {
  LIVE_AMOUNT_ATOMIC,
  LIVE_ASSET,
  LIVE_EXTRACT_URL,
  LIVE_NETWORK,
  LIVE_RECIPIENT,
} from "../src/constants.mjs";

export const FIXTURE_VALID_BODY = Object.freeze({
  ok: true,
  url: "https://example.com/",
  status: 200,
  contentType: "text/html; charset=utf-8",
  title: "Example Domain",
  description: null,
  canonical: null,
  lang: null,
  openGraph: {},
  twitter: {},
  jsonLd: [],
  headings: { h1: ["Example Domain"], h2: [] },
  links: ["https://www.iana.org/domains/example"],
  text: "Example Domain This domain is for use in documentation examples.",
  aiReadiness: {
    hasJsonLd: false,
    hasOpenGraph: false,
    hasTitle: true,
    hasDescription: false,
    hasCanonical: false,
    schemaTypes: [],
  },
  fetchedAt: "2026-09-07T00:00:00.000Z",
});

export const FIXTURE_INVALID_BODY = Object.freeze({
  ok: true,
  url: "https://example.com/",
  title: "Example Domain",
});

export function buildChallenge({
  url = LIVE_EXTRACT_URL,
  network = LIVE_NETWORK,
  asset = LIVE_ASSET,
  payTo = LIVE_RECIPIENT,
  amount = LIVE_AMOUNT_ATOMIC,
} = {}) {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url,
      description: "Fixture extract offer",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network,
        amount: String(amount),
        asset,
        payTo,
        maxTimeoutSeconds: 300,
        extra: { name: "USD Coin", version: "2" },
      },
    ],
  };
}

export function createFixtureFetch({
  challenge = buildChallenge(),
  paidStatus = 200,
  paidBody = FIXTURE_VALID_BODY,
  settlement = {
    success: true,
    transaction: `0x${"ab".repeat(32)}`,
    network: LIVE_NETWORK,
  },
} = {}) {
  let stage = 0;
  const calls = [];

  const fetchImpl = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    stage += 1;
    const hasPaymentSignature =
      request.headers.has("PAYMENT-SIGNATURE") ||
      request.headers.has("payment-signature") ||
      request.headers.has("X-PAYMENT") ||
      request.headers.has("x-payment");
    calls.push({
      stage,
      url: request.url,
      method: request.method,
      headerNames: [...request.headers.keys()].sort(),
      hasPaymentSignature,
    });

    if (!hasPaymentSignature) {
      return new Response(JSON.stringify(challenge), {
        status: 402,
        headers: {
          "content-type": "application/json",
          "PAYMENT-REQUIRED": encodePaymentRequiredHeader(challenge),
        },
      });
    }

    const headers = { "content-type": "application/json" };
    if (settlement) {
      headers["PAYMENT-RESPONSE"] = encodePaymentResponseHeader(settlement);
    }
    return new Response(JSON.stringify(paidBody), {
      status: paidStatus,
      headers,
    });
  };

  return { fetchImpl, calls, challenge };
}
