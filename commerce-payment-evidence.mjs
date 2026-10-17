import { createHash } from "node:crypto";

export const COMMERCE_PAYMENT_EVIDENCE_SCHEMA =
  "samedaydesk.commerce-payment-evidence-readout.v1";
export const COMMERCE_SETTLEMENT_LINEAGE_SCHEMA =
  "samedaydesk.commerce-settlement-lineage.v1";

const COMPLETE = "complete";
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const DIGITS = /^\d+$/;
const POPULATION = "requested_window_external_paid_success";
const DISCOVERY_KINDS = Object.freeze([
  "declared_header",
  "declared_receipt_referral",
  "observed_user_agent",
  "none",
  "unknown",
]);
const DISCOVERY_KIND_SET = new Set(DISCOVERY_KINDS);
const PAYER_CONTINUITY = Object.freeze(["matched_request_pseudonym", "onchain_only", "unknown"]);
const TECHNICAL = Object.freeze([
  "validated_response",
  "schema_invalid",
  "partial",
  "no_response",
  "dropped_connection",
  "failure_after_settlement",
  "channel_conflict",
  "unknown",
]);
const FEEDBACK = Object.freeze(["absent", "declared_useful", "declared_not_useful", "rejected"]);
const TRANSMISSION = Object.freeze(["transmitted", "not_transmitted", "unknown"]);
const TASKS = Object.freeze(["absent", "controlled_test", "external_unknown", "owner_qa", "sponsored_trial"]);
const AMOUNT_MAX = 80;

// Settlement references stay on the producer objects. A WeakMap is invisible to
// JSON.stringify and to assert.deepEqual. A copied object loses the association,
// which is what keeps a spread public aggregate from publishing the join inputs.
const lineageEvents = new WeakMap();
const lineageAdmitted = new WeakMap();
const lineageProspective = new WeakMap();

function remember(map, key, value) {
  if (key && (typeof key === "object" || typeof key === "function")) map.set(key, value);
}

export function rememberLineageEvents(snapshot, value) {
  remember(lineageEvents, snapshot, value);
}

export function lineageEventsOf(snapshot) {
  return snapshot && lineageEvents.has(snapshot) ? lineageEvents.get(snapshot) : null;
}

export function rememberLineageAdmitted(statusPacket, admittedRows) {
  remember(lineageAdmitted, statusPacket, admittedRows);
}

export function lineageAdmittedOf(statusPacket) {
  return statusPacket && lineageAdmitted.has(statusPacket) ? lineageAdmitted.get(statusPacket) : null;
}

export function rememberLineageProspective(prospectivePacket, records) {
  remember(lineageProspective, prospectivePacket, records);
}

export function lineageProspectiveOf(prospectivePacket) {
  return prospectivePacket && lineageProspective.has(prospectivePacket)
    ? lineageProspective.get(prospectivePacket)
    : null;
}

// Same key as prospectiveEvidenceKey. Duplicated so this module does not import
// the journal, the reconciler, or the event writer.
export function settlementLineageEvidenceKey(reference) {
  const text = String(reference || "").toLowerCase();
  if (!TX_HASH.test(text)) return null;
  return createHash("sha256").update(text).digest("hex");
}

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
      lineage: commerceSettlementLineageSchema(),
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
      "lineage",
      "boundaries",
    ],
  };
}

function countObjectSchema(keys) {
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(keys.map((key) => [key, { type: "integer", minimum: 0 }])),
    required: [...keys],
  };
}

