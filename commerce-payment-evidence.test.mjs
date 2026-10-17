import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import { declareDiscoveryContract } from "./discovery-contract.mjs";

import { LEDGER_DISCOVERY_SOURCE_KINDS, createCommerceTelemetry } from "./commerce-events.mjs";
import {
  COMMERCE_PAYMENT_EVIDENCE_SCHEMA,
  COMMERCE_SETTLEMENT_LINEAGE_SCHEMA,
  buildCommercePaymentEvidenceReadout,
  commercePaymentEvidenceOutputSchema,
  lineageAdmittedOf,
  lineageEventsOf,
  lineageProspectiveOf,
  settlementLineageEvidenceKey,
} from "./commerce-payment-evidence.mjs";
import {
  PROSPECTIVE_CAPTURE_VERSION,
  PROSPECTIVE_FILENAME,
  PROSPECTIVE_HEADER_SCHEMA,
  absentProspectiveDelivery,
  commerceProspectiveDeliveryOutputSchema,
  projectProspectiveDelivery,
  prospectiveEvidenceKey,
  readProspectiveDelivery,
  unavailableProspectiveDelivery,
} from "./commerce-prospective-delivery.mjs";
import { createCommerceSettlementReconciler } from "./commerce-settlement-reconciler.mjs";

// The mounted server re-derives paid GET construction from the discovery
// contract registered at process start. Register the same required query key
// before this file's producer writes, so that paid success stays canonical
// when the server reads the journal.
declareDiscoveryContract({
  routeKey: "GET /extract",
  input: { url: "https://example.com" },
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
    },
    required: ["url"],
  },
  output: { example: { ok: true } },
  outputSchema: {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
  },
});

function eventSnapshot(overrides = {}) {
  return {
    paidSuccessActors: 0,
    repeatPaidSuccessActors: 0,
    requestedWindowStart: "2026-08-28T00:00:00.000Z",
    requestedWindowCoverage: "unknown_for_full_window",
    coverage: {
      metrics: {
        external: { coverage: "unknown_for_full_window" },
      },
    },
    ...overrides,
  };
}

function settlementReconciliation(overrides = {}) {
  return {
    enabled: true,
    settlementEvidenceSince: "2026-08-09T13:49:54.000Z",
    ledger: {
      reconciledSettlements: 25,
      amountAtomic: "842000",
      byClass: {
        unclassified: { settlements: 12, amountAtomic: "255000" },
        internal: { settlements: 12, amountAtomic: "577000" },
        validation: { settlements: 1, amountAtomic: "10000" },
      },
      byRoute: {
        "/commerce/seller-integrity-audit": { settlements: 2, amountAtomic: "20000" },
      },
    },
    ...overrides,
  };
}

test("durable settlements outlive rotated paid-success events without becoming customers", () => {
  const result = buildCommercePaymentEvidenceReadout({
    eventSnapshot: eventSnapshot(),
    settlementReconciliation: settlementReconciliation(),
  });

  assert.equal(result.schemaVersion, COMMERCE_PAYMENT_EVIDENCE_SCHEMA);
  assert.equal(result.relationship, "durable_settlement_outlives_retained_paid_event");
  assert.equal(result.eventPlane.retainedPaidSuccessActors, 0);
  assert.equal(result.eventPlane.requestedWindowPaidSuccessActors, null);
  assert.equal(result.settlementPlane.reconciledSettlements, 25);
  assert.deepEqual(result.settlementPlane.byClass.validation, {
    settlements: 1,
    amountAtomic: "10000",
  });
  assert.equal(result.customerPlane.attributableCustomerCount, null);
  assert.equal(result.customerPlane.buyerValidDeliveryCount, null);
  assert.equal(result.customerPlane.repeatIndependentCustomerCount, null);
  assert.equal(result.boundaries.retainedEventZeroNeverMeansHistoricalZeroWhenCoverageIncomplete, true);
});

test("retained paid events and durable settlements remain separate positive planes", () => {
  const result = buildCommercePaymentEvidenceReadout({
    eventSnapshot: eventSnapshot({ paidSuccessActors: 2, repeatPaidSuccessActors: 1 }),
    settlementReconciliation: settlementReconciliation(),
  });
  assert.equal(result.relationship, "retained_paid_event_and_durable_settlement");
  assert.equal(result.eventPlane.retainedPaidSuccessActors, 2);
  assert.equal(result.eventPlane.requestedWindowPaidSuccessActors, null);
  assert.equal(result.settlementPlane.reconciledSettlements, 25);
});

test("complete event coverage admits an exact requested-window zero", () => {
  const result = buildCommercePaymentEvidenceReadout({
    eventSnapshot: eventSnapshot({
      requestedWindowCoverage: "complete",
      coverage: { metrics: { external: { coverage: "complete" } } },
    }),
    settlementReconciliation: settlementReconciliation({
      settlementEvidenceSince: "2026-08-01T00:00:00.000Z",
      ledger: {
        reconciledSettlements: 0,
        amountAtomic: "0",
        byClass: {},
        byRoute: {},
      },
    }),
  });
  assert.equal(result.relationship, "complete_no_paid_evidence");
  assert.equal(result.eventPlane.requestedWindowPaidSuccessActors, 0);
  assert.equal(result.eventPlane.requestedWindowRepeatPaidSuccessActors, 0);
});

test("a complete event slice cannot manufacture a zero before settlement coverage begins", () => {
  const result = buildCommercePaymentEvidenceReadout({
    eventSnapshot: eventSnapshot({
      requestedWindowStart: "2026-08-01T00:00:00.000Z",
      requestedWindowCoverage: "complete",
      coverage: { metrics: { external: { coverage: "complete" } } },
    }),
    settlementReconciliation: settlementReconciliation({
      settlementEvidenceSince: "2026-08-09T13:49:54.000Z",
      ledger: {
        reconciledSettlements: 0,
        amountAtomic: "0",
        byClass: {},
        byRoute: {},
      },
    }),
  });
  assert.equal(result.relationship, "unknown");
  assert.equal(result.eventPlane.requestedWindowPaidSuccessActors, 0);
  assert.equal(result.settlementPlane.coverage, "unknown_for_full_window");
});

test("an unreconciled retained paid event remains pending instead of becoming revenue", () => {
  const result = buildCommercePaymentEvidenceReadout({
    eventSnapshot: eventSnapshot({ paidSuccessActors: 1 }),
    settlementReconciliation: settlementReconciliation({
      ledger: {
        reconciledSettlements: 0,
        amountAtomic: "0",
        byClass: {},
        byRoute: {},
      },
    }),
  });
  assert.equal(result.relationship, "retained_paid_event_pending_or_outside_settlement_ledger");
  assert.equal(result.customerPlane.attributableCustomerCount, null);
});

test("missing planes stay unknown rather than fabricating zero", () => {
  const result = buildCommercePaymentEvidenceReadout({});
  assert.equal(result.relationship, "unknown");
  assert.equal(result.eventPlane.retainedPaidSuccessActors, null);
  assert.equal(result.eventPlane.requestedWindowPaidSuccessActors, null);
  assert.equal(result.settlementPlane.reconciledSettlements, null);
  assert.equal(result.settlementPlane.amountAtomic, null);
});

