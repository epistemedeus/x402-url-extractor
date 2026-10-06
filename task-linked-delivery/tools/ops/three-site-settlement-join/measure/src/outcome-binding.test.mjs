import assert from "node:assert/strict";
import test from "node:test";
import { importOutcomeText } from "./outcome-binding.mjs";

const META = { kind: "ndjson", path: "fixture", sha256: "a".repeat(64), bytes: 32 };

function v3Event(extra = {}) {
  return {
    v: 3,
    id: "00000000-0000-4000-8000-0000000000b1",
    ts: "2026-10-06T03:20:39.166Z",
    actor: "aaaaaaaaaaaaaaaaaaaaaaaa",
    originClass: "external",
    agentDiscoverySource: null,
    method: "GET",
    route: "/extract",
    kind: "paid",
    matched: true,
    queryKeys: ["url"],
    requestConstruction: "not_measured",
    requestConstructionRequiredKeyCount: 0,
    paymentPresent: true,
    paymentCredentialParsed: true,
    paymentProtocol: "x402",
    paymentFailureCode: "payment_verification_failed",
    paymentIdentifier: null,
    paymentActor: "abababababababababababab",
    protocolsOffered: ["x402"],
    replayed: false,
    result: "challenge",
    settlementAmountAtomic: null,
    settlementCurrency: null,
    settlementNetwork: null,
    settlementReference: null,
    status: 402,
    durationMs: 1,
    ...extra,
  };
}

function rareEvent(extra = {}) {
  return {
    v: 1,
    schemaVersion: "samedaydesk.commerce-rare-funnel-evidence.v1",
    captureVersion: "rare_funnel_capture_v1",
    captureProvenance: "http_middleware",
    id: "00000000-0000-4000-8000-0000000000b2",
    ts: "2026-10-06T03:20:39.166Z",
    actor: "aaaaaaaaaaaaaaaaaaaaaaaa",
    originClass: "external",
    agentDiscoverySource: null,
    method: "GET",
    route: "/extract",
    kind: "paid",
    matched: true,
    paymentPresent: true,
    paymentCredentialParsed: true,
    paymentProtocol: "x402",
    paymentActor: "abababababababababababab",
    paymentFailureCode: "payment_verification_failed",
    result: "challenge",
    status: 402,
    replayed: false,
    usefulness: "unknown",
    ...extra,
  };
}

function imported(record) {
  return importOutcomeText(`${JSON.stringify(record)}\n`, META);
}

function importedBatch(records) {
  return importOutcomeText(JSON.stringify(records), META);
}

test("outcome binding keeps historical rows and accepts only consistent failure evidence", () => {
  const historical = imported(v3Event());
  assert.equal(historical.historical.records, 1);
  assert.equal(historical.unusable.count, 0);

  const classified = imported(v3Event({ paymentFailureEvidence: "generic_402" }));
  assert.equal(classified.historical.records, 1);

  const verifier = imported(v3Event({
    paymentFailureCode: "signature_invalid",
    paymentFailureEvidence: "verifier_text",
  }));
  assert.equal(verifier.historical.records, 1);

  const mismatched = importedBatch([v3Event({
    paymentFailureCode: "signature_invalid",
    paymentFailureEvidence: "generic_402",
    facilitatorVerifiedValidPayment: true,
  })]);
  assert.equal(mismatched.historical.records, 0);
  assert.equal(mismatched.unusable.reasons.shape, 1);

  const storedReaderLabel = importedBatch([v3Event({ paymentFailureEvidence: "not_retained" })]);
  assert.equal(storedReaderLabel.historical.records, 0);
  assert.equal(storedReaderLabel.unusable.reasons.shape, 1);

  const rareHistorical = imported(rareEvent());
  assert.equal(rareHistorical.historical.records, 0);
  assert.equal(rareHistorical.unusable.count, 0);

  const rareClassified = imported(rareEvent({ paymentFailureEvidence: "generic_402" }));
  assert.equal(rareClassified.unusable.count, 0);

  const rareProof = importedBatch([rareEvent({
    paymentFailureEvidence: "generic_402",
    facilitatorVerifiedValidPayment: true,
  })]);
  assert.equal(rareProof.unusable.reasons.shape, 1);

  const success = imported(v3Event({
    status: 200,
    result: "paid_success",
    paymentFailureCode: null,
    paymentFailureEvidence: null,
  }));
  assert.equal(success.historical.records, 1);
});