function commerceSettlementLineageSchema() {
  const boundaryTrue = { type: "boolean", const: true };
  const boundaryKeys = [
    "referenceMatchIsNotActorIdentity",
    "actorCorrespondenceStaysUnproven",
    "tokenTransferFromIsNotTheTransactionSender",
    "facilitatorSenderIsNotTheBuyer",
    "payerContinuityIsNotACustomer",
    "transmissionIsNotClientObservation",
    "transmissionIsNotADeclaration",
    "omittedTransmissionIsUnknown",
    "feedbackAbsentIsNotRefusal",
    "ownerQaIsNotACustomer",
    "technicalValidationIsNotUsefulness",
    "paymentIsNotACustomer",
    "incompleteCoverageIsNotHistoricalZero",
    "noHistoricalBackfill",
    "populationsAreNotSummed",
    "lossyAdmissionIsNotCompleteCorrespondence",
    "laterExternalObservationIsNotRequestedCoverage",
    "incompleteProspectiveCohortIsUnknown",
  ];
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { type: "string", const: COMMERCE_SETTLEMENT_LINEAGE_SCHEMA },
      historicalBackfill: { type: "boolean", const: false },
      population: { type: "string", enum: [POPULATION, "unreceived"] },
      requestedWindowCoverage: nullable({ type: "string" }),
      externalObservationStart: nullable({ type: "string" }),
      externalObservationCoverage: nullable({ type: "string" }),
      externalObservationCoversRequestedWindow: nullable({ type: "boolean" }),
      settlementBaselineCoversWindow: nullable({ type: "boolean" }),
      paidSuccessEvents: nullableNonnegativeIntegerSchema(),
      paidSuccessActors: nullableNonnegativeIntegerSchema(),
      distinctEventSettlementReferences: nullableNonnegativeIntegerSchema(),
      eventReferencesMissing: nullableNonnegativeIntegerSchema(),
      duplicateEventReferences: nullableNonnegativeIntegerSchema(),
      duplicateAdmittedReferences: nullableNonnegativeIntegerSchema(),
      admittedUnreadableLines: nullableNonnegativeIntegerSchema(),
      eventReferencesAdmittedInWindow: nullableNonnegativeIntegerSchema(),
      eventReferencesAdmittedOutsideWindow: nullableNonnegativeIntegerSchema(),
      eventReferencesAdmittedClockAbsent: nullableNonnegativeIntegerSchema(),
      eventReferencesUnadmitted: nullableNonnegativeIntegerSchema(),
      admittedSettlementsInWindow: nullableNonnegativeIntegerSchema(),
      admittedInWindowWithoutEventReference: nullableNonnegativeIntegerSchema(),
      admittedClockAbsent: nullableNonnegativeIntegerSchema(),
      exactReferenceJoins: nullableNonnegativeIntegerSchema(),
      conflictingReferenceJoins: nullableNonnegativeIntegerSchema(),
      referenceMatchedIncomplete: nullableNonnegativeIntegerSchema(),
      referenceCorrespondence: {
        type: "string",
        enum: ["one_to_one", "not_one_to_one", "unreceived"],
      },
      actorCorrespondence: { type: "string", const: "unproven" },
      payerContinuity: nullable(countObjectSchema(PAYER_CONTINUITY)),
      payerContinuityBoundary: {
        type: "string",
        const: "erc20_transfer_from_is_not_the_transaction_sender",
      },
      payerContinuityCohort: nullable({
        type: "string",
        const: "in_window_reference_intersection",
      }),
      discoverySourceKind: nullable(countObjectSchema(DISCOVERY_KINDS)),
      prospective: nullable({
        type: "object",
        additionalProperties: false,
        properties: {
          withRecord: { type: "integer", minimum: 0 },
          withoutRecord: { type: "integer", minimum: 0 },
          technical: countObjectSchema(TECHNICAL),
          declaredFeedback: countObjectSchema(FEEDBACK),
          continuationTransmission: countObjectSchema(TRANSMISSION),
          declaredTaskClass: countObjectSchema(TASKS),
        },
        required: [
          "withRecord",
          "withoutRecord",
          "technical",
          "declaredFeedback",
          "continuationTransmission",
          "declaredTaskClass",
        ],
      }),
      canonicalChainReplay: { type: "boolean", const: false },
      customerAttribution: { type: "null" },
      usefulness: { type: "string", const: "unknown" },
      boundaries: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...Object.fromEntries(boundaryKeys.map((key) => [key, boundaryTrue])),
          canonicalChainReplay: { type: "boolean", const: false },
        },
        required: [...boundaryKeys, "canonicalChainReplay"],
      },
    },
    required: [
      "schemaVersion",
      "historicalBackfill",
      "population",
      "requestedWindowCoverage",
      "externalObservationStart",
      "externalObservationCoverage",
      "externalObservationCoversRequestedWindow",
      "settlementBaselineCoversWindow",
      "paidSuccessEvents",
      "paidSuccessActors",
      "distinctEventSettlementReferences",
      "eventReferencesMissing",
      "duplicateEventReferences",
      "duplicateAdmittedReferences",
      "admittedUnreadableLines",
      "eventReferencesAdmittedInWindow",
      "eventReferencesAdmittedOutsideWindow",
      "eventReferencesAdmittedClockAbsent",
      "eventReferencesUnadmitted",
      "admittedSettlementsInWindow",
      "admittedInWindowWithoutEventReference",
      "admittedClockAbsent",
      "exactReferenceJoins",
      "conflictingReferenceJoins",
      "referenceMatchedIncomplete",
      "referenceCorrespondence",
      "actorCorrespondence",
      "payerContinuity",
      "payerContinuityBoundary",
      "payerContinuityCohort",
      "discoverySourceKind",
      "prospective",
      "canonicalChainReplay",
      "customerAttribution",
      "usefulness",
      "boundaries",
    ],
  };
}