test("the exported schema accepts the readout and rejects invented customer authority", () => {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(
    commercePaymentEvidenceOutputSchema(),
  );
  const result = buildCommercePaymentEvidenceReadout({
    eventSnapshot: eventSnapshot(),
    settlementReconciliation: settlementReconciliation(),
  });
  assert.equal(validate(result), true, JSON.stringify(validate.errors));

  const promoted = structuredClone(result);
  promoted.customerPlane.attributableCustomerCount = 1;
  assert.equal(validate(promoted), false);
  assert.equal(result.lineage.population, "unreceived");
  assert.equal(result.lineage.paidSuccessEvents, null);
  assert.equal(result.lineage.actorCorrespondence, "unproven");
});

const WINDOW_START = "2026-10-16T19:20:57.449Z";
const WINDOW_END = "2026-10-17T19:20:57.449Z";
const BASELINE = "2026-08-09T13:49:54.000Z";
const WHEN = "2026-10-17T15:00:00.000Z";
const REF_A = `0x${"ab".repeat(32)}`;
const REF_B = `0x${"cd".repeat(32)}`;
const validateLineage = new Ajv({ allErrors: true, strict: false }).compile(
  commercePaymentEvidenceOutputSchema(),
);

function paidRow(reference, overrides = {}) {
  return {
    reference,
    route: "/extract",
    protocol: "x402",
    amountAtomic: "5000",
    timestamp: WHEN,
    discoverySourceKind: "none",
    ...overrides,
  };
}

function admittedRow(reference, overrides = {}) {
  return {
    settlementReference: reference,
    route: "/extract",
    protocol: "x402",
    amountAtomic: "5000",
    sourceEventTimestamp: WHEN,
    payerContinuity: "matched_request_pseudonym",
    paymentClass: "internal",
    sourceEventId: "event-canary-not-public",
    sourceDeliveryAttribution: { discoverySourceKind: "none" },
    ...overrides,
  };
}

function eventsOf(rows, overrides = {}) {
  return {
    paidSuccessActors: rows.length,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    windowCoverage: "complete",
    externalObservationStart: WINDOW_START,
    externalObservationCoverage: "complete",
    externalObservationCoversRequestedWindow: true,
    settlementBaseline: BASELINE,
    ...overrides,
    rows,
  };
}

function lineageReadout(lineageInputs) {
  const coverage = lineageInputs?.events?.windowCoverage || "complete";
  const result = buildCommercePaymentEvidenceReadout({
    eventSnapshot: eventSnapshot({
      paidSuccessActors: lineageInputs?.events?.paidSuccessActors ?? 1,
      requestedWindowStart: WINDOW_START,
      requestedWindowCoverage: coverage,
      coverage: { metrics: { external: { coverage } } },
    }),
    settlementReconciliation: settlementReconciliation({
      settlementEvidenceSince: BASELINE,
    }),
    lineageInputs,
  });
  assert.equal(validateLineage(result), true, JSON.stringify(validateLineage.errors));
  assert.equal(result.lineage.schemaVersion, COMMERCE_SETTLEMENT_LINEAGE_SCHEMA);
  assert.equal(result.customerPlane.attributableCustomerCount, null);
  assert.equal(result.customerPlane.buyerValidDeliveryCount, null);
  assert.equal(result.customerPlane.repeatIndependentCustomerCount, null);
  assert.equal(result.lineage.customerAttribution, null);
  assert.equal(result.lineage.usefulness, "unknown");
  assert.equal(result.lineage.actorCorrespondence, "unproven");
  assert.equal(result.lineage.historicalBackfill, false);
  assert.equal(result.lineage.canonicalChainReplay, false);
  assert.equal(result.lineage.boundaries.canonicalChainReplay, false);
  assert.equal(result.lineage.payerContinuityBoundary, "erc20_transfer_from_is_not_the_transaction_sender");
  return result;
}

function assertNoIdentity(result, ...needles) {
  const serialized = JSON.stringify(result);
  const keys = new Set();
  JSON.parse(serialized, (key, value) => {
    keys.add(key);
    return value;
  });
  for (const key of ["reference", "settlementReference", "evidenceKey", "sourceEventId", "paymentActor", "payer"]) {
    assert.equal(keys.has(key), false, key);
  }
  for (const needle of needles) {
    if (!needle) continue;
    assert.equal(serialized.includes(needle), false, needle);
  }
}

test("an exact reference join stays unproven as a customer and does not publish the reference", () => {
  const result = lineageReadout({
    events: eventsOf([paidRow(REF_A)], { paidSuccessActors: 1 }),
    admitted: [admittedRow(REF_A)],
    prospective: [{
      evidenceKey: prospectiveEvidenceKey(REF_A),
      technical: "validated_response",
      feedback: "absent",
      taskClass: "owner_qa",
    }],
  });
  assert.equal(result.lineage.referenceCorrespondence, "one_to_one");
  assert.equal(result.lineage.exactReferenceJoins, 1);
  assert.equal(result.lineage.paidSuccessEvents, 1);
  assert.equal(result.lineage.paidSuccessActors, 1);
  assert.equal(result.lineage.payerContinuity.matched_request_pseudonym, 1);
  assert.equal(result.lineage.payerContinuity.onchain_only, 0);
  assert.equal(result.lineage.payerContinuityCohort, "in_window_reference_intersection");
  assert.equal(result.lineage.discoverySourceKind.none, 1);
  assert.equal(result.lineage.prospective.withRecord, 1);
  assert.equal(result.lineage.prospective.withoutRecord, 0);
  assert.equal(result.lineage.prospective.technical.validated_response, 1);
  assert.equal(result.lineage.prospective.declaredFeedback.absent, 1);
  assert.equal(result.lineage.prospective.declaredFeedback.rejected, 0);
  assert.equal(result.lineage.prospective.continuationTransmission.unknown, 1);
  assert.equal(result.lineage.prospective.continuationTransmission.not_transmitted, 0);
  assert.equal(result.lineage.prospective.declaredTaskClass.owner_qa, 1);
  assert.equal(result.lineage.boundaries.ownerQaIsNotACustomer, true);
  assert.equal(result.lineage.boundaries.feedbackAbsentIsNotRefusal, true);
  assert.equal(result.lineage.boundaries.omittedTransmissionIsUnknown, true);
  assertNoIdentity(result, REF_A, prospectiveEvidenceKey(REF_A), "event-canary-not-public");
});

