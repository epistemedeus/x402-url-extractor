import { adaptRecords } from "./adapters.mjs";
import { digestOf } from "./canonical.mjs";
import {
  AUTHORITIES,
  BUNDLE_SCHEMA,
  CONSUMER_COMMIT,
  EVIDENCE_JOIN_COMMIT,
  HISTORIC_BANKED_REVENUE_USDC,
  OBSERVATION_SCHEMA,
  PUBLIC_SCHEMA,
  QUERY_SCHEMA,
  RECEIPT_SCHEMA,
  SOURCE_CLASSES,
  STAGES,
  TASK_REF_RE,
} from "./constants.mjs";
import { mergeCosts, observeGross, projectCosts, settleEconomics } from "./economics.mjs";
import { fail } from "./errors.mjs";
import { assertProjectable, refusesDirective } from "./privacy.mjs";

const BLOCKING_REASONS = new Set([
  "audit_incomplete",
  "additional_work_missing",
  "schema_invalid",
  "delivery_failed",
  "not_delivery",
  "body_unavailable",
  "missing_field",
  "execution_failed",
  "target_mismatch",
  "echoes_free_diagnostic",
]);

function observationUsefulness(row) {
  const reasons = new Set((row.reasons || []).filter((reason) => typeof reason === "string"));
  if (row.truncated || row.incomplete) {
    reasons.add("incomplete_record");
    return { useful: "unknown", establishes: false, blocks: false, reasons };
  }
  if (row.authority === "wallet_transfer" || row.sourceClass === "wallet_transfer") {
    reasons.add("wallet_transfer_not_settlement");
    return { useful: "unknown", establishes: false, blocks: false, reasons };
  }
  if (row.httpStatus === 402 && row.paymentPresented !== true) {
    reasons.add("challenge_not_useful");
    return { useful: "false", establishes: false, blocks: false, reasons };
  }
  if (row.httpStatus === 200 && row.serverExecution === "absent" && row.explicitCriterionMet !== true && row.stage === "verified_delivery") {
    reasons.add("http_200_not_useful");
    return { useful: "false", establishes: false, blocks: false, reasons };
  }
  if (row.bodyDigest && row.serverExecution === "absent" && row.explicitCriterionMet !== true && row.stage === "verified_delivery") {
    reasons.add("byte_hash_not_useful");
  }
  if ([...reasons].some((reason) => BLOCKING_REASONS.has(reason)) && (row.stage === "verified_delivery" || row.stage === "caller_expected_output")) {
    return { useful: "false", establishes: false, blocks: true, reasons };
  }
  if (row.serverExecution === "failed") {
    reasons.add("execution_failed");
    return { useful: "false", establishes: false, blocks: true, reasons };
  }
  if (row.authority === "caller_expectation" && row.explicitCriterionMet === true) {
    reasons.add("caller_flag_not_execution");
    return { useful: "unknown", establishes: false, blocks: false, reasons };
  }
  const agreed = row.serverExecution === "not_found"
    && row.callerExpectation === "agreed_negative"
    && row.expectationAuthority === "operation_contract"
    && row.settlementTrusted === true
    && row.settlementStatus === "verified"
    && row.withdrawn !== true;
  if (agreed && row.stage === "verified_delivery") {
    reasons.add("agreed_negative");
    return { useful: "agreed_negative", establishes: true, blocks: false, reasons };
  }
  if (row.explicitCriterionMet === true && row.authority === "server_execution" && row.serverExecution === "found" && row.withdrawn !== true) {
    return { useful: "true", establishes: true, blocks: false, reasons };
  }
  return { useful: "unknown", establishes: false, blocks: false, reasons };
}

