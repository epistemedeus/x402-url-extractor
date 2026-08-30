export const COMMERCE_PAYMENT_EVIDENCE_SCHEMA =
  "samedaydesk.commerce-payment-evidence-readout.v1";

const COMPLETE = "complete";

function nullableNonnegativeIntegerSchema() {
  return { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] };
}

function nullableAtomicStringSchema() {
  return { anyOf: [{ type: "string", pattern: "^\\d+$" }, { type: "null" }] };
}

function settlementBreakdownSchema() {
  return {
    type: "object",
    additionalProperties: {
      type: "object",
      additionalProperties: false,
      properties: {
        settlements: { type: "integer", minimum: 0 },
        amountAtomic: { type: "string", pattern: "^\\d+$" },
      },
      required: ["settlements", "amountAtomic"],
    },
  };
}

export function commercePaymentEvidenceOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { type: "string", const: COMMERCE_PAYMENT_EVIDENCE_SCHEMA },
      relationship: {
        type: "string",
        enum: [
          "durable_settlement_outlives_retained_paid_event",
          "retained_paid_event_and_durable_settlement",
          "retained_paid_event_pending_or_outside_settlement_ledger",
          "complete_no_paid_evidence",
          "unknown",
        ],
      },
      eventPlane: {
        type: "object",
        additionalProperties: false,
        properties: {
          coverage: { type: "string" },
          retainedPaidSuccessActors: nullableNonnegativeIntegerSchema(),
          retainedRepeatPaidSuccessActors: nullableNonnegativeIntegerSchema(),
          requestedWindowPaidSuccessActors: nullableNonnegativeIntegerSchema(),
          requestedWindowRepeatPaidSuccessActors: nullableNonnegativeIntegerSchema(),
        },
        required: [
          "coverage",
          "retainedPaidSuccessActors",
          "retainedRepeatPaidSuccessActors",
          "requestedWindowPaidSuccessActors",
          "requestedWindowRepeatPaidSuccessActors",
        ],
      },
      settlementPlane: {
        type: "object",
        additionalProperties: false,
        properties: {
          enabled: { type: "boolean" },
          baseline: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
          coverage: { type: "string", enum: ["complete", "unknown_for_full_window"] },
          reconciledSettlements: nullableNonnegativeIntegerSchema(),
          amountAtomic: nullableAtomicStringSchema(),
          byClass: settlementBreakdownSchema(),
          byRoute: settlementBreakdownSchema(),
        },
        required: [
          "enabled",
          "baseline",
          "coverage",
          "reconciledSettlements",
          "amountAtomic",
          "byClass",
          "byRoute",
        ],
      },
      customerPlane: {
        type: "object",
        additionalProperties: false,
        properties: {
          attributableCustomerCount: { type: "null" },
          buyerValidDeliveryCount: { type: "null" },
          repeatIndependentCustomerCount: { type: "null" },
        },
        required: [
          "attributableCustomerCount",
          "buyerValidDeliveryCount",
          "repeatIndependentCustomerCount",
        ],
      },
      boundaries: {
        type: "object",
        additionalProperties: false,
        properties: {
          retainedEventZeroNeverMeansHistoricalZeroWhenCoverageIncomplete: { type: "boolean", const: true },
          settlementNeverBecomesCustomer: { type: "boolean", const: true },
          paymentKeyNeverBecomesCustomer: { type: "boolean", const: true },
          settlementNeverProvesBuyerValidDelivery: { type: "boolean", const: true },
          customerAttributionRequiresSeparateEvidence: { type: "boolean", const: true },
        },
        required: [
          "retainedEventZeroNeverMeansHistoricalZeroWhenCoverageIncomplete",
          "settlementNeverBecomesCustomer",
          "paymentKeyNeverBecomesCustomer",
          "settlementNeverProvesBuyerValidDelivery",
          "customerAttributionRequiresSeparateEvidence",
        ],
      },
    },
    required: [
      "schemaVersion",
      "relationship",
      "eventPlane",
      "settlementPlane",
      "customerPlane",
      "boundaries",
    ],
  };
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function atomicString(value) {
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function settlementSummary(settlementReconciliation, eventSnapshot) {
  const ledger = settlementReconciliation?.ledger;
  const baseline = typeof settlementReconciliation?.settlementEvidenceSince === "string"
    ? settlementReconciliation.settlementEvidenceSince
    : null;
  const requestedWindowStart = typeof eventSnapshot?.requestedWindowStart === "string"
    ? eventSnapshot.requestedWindowStart
    : null;
  const baselineMs = Date.parse(baseline);
  const requestedWindowStartMs = Date.parse(requestedWindowStart);
  const enabled = settlementReconciliation?.enabled === true;
  const coverage = enabled
    && Number.isFinite(baselineMs)
    && Number.isFinite(requestedWindowStartMs)
    && baselineMs <= requestedWindowStartMs
    ? COMPLETE
    : "unknown_for_full_window";
  return {
    enabled,
    baseline,
    coverage,
    reconciledSettlements: nonnegativeInteger(ledger?.reconciledSettlements),
    amountAtomic: atomicString(ledger?.amountAtomic),
    byClass: ledger?.byClass && typeof ledger.byClass === "object"
      ? ledger.byClass
      : {},
    byRoute: ledger?.byRoute && typeof ledger.byRoute === "object"
      ? ledger.byRoute
      : {},
  };
}

export function buildCommercePaymentEvidenceReadout({
  eventSnapshot,
  settlementReconciliation,
} = {}) {
  const retainedPaidSuccessActors = nonnegativeInteger(eventSnapshot?.paidSuccessActors);
  const retainedRepeatPaidSuccessActors = nonnegativeInteger(eventSnapshot?.repeatPaidSuccessActors);
  const eventCoverage = eventSnapshot?.coverage?.metrics?.external?.coverage
    || eventSnapshot?.requestedWindowCoverage
    || "unknown_for_full_window";
  const settlementPlane = settlementSummary(settlementReconciliation, eventSnapshot);
  const durableSettlements = settlementPlane.reconciledSettlements;

  let relationship = "unknown";
  if (durableSettlements !== null && durableSettlements > 0 && retainedPaidSuccessActors === 0) {
    relationship = "durable_settlement_outlives_retained_paid_event";
  } else if (durableSettlements !== null && durableSettlements > 0
    && retainedPaidSuccessActors !== null && retainedPaidSuccessActors > 0) {
    relationship = "retained_paid_event_and_durable_settlement";
  } else if (settlementPlane.enabled && durableSettlements === 0 && retainedPaidSuccessActors !== null
    && retainedPaidSuccessActors > 0) {
    relationship = "retained_paid_event_pending_or_outside_settlement_ledger";
  } else if (durableSettlements === 0 && retainedPaidSuccessActors === 0
    && eventCoverage === COMPLETE && settlementPlane.coverage === COMPLETE) {
    relationship = "complete_no_paid_evidence";
  }

  return {
    schemaVersion: COMMERCE_PAYMENT_EVIDENCE_SCHEMA,
    relationship,
    eventPlane: {
      coverage: eventCoverage,
      retainedPaidSuccessActors,
      retainedRepeatPaidSuccessActors,
      requestedWindowPaidSuccessActors: eventCoverage === COMPLETE
        ? retainedPaidSuccessActors
        : null,
      requestedWindowRepeatPaidSuccessActors: eventCoverage === COMPLETE
        ? retainedRepeatPaidSuccessActors
        : null,
    },
    settlementPlane,
    customerPlane: {
      attributableCustomerCount: null,
      buyerValidDeliveryCount: null,
      repeatIndependentCustomerCount: null,
    },
    boundaries: {
      retainedEventZeroNeverMeansHistoricalZeroWhenCoverageIncomplete: true,
      settlementNeverBecomesCustomer: true,
      paymentKeyNeverBecomesCustomer: true,
      settlementNeverProvesBuyerValidDelivery: true,
      customerAttributionRequiresSeparateEvidence: true,
    },
  };
}
