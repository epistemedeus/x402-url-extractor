import assert from "node:assert/strict";
import test from "node:test";

import Ajv from "ajv";

import {
  COMMERCE_PAYMENT_EVIDENCE_SCHEMA,
  buildCommercePaymentEvidenceReadout,
  commercePaymentEvidenceOutputSchema,
} from "./commerce-payment-evidence.mjs";

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
});
