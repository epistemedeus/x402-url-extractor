import { RESOURCES } from "./contract.mjs";
import {
  DELIVERY,
  SCHEMA_CONFORMANCE,
  USEFULNESS_UNKNOWN,
  VERDICT,
} from "./classify.mjs";

export const PAID_DIAGNOSTIC_MEASUREMENT = "seller_integrity_report_contract_observation";
export const PAID_DIAGNOSTIC_POPULATION = "external_ordinary_paid_seller_integrity_http_responses_with_bounded_captured_bytes";
export const PAID_DIAGNOSTIC_POPULATION_UNIT = "paid_http_response";

export function isDeliveredSellerDiagnostic(evaluated) {
  return Boolean(
    evaluated
    && evaluated.resource === RESOURCES.SELLER_INTEGRITY
    && evaluated.validatorVerdict === VERDICT.PASS
    && evaluated.deliveryClass === DELIVERY.FULL_BOUNDED_CAPTURE
    && evaluated.schemaConformance === SCHEMA_CONFORMANCE.HOLDS
    && evaluated.usefulness === USEFULNESS_UNKNOWN
  );
}

function emptyCounts() {
  return {
    observations: 0,
    deliveredDiagnostics: 0,
    incompleteAudits: 0,
    malformedReports: 0,
    truncatedOrOversized: 0,
    other: 0,
    settlementReferenced: 0,
    settlementUnknown: 0,
  };
}

function nullCounts() {
  return {
    observations: null,
    deliveredDiagnostics: null,
    incompleteAudits: null,
    malformedReports: null,
    truncatedOrOversized: null,
    other: null,
    settlementReferenced: null,
    settlementUnknown: null,
  };
}

export function emptySellerTransactionPlane() {
  return {
    paidSuccess: 0,
    replayNotPromoted: 0,
    failedOrRejected: 0,
    settlementReferencePresent: 0,
    settlementReferenceAbsent: 0,
  };
}

function countRows(rows) {
  const counts = emptyCounts();
  for (const row of rows) {
    counts.observations += 1;
    if (row.validatorVerdict === VERDICT.PASS && row.deliveryClass === DELIVERY.FULL_BOUNDED_CAPTURE) {
      counts.deliveredDiagnostics += 1;
    } else if (row.deliveryClass === DELIVERY.INCOMPLETE_REPORT) {
      counts.incompleteAudits += 1;
    } else if (row.deliveryClass === DELIVERY.MALFORMED_BODY || row.deliveryClass === DELIVERY.MISSING_BODY) {
      counts.malformedReports += 1;
    } else if (row.deliveryClass === DELIVERY.TRUNCATED_PARTIAL) {
      counts.truncatedOrOversized += 1;
    } else {
      counts.other += 1;
    }
    if (row.settlementReference) counts.settlementReferenced += 1;
    else counts.settlementUnknown += 1;
  }
  return counts;
}

/**
 * Public measurement for bounded seller-integrity report contracts.
 * Counts are paid HTTP responses joined to external paid-success events.
 * They are not a customer census and they do not carry report bodies.
 */
export function publicPaidDiagnosticMeasurement({
  rows = [],
  read = "empty",
  transactionPlane = null,
} = {}) {
  const counts = read === "unavailable" ? nullCounts() : countRows(rows);
  return Object.freeze({
    measurement: PAID_DIAGNOSTIC_MEASUREMENT,
    population: PAID_DIAGNOSTIC_POPULATION,
    populationUnit: PAID_DIAGNOSTIC_POPULATION_UNIT,
    populationIsCustomers: false,
    read,
    ...counts,
    usefulness: USEFULNESS_UNKNOWN,
    schemaConformanceIsBuyerUsefulness: false,
    cashAtomic: "0",
    recognizedRevenueAtomic: "0",
    historicalUncapturedRemainUnknown: true,
    backfill: false,
    transactionPlane: Object.freeze({ ...emptySellerTransactionPlane(), ...(transactionPlane || {}) }),
  });
}