test("token-sender continuity and a request pseudonym stay different and neither is the buyer", () => {
  const result = lineageReadout({
    events: eventsOf([
      paidRow(REF_A),
      paidRow(REF_B, { discoverySourceKind: "declared_header" }),
    ], { paidSuccessActors: 2 }),
    admitted: [
      admittedRow(REF_A, { payerContinuity: "matched_request_pseudonym" }),
      admittedRow(REF_B, { payerContinuity: "onchain_only" }),
    ],
    prospective: [],
  });
  assert.equal(result.lineage.referenceCorrespondence, "one_to_one");
  assert.equal(result.lineage.exactReferenceJoins, 2);
  assert.equal(result.lineage.payerContinuity.matched_request_pseudonym, 1);
  assert.equal(result.lineage.payerContinuity.onchain_only, 1);
  assert.equal(result.lineage.payerContinuity.unknown, 0);
  assert.equal(result.lineage.discoverySourceKind.declared_header, 1);
  assert.equal(result.lineage.discoverySourceKind.none, 1);
  assert.equal(result.lineage.boundaries.tokenTransferFromIsNotTheTransactionSender, true);
  assert.equal(result.lineage.boundaries.facilitatorSenderIsNotTheBuyer, true);
  assert.equal(result.lineage.boundaries.payerContinuityIsNotACustomer, true);
  assert.equal(result.lineage.prospective.withRecord, 0);
  assert.equal(result.lineage.prospective.withoutRecord, 2);
  assertNoIdentity(result, REF_A, REF_B);
});

test("missing, refused, and partial capture stay out of usefulness and out of one-to-one", () => {
  const missing = lineageReadout({
    events: eventsOf([paidRow(null, { reference: null })]),
    admitted: [admittedRow(REF_A)],
    prospective: [],
  });
  assert.equal(missing.lineage.eventReferencesMissing, 1);
  assert.equal(missing.lineage.exactReferenceJoins, 0);
  assert.equal(missing.lineage.referenceCorrespondence, "not_one_to_one");
  assert.equal(missing.lineage.admittedInWindowWithoutEventReference, 1);

  const refused = lineageReadout({
    events: eventsOf([paidRow(REF_A, { amountAtomic: null })]),
    admitted: [admittedRow(REF_A)],
    prospective: [{
      evidenceKey: prospectiveEvidenceKey(REF_A),
      technical: "schema_invalid",
      feedback: "absent",
      taskClass: "external_unknown",
      continuationTransmission: "transmitted",
    }],
  });
  assert.equal(refused.lineage.referenceMatchedIncomplete, 1);
  assert.equal(refused.lineage.conflictingReferenceJoins, 0);
  assert.equal(refused.lineage.referenceCorrespondence, "not_one_to_one");
  assert.equal(refused.lineage.prospective.technical.schema_invalid, 1);
  assert.equal(refused.lineage.prospective.technical.partial, 0);
  assert.equal(refused.lineage.prospective.declaredFeedback.rejected, 0);
  assert.equal(refused.lineage.prospective.declaredFeedback.absent, 1);
  assert.equal(refused.lineage.prospective.continuationTransmission.transmitted, 1);

  const partial = lineageReadout({
    events: eventsOf([paidRow(REF_A)]),
    admitted: [admittedRow(REF_A)],
    prospective: [{
      evidenceKey: prospectiveEvidenceKey(REF_A),
      technical: "partial",
      feedback: "absent",
      taskClass: "absent",
      continuationTransmission: "not_transmitted",
    }],
  });
  assert.equal(partial.lineage.exactReferenceJoins, 1);
  assert.equal(partial.lineage.prospective.technical.partial, 1);
  assert.equal(partial.lineage.prospective.continuationTransmission.not_transmitted, 1);
  assert.equal(partial.lineage.boundaries.technicalValidationIsNotUsefulness, true);
  assert.equal(partial.lineage.boundaries.transmissionIsNotClientObservation, true);
  assert.equal(partial.lineage.boundaries.transmissionIsNotADeclaration, true);
});

test("a changed route or amount conflicts, and a repeated reference is not a second settlement", () => {
  const changed = lineageReadout({
    events: eventsOf([paidRow(REF_A, { route: "/wallet-enrich", amountAtomic: "10000" })]),
    admitted: [admittedRow(REF_A)],
    prospective: [],
  });
  assert.equal(changed.lineage.conflictingReferenceJoins, 1);
  assert.equal(changed.lineage.exactReferenceJoins, 0);
  assert.equal(changed.lineage.referenceCorrespondence, "not_one_to_one");

  const duplicate = lineageReadout({
    events: eventsOf([paidRow(REF_A), paidRow(REF_A)]),
    admitted: [admittedRow(REF_A), admittedRow(REF_A, { amountAtomic: "9000" })],
    prospective: [],
  });
  assert.equal(duplicate.lineage.duplicateEventReferences, 1);
  assert.equal(duplicate.lineage.duplicateAdmittedReferences, 1);
  assert.equal(duplicate.lineage.exactReferenceJoins, 0);
  assert.equal(duplicate.lineage.paidSuccessEvents, 2);
  assert.equal(duplicate.lineage.referenceCorrespondence, "not_one_to_one");
  assert.equal(duplicate.lineage.boundaries.paymentIsNotACustomer, true);
});

test("equal actor and settlement counts are not identity when the references differ", () => {
  const result = lineageReadout({
    events: eventsOf([paidRow(REF_A), paidRow(REF_B)], { paidSuccessActors: 2 }),
    admitted: [
      admittedRow(`0x${"11".repeat(32)}`),
      admittedRow(`0x${"22".repeat(32)}`),
    ],
    prospective: [],
  });
  assert.equal(result.lineage.paidSuccessEvents, 2);
  assert.equal(result.lineage.paidSuccessActors, 2);
  assert.equal(result.lineage.admittedSettlementsInWindow, 2);
  assert.equal(result.lineage.eventReferencesUnadmitted, 2);
  assert.equal(result.lineage.admittedInWindowWithoutEventReference, 2);
  assert.equal(result.lineage.referenceCorrespondence, "not_one_to_one");
  assert.equal(result.lineage.actorCorrespondence, "unproven");
});

test("a late caller statement does not replace the stored feedback, and a lost response is not a refusal", () => {
  const evidenceKey = prospectiveEvidenceKey(REF_A);
  const result = lineageReadout({
    events: eventsOf([paidRow(REF_A)]),
    admitted: [admittedRow(REF_A, { payerContinuity: "unrecognized-label" })],
    prospective: [
      { evidenceKey, technical: "validated_response", feedback: "absent", taskClass: "absent" },
      {
        evidenceKey,
        technical: "validated_response",
        feedback: "declared_useful",
        taskClass: "external_unknown",
        continuationTransmission: "transmitted",
      },
    ],
  });
  assert.equal(result.lineage.prospective.withRecord, 1);
  assert.equal(result.lineage.prospective.declaredFeedback.absent, 1);
  assert.equal(result.lineage.prospective.declaredFeedback.declared_useful, 0);
  assert.equal(result.lineage.prospective.continuationTransmission.unknown, 1);
  assert.equal(result.lineage.payerContinuity.unknown, 1);
  assert.equal(result.lineage.boundaries.feedbackAbsentIsNotRefusal, true);

  const lost = lineageReadout({
    events: eventsOf([paidRow(REF_A)]),
    admitted: [admittedRow(REF_A)],
    prospective: [],
  });
  assert.equal(lost.lineage.prospective.withoutRecord, 1);
  assert.equal(lost.lineage.prospective.declaredFeedback.rejected, 0);
  assert.equal(lost.lineage.exactReferenceJoins, 1);
});

