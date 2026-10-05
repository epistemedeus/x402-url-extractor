import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createCommerceTelemetry } from "../../commerce-events.mjs";
import { admitEvidence } from "./admit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = "verified-owner-token-extract-recv-1004";
const EXTRACT_PAYER = "0x1111111111111111111111111111111111111111";
const SELLER_PAYER = "0x2222222222222222222222222222222222222222";
const OTHER_PAYER = "0x3333333333333333333333333333333333333333";

function signature(from, amount = "5000") {
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      amount,
      asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      payTo: "0x8904df3de6dfee6a7c8cc38619d2f17806213cee",
    },
    payload: { authorization: { from } },
  })).toString("base64");
}

function paymentResponse(reference, amount = "5000") {
  return Buffer.from(JSON.stringify({
    success: true,
    transaction: reference,
    amount,
    network: "eip155:8453",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  })).toString("base64");
}

function reference(digit) {
  return `0x${digit.repeat(64)}`;
}

async function openTelemetry(payerClasses = "") {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-payment-receiving-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "extract-payment-receiving-1004-secret",
    internalToken: TOKEN,
    externalSince: "2026-08-09T00:00:00.000Z",
    credentialAttemptSince: "2026-08-09T00:00:00.000Z",
    settlementEvidenceSince: "2026-08-09T00:00:00.000Z",
    payerClasses,
    writerProcessCount: 1,
  });
  return { dataDir, telemetry };
}