function nullable(schema) {
  return { anyOf: [schema, { type: "null" }] };
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

function emptyCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function digitAmount(value) {
  return typeof value === "string" && value.length > 0 && value.length <= AMOUNT_MAX && DIGITS.test(value)
    ? value
    : null;
}

function instant(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeEventRow(raw) {
  const referenceText = String(raw?.reference || "");
  return {
    reference: TX_HASH.test(referenceText) ? referenceText.toLowerCase() : null,
    route: nonEmpty(raw?.route),
    protocol: nonEmpty(raw?.protocol),
    amountAtomic: digitAmount(raw?.amountAtomic),
    timestamp: instant(raw?.timestamp) === null ? null : raw.timestamp,
    discoverySourceKind: typeof raw?.discoverySourceKind === "string" ? raw.discoverySourceKind : null,
  };
}

function normalizeAdmittedRow(raw) {
  const referenceText = String(raw?.settlementReference || raw?.reference || "");
  const timestampText = raw?.sourceEventTimestamp ?? raw?.timestamp;
  const payer = raw?.payerContinuity === "matched_request_pseudonym" || raw?.payerContinuity === "onchain_only"
    ? raw.payerContinuity
    : "unknown";
  const attributionKind = raw?.sourceDeliveryAttribution?.discoverySourceKind;
  return {
    reference: TX_HASH.test(referenceText) ? referenceText.toLowerCase() : null,
    route: nonEmpty(raw?.route),
    protocol: nonEmpty(raw?.protocol),
    amountAtomic: digitAmount(raw?.amountAtomic),
    timestamp: instant(timestampText) === null ? null : timestampText,
    payerContinuity: payer,
    discoverySourceKind: typeof raw?.discoverySourceKind === "string"
      ? raw.discoverySourceKind
      : (typeof attributionKind === "string" ? attributionKind : null),
  };
}

function normalizeEvents(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.rows)) return null;
  const windowStartMs = instant(value.windowStart);
  const windowEndMs = instant(value.windowEnd);
  if (windowStartMs === null || windowEndMs === null || windowStartMs > windowEndMs) return null;
  const actors = value.paidSuccessActors;
  return {
    paidSuccessActors: Number.isSafeInteger(actors) && actors >= 0 ? actors : null,
    windowStartMs,
    windowEndMs,
    windowCoverage: typeof value.windowCoverage === "string" ? value.windowCoverage : null,
    externalObservationStart: typeof value.externalObservationStart === "string"
      ? value.externalObservationStart
      : null,
    externalObservationCoverage: typeof value.externalObservationCoverage === "string"
      ? value.externalObservationCoverage
      : null,
    externalObservationCoversRequestedWindow: value.externalObservationCoversRequestedWindow === true
      ? true
      : value.externalObservationCoversRequestedWindow === false
        ? false
        : null,
    settlementBaseline: typeof value.settlementBaseline === "string" ? value.settlementBaseline : null,
    rows: value.rows.map(normalizeEventRow),
  };
}