test("an old admitted clock stays outside the window and an incomplete window is not a zero", () => {
  const oldClock = "2026-10-01T00:00:00.000Z";
  const admitted = admittedRow(REF_A, { sourceEventTimestamp: oldClock });
  const result = lineageReadout({
    events: eventsOf([paidRow(REF_A)]),
    admitted: [admitted],
    prospective: [{
      evidenceKey: prospectiveEvidenceKey(REF_A),
      technical: "validated_response",
      feedback: "absent",
      taskClass: "sponsored_trial",
    }],
  });
  assert.equal(admitted.sourceEventTimestamp, oldClock);
  assert.equal(result.lineage.eventReferencesAdmittedOutsideWindow, 1);
  assert.equal(result.lineage.eventReferencesAdmittedInWindow, 0);
  assert.equal(result.lineage.exactReferenceJoins, 0);
  assert.equal(result.lineage.admittedSettlementsInWindow, 0);
  assert.equal(result.lineage.referenceCorrespondence, "not_one_to_one");
  assert.equal(result.lineage.prospective.withRecord, 0);
  assert.equal(result.lineage.prospective.declaredTaskClass.sponsored_trial, 0);
  assertNoIdentity(result, REF_A, prospectiveEvidenceKey(REF_A));

  const incomplete = lineageReadout({
    events: eventsOf([], { windowCoverage: "unknown_for_full_window" }),
    admitted: [],
    prospective: [],
  });
  assert.equal(incomplete.lineage.paidSuccessEvents, 0);
  assert.equal(incomplete.lineage.referenceCorrespondence, "not_one_to_one");
  assert.equal(incomplete.lineage.boundaries.incompleteCoverageIsNotHistoricalZero, true);
  assert.equal(incomplete.lineage.customerAttribution, null);
});

test("historical admitted rows outside the window do not block a later exact join", () => {
  const result = lineageReadout({
    events: eventsOf([paidRow(REF_A)]),
    admitted: [
      admittedRow(REF_B, { sourceEventTimestamp: "2026-10-01T00:00:00.000Z" }),
      admittedRow(REF_A),
    ],
    prospective: [],
  });
  assert.equal(result.lineage.exactReferenceJoins, 1);
  assert.equal(result.lineage.eventReferencesAdmittedOutsideWindow, 0);
  assert.equal(result.lineage.admittedSettlementsInWindow, 1);
  assert.equal(result.lineage.referenceCorrespondence, "one_to_one");
  assert.equal(result.lineage.actorCorrespondence, "unproven");
});

test("a pre-baseline event and an invalid window are not turned into a join", () => {
  const before = lineageReadout({
    events: eventsOf([paidRow(REF_A, { timestamp: "2026-10-16T00:00:00.000Z" })], {
      settlementBaseline: "2026-10-17T12:00:00.000Z",
    }),
    admitted: [admittedRow(REF_A)],
    prospective: [],
  });
  assert.equal(before.lineage.settlementBaselineCoversWindow, false);
  assert.equal(before.lineage.distinctEventSettlementReferences, 0);
  assert.equal(before.lineage.exactReferenceJoins, 0);
  assert.equal(before.lineage.referenceCorrespondence, "not_one_to_one");

  const invalid = lineageReadout({
    events: eventsOf([paidRow(REF_A)], { windowEnd: "2026-10-01T00:00:00.000Z" }),
    admitted: [admittedRow(REF_A)],
    prospective: [],
  });
  assert.equal(invalid.lineage.population, "unreceived");
  assert.equal(invalid.lineage.paidSuccessEvents, null);
  assert.equal(invalid.lineage.exactReferenceJoins, null);
  assert.equal(invalid.lineage.referenceCorrespondence, "unreceived");
  assertNoIdentity(invalid, REF_A);
});

test("missing lineage inputs stay null and a raw discovery label is not echoed", () => {
  const absent = lineageReadout({});
  assert.equal(absent.lineage.population, "unreceived");
  assert.equal(absent.lineage.paidSuccessEvents, null);
  assert.equal(absent.lineage.admittedSettlementsInWindow, null);
  assert.equal(absent.lineage.prospective, null);
  assert.equal(absent.lineage.payerContinuity, null);
  assert.equal(absent.lineage.referenceCorrespondence, "unreceived");

  const eventsOnly = lineageReadout({ events: eventsOf([paidRow(REF_A)]) });
  assert.equal(eventsOnly.lineage.paidSuccessEvents, 1);
  assert.equal(eventsOnly.lineage.distinctEventSettlementReferences, 1);
  assert.equal(eventsOnly.lineage.admittedSettlementsInWindow, null);
  assert.equal(eventsOnly.lineage.exactReferenceJoins, null);
  assert.equal(eventsOnly.lineage.prospective, null);
  assert.equal(eventsOnly.lineage.referenceCorrespondence, "unreceived");

  const raw = "raw-partner-label-do-not-publish";
  const folded = lineageReadout({
    events: eventsOf([paidRow(REF_A, { discoverySourceKind: raw })]),
    admitted: [admittedRow(REF_A)],
    prospective: null,
  });
  assert.equal(folded.lineage.discoverySourceKind.unknown, 1);
  assert.equal(folded.lineage.discoverySourceKind.declared_header, 0);
  assert.equal(folded.lineage.prospective, null);
  assertNoIdentity(folded, raw, REF_A);
});

test("lineage vocabulary matches the ledger kinds and the prospective report", () => {
  assert.equal(settlementLineageEvidenceKey(REF_A), prospectiveEvidenceKey(REF_A));
  assert.equal(settlementLineageEvidenceKey("not-a-reference"), null);
  const lineageSchema = commercePaymentEvidenceOutputSchema().properties.lineage;
  const discoverySchema = lineageSchema.properties.discoverySourceKind.anyOf[0];
  assert.deepEqual([...discoverySchema.required].sort(), [...LEDGER_DISCOVERY_SOURCE_KINDS].sort());
  const prospectiveSchema = commerceProspectiveDeliveryOutputSchema();
  const lineageProspective = lineageSchema.properties.prospective.anyOf[0];
  for (const key of ["technical", "declaredFeedback", "continuationTransmission", "declaredTaskClass"]) {
    assert.deepEqual(lineageProspective.properties[key].required, prospectiveSchema.properties[key].required);
  }
});

