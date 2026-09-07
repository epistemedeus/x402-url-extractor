import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";

import {
  LIVE_AMOUNT_ATOMIC,
  LIVE_ASSET,
  LIVE_BATCH_AMOUNT_ATOMIC,
  LIVE_EXTRACT_BATCH_URL,
  LIVE_EXTRACT_URL,
  LIVE_NETWORK,
  LIVE_RECIPIENT,
} from "../src/constants.mjs";
import { normalizeAuthorization } from "../src/authorization.mjs";

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

export function buildBatchUsefulBody({
  urls = ["https://example.com/", "https://example.org/"],
  fields = ["title", "description", "headings"],
} = {}) {
  return {
    ok: true,
    product: "samedaydesk-extract-batch",
    schemaVersion: "samedaydesk.extract-batch.v0",
    quote: {
      amountAtomic: LIVE_BATCH_AMOUNT_ATOMIC,
      displayUsdc: "0.01",
      meaning: "Introductory flat 0.01 USDC batch quote for a bounded 1-5 URL attempt. Not a per-URL success promise.",
    },
    jobId: "a".repeat(64),
    jobStatus: "completed",
    stopReason: null,
    partial: false,
    sources: urls.map((source, index) => ({
      id: `item-${String(index + 1).padStart(3, "0")}`,
      source,
      status: "success",
      data: Object.fromEntries(fields.map((field) => {
        if (field === "title") return [field, `Title ${index + 1}`];
        if (field === "description") return [field, null];
        if (field === "headings") return [field, { h1: [`H1 ${index + 1}`], h2: [] }];
        return [field, field === "jsonLd" ? [] : field === "links" ? [] : field === "text" ? "text" : null];
      })),
      notes: [],
      error: null,
      provenance: { transport: "live", finalUrl: source, httpStatus: 200 },
    })),
    accounting: {
      requests: urls.length, bytes: 100, wallMs: 10, retries: 0,
      succeeded: urls.length, partial: 0, failed: 0, unknown: 0, skippedDuplicate: 0,
    },
    costInputs: {
      admittedBodyBytes: 100, requests: urls.length, wallMs: 10,
      hostingCosts: "unknown", modelCosts: "none", monetaryMargin: null,
    },
    charged: true,
    boundary: {
      guaranteedUrlSuccess: false,
      introductoryPrice: true,
      sourceFetchBeforeAuthorization: false,
      automaticRetries: false,
    },
  };
}

export function buildBatchPartialBody(options) {
  const body = buildBatchUsefulBody(options);
  body.ok = false;
  body.partial = true;
  body.sources[1] = {
    ...body.sources[1],
    status: "failure",
    data: null,
    error: { code: "fetch_failed", message: "fixture upstream failure" },
  };
  body.accounting.succeeded = 1;
  body.accounting.failed = 1;
  return body;
}

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

export function buildBatchChallenge(overrides = {}) {
  return buildChallenge({
    url: LIVE_EXTRACT_BATCH_URL,
    amount: LIVE_BATCH_AMOUNT_ATOMIC,
    ...overrides,
  });
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
  expectedBodyRaw = null,
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
    const bodyText = request.method === "POST" ? await request.clone().text() : null;
    calls.push({
      stage,
      url: request.url,
      method: request.method,
      headerNames: [...request.headers.keys()].sort(),
      hasPaymentSignature,
      bodyText,
    });
    if (expectedBodyRaw != null && request.method === "POST") {
      if (bodyText !== expectedBodyRaw) {
        throw new Error(`fixture body mismatch: ${bodyText} !== ${expectedBodyRaw}`);
      }
    }

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

export function createBatchFixtureFetch(options = {}) {
  const auth = normalizeAuthorization(options.authorization || {
    method: "POST",
    url: LIVE_EXTRACT_BATCH_URL,
    network: LIVE_NETWORK,
    asset: LIVE_ASSET,
    recipient: LIVE_RECIPIENT,
    amountCapAtomic: LIVE_BATCH_AMOUNT_ATOMIC,
    assetName: "USD Coin",
    assetVersion: "2",
    maxTimeoutSeconds: 300,
    body: {
      urls: ["https://example.com/", "https://example.org/"],
      fields: ["title", "description", "headings"],
    },
  });
  return createFixtureFetch({
    challenge: options.challenge || buildBatchChallenge(),
    paidBody: options.paidBody || buildBatchUsefulBody({
      urls: [...auth.batch.urls],
      fields: [...auth.batch.fields],
    }),
    expectedBodyRaw: auth.bodyRaw,
    settlement: options.settlement,
    paidStatus: options.paidStatus,
  });
}