function fieldRelation(left, right, equal) {
  if (left == null || right == null) return "incomplete";
  return equal(left, right) ? "match" : "conflict";
}

function classifyReference(eventRows, admitted) {
  let conflict = false;
  let incomplete = false;
  const admittedMs = instant(admitted.timestamp);
  for (const event of eventRows) {
    const relations = [
      fieldRelation(event.route, admitted.route, (left, right) => left === right),
      fieldRelation(event.protocol, admitted.protocol, (left, right) => left === right),
      fieldRelation(event.amountAtomic, admitted.amountAtomic, (left, right) => BigInt(left) === BigInt(right)),
      fieldRelation(instant(event.timestamp), admittedMs, (left, right) => left === right),
    ];
    if (relations.includes("conflict")) conflict = true;
    if (relations.includes("incomplete")) incomplete = true;
  }
  if (conflict) return "conflict";
  if (incomplete) return "incomplete";
  return eventRows.length === 1 ? "exact" : "duplicate";
}

function discoveryKindFor(eventRows, admitted) {
  const explicit = eventRows.some((row) => row.discoverySourceKind != null);
  if (!explicit) {
    return DISCOVERY_KIND_SET.has(admitted.discoverySourceKind) ? admitted.discoverySourceKind : "unknown";
  }
  const labels = eventRows.map((row) => (
    DISCOVERY_KIND_SET.has(row.discoverySourceKind) ? row.discoverySourceKind : "unknown"
  ));
  return labels.every((label) => label === labels[0]) ? labels[0] : "unknown";
}

function foldLabel(value, allowed) {
  return allowed.includes(value) ? value : "unknown";
}

function lineageBoundaries() {
  return {
    referenceMatchIsNotActorIdentity: true,
    actorCorrespondenceStaysUnproven: true,
    tokenTransferFromIsNotTheTransactionSender: true,
    facilitatorSenderIsNotTheBuyer: true,
    payerContinuityIsNotACustomer: true,
    transmissionIsNotClientObservation: true,
    transmissionIsNotADeclaration: true,
    omittedTransmissionIsUnknown: true,
    feedbackAbsentIsNotRefusal: true,
    ownerQaIsNotACustomer: true,
    technicalValidationIsNotUsefulness: true,
    paymentIsNotACustomer: true,
    incompleteCoverageIsNotHistoricalZero: true,
    noHistoricalBackfill: true,
    populationsAreNotSummed: true,
    lossyAdmissionIsNotCompleteCorrespondence: true,
    laterExternalObservationIsNotRequestedCoverage: true,
    incompleteProspectiveCohortIsUnknown: true,
    canonicalChainReplay: false,
  };
}

