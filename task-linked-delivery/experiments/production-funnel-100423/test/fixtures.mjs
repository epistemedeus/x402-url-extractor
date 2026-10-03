const TX = `0x${"ab".repeat(32)}`;
const OTHER = `0x${"cd".repeat(32)}`;
const DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);

export function phase(overrides = {}) {
  return {
    bodyDigest: null,
    callId: "call-100423",
    cohort: "unknown",
    evidenceKind: "supplied_fixture",
    httpStatus: null,
    phase: "challenge",
    rail: "x402-base",
    route: "/extract",
    settlementReference: null,
    ...overrides,
  };
}

export function positivePhases() {
  return [
    phase(),
    phase({
      phase: "delivery",
      httpStatus: 200,
      bodyDigest: DIGEST,
      settlementReference: TX,
    }),
    phase({ phase: "settlement", settlementReference: TX }),
    phase({ phase: "later_read", bodyDigest: DIGEST }),
  ];
}

export const references = { TX, OTHER, DIGEST, OTHER_DIGEST };

function rare(counts) {
  return {
    paymentHeaderEvents: counts.headers,
    parseableCredentialAttemptEvents: counts.parsed,
    unparseablePaymentHeaderEvents: counts.headers - counts.parsed,
    paidSuccessEvents: counts.paid,
    paidSuccessActors: counts.actors,
    paymentErrorEvents: counts.errors,
    byResult: counts.byResult,
    independentOperatorCount: null,
    independentUsefulDemand: "unknown",
    coverage: {
      retainedObservationStartUtcDay: "2026-09-11",
      retainedObservationEndUtcDay: "2026-09-30",
      retainedDurationWholeDays: 20,
      retainedParseableRecordCount: 102,
      requestedWindowComplete: false,
      captureContinuityProven: false,
      integrityStatus: "ok",
    },
  };
}

export function aggregate({ days = 1, complete = true, headers = 0, paid = 0, actors = 0, errors = 0, byResult = {}, customers = null } = {}) {
  const start = days === 1 ? "2026-10-02T03:01:52.512Z" : "2026-09-03T03:01:52.512Z";
  return {
    generatedAt: "2026-10-03T03:01:52.512Z",
    requestedWindowDays: days,
    requestedWindowStart: start,
    requestedWindowEnd: "2026-10-03T03:01:52.512Z",
    requestedWindowComplete: complete,
    requestedWindowCoverage: complete ? "complete" : "unknown_for_full_window",
    externalEvents: 10,
    paidSuccessActors: 0,
    independentPaidSuccessActors: 0,
    agentChallengeActors: 3,
    paymentHeaderEvents: days === 1 ? 0 : headers,
    parseableCredentialAttemptEvents: 0,
    constructedRequestEvents: 1,
    byResult: {
      challenge: 4,
      discovery: 5,
      validation_failure: 1,
      unmatched: 0,
      protocol_discovery: 0,
      paid_success: 0,
    },
    agentChallengeBySource: { "generic-agent-indexer": 4 },
    constructedRequestBySource: { "direct-or-unattributed": 1 },
    coverage: {
      retainedDurationWholeDays: 0,
      retainedObservationStartUtcDay: null,
      retainedObservationEndUtcDay: null,
    },
    durableRareFunnel: rare({ headers, parsed: Math.min(headers, 1), paid, actors, errors, byResult }),
    paymentEvidence: {
      relationship: "durable_settlement_outlives_retained_paid_event",
      eventPlane: { coverage: complete ? "complete" : "unknown_for_full_window", requestedWindowPaidSuccessActors: 0 },
      settlementPlane: {
        coverage: complete ? "complete" : "unknown_for_full_window",
        reconciledSettlements: 43,
        amountAtomic: "1027000",
        byClass: {
          unclassified: { settlements: 30, amountAtomic: "440000" },
          internal: { settlements: 12, amountAtomic: "577000" },
          validation: { settlements: 1, amountAtomic: "10000" },
        },
      },
      customerPlane: {
        attributableCustomerCount: customers,
        buyerValidDeliveryCount: null,
        repeatIndependentCustomerCount: null,
      },
    },
    policyContractFunnel: {
      exactAction: {
        paidRoute: "/security/wallet-policy-conformance",
        contractReads: 1,
        challengeContinuationActors: 0,
        credentialContinuationActors: 0,
        paidDeliveryContinuationActors: 0,
      },
    },
  };
}

export function meta(url) {
  return { url, sha256: "a".repeat(64), bytes: 100, acquiredAt: "2026-10-03T03:02:00.000Z", httpStatus: 200 };
}

export const SEEDED_PROPOSAL = {
  census: true,
  payingCustomers: 43,
  uniqueAgentsFromActors: true,
  windowPaidDeliveries: 0,
  joinSluzenCallId: true,
  publicExample: true,
  laterRepeatInheritsUsefulness: true,
  productionPopulation: true,
};