test("the prospective producer remembers a bound record and an unreadable spread stays unreceived", () => {
  const header = {
    schemaVersion: "samedaydesk.commerce-prospective-delivery-header.v1",
    captureVersion: "prospective_delivery_v1",
    prospectiveSince: "2026-10-13T03:18:47.837Z",
    sourceVersion: "1.23.53",
  };
  const observation = {
    schemaVersion: "samedaydesk.commerce-prospective-delivery-record.v1",
    evidenceKey: prospectiveEvidenceKey(REF_A),
    technical: "validated_response",
    channel: "http",
    taskClass: "absent",
    feedback: "absent",
    feedbackSeal: "none",
    observedAt: WHEN,
  };
  const admission = {
    summary: {
      schemaVersion: "samedaydesk.commerce-settlement-summary.v1",
      reconciledSettlements: 1,
      distinctSettlementReferences: 1,
      amountAtomic: "5000",
      invalidLines: 0,
    },
    admissionCutId: "ab".repeat(32),
    admitted: [{ settlementReference: REF_A }],
  };
  const packet = projectProspectiveDelivery({
    journalText: `${JSON.stringify(header)}\n${JSON.stringify(observation)}\n`,
    admission,
  });
  const remembered = lineageProspectiveOf(packet);
  assert.equal(remembered.length, 1);
  assert.equal(remembered[0].evidenceKey, prospectiveEvidenceKey(REF_A));
  assert.equal(Object.hasOwn(remembered[0], "continuationTransmission"), false);
  assert.equal(JSON.stringify(packet).includes(REF_A), false);
  assert.equal(JSON.stringify(packet).includes(prospectiveEvidenceKey(REF_A)), false);
  assert.equal(lineageProspectiveOf(unavailableProspectiveDelivery(admission)), null);
  assert.equal(lineageProspectiveOf(absentProspectiveDelivery()), null);

  const joined = lineageReadout({
    events: eventsOf([paidRow(REF_A)]),
    admitted: [admittedRow(REF_A)],
    prospective: remembered,
  });
  assert.equal(joined.lineage.prospective.withRecord, 1);
  assert.equal(joined.lineage.prospective.continuationTransmission.unknown, 1);
  assertNoIdentity(joined, REF_A, prospectiveEvidenceKey(REF_A));
});

test("a captured paid success joins its admitted reference and a replay does not add one", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-lineage-producer-"));
  const reference = `0x${"e".repeat(64)}`;
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "root190-lineage-producer-secret",
    settlementEvidenceSince: "2020-01-01T00:00:00.000Z",
    credentialAttemptSince: "2020-01-01T00:00:00.000Z",
    requestConstructionSince: "2020-01-01T00:00:00.000Z",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
  });
  const paymentSignature = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: { scheme: "exact", network: "eip155:8453", amount: "5000" },
    payload: { authorization: { from: `0x${"a".repeat(40)}` } },
  })).toString("base64url");
  const paymentResponse = Buffer.from(JSON.stringify({
    success: true,
    transaction: reference,
    amount: "5000",
    network: "eip155:8453",
  })).toString("base64url");
  function emit(responseHeaders) {
    const listeners = new Map();
    const req = {
      path: "/extract",
      url: "/extract",
      originalUrl: "/extract",
      method: "GET",
      headers: { "user-agent": "BuyerAgentCanary/9.9", "payment-signature": paymentSignature },
      query: { url: "https://example.com/public" },
      ip: "203.0.113.10",
      socket: {},
    };
    const res = {
      statusCode: 200,
      once(name, listener) { listeners.set(name, listener); },
      getHeader(name) { return responseHeaders[String(name).toLowerCase()]; },
    };
    telemetry.middleware(req, res, () => {});
    listeners.get("finish")?.();
  }
  try {
    emit({ "payment-response": paymentResponse });
    emit({ "payment-response": paymentResponse, "x-payment-replay": "hit" });
    await telemetry.flush();
    const snapshot = await telemetry.snapshot({ days: 1 });
    const captured = lineageEventsOf(snapshot);
    assert.equal(snapshot.byResult.paid_success, 1);
    assert.equal(snapshot.byResult.replay_success, 1);
    assert.equal(captured.rows.length, 1);
    assert.equal(captured.rows[0].reference, reference);
    assert.equal(captured.rows[0].route, "/extract");
    assert.equal(captured.rows[0].protocol, "x402");
    assert.equal(captured.rows[0].amountAtomic, "5000");
    assert.equal(captured.paidSuccessActors, 1);
    assert.equal(Object.hasOwn(snapshot, "settlementReference"), false);

    const omitted = buildCommercePaymentEvidenceReadout({
      eventSnapshot: snapshot,
      settlementReconciliation: { enabled: false },
    });
    assert.equal(omitted.lineage.population, "unreceived");
    assert.equal(JSON.stringify(omitted).includes(reference), false);

    const observed = lineageReadout({
      events: captured,
      admitted: [admittedRow(reference, {
        sourceEventTimestamp: captured.rows[0].timestamp,
        payerContinuity: "onchain_only",
        sourceDeliveryAttribution: { discoverySourceKind: captured.rows[0].discoverySourceKind },
      })],
      prospective: [],
    });
    assert.equal(observed.lineage.exactReferenceJoins, 1);
    assert.equal(observed.lineage.paidSuccessEvents, 1);
    assert.equal(observed.lineage.payerContinuity.onchain_only, 1);
    const observedComplete = captured.windowCoverage === "complete"
      && captured.externalObservationCoverage === "complete"
      && captured.externalObservationCoversRequestedWindow === true;
    assert.equal(observed.lineage.referenceCorrespondence, observedComplete ? "one_to_one" : "not_one_to_one");
    assertNoIdentity(observed, reference, createHash("sha256").update(reference).digest("hex"), paymentSignature);

    const complete = lineageReadout({
      events: {
        ...captured,
        windowStart: new Date(Date.parse(captured.rows[0].timestamp) - 60_000).toISOString(),
        windowEnd: new Date(Date.parse(captured.rows[0].timestamp) + 60_000).toISOString(),
        windowCoverage: "complete",
        externalObservationStart: new Date(Date.parse(captured.rows[0].timestamp) - 60_000).toISOString(),
        externalObservationCoverage: "complete",
        externalObservationCoversRequestedWindow: true,
        settlementBaseline: "2020-01-01T00:00:00.000Z",
      },
      admitted: [admittedRow(reference, {
        sourceEventTimestamp: captured.rows[0].timestamp,
        payerContinuity: "onchain_only",
      })],
      prospective: [],
    });
    assert.equal(complete.lineage.referenceCorrespondence, "one_to_one");
    assert.equal(complete.lineage.exactReferenceJoins, 1);
    assert.equal(complete.lineage.actorCorrespondence, "unproven");
    assertNoIdentity(complete, reference, paymentSignature);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a later external observation refuses one_to_one for a perfect intersection", () => {
  const later = lineageReadout({
    events: eventsOf([paidRow(REF_A)], {
      externalObservationStart: "2026-10-17T12:00:00.000Z",
      externalObservationCoverage: "complete",
      externalObservationCoversRequestedWindow: false,
    }),
    admitted: [admittedRow(REF_A)],
    prospective: [],
  });
  assert.equal(later.lineage.requestedWindowCoverage, "complete");
  assert.equal(later.lineage.externalObservationCoverage, "complete");
  assert.equal(later.lineage.externalObservationCoversRequestedWindow, false);
  assert.equal(later.lineage.exactReferenceJoins, 1);
  assert.equal(later.lineage.admittedInWindowWithoutEventReference, 0);
  assert.equal(later.lineage.referenceCorrespondence, "not_one_to_one");
  assert.equal(later.lineage.boundaries.laterExternalObservationIsNotRequestedCoverage, true);

  const aligned = lineageReadout({
    events: eventsOf([paidRow(REF_A)]),
    admitted: [admittedRow(REF_A)],
    prospective: [],
  });
  assert.equal(aligned.lineage.externalObservationCoversRequestedWindow, true);
  assert.equal(aligned.lineage.referenceCorrespondence, "one_to_one");
});

