import { projectPublicAggregate } from "../../../tools/ops/three-site-settlement-join/measure/src/outcome-binding.mjs";
import { sha256 } from "./canonical.mjs";
import { fail } from "./errors.mjs";
import { assertProjectable } from "./privacy.mjs";

function integer(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function classRows(byClass) {
  if (!byClass || typeof byClass !== "object" || Array.isArray(byClass)) return [];
  return Object.entries(byClass).map(([name, row]) => ({
    class: name,
    settlements: integer(row?.settlements),
    amountAtomic: typeof row?.amountAtomic === "string" ? row.amountAtomic : null,
    recognizedRevenue: false,
  })).sort((left, right) => left.class.localeCompare(right.class));
}

export function projectDemandDocument(document, meta) {
  assertProjectable(document);
  let receipt;
  try {
    receipt = projectPublicAggregate(document, meta);
  } catch {
    fail("public_aggregate_rejected");
  }
  const rare = document.durableRareFunnel || {};
  const coverage = document.requestedWindowCoverage === "complete" ? "complete" : "unknown_for_full_window";
  const projected = {
    decision: receipt.decision,
    individualJoin: receipt.individualJoin === true,
    recognizedRevenueAtomic: "0",
    generatedAt: typeof document.generatedAt === "string" ? document.generatedAt : null,
    window: {
      start: typeof document.requestedWindowStart === "string" ? document.requestedWindowStart : null,
      end: typeof document.requestedWindowEnd === "string" ? document.requestedWindowEnd : null,
      days: integer(document.requestedWindowDays),
      coverage,
      complete: document.requestedWindowComplete === true,
    },
    externalEvents: integer(document.externalEvents),
    retainedParseableEventCount: integer(document.retainedParseableEventCount),
    byResult: {
      discovery: integer(document.byResult?.discovery),
      protocol_discovery: integer(document.byResult?.protocol_discovery),
      challenge: integer(document.byResult?.challenge),
      paid_success: integer(document.byResult?.paid_success),
      validation_failure: integer(document.byResult?.validation_failure),
    },
    customerPlaneNull: receipt.aggregate?.customerPlane?.attributableCustomerCount === null
      && receipt.aggregate?.customerPlane?.buyerValidDeliveryCount === null
      && receipt.aggregate?.customerPlane?.repeatIndependentCustomerCount === null,
    reconciledSettlements: integer(document.paymentEvidence?.settlementPlane?.reconciledSettlements),
    settlementAmountAtomic: typeof document.paymentEvidence?.settlementPlane?.amountAtomic === "string"
      ? document.paymentEvidence.settlementPlane.amountAtomic
      : null,
    settlementAmountIsRevenue: false,
    settlementClasses: classRows(document.paymentEvidence?.settlementPlane?.byClass),
    paidSuccessActors: integer(document.paidSuccessActors),
    independentPaidSuccessActors: integer(document.independentPaidSuccessActors),
    repeatIndependentPaidSuccessActors: integer(document.repeatIndependentPaidSuccessActors),
    independentUsefulDemand: rare.independentUsefulDemand === "unknown" || rare.independentUsefulDemand == null
      ? "unknown"
      : "not_read_as_customer",
    usefulnessRemainsUnknown: rare.boundaries?.usefulnessRemainsUnknownWithoutSeparateAuthority === true,
    zeroIsNotHistoricalZero: rare.boundaries?.zeroNeverMeansHistoricalZeroWhenCoverageIncomplete === true,
    actorHashIsNotIdentity: rare.boundaries?.actorHashNotIndependentIdentity === true,
    missingEvidence: receipt.missingEvidence,
    source: {
      locator: meta.publicAggregateUrl || meta.path,
      sha256: meta.sha256,
      bytes: meta.bytes,
    },
  };
  if (receipt.aggregate?.requestedWindowCoverage && receipt.aggregate.requestedWindowCoverage !== projected.window.coverage) {
    fail("public_aggregate_rejected");
  }
  if (receipt.recognizedRevenueAtomic !== "0" || receipt.individualJoin !== false) fail("public_aggregate_rejected");
  const unclassified = projected.settlementClasses.find((row) => row.class === "unclassified");
  projected.unclassifiedSettlementsRemainUnclassified = Boolean(unclassified);
  projected.independentUseFromSettlements = 0;
  return projected;
}

export function projectDemandText(text, locator) {
  const bytes = Buffer.byteLength(text);
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    fail("public_aggregate_rejected");
  }
  return projectDemandDocument(document, {
    kind: "public_aggregate",
    path: locator,
    sha256: sha256(text),
    bytes,
    publicAggregateUrl: locator,
  });
}