function normalize(row, index) {
  const eventId = typeof row.eventId === "string" && /^[a-z0-9][a-z0-9:_-]{0,80}$/.test(row.eventId)
    ? row.eventId
    : `row-${index}`;
  const operationId = typeof row.operationId === "string" && row.operationId.length > 0 && row.operationId.length <= 160
    ? row.operationId
    : "missing-operation";
  const sourceClass = SOURCE_CLASSES.includes(row.sourceClass) ? row.sourceClass : "unknown";
  const authority = AUTHORITIES.includes(row.authority) ? row.authority : "unknown";
  const stage = STAGES.includes(row.stage) ? row.stage : "task_discovery";
  const taskRef = typeof row.taskRef === "string" && TASK_REF_RE.test(row.taskRef) ? row.taskRef : null;
  const decision = observationUsefulness({ ...row, stage, authority, sourceClass });
  return {
    schema: OBSERVATION_SCHEMA,
    eventId,
    operationId,
    taskRef,
    commerceEventId: typeof row.commerceEventId === "string" ? row.commerceEventId : null,
    stage,
    sourceClass,
    authority,
    cohort: typeof row.cohort === "string" ? row.cohort : "unknown",
    httpStatus: Number.isInteger(row.httpStatus) ? row.httpStatus : null,
    serverExecution: typeof row.serverExecution === "string" ? row.serverExecution : "absent",
    callerExpectation: typeof row.callerExpectation === "string" ? row.callerExpectation : "absent",
    expectationAuthority: row.expectationAuthority || null,
    explicitCriterionMet: row.explicitCriterionMet === true,
    settlementStatus: typeof row.settlementStatus === "string" ? row.settlementStatus : "absent",
    settlementTrusted: row.settlementTrusted === true,
    grossSettledAtomic: typeof row.grossSettledAtomic === "string" ? row.grossSettledAtomic : null,
    paidValidDelivery: row.paidValidDelivery === true,
    reused: row.reused === true,
    withdrawn: row.withdrawn === true,
    incomplete: row.incomplete === true || row.truncated === true,
    truncated: row.truncated === true,
    paymentPresented: row.paymentPresented === true,
    ownerSlot: typeof row.ownerSlot === "string" && row.ownerSlot.length <= 16 ? row.ownerSlot : "sole",
    bodyDigest: typeof row.bodyDigest === "string" ? row.bodyDigest : null,
    priorOperationId: typeof row.priorOperationId === "string" ? row.priorOperationId : null,
    runtimeMs: Number.isInteger(row.runtimeMs) ? row.runtimeMs : null,
    reasons: [...decision.reasons].sort(),
    establishes: decision.establishes,
    blocks: decision.blocks,
    useful: decision.useful,
    callerClaimIndependent: sourceClass === "self_asserted_independent",
  };
}

function bindingKey(row) {
  if (row.taskRef) return `${row.operationId}\0${row.taskRef}`;
  return `${row.operationId}\0event:${row.eventId}`;
}