test("a lossy admission cut refuses one_to_one and a consistent cut can still match", () => {
  const lossy = lineageReadout({
    events: eventsOf([paidRow(REF_A)]),
    admitted: {
      rows: [admittedRow(REF_A)],
      duplicateReferencesIgnored: 1,
      invalidLines: 2,
    },
    prospective: [],
  });
  assert.equal(lossy.lineage.exactReferenceJoins, 1);
  assert.equal(lossy.lineage.duplicateAdmittedReferences, 1);
  assert.equal(lossy.lineage.admittedUnreadableLines, 2);
  assert.equal(lossy.lineage.referenceCorrespondence, "not_one_to_one");
  assert.equal(lossy.lineage.boundaries.lossyAdmissionIsNotCompleteCorrespondence, true);
  assertNoIdentity(lossy, REF_A);

  const undeclared = lineageReadout({
    events: eventsOf([paidRow(REF_A)]),
    admitted: { rows: [admittedRow(REF_A)] },
    prospective: [],
  });
  assert.equal(undeclared.lineage.admittedUnreadableLines, null);
  assert.equal(undeclared.lineage.duplicateAdmittedReferences, null);
  assert.equal(undeclared.lineage.referenceCorrespondence, "not_one_to_one");

  const clean = lineageReadout({
    events: eventsOf([paidRow(REF_A)]),
    admitted: {
      rows: [admittedRow(REF_A)],
      duplicateReferencesIgnored: 0,
      invalidLines: 0,
    },
    prospective: [],
  });
  assert.equal(clean.lineage.referenceCorrespondence, "one_to_one");
  assert.equal(clean.lineage.admittedUnreadableLines, 0);
});

const LEDGER_SCHEMA = "samedaydesk.commerce-settlement-reconciliation.v1";
const LINEAGE_SECRET = "root211-lineage-producer-secret";

function anchorEvent(ts) {
  return {
    v: 3,
    id: "00000000-0000-4000-8000-0000000000a1",
    ts,
    actor: "aaaaaaaaaaaaaaaaaaaaaaaa",
    originClass: "crawler",
    agentDiscoverySource: "agent402",
    method: "GET",
    route: "/openapi.json",
    matched: true,
    kind: "discovery",
    queryKeys: [],
    requestConstruction: "not_measured",
    requestConstructionRequiredKeyCount: 0,
    paymentPresent: false,
    paymentCredentialParsed: false,
    paymentProtocol: null,
    paymentFailureCode: null,
    protocolsOffered: ["x402"],
    replayed: false,
    paymentActor: null,
    paymentIdentifier: null,
    settlementReference: null,
    settlementAmountAtomic: null,
    settlementNetwork: null,
    settlementCurrency: null,
    status: 200,
    result: "discovery",
    durationMs: 1,
  };
}

function ledgerRow(reference, timestamp, amountAtomic) {
  return {
    schemaVersion: LEDGER_SCHEMA,
    state: "reconciled",
    settlementReference: reference,
    amountAtomic,
    route: "/extract",
    protocol: "x402",
    sourceEventTimestamp: timestamp,
    payerContinuity: "onchain_only",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  };
}

function lineageTelemetry(dataDir, externalSince) {
  return createCommerceTelemetry({
    dataDir,
    secret: LINEAGE_SECRET,
    externalSince,
    settlementEvidenceSince: "2020-01-01T00:00:00.000Z",
    credentialAttemptSince: "2020-01-01T00:00:00.000Z",
    requestConstructionSince: "2020-01-01T00:00:00.000Z",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
  });
}

function emitPaidSuccess(telemetry, reference) {
  const listeners = new Map();
  const paymentSignature = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: { scheme: "exact", network: "eip155:8453", amount: "5000" },
    payload: { authorization: { from: `0x${"a".repeat(40)}` } },
  })).toString("base64url");
  const paymentResponse = Buffer.from(JSON.stringify({
    success: true,
    transaction: reference,
    amount: "5000",
    network: "eip155:8453",
  })).toString("base64url");
  const req = {
    path: "/extract",
    url: "/extract",
    originalUrl: "/extract",
    method: "GET",
    headers: { "user-agent": "BuyerAgentCanary/9.9", "payment-signature": paymentSignature },
    query: { url: "https://example.com/public" },
    ip: "203.0.113.10",
    socket: {},
  };
  const res = {
    statusCode: 200,
    once(name, listener) { listeners.set(name, listener); },
    getHeader(name) { return name.toLowerCase() === "payment-response" ? paymentResponse : undefined; },
  };
  telemetry.middleware(req, res, () => {});
  listeners.get("finish")?.();
}

async function waitForContinuation(dataDir) {
  const file = path.join(dataDir, PROSPECTIVE_FILENAME);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const text = await readFile(file, "utf8");
      if (text.includes("not_transmitted")) return text;
    } catch {
      // The paid-success finish path retains transmission after the commerce row.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("producer continuation was not retained");
}

function readoutFromProducers(snapshot, statusPacket) {
  const result = buildCommercePaymentEvidenceReadout({
    eventSnapshot: snapshot,
    settlementReconciliation: statusPacket,
    lineageInputs: {
      events: lineageEventsOf(snapshot),
      admitted: lineageAdmittedOf(statusPacket),
      prospective: lineageProspectiveOf(statusPacket.prospectiveDelivery),
    },
  });
  assert.equal(validateLineage(result), true, JSON.stringify(validateLineage.errors));
  return result;
}

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