function lineageResult(values) {
  return {
    schemaVersion: COMMERCE_SETTLEMENT_LINEAGE_SCHEMA,
    historicalBackfill: false,
    population: values.population,
    requestedWindowCoverage: values.requestedWindowCoverage ?? null,
    externalObservationStart: values.externalObservationStart ?? null,
    externalObservationCoverage: values.externalObservationCoverage ?? null,
    externalObservationCoversRequestedWindow: values.externalObservationCoversRequestedWindow ?? null,
    settlementBaselineCoversWindow: values.settlementBaselineCoversWindow ?? null,
    paidSuccessEvents: values.paidSuccessEvents ?? null,
    paidSuccessActors: values.paidSuccessActors ?? null,
    distinctEventSettlementReferences: values.distinctEventSettlementReferences ?? null,
    eventReferencesMissing: values.eventReferencesMissing ?? null,
    duplicateEventReferences: values.duplicateEventReferences ?? null,
    duplicateAdmittedReferences: values.duplicateAdmittedReferences ?? null,
    admittedUnreadableLines: values.admittedUnreadableLines ?? null,
    eventReferencesAdmittedInWindow: values.eventReferencesAdmittedInWindow ?? null,
    eventReferencesAdmittedOutsideWindow: values.eventReferencesAdmittedOutsideWindow ?? null,
    eventReferencesAdmittedClockAbsent: values.eventReferencesAdmittedClockAbsent ?? null,
    eventReferencesUnadmitted: values.eventReferencesUnadmitted ?? null,
    admittedSettlementsInWindow: values.admittedSettlementsInWindow ?? null,
    admittedInWindowWithoutEventReference: values.admittedInWindowWithoutEventReference ?? null,
    admittedClockAbsent: values.admittedClockAbsent ?? null,
    exactReferenceJoins: values.exactReferenceJoins ?? null,
    conflictingReferenceJoins: values.conflictingReferenceJoins ?? null,
    referenceMatchedIncomplete: values.referenceMatchedIncomplete ?? null,
    referenceCorrespondence: values.referenceCorrespondence,
    actorCorrespondence: "unproven",
    payerContinuity: values.payerContinuity ?? null,
    payerContinuityBoundary: "erc20_transfer_from_is_not_the_transaction_sender",
    payerContinuityCohort: values.payerContinuityCohort ?? null,
    discoverySourceKind: values.discoverySourceKind ?? null,
    prospective: values.prospective ?? null,
    canonicalChainReplay: false,
    customerAttribution: null,
    usefulness: "unknown",
    boundaries: lineageBoundaries(),
  };
}

function unreceivedLineage(extra = {}) {
  return lineageResult({
    population: "unreceived",
    referenceCorrespondence: "unreceived",
    ...extra,
  });
}

function indexAdmitted(rows) {
  const byReference = new Map();
  let duplicateAdmittedReferences = 0;
  for (const row of rows) {
    if (!row.reference) continue;
    if (byReference.has(row.reference)) {
      duplicateAdmittedReferences += 1;
      continue;
    }
    byReference.set(row.reference, row);
  }
  return { byReference, duplicateAdmittedReferences };
}

function prospectiveForCohort(records, cohort) {
  const byKey = new Map();
  for (const record of records) {
    if (!record || typeof record.evidenceKey !== "string" || !/^[0-9a-f]{64}$/.test(record.evidenceKey)) continue;
    if (!byKey.has(record.evidenceKey)) byKey.set(record.evidenceKey, record);
  }
  const technical = emptyCounts(TECHNICAL);
  const declaredFeedback = emptyCounts(FEEDBACK);
  const continuationTransmission = emptyCounts(TRANSMISSION);
  const declaredTaskClass = emptyCounts(TASKS);
  let withRecord = 0;
  let withoutRecord = 0;
  for (const member of cohort) {
    const key = settlementLineageEvidenceKey(member.reference);
    const record = key ? byKey.get(key) : null;
    if (!record) {
      withoutRecord += 1;
      continue;
    }
    withRecord += 1;
    technical[foldLabel(record.technical, TECHNICAL)] += 1;
    declaredFeedback[foldLabel(record.feedback, FEEDBACK)] += 1;
    declaredTaskClass[foldLabel(record.taskClass, TASKS)] += 1;
    const transmitted = Object.hasOwn(record, "continuationTransmission")
      ? record.continuationTransmission
      : null;
    continuationTransmission[TRANSMISSION.includes(transmitted) ? transmitted : "unknown"] += 1;
  }
  return {
    withRecord,
    withoutRecord,
    technical,
    declaredFeedback,
    continuationTransmission,
    declaredTaskClass,
  };
}

// Admission already drops repeated references and keeps malformed lines on the
// summary. The cut carries both so a deduplicated row list cannot become
// one_to_one. A supplied array is that caller's whole population.
export function lineageAdmissionCut(admission) {
  const rows = Array.isArray(admission?.admitted) ? admission.admitted.slice() : [];
  return Object.freeze({
    rows: Object.freeze(rows),
    duplicateReferencesIgnored: nonnegativeInteger(admission?.duplicateReferencesIgnored),
    invalidLines: nonnegativeInteger(admission?.summary?.invalidLines),
  });
}