function finishJourney(key, rows) {
  const seen = new Map();
  let duplicate = false;
  const unique = [];
  for (const row of rows) {
    const material = digestOf({ ...row, reasons: row.reasons });
    const prior = seen.get(row.eventId);
    if (prior && prior !== material) duplicate = true;
    if (!prior) {
      seen.set(row.eventId, material);
      unique.push(row);
    }
  }
  const stages = Object.fromEntries(STAGES.map((stage) => [stage, unique.some((row) => row.stage === stage)]));
  const reasons = new Set(unique.flatMap((row) => row.reasons));
  if (duplicate) reasons.add("duplicate_id_conflict");
  const slots = new Map();
  for (const row of unique) {
    const slot = slots.get(row.ownerSlot) || {
      id: row.ownerSlot,
      withdrawn: false,
      serverExecution: "absent",
      paidValidDelivery: false,
      settlementStatus: "absent",
      settlementTrusted: false,
      bodyDigest: null,
      establishes: false,
      useful: "unknown",
    };
    if (row.withdrawn) slot.withdrawn = true;
    if (row.serverExecution && row.serverExecution !== "absent") slot.serverExecution = row.serverExecution;
    if (row.paidValidDelivery) slot.paidValidDelivery = true;
    if (row.settlementTrusted && row.settlementStatus === "verified") {
      slot.settlementStatus = "verified";
      slot.settlementTrusted = true;
    } else if (slot.settlementStatus !== "verified" && row.settlementStatus !== "absent") {
      slot.settlementStatus = row.settlementStatus;
    }
    if (row.bodyDigest) slot.bodyDigest = row.bodyDigest;
    if (row.establishes && !slot.withdrawn) {
      slot.establishes = true;
      slot.useful = row.useful;
    }
    if (row.blocks) slot.blocks = true;
    slots.set(row.ownerSlot, slot);
  }
  for (const slot of slots.values()) {
    if (slot.withdrawn) {
      slot.establishes = false;
      slot.useful = "false";
      slot.paidValidDelivery = false;
      reasons.add("withdrawn");
    }
    if (slot.blocks) {
      slot.establishes = false;
      slot.useful = "false";
    }
  }
  const live = [...slots.values()].filter((slot) => slot.establishes);
  let useful = "unknown";
  if (live.some((slot) => slot.useful === "true")) useful = "true";
  else if (live.some((slot) => slot.useful === "agreed_negative")) useful = "agreed_negative";
  else if (live.length === 0 && unique.some((row) => row.useful === "false" || row.blocks || row.withdrawn)) useful = "false";
  const unknownOnly = unique.every((row) => row.sourceClass === "unknown");
  const truncatedOnly = unique.every((row) => row.truncated);
  const incompleteOnly = unique.every((row) => row.incomplete || row.truncated);
  let status = "partial";
  if (duplicate) {
    status = "unjoinable";
    useful = "unknown";
  } else if (truncatedOnly) status = "incomplete";
  else if (unknownOnly) status = "unknown_source";
  else if (incompleteOnly) status = "incomplete";
  else if (useful === "true" || useful === "agreed_negative") status = "joined";
  const digestCounts = new Map();
  for (const slot of slots.values()) {
    if (!slot.bodyDigest) continue;
    digestCounts.set(slot.bodyDigest, (digestCounts.get(slot.bodyDigest) || 0) + 1);
  }
  const settlementTrusted = [...slots.values()].some((slot) => slot.settlementTrusted && !slot.withdrawn);
  const settlementStatuses = [...new Set(unique.map((row) => row.settlementStatus).filter((statusName) => statusName !== "absent"))];
  let settlementStatus = "absent";
  if (settlementTrusted) settlementStatus = "verified";
  else if (settlementStatuses.includes("failed")) settlementStatus = "failed";
  else if (settlementStatuses.includes("unknown")) settlementStatus = "unknown";
  else if (settlementStatuses.includes("unverified_payment_present")) settlementStatus = "unverified_payment_present";
  const grossValues = unique.filter((row) => row.settlementTrusted && row.grossSettledAtomic).map((row) => row.grossSettledAtomic);
  return {
    bindingKey: key,
    operationId: unique[0]?.operationId || null,
    taskRef: unique.find((row) => row.taskRef)?.taskRef || null,
    status,
    useful,
    complete: status === "joined",
    stages,
    reasons: [...reasons].sort(),
    settlementStatus,
    settlementTrusted,
    grossSettledAtomic: settlementTrusted && grossValues.length === 1 ? grossValues[0] : null,
    paidValidDelivery: [...slots.values()].some((slot) => slot.paidValidDelivery && !slot.withdrawn),
    reused: unique.some((row) => row.reused === true && row.stage === "authorized_retained_read"),
    priorOperationId: unique.find((row) => row.priorOperationId)?.priorOperationId || null,
    callerClaimIndependent: unique.some((row) => row.callerClaimIndependent),
    independentUse: 0,
    ownerSlots: [...slots.values()].map((slot) => ({
      id: slot.id,
      withdrawn: slot.withdrawn,
      serverExecution: slot.serverExecution,
      paidValidDelivery: slot.paidValidDelivery && !slot.withdrawn,
      useful: slot.useful,
    })),
    identicalBody: [...digestCounts.values()].some((count) => count > 1),
    revocationTransferred: [...slots.values()].filter((slot) => slot.id !== "read").length > 1
      && [...slots.values()].filter((slot) => slot.id !== "read").every((slot) => slot.withdrawn),
    runtimeMs: unique.reduce((sum, row) => (row.runtimeMs != null ? sum + row.runtimeMs : sum), 0),
    runtimeKnown: unique.some((row) => row.runtimeMs != null),
    commerceEventIds: [...new Set(unique.map((row) => row.commerceEventId).filter(Boolean))],
    sourceClasses: [...new Set(unique.map((row) => row.sourceClass))].sort(),
  };
}