test("producer snapshots keep the requested window and refuse a later external baseline", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-lineage-coverage-"));
  const reference = `0x${"b".repeat(64)}`;
  try {
    const anchorTs = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(dataDir, "commerce-events.ndjson"),
      `${JSON.stringify(anchorEvent(anchorTs))}\n`,
      { mode: 0o600 },
    );
    const writer = lineageTelemetry(dataDir, "2020-01-01T00:00:00.000Z");
    emitPaidSuccess(writer, reference);
    await writer.flush();
    await waitForContinuation(dataDir);

    const laterSince = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const laterTelemetry = lineageTelemetry(dataDir, laterSince);
    const laterSnapshot = await laterTelemetry.snapshot({ days: 1 });
    const laterEvents = lineageEventsOf(laterSnapshot);
    assert.equal(laterSnapshot.requestedWindowCoverage, "complete");
    assert.equal(laterEvents.windowStart, laterSnapshot.requestedWindowStart);
    assert.equal(laterEvents.windowCoverage, laterSnapshot.requestedWindowCoverage);
    assert.equal(laterEvents.rows.length, 1);
    assert.equal(laterEvents.rows[0].reference, reference);
    assert.equal(laterEvents.externalObservationCoversRequestedWindow, false);
    assert.equal(laterEvents.externalObservationCoverage, "complete");
    assert.equal(Date.parse(laterEvents.externalObservationStart) > Date.parse(laterSnapshot.requestedWindowStart), true);

    const timestamp = laterEvents.rows[0].timestamp;
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: "",
      client: {},
      dataDir,
      network: "eip155:8453",
      treasury: "",
      settlementEvidenceSince: "2020-01-01T00:00:00.000Z",
    });
    await writeFile(reconciler.ledgerPath, `${JSON.stringify(ledgerRow(reference, timestamp, "5000"))}\n`);
    const cleanStatus = await reconciler.status();
    assert.equal(lineageAdmittedOf(cleanStatus).duplicateReferencesIgnored, 0);
    assert.equal(lineageAdmittedOf(cleanStatus).invalidLines, 0);
    assert.equal(Object.hasOwn(cleanStatus, "admitted"), false);
    const laterRead = readoutFromProducers(laterSnapshot, cleanStatus);
    assert.equal(laterRead.lineage.exactReferenceJoins, 1);
    assert.equal(laterRead.lineage.admittedInWindowWithoutEventReference, 0);
    assert.equal(laterRead.lineage.paidSuccessEvents, 1);
    assert.equal(laterRead.lineage.referenceCorrespondence, "not_one_to_one");
    assert.equal(laterRead.lineage.settlementBaselineCoversWindow, true);
    assertNoIdentity(laterRead, reference);

    const alignedSnapshot = await lineageTelemetry(dataDir, "2020-01-01T00:00:00.000Z").snapshot({ days: 1 });
    const alignedEvents = lineageEventsOf(alignedSnapshot);
    assert.equal(alignedEvents.externalObservationCoversRequestedWindow, true);
    assert.equal(alignedEvents.externalObservationCoverage, "complete");
    assert.equal(alignedSnapshot.requestedWindowCoverage, "complete");
    const alignedRead = readoutFromProducers(alignedSnapshot, cleanStatus);
    assert.equal(alignedRead.lineage.referenceCorrespondence, "one_to_one");
    assert.equal(alignedRead.lineage.exactReferenceJoins, 1);
    assert.equal(alignedRead.lineage.prospective.withRecord, 1);
    assert.equal(alignedRead.lineage.prospective.withoutRecord, 0);
    assert.equal(alignedRead.lineage.prospective.technical.unknown, 1);
    assert.equal(alignedRead.lineage.prospective.declaredFeedback.absent, 1);
    assert.equal(alignedRead.lineage.prospective.continuationTransmission.not_transmitted, 1);
    assert.equal(alignedRead.lineage.usefulness, "unknown");
    assert.equal(alignedRead.lineage.admittedUnreadableLines, 0);
    assert.equal(alignedRead.lineage.duplicateAdmittedReferences, 0);
    assert.equal(alignedRead.lineage.actorCorrespondence, "unproven");
    assert.equal(alignedRead.customerPlane.attributableCustomerCount, null);

    await writeFile(
      reconciler.ledgerPath,
      `${JSON.stringify(ledgerRow(reference, timestamp, "5000"))}\n${JSON.stringify(ledgerRow(reference, timestamp, "10000"))}\nnot-json\n`,
    );
    const lossyStatus = await reconciler.status();
    assert.equal(lineageAdmittedOf(lossyStatus).rows.length, 1);
    assert.equal(lineageAdmittedOf(lossyStatus).duplicateReferencesIgnored, 1);
    assert.equal(lineageAdmittedOf(lossyStatus).invalidLines, 1);
    assert.equal(JSON.stringify(lossyStatus).includes(reference), false);
    const lossyRead = readoutFromProducers(alignedSnapshot, lossyStatus);
    assert.equal(lossyRead.lineage.exactReferenceJoins, 1);
    assert.equal(lossyRead.lineage.duplicateAdmittedReferences, 1);
    assert.equal(lossyRead.lineage.admittedUnreadableLines, 1);
    assert.equal(lossyRead.lineage.referenceCorrespondence, "not_one_to_one");
    assertNoIdentity(lossyRead, reference);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("mounted commerce-demand refuses one_to_one when admission dropped a duplicate and a bad line", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-lineage-mounted-"));
  const reference = `0x${"c".repeat(64)}`;
  const port = await unusedPort();
  let child = null;
  try {
    const anchorTs = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(dataDir, "commerce-events.ndjson"),
      `${JSON.stringify(anchorEvent(anchorTs))}\n`,
      { mode: 0o600 },
    );
    const writer = lineageTelemetry(dataDir, "2020-01-01T00:00:00.000Z");
    emitPaidSuccess(writer, reference);
    await writer.flush();
    await waitForContinuation(dataDir);
    const snapshot = await writer.snapshot({ days: 1 });
    const captured = lineageEventsOf(snapshot);
    assert.equal(snapshot.requestedWindowCoverage, "complete");
    assert.equal(captured.externalObservationCoversRequestedWindow, true);
    await writeFile(
      path.join(dataDir, "commerce-settlements.ndjson"),
      `${JSON.stringify(ledgerRow(reference, captured.rows[0].timestamp, "5000"))}\n${JSON.stringify(ledgerRow(reference, captured.rows[0].timestamp, "9000"))}\nnot-json\n`,
    );
    child = spawn(process.execPath, ["server.js"], {
      cwd: path.dirname(fileURLToPath(import.meta.url)),
      env: {
        ...process.env,
        PORT: String(port),
        PAY_TO: "",
        COMMERCE_DATA_DIR: dataDir,
        COMMERCE_ACTOR_SECRET: LINEAGE_SECRET,
        COMMERCE_EXTERNAL_SINCE: "2020-01-01T00:00:00.000Z",
        COMMERCE_SETTLEMENT_EVIDENCE_SINCE: "2020-01-01T00:00:00.000Z",
        COMMERCE_CREDENTIAL_ATTEMPT_SINCE: "2020-01-01T00:00:00.000Z",
        COMMERCE_REQUEST_CONSTRUCTION_SINCE: "2020-01-01T00:00:00.000Z",
        COMMERCE_AGENT_DISCOVERY_SINCE: "2020-01-01T00:00:00.000Z",
        COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
        NETWORK: "eip155:8453",
        MPP_SECRET_KEY: "",
        PUBLIC_URL: "https://agents.samedaydesk.com",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
      const onData = (chunk) => {
        output = `${output}${chunk}`.slice(-20_000);
        if (!output.includes(`x402-merchant listening on :${port}`)) return;
        clearTimeout(timer);
        resolve();
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/v0/commerce-demand.json?days=1`);
    const body = await response.text();
    assert.equal(response.status, 200, body.slice(0, 500));
    const demand = JSON.parse(body);
    const lineage = demand.paymentEvidence.lineage;
    assert.equal(validateLineage(demand.paymentEvidence), true, JSON.stringify(validateLineage.errors));
    assert.equal(demand.requestedWindowCoverage, "complete", JSON.stringify({
      integrity: demand.integrityStatus,
      retained: demand.retainedParseableEventCount,
      detail: demand.coverage?.integrity,
    }));
    assert.equal(lineage.externalObservationCoversRequestedWindow, true);
    assert.equal(lineage.externalObservationCoverage, "complete");
    assert.equal(lineage.settlementBaselineCoversWindow, true);
    assert.equal(lineage.exactReferenceJoins, 1);
    assert.equal(lineage.duplicateAdmittedReferences, 1);
    assert.equal(lineage.admittedUnreadableLines, 1);
    assert.equal(lineage.referenceCorrespondence, "not_one_to_one");
    assert.equal(lineage.prospective.withRecord, 1);
    assert.equal(lineage.prospective.continuationTransmission.not_transmitted, 1);
    assert.equal(lineage.usefulness, "unknown");
    assert.equal(lineage.actorCorrespondence, "unproven");
    assert.equal(lineage.customerAttribution, null);
    assert.equal(lineage.historicalBackfill, false);
    assert.equal(lineage.canonicalChainReplay, false);
    assert.equal(body.includes(reference), false);
    assert.equal(body.includes(createHash("sha256").update(reference).digest("hex")), false);
  } finally {
    if (child) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("exit", resolve);
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2_000).unref();
      });
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("prospective journal readers withhold an incomplete cohort and keep a complete empty set", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "commerce-lineage-prospective-"));
  const ledger = `${JSON.stringify(ledgerRow(REF_A, WHEN, "5000"))}\n${JSON.stringify(ledgerRow(REF_B, WHEN, "5000"))}\n`;
  const header = {
    schemaVersion: PROSPECTIVE_HEADER_SCHEMA,
    captureVersion: PROSPECTIVE_CAPTURE_VERSION,
    prospectiveSince: "2026-10-13T03:18:47.837Z",
    sourceVersion: "1.23.53",
  };
  const observation = {
    schemaVersion: "samedaydesk.commerce-prospective-delivery-record.v1",
    evidenceKey: prospectiveEvidenceKey(REF_A),
    technical: "validated_response",
    channel: "http",
    taskClass: "absent",
    feedback: "absent",
    feedbackSeal: "none",
    observedAt: WHEN,
  };
  function join(packet) {
    return lineageReadout({
      events: eventsOf([paidRow(REF_A), paidRow(REF_B)], { paidSuccessActors: 2 }),
      admitted: [admittedRow(REF_A), admittedRow(REF_B)],
      prospective: lineageProspectiveOf(packet),
    });
  }
  try {
    const absent = await readProspectiveDelivery({ dataDir: dir, ledger });
    assert.equal(absent.decision, "not_started");
    assert.equal(absent.comparable, false);
    assert.equal(lineageProspectiveOf(absent), null);
    assert.equal(join(absent).lineage.prospective, null);

    await writeFile(path.join(dir, PROSPECTIVE_FILENAME), "{not-json\n", { mode: 0o600 });
    const unreadable = await readProspectiveDelivery({ dataDir: dir, ledger });
    assert.equal(unreadable.decision, "unreadable");
    assert.equal(lineageProspectiveOf(unreadable), null);
    assert.equal(join(unreadable).lineage.prospective, null);

    await writeFile(path.join(dir, PROSPECTIVE_FILENAME), `${JSON.stringify({
      ...header,
      schemaVersion: "samedaydesk.commerce-prospective-delivery-header.v0",
    })}\n`, { mode: 0o600 });
    const mismatched = await readProspectiveDelivery({ dataDir: dir, ledger });
    assert.equal(mismatched.decision, "version_mismatch");
    assert.equal(lineageProspectiveOf(mismatched), null);

    await writeFile(path.join(dir, PROSPECTIVE_FILENAME), `${JSON.stringify(header)}\n${JSON.stringify({
      schemaVersion: PROSPECTIVE_HEADER_SCHEMA,
      kind: "saturated",
      at: "2026-10-13T04:00:00.000Z",
    })}\n${JSON.stringify(observation)}\n`, { mode: 0o600 });
    const saturated = await readProspectiveDelivery({ dataDir: dir, ledger });
    assert.equal(saturated.decision, "saturated");
    assert.equal(saturated.comparable, false);
    assert.equal(lineageProspectiveOf(saturated), null);
    assert.equal(join(saturated).lineage.prospective, null);

    await writeFile(
      path.join(dir, PROSPECTIVE_FILENAME),
      `${JSON.stringify(header)}\n${JSON.stringify(observation)}\n{not-json\n`,
      { mode: 0o600 },
    );
    const corrupt = await readProspectiveDelivery({ dataDir: dir, ledger });
    assert.equal(corrupt.comparable, false);
    assert.equal(corrupt.coverage.corruptLines > 0, true);
    assert.equal(lineageProspectiveOf(corrupt), null);
    const corruptJoin = join(corrupt);
    assert.equal(corruptJoin.lineage.prospective, null);
    assert.equal(corruptJoin.lineage.boundaries.incompleteProspectiveCohortIsUnknown, true);

    const stale = await readProspectiveDelivery({
      dataDir: dir,
      ledger,
      suppliedCutId: "ab".repeat(32),
    });
    assert.equal(stale.decision, "stale_cut");
    assert.equal(stale.comparable, false);
    assert.equal(lineageProspectiveOf(stale), null);

    await writeFile(path.join(dir, PROSPECTIVE_FILENAME), `${JSON.stringify(header)}\n`, { mode: 0o600 });
    const empty = await readProspectiveDelivery({ dataDir: dir, ledger });
    assert.equal(empty.decision, "prospective");
    assert.equal(empty.comparable, true);
    assert.deepEqual(lineageProspectiveOf(empty), []);
    const emptyJoin = join(empty);
    assert.equal(emptyJoin.lineage.prospective.withRecord, 0);
    assert.equal(emptyJoin.lineage.prospective.withoutRecord, 2);
    assert.equal(emptyJoin.lineage.prospective.technical.validated_response, 0);
    assert.equal(emptyJoin.lineage.prospective.declaredFeedback.absent, 0);
    assert.equal(emptyJoin.lineage.referenceCorrespondence, "one_to_one");

    await writeFile(
      path.join(dir, PROSPECTIVE_FILENAME),
      `${JSON.stringify(header)}\n${JSON.stringify(observation)}\n`,
      { mode: 0o600 },
    );
    const recovered = await readProspectiveDelivery({ dataDir: dir, ledger });
    assert.equal(recovered.comparable, true);
    assert.equal(lineageProspectiveOf(recovered).length, 1);
    const recoveredJoin = join(recovered);
    assert.equal(recoveredJoin.lineage.prospective.withRecord, 1);
    assert.equal(recoveredJoin.lineage.prospective.withoutRecord, 1);
    assert.equal(recoveredJoin.lineage.prospective.technical.validated_response, 1);
    assert.equal(recoveredJoin.lineage.prospective.declaredFeedback.absent, 1);
    assert.equal(recoveredJoin.lineage.referenceCorrespondence, "one_to_one");
    assertNoIdentity(recoveredJoin, REF_A, REF_B, prospectiveEvidenceKey(REF_A));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