function admissionInput(value) {
  if (Array.isArray(value)) {
    return {
      rows: value.map(normalizeAdmittedRow),
      duplicateReferencesIgnored: 0,
      invalidLines: 0,
    };
  }
  if (!value || typeof value !== "object" || !Array.isArray(value.rows)) return null;
  return {
    rows: value.rows.map(normalizeAdmittedRow),
    duplicateReferencesIgnored: nonnegativeInteger(value.duplicateReferencesIgnored),
    invalidLines: nonnegativeInteger(value.invalidLines),
  };
}

function admittedDuplicateCount(admission, indexedDuplicates) {
  if (admission.duplicateReferencesIgnored === null) return null;
  return indexedDuplicates + admission.duplicateReferencesIgnored;
}

export function buildCommerceSettlementLineage(lineageInputs = {}) {
  const events = normalizeEvents(lineageInputs?.events);
  const admission = admissionInput(lineageInputs?.admitted);
  const prospectiveRecords = Array.isArray(lineageInputs?.prospective) ? lineageInputs.prospective : null;
  if (!events) {
    if (!admission) return unreceivedLineage();
    const admittedOnly = indexAdmitted(admission.rows);
    return unreceivedLineage({
      duplicateAdmittedReferences: admittedDuplicateCount(admission, admittedOnly.duplicateAdmittedReferences),
      admittedUnreadableLines: admission.invalidLines,
      admittedClockAbsent: admission.rows.filter((row) => {
        if (row.reference && admittedOnly.byReference.get(row.reference) !== row) return false;
        return row.timestamp == null;
      }).length,
    });
  }

  const baselineMs = instant(events.settlementBaseline);
  const settlementBaselineCoversWindow = baselineMs !== null && baselineMs <= events.windowStartMs;
  let eventReferencesMissing = 0;
  let duplicateEventReferences = 0;
  const eventsByReference = new Map();
  for (const row of events.rows) {
    const timestampMs = instant(row.timestamp);
    const eligible = settlementBaselineCoversWindow
      || (baselineMs !== null && timestampMs !== null && timestampMs >= baselineMs);
    if (!eligible) continue;
    if (!row.reference) {
      eventReferencesMissing += 1;
      continue;
    }
    const list = eventsByReference.get(row.reference) || [];
    list.push(row);
    eventsByReference.set(row.reference, list);
  }
  for (const list of eventsByReference.values()) {
    if (list.length > 1) duplicateEventReferences += 1;
  }
  const eventSide = {
    population: POPULATION,
    requestedWindowCoverage: events.windowCoverage,
    externalObservationStart: events.externalObservationStart,
    externalObservationCoverage: events.externalObservationCoverage,
    externalObservationCoversRequestedWindow: events.externalObservationCoversRequestedWindow,
    settlementBaselineCoversWindow,
    paidSuccessEvents: events.rows.length,
    paidSuccessActors: events.paidSuccessActors,
    distinctEventSettlementReferences: eventsByReference.size,
    eventReferencesMissing,
    duplicateEventReferences,
  };
  if (!admission) {
    return lineageResult({
      ...eventSide,
      referenceCorrespondence: "unreceived",
    });
  }

  const indexed = indexAdmitted(admission.rows);
  const { byReference } = indexed;
  const duplicateAdmittedReferences = admittedDuplicateCount(admission, indexed.duplicateAdmittedReferences);
  const admittedRows = admission.rows;
  const placed = [
    ...byReference.values(),
    ...admittedRows.filter((row) => !row.reference),
  ];
  let admittedClockAbsent = 0;
  let admittedSettlementsInWindow = 0;
  let admittedInWindowWithoutEventReference = 0;
  for (const row of placed) {
    const timestampMs = instant(row.timestamp);
    if (timestampMs === null) {
      admittedClockAbsent += 1;
      continue;
    }
    const inside = timestampMs >= events.windowStartMs && timestampMs <= events.windowEndMs;
    if (!inside) continue;
    admittedSettlementsInWindow += 1;
    if (!row.reference || !eventsByReference.has(row.reference)) admittedInWindowWithoutEventReference += 1;
  }

  let eventReferencesAdmittedInWindow = 0;
  let eventReferencesAdmittedOutsideWindow = 0;
  let eventReferencesAdmittedClockAbsent = 0;
  let eventReferencesUnadmitted = 0;
  let exactReferenceJoins = 0;
  let conflictingReferenceJoins = 0;
  let referenceMatchedIncomplete = 0;
  const cohort = [];
  for (const [reference, eventRows] of eventsByReference) {
    const admitted = byReference.get(reference);
    if (!admitted) {
      eventReferencesUnadmitted += 1;
      continue;
    }
    const admittedMs = instant(admitted.timestamp);
    if (admittedMs === null) {
      eventReferencesAdmittedClockAbsent += 1;
      continue;
    }
    if (admittedMs < events.windowStartMs || admittedMs > events.windowEndMs) {
      eventReferencesAdmittedOutsideWindow += 1;
      continue;
    }
    eventReferencesAdmittedInWindow += 1;
    const kind = classifyReference(eventRows, admitted);
    if (kind === "exact") exactReferenceJoins += 1;
    else if (kind === "conflict") conflictingReferenceJoins += 1;
    else if (kind === "incomplete") referenceMatchedIncomplete += 1;
    cohort.push({ reference, eventRows, admitted });
  }

  const payerContinuity = emptyCounts(PAYER_CONTINUITY);
  const discoverySourceKind = emptyCounts(DISCOVERY_KINDS);
  for (const member of cohort) {
    payerContinuity[member.admitted.payerContinuity] += 1;
    discoverySourceKind[discoveryKindFor(member.eventRows, member.admitted)] += 1;
  }
  const externalObservationComplete = events.externalObservationCoversRequestedWindow === true
    && events.externalObservationCoverage === COMPLETE;
  const admissionIntegrityComplete = admission.invalidLines === 0
    && duplicateAdmittedReferences === 0;
  const oneToOne = events.windowCoverage === COMPLETE
    && externalObservationComplete
    && settlementBaselineCoversWindow
    && admissionIntegrityComplete
    && admittedClockAbsent === 0
    && eventReferencesMissing === 0
    && duplicateEventReferences === 0
    && conflictingReferenceJoins === 0
    && referenceMatchedIncomplete === 0
    && eventReferencesUnadmitted === 0
    && eventReferencesAdmittedOutsideWindow === 0
    && eventReferencesAdmittedClockAbsent === 0
    && events.rows.length === exactReferenceJoins
    && admittedSettlementsInWindow === exactReferenceJoins
    && admittedInWindowWithoutEventReference === 0
    && events.rows.length === eventsByReference.size
    && eventReferencesAdmittedInWindow === exactReferenceJoins;

  return lineageResult({
    ...eventSide,
    duplicateAdmittedReferences,
    admittedUnreadableLines: admission.invalidLines,
    eventReferencesAdmittedInWindow,
    eventReferencesAdmittedOutsideWindow,
    eventReferencesAdmittedClockAbsent,
    eventReferencesUnadmitted,
    admittedSettlementsInWindow,
    admittedInWindowWithoutEventReference,
    admittedClockAbsent,
    exactReferenceJoins,
    conflictingReferenceJoins,
    referenceMatchedIncomplete,
    referenceCorrespondence: oneToOne ? "one_to_one" : "not_one_to_one",
    payerContinuity,
    payerContinuityCohort: "in_window_reference_intersection",
    discoverySourceKind,
    prospective: prospectiveRecords ? prospectiveForCohort(prospectiveRecords, cohort) : null,
  });
}

export function buildCommercePaymentEvidenceReadout({
  eventSnapshot,
  settlementReconciliation,
  lineageInputs,
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
    lineage: buildCommerceSettlementLineage(lineageInputs),
    boundaries: {
      retainedEventZeroNeverMeansHistoricalZeroWhenCoverageIncomplete: true,
      settlementNeverBecomesCustomer: true,
      paymentKeyNeverBecomesCustomer: true,
      settlementNeverProvesBuyerValidDelivery: true,
      customerAttributionRequiresSeparateEvidence: true,
    },
  };
}
