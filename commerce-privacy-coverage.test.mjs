import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCommercePaymentEvidenceReadout } from "./commerce-payment-evidence.mjs";
import {
  COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW,
  COMMERCE_INTEGRITY_OK,
  createCommerceTelemetry,
  describeRetentionCoverage,
} from "./commerce-events.mjs";

const BUYER_EMAIL = "buyer-email-canary@example.com";
const BUYER_PAYER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BUYER_ASSET = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BUYER_PAYTO = "0xcccccccccccccccccccccccccccccccccccccccc";
const BUYER_IP = "198.51.100.77";
const BUYER_UA = "BuyerAgentCanary/9.9";
const BUYER_QUERY_URL = "https://buyer-private.example/secret-query-canary";
const BUYER_WALLET_QUERY = "0xdddddddddddddddddddddddddddddddddddddddd";
const BUYER_ORDER_ID = "order_buyer_canary_id01";
const BUYER_SETTLEMENT = `0x${"e".repeat(64)}`;
const BUYER_BODY = "raw-buyer-body-canary-do-not-publish";

function emit(telemetry, {
  requestPath,
  status = 200,
  method = "GET",
  headers = {},
  query = {},
  ip = "203.0.113.10",
  responseHeaders = {},
  rawBody,
} = {}) {
  const listeners = new Map();
  const req = {
    path: requestPath,
    url: requestPath,
    originalUrl: requestPath,
    method,
    headers,
    query,
    ip,
    socket: {},
    rawBody,
  };
  const res = {
    statusCode: status,
    once(name, listener) {
      listeners.set(name, listener);
    },
    getHeader(name) {
      return responseHeaders[String(name).toLowerCase()];
    },
  };
  telemetry.middleware(req, res, () => {});
  listeners.get("finish")?.();
}

function publicAggregate(snapshot) {
  return {
    ...snapshot,
    paymentEvidence: buildCommercePaymentEvidenceReadout({
      eventSnapshot: snapshot,
      settlementReconciliation: { enabled: false },
    }),
  };
}

function assertNoRawBuyerFields(serialized, extra = []) {
  const forbidden = [
    BUYER_EMAIL,
    BUYER_PAYER,
    BUYER_ASSET,
    BUYER_PAYTO,
    BUYER_IP,
    BUYER_UA,
    BUYER_QUERY_URL,
    BUYER_WALLET_QUERY,
    BUYER_ORDER_ID,
    BUYER_SETTLEMENT,
    BUYER_BODY,
    "secret-query-canary",
    "buyer-private.example",
    ...extra,
  ];
  for (const value of forbidden) {
    assert.equal(serialized.includes(value), false, `public aggregate leaked ${value}`);
  }
}