function emit(telemetry, {
  requestPath,
  status = 200,
  headers = {},
  responseHeaders = {},
  ip = "203.0.113.10",
}) {
  const listeners = new Map();
  const req = {
    path: requestPath,
    url: requestPath,
    method: "GET",
    headers,
    query: {},
    ip,
    socket: {},
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

test("cross-route payer continuity repeats without a second seller success", async () => {
  const { dataDir, telemetry } = await openTelemetry();
  try {
    emit(telemetry, {
      requestPath: "/extract",
      headers: { "payment-signature": signature(EXTRACT_PAYER), "user-agent": "curl/8.0" },
      responseHeaders: { "payment-response": paymentResponse(reference("a")) },
      ip: "203.0.113.11",
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: { "payment-signature": signature(EXTRACT_PAYER), "user-agent": "curl/8.0" },
      responseHeaders: { "payment-response": paymentResponse(reference("b")) },
      ip: "203.0.113.12",
    });
    emit(telemetry, {
      requestPath: "/commerce/seller-integrity-audit",
      headers: { "payment-signature": signature(SELLER_PAYER, "10000"), "user-agent": "curl/8.0" },
      responseHeaders: { "payment-response": paymentResponse(reference("c"), "10000") },
      ip: "203.0.113.13",
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: { "payment-signature": signature(EXTRACT_PAYER), "user-agent": "curl/8.0" },
      responseHeaders: {
        "payment-response": paymentResponse(reference("a")),
        "x-payment-replay": "hit",
      },
      ip: "203.0.113.14",
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: {
        "payment-signature": signature(EXTRACT_PAYER),
        "user-agent": "curl/8.0",
        "x-samedaydesk-internal": TOKEN,
      },
      responseHeaders: { "payment-response": paymentResponse(reference("d")) },
      ip: "203.0.113.15",
    });
    await telemetry.flush();
    const snapshot = await telemetry.snapshot({ days: 1 });
    assert.equal(snapshot.paidSuccessByRoute["/extract"], 2);
    assert.equal(snapshot.paidSuccessByRoute["/commerce/seller-integrity-audit"], 1);
    assert.equal(snapshot.paidSuccessActors, 2);
    assert.equal(snapshot.repeatPaidSuccessActors, 1);
    assert.equal(snapshot.independentPaidSuccessActors, 0);
    assert.equal(snapshot.repeatIndependentPaidSuccessActors, 0);
    assert.equal(snapshot.paidSuccessByClass.unclassified, 3);
    assert.equal(snapshot.replaySuccessEvents, 1);
    assert.equal(snapshot.distinctSettlementReferences, 3);
    assert.equal(snapshot.paidDiagnosticReportContract.transactionPlane.paidSuccess, 1);
    assert.equal(snapshot.paidDiagnosticReportContract.transactionPlane.replayNotPromoted, 0);
    assert.equal(snapshot.paidDiagnosticReportContract.observations, 0);
    assert.equal(snapshot.paidDiagnosticReportContract.usefulness, "unknown");
    assert.equal(snapshot.paidDiagnosticReportContract.recognizedRevenueAtomic, "0");
    assert.equal(snapshot.trafficProvenance.populations.unattributedExternal.paidSuccesses, 3);
    assert.equal(snapshot.trafficProvenance.populations.verifiedInternal.paidSuccesses, 1);
    assert.equal(snapshot.trafficProvenance.populations.verifiedInternal.events > 0, true);
    assert.equal(snapshot.durableRareFunnel.originPopulations.unattributedExternal.paidSuccessEvents, 3);
    assert.equal(snapshot.durableRareFunnel.originPopulations.verifiedInternal.paidSuccessEvents, 1);
    assert.equal(snapshot.durableRareFunnel.paidSuccessEvents, 3);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("distinct extract payers do not create a repeat actor", async () => {
  const { dataDir, telemetry } = await openTelemetry();
  try {
    emit(telemetry, {
      requestPath: "/extract",
      headers: { "payment-signature": signature(EXTRACT_PAYER), "user-agent": "curl/8.0" },
      responseHeaders: { "payment-response": paymentResponse(reference("1")) },
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: { "payment-signature": signature(OTHER_PAYER), "user-agent": "curl/8.0" },
      responseHeaders: { "payment-response": paymentResponse(reference("2")) },
      ip: "203.0.113.20",
    });
    emit(telemetry, {
      requestPath: "/commerce/seller-integrity-audit",
      headers: { "payment-signature": signature(SELLER_PAYER, "10000"), "user-agent": "curl/8.0" },
      responseHeaders: { "payment-response": paymentResponse(reference("3"), "10000") },
      ip: "203.0.113.21",
    });
    await telemetry.flush();
    const snapshot = await telemetry.snapshot({ days: 1 });
    assert.equal(snapshot.paidSuccessByRoute["/extract"], 2);
    assert.equal(snapshot.paidSuccessActors, 3);
    assert.equal(snapshot.repeatPaidSuccessActors, 0);
    assert.equal(snapshot.paidDiagnosticReportContract.transactionPlane.paidSuccess, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("an allowlist entry is required before the same payer becomes independent", async () => {
  const { dataDir, telemetry } = await openTelemetry(JSON.stringify([
    { address: EXTRACT_PAYER, class: "independent" },
  ]));
  try {
    emit(telemetry, {
      requestPath: "/extract",
      headers: { "payment-signature": signature(EXTRACT_PAYER), "user-agent": "curl/8.0" },
      responseHeaders: { "payment-response": paymentResponse(reference("4")) },
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: { "payment-signature": signature(EXTRACT_PAYER), "user-agent": "curl/8.0" },
      responseHeaders: { "payment-response": paymentResponse(reference("5")) },
    });
    await telemetry.flush();
    const snapshot = await telemetry.snapshot({ days: 1 });
    assert.equal(snapshot.paidSuccessByClass.independent, 2);
    assert.equal(snapshot.paidSuccessByClass.unclassified || 0, 0);
    assert.equal(snapshot.independentPaidSuccessActors, 1);
    assert.equal(snapshot.repeatIndependentPaidSuccessActors, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("the receiving record is admitted and the seeded revenue claim is rejected", async () => {
  const laterBytes = await readFile(path.join(HERE, "later-public-demand.json"));
  const laterDemand = JSON.parse(laterBytes.toString("utf8"));
  const evidence = JSON.parse(await readFile(path.join(HERE, "EVIDENCE.json"), "utf8"));
  const seeded = JSON.parse(await readFile(path.join(HERE, "seeded-false-revenue.json"), "utf8"));
  const accepted = await admitEvidence(evidence, laterDemand, laterBytes);
  const rejected = await admitEvidence(seeded, laterDemand, laterBytes);
  assert.deepEqual(accepted.failures, []);
  assert.equal(accepted.accepted, true);
  assert.equal(rejected.accepted, false);
  assert.ok(rejected.failures.includes("recognized_revenue_promoted"));
  assert.ok(rejected.failures.includes("census_promoted"));
  assert.ok(rejected.failures.includes("extract_payer_collapsed_into_seller"));
  assert.ok(rejected.failures.includes("extract_duplicates_seller_settlement"));
  assert.ok(rejected.failures.includes("delivery_body_backfilled"));
  assert.ok(rejected.failures.includes("event_id_invented"));
  assert.ok(rejected.failures.includes("missing_marker_called_outside"));
});