function count(journeys, predicate) {
  return journeys.filter(predicate).length;
}

function rate(numerator, denominator, coverageComplete) {
  if (!coverageComplete || denominator <= 0) return null;
  return numerator / denominator;
}

function buildQuery(journeys, { coverageComplete, truncated, sourceClasses }) {
  const population = journeys.length;
  const eligible = journeys.filter((journey) => journey.status === "joined" || journey.status === "partial");
  const attempted = eligible.filter((journey) => journey.stages.attempted_call);
  const settled = eligible.filter((journey) => journey.settlementTrusted && journey.settlementStatus === "verified");
  const validDelivered = eligible.filter((journey) => journey.paidValidDelivery || journey.useful === "agreed_negative" || (journey.useful === "true" && journey.stages.verified_delivery));
  const useful = eligible.filter((journey) => journey.useful === "true" || journey.useful === "agreed_negative");
  const reused = eligible.filter((journey) => journey.reused);
  const operationIds = new Set(journeys.map((journey) => journey.operationId));
  const repeat = eligible.filter((journey) => (
    journey.stages.subsequent_useful_or_paid_job
    && journey.priorOperationId
    && journey.priorOperationId !== journey.operationId
    && operationIds.has(journey.priorOperationId)
    && journey.taskRef
  ));
  const metric = (rows, denominator) => ({
    count: rows.length,
    denominator,
    rate: rate(rows.length, denominator, coverageComplete),
  });
  return {
    schema: QUERY_SCHEMA,
    eligible: metric(eligible, population),
    attempted: metric(attempted, eligible.length),
    settled: metric(settled, attempted.length),
    validDelivered: metric(validDelivered, settled.length || attempted.length),
    useful: metric(useful, validDelivered.length || eligible.length),
    reused: metric(reused, useful.length),
    repeat: metric(repeat, reused.length || useful.length),
    sourceCoverage: {
      complete: coverageComplete,
      classes: sourceClasses,
      unknownSourceBindings: count(journeys, (journey) => journey.status === "unknown_source"),
      truncatedRecords: truncated,
      independentUse: 0,
      independentDemand: "unknown",
      globalTraffic: false,
      ownerQaIsNotGlobalTraffic: true,
    },
    recognizedRevenueAtomic: "0",
    historicalBankedRevenueUsdc: HISTORIC_BANKED_REVENUE_USDC,
    historicalIsMargin: false,
    historicalIsFutureCashAllocation: false,
    demandEstablished: false,
    profitEstablished: false,
    globalTrafficEstablished: false,
    tokenMeter: "unknown",
  };
}

function publicSlots(slots) {
  let ordinal = 0;
  return slots.map((slot) => {
    let id = slot.id;
    if (id !== "read" && id !== "sole") {
      ordinal += 1;
      id = `slot-${ordinal}`;
    }
    return { ...slot, id };
  });
}

function publicJourney(journey) {
  return {
    operationId: journey.operationId,
    taskRef: journey.taskRef,
    status: journey.status,
    useful: journey.useful,
    complete: journey.complete,
    settlementStatus: journey.settlementStatus,
    settlementTrusted: journey.settlementTrusted,
    paidValidDelivery: journey.paidValidDelivery,
    reused: journey.reused,
    priorOperationId: journey.priorOperationId,
    callerClaimIndependent: journey.callerClaimIndependent,
    independentUse: 0,
    identicalBody: journey.identicalBody,
    revocationTransferred: journey.revocationTransferred,
    ownerSlots: publicSlots(journey.ownerSlots),
    reasons: journey.reasons,
    stages: journey.stages,
    sourceClasses: journey.sourceClasses,
  };
}