test("public aggregate contains no raw buyer fields", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-privacy-buyer-fields-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "privacy-coverage-secret",
    settlementEvidenceSince: "2020-01-01T00:00:00.000Z",
    credentialAttemptSince: "2020-01-01T00:00:00.000Z",
    requestConstructionSince: "2020-01-01T00:00:00.000Z",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
    payerClasses: [{ address: BUYER_PAYER, class: "independent" }],
  });

  const paymentSignature = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      amount: "20000",
      asset: BUYER_ASSET,
      payTo: BUYER_PAYTO,
    },
    payload: { authorization: { from: BUYER_PAYER } },
    extensions: { "payment-identifier": { info: { id: BUYER_ORDER_ID } } },
  })).toString("base64");
  const paymentResponse = Buffer.from(JSON.stringify({
    success: true,
    transaction: BUYER_SETTLEMENT,
    amount: "20000",
    network: "eip155:8453",
  })).toString("base64");

  emit(telemetry, {
    requestPath: `/${BUYER_EMAIL}/private`,
    status: 404,
    headers: { "user-agent": BUYER_UA },
    query: { email: BUYER_EMAIL, wallet: BUYER_WALLET_QUERY },
    ip: BUYER_IP,
  });
  emit(telemetry, {
    requestPath: "/extract",
    status: 402,
    headers: { "user-agent": BUYER_UA },
    query: { url: BUYER_QUERY_URL },
    ip: BUYER_IP,
  });
  emit(telemetry, {
    requestPath: "/wallet-enrich",
    status: 200,
    headers: {
      "user-agent": BUYER_UA,
      "payment-signature": paymentSignature,
    },
    query: { wallet: BUYER_WALLET_QUERY },
    ip: BUYER_IP,
    rawBody: Buffer.from(BUYER_BODY),
    responseHeaders: { "payment-response": paymentResponse },
  });

  await telemetry.flush();
  const snapshot = await telemetry.snapshot({ days: 1 });
  const aggregate = publicAggregate(snapshot);
  const serialized = JSON.stringify(aggregate);

  assert.equal(snapshot.byResult.paid_success, 1);
  assert.equal(snapshot.paidSuccessByClass.independent, 1);
  assert.equal(snapshot.unmatchedRequests["/:opaque/*"], 1);
  assert.equal(Object.hasOwn(snapshot, "actors"), false);
  assert.equal(Object.hasOwn(snapshot, "actor"), false);
  assert.equal(Object.hasOwn(snapshot, "paymentActor"), false);
  assert.equal(Object.hasOwn(snapshot, "paymentIdentifier"), false);
  assert.equal(Object.hasOwn(snapshot, "settlementReference"), false);
  assert.equal(Object.hasOwn(snapshot, "payer"), false);
  assert.equal(aggregate.paymentEvidence.customerPlane.buyerValidDeliveryCount, null);
  assert.equal(aggregate.paymentEvidence.customerPlane.attributableCustomerCount, null);
  assertNoRawBuyerFields(serialized, [paymentSignature, paymentResponse]);

  await rm(dataDir, { recursive: true, force: true });
});

test("incomplete coverage cannot be reported as a full-window zero", async () => {
  const generatedAtMs = Date.parse("2026-08-21T00:21:21.579Z");
  const retainedStart = Date.parse("2026-08-20T21:53:22.761Z");
  const helper = describeRetentionCoverage({
    generatedAtMs,
    requestedWindowDays: 90,
    retainedObservationStartMs: retainedStart,
    retainedObservationEndMs: generatedAtMs,
    retainedParseableEventCount: 2,
    baselines: {
      requestConstruction: Date.parse("2026-08-13T16:25:03.766Z"),
    },
  });
  assert.equal(helper.requestedWindowComplete, false);
  assert.equal(helper.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(helper.metrics.requestConstruction.complete, false);
  assert.equal(helper.metrics.requestConstruction.coverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(JSON.stringify(helper).includes("2026-08-20T21:53:22.761Z"), false);

  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-privacy-incomplete-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "privacy-coverage-secret",
    requestConstructionSince: "2020-01-01T00:00:00.000Z",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
  });

  const empty = await telemetry.snapshot({ days: 90 });
  assert.equal(empty.constructedRequestEvents, 0);
  assert.equal(empty.externalEvents, 0);
  assert.equal(empty.requestedWindowComplete, false);
  assert.equal(empty.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(empty.requestConstructionCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(empty.integrityStatus, COMMERCE_INTEGRITY_OK);

  emit(telemetry, {
    requestPath: "/openapi.json",
    status: 200,
    headers: { "user-agent": "Agent402/1.0" },
    ip: "203.0.113.40",
  });
  await telemetry.flush();
  const snapshot = await telemetry.snapshot({ days: 90 });
  assert.equal(snapshot.constructedRequestEvents, 0);
  assert.equal(snapshot.requestedWindowComplete, false);
  assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.equal(snapshot.requestConstructionCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
  assert.ok(snapshot.retainedParseableEventCount >= 1);
  assert.equal(JSON.stringify(snapshot).includes("203.0.113.40"), false);
  await rm(dataDir, { recursive: true, force: true });
});