export function toPublic(receipt) {
  return {
    schema: PUBLIC_SCHEMA,
    receiptId: receipt.receiptId,
    generation: receipt.generation,
    priorReceiptId: receipt.priorReceiptId,
    query: receipt.query,
    economics: {
      planes: receipt.economics.planes,
      effortPlanes: receipt.economics.effortPlanes,
      breakeven: receipt.economics.breakeven,
      recognizedRevenueAtomic: "0",
      historicalBankedRevenueUsdc: receipt.economics.historicalBankedRevenueUsdc,
      historicalCountsAsMargin: false,
      historicalCountsAsFutureCashAllocation: false,
      historicalCountedInBreakeven: false,
      profit: null,
      summed: false,
    },
    journeys: receipt.journeys.map(publicJourney),
    gaps: receipt.gaps,
    meters: receipt.meters,
    demandEstablished: false,
    profitEstablished: false,
    globalTrafficEstablished: false,
  };
}

export async function evaluateBundle(bundle, { prior = null, sealedAt = "2026-10-02T00:00:00.000Z" } = {}) {
  if (!bundle || bundle.schema !== BUNDLE_SCHEMA) fail("invalid_bundle");
  const directive = refusesDirective(bundle.directives);
  if (directive) fail(directive);
  const costsInput = bundle.costs || null;
  const { observations, records, directives, coverage, ...rest } = bundle;
  await assertProjectable({ ...rest, costs: costsInput, coverage: coverage || "unknown" });
  const adapted = adaptRecords(records || []);
  const incoming = [...(observations || []), ...adapted.observations];
  for (const row of incoming) await assertProjectable(row);
  const priorRows = prior ? structuredClone(prior.observations || []) : [];
  const sorted = [...priorRows, ...incoming].map(normalize);
  sorted.sort((left, right) => left.eventId.localeCompare(right.eventId) || left.stage.localeCompare(right.stage));
  const seenMaterial = new Set();
  const normalized = [];
  for (const row of sorted) {
    const key = `${row.eventId}\0${digestOf(row)}`;
    if (seenMaterial.has(key)) continue;
    seenMaterial.add(key);
    normalized.push(row);
  }
  const groups = new Map();
  for (const row of normalized) {
    const key = bindingKey(row);
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  const journeys = [...groups.entries()].map(([key, rows]) => finishJourney(key, rows))
    .sort((left, right) => left.bindingKey.localeCompare(right.bindingKey));
  const truncated = normalized.filter((row) => row.truncated).length + (bundle.truncatedRecords || 0);
  const classCounts = {};
  for (const row of normalized) classCounts[row.sourceClass] = (classCounts[row.sourceClass] || 0) + 1;
  const ownerQa = normalized.some((row) => row.cohort === "owner_qa" || row.sourceClass === "owner_qa");
  const coverageComplete = bundle.coverage === "complete" && truncated === 0 && !classCounts.unknown && !ownerQa;
  const suppliedCosts = mergeCosts([projectCosts(costsInput), ...adapted.costs.map(projectCosts)]);
  const economics = settleEconomics({
    supplied: {
      grossSettledRevenueAtomic: suppliedCosts.grossSettledRevenue.known ? {
        lower: suppliedCosts.grossSettledRevenue.lower,
        upper: suppliedCosts.grossSettledRevenue.upper,
      } : null,
      feesAtomic: suppliedCosts.fees.known ? { lower: suppliedCosts.fees.lower, upper: suppliedCosts.fees.upper } : null,
      cashMarginalAtomic: suppliedCosts.cashMarginal.known ? { lower: suppliedCosts.cashMarginal.lower, upper: suppliedCosts.cashMarginal.upper } : null,
      reviewAdaptationAtomic: suppliedCosts.reviewAdaptation.known ? { lower: suppliedCosts.reviewAdaptation.lower, upper: suppliedCosts.reviewAdaptation.upper } : null,
      includedQuotaOpportunityCostAtomic: suppliedCosts.includedQuotaOpportunityCost.known ? {
        lower: suppliedCosts.includedQuotaOpportunityCost.lower,
        upper: suppliedCosts.includedQuotaOpportunityCost.upper,
        countsAsCash: false,
      } : null,
      sharedRndAtomic: suppliedCosts.sharedRnd.known ? {
        lower: suppliedCosts.sharedRnd.lower,
        upper: suppliedCosts.sharedRnd.upper,
        allocatable: false,
      } : null,
      apiEquivalentBuildEffort: suppliedCosts.apiEquivalentBuildEffort.known ? {
        probes: suppliedCosts.apiEquivalentBuildEffort.probes,
        countsAsCash: false,
      } : null,
      measuredLaterSavedWork: suppliedCosts.measuredLaterSavedWork.known ? {
        unit: suppliedCosts.measuredLaterSavedWork.unit,
        saved: suppliedCosts.measuredLaterSavedWork.saved,
      } : null,
    },
    observedGross: observeGross(journeys),
  });
  const query = buildQuery(journeys, { coverageComplete, truncated, sourceClasses: classCounts });
  const runtimeValues = journeys.filter((journey) => journey.runtimeKnown).map((journey) => journey.runtimeMs);
  const gaps = [
    "effort_ledger_not_in_checkout",
    "historical_10_955_usdc_is_not_margin",
    "body_digest_is_not_a_join_key",
    "wallet_user_agent_email_and_ip_are_not_identity",
    "commerce_paid_success_is_not_useful_delivery",
  ];
  const looseCommerce = normalized.filter((row) => row.commerceEventId && !row.taskRef && String(row.operationId).includes(":/"));
  if (looseCommerce.length) gaps.push("commerce_event_not_task_bound");
  if (adapted.bindingConflicts?.length) gaps.push("causal_binding_conflict");
  if (truncated) gaps.push("truncated_record");
  if (journeys.some((journey) => journey.status === "unjoinable")) gaps.push("duplicate_id_conflict");
  if (journeys.some((journey) => journey.status === "unknown_source")) gaps.push("unknown_source");
  if (ownerQa) gaps.push("owner_qa_is_not_world_coverage");
  if (normalized.length !== sorted.length) gaps.push("duplicate_record_collapsed");
  if (normalized.some((row) => row.callerClaimIndependent)) gaps.push("self_asserted_independent_is_not_demand");
  const observationDigest = digestOf(normalized.map((row) => ({ ...row, establishes: undefined, blocks: undefined })));
  const costDigest = digestOf(economics.planes);
  const generation = prior ? prior.generation + 1 : 1;
  const receipt = {
    schema: RECEIPT_SCHEMA,
    receiptId: digestOf({ priorReceiptId: prior?.receiptId || null, observationDigest, costDigest, generation }),
    generation,
    priorReceiptId: prior?.receiptId || null,
    sealedAt,
    observationDigest,
    costDigest,
    observations: normalized,
    journeys,
    economics,
    query,
    gaps: [...new Set(gaps)].sort(),
    meters: {
      calls: query.attempted.count,
      runtimeMs: runtimeValues.length ? runtimeValues.reduce((sum, value) => sum + value, 0) : null,
      runtimeCoverage: runtimeValues.length === journeys.length && journeys.length ? "complete_for_supplied_rows" : "partial_or_unknown",
      tokenMeter: "unknown",
    },
    pins: {
      consumerCommit: CONSUMER_COMMIT,
      evidenceJoinCommit: EVIDENCE_JOIN_COMMIT,
      historicBankedRevenueUsdc: HISTORIC_BANKED_REVENUE_USDC,
    },
    demandEstablished: false,
    profitEstablished: false,
    globalTrafficEstablished: false,
  };
  return receipt;
}
