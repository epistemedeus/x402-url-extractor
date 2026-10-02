import {
  ATOMIC,
  HEX64,
  OBSERVATION_SCHEMA,
  RECEIPT_OPERATION,
  SELLER_AUDIT_OPERATION,
  TASK_REF_RE,
} from "./constants.mjs";

const CUSTOMER_SCHEMA = "samedaydesk.useful-result-reuse.customer-grant.v1";
const METRIC_SCHEMA = "samedaydesk.useful-result-reuse.metric.v1";
const TASK_REF_SCHEMA = "samedaydesk.outcome-task-ref.v1";
const COMMERCE_EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SELLER_SCHEMA = "samedaydesk.seller-repair-service.v1";
const JOURNEY_SCHEMA = "samedaydesk.paid-useful-journey.v1";
const MAINTAINED_SCHEMA = "samedaydesk.maintained-task.envelope.v1";

function idFor(value, fallback) {
  const text = String(value || fallback || "event").toLowerCase().replace(/[^a-z0-9:_-]/g, "").slice(0, 80);
  return /^[a-z0-9]/.test(text) ? text : `e${text}`.slice(0, 81);
}

function taskRefOrNull(value) {
  return typeof value === "string" && TASK_REF_RE.test(value) ? value : null;
}

function base(extra) {
  return {
    schema: OBSERVATION_SCHEMA,
    taskRef: null,
    commerceEventId: null,
    sourceClass: "unknown",
    authority: "unknown",
    cohort: "unknown",
    httpStatus: null,
    serverExecution: "absent",
    callerExpectation: "absent",
    expectationAuthority: null,
    explicitCriterionMet: false,
    settlementStatus: "absent",
    settlementTrusted: false,
    grossSettledAtomic: null,
    paidValidDelivery: false,
    reused: false,
    withdrawn: false,
    incomplete: false,
    truncated: false,
    paymentPresented: false,
    ownerSlot: "sole",
    bodyDigest: null,
    priorOperationId: null,
    reasons: [],
    ...extra,
  };
}

function customerDecision(row) {
  const decision = row?.body && typeof row.body.decision === "string" ? row.body.decision : null;
  if (decision === "found" || decision === "not_found" || decision === "rpc_unavailable") return decision;
  return null;
}

export function adaptCustomer(row) {
  if (!row || row.schema !== CUSTOMER_SCHEMA) return [];
  if (row.action === "revoke") {
    const slot = String(row.targetId || row.grantId || "sole").slice(0, 16);
    return [base({
      eventId: idFor(`revoke-${slot}`),
      operationId: typeof row.operationId === "string" ? row.operationId : RECEIPT_OPERATION,
      taskRef: taskRefOrNull(row.taskRef),
      stage: "corrected_or_withdrawn",
      sourceClass: "server_execution",
      authority: "server_execution",
      cohort: "owner_qa",
      ownerSlot: slot || "sole",
      withdrawn: true,
    })];
  }
  if (row.action !== "retain") return [];
  const decision = customerDecision(row);
  const serverExecution = decision === "found" ? "found" : decision === "not_found" ? "not_found" : decision === "rpc_unavailable" ? "failed" : "unknown";
  const negative = row.evidenceClass === "useful_negative" && serverExecution === "not_found";
  const positive = row.paidValidDelivery === true && row.evidenceClass === "paid_valid_delivery" && serverExecution === "found";
  const slot = String(row.grantId || "sole").slice(0, 16);
  const recordKey = idFor(row.recordId || row.resultId || slot);
  const shared = {
    operationId: typeof row.operationId === "string" ? row.operationId : RECEIPT_OPERATION,
    taskRef: taskRefOrNull(row.taskRef),
    sourceClass: "server_execution",
    authority: "server_execution",
    cohort: "owner_qa",
    ownerSlot: slot || "sole",
    bodyDigest: HEX64.test(row.comparable || "") ? row.comparable : null,
    settlementStatus: row.settlementStatus === "verified" ? "verified" : row.settlementStatus === "failed" ? "failed" : "unknown",
    settlementTrusted: row.settlementStatus === "verified",
    paidValidDelivery: positive,
    httpStatus: 200,
    serverExecution,
    callerExpectation: negative ? "agreed_negative" : "positive",
    expectationAuthority: "operation_contract",
    explicitCriterionMet: positive,
    criterionReason: positive ? "paid_valid_delivery" : null,
  };
  return ["qualification", "attempted_call", "settlement", "caller_expected_output", "verified_delivery"].map((stage) => base({
    ...shared,
    eventId: idFor(`${recordKey}-${stage}`),
    stage,
    reasons: serverExecution === "failed" ? ["execution_failed"] : [],
  }));
}

export function adaptMetric(row) {
  if (!row || row.schema !== METRIC_SCHEMA) return [];
  if (row.kind !== "useful_later_read" && row.kind !== "correction") return [];
  const stage = row.kind === "useful_later_read" ? "authorized_retained_read" : "corrected_or_withdrawn";
  return [base({
    eventId: idFor(`metric-${row.eventId || row.kind}`),
    operationId: RECEIPT_OPERATION,
    taskRef: taskRefOrNull(row.taskRef),
    stage,
    sourceClass: "server_execution",
    authority: "server_execution",
    cohort: "owner_qa",
    reused: row.kind === "useful_later_read",
    withdrawn: row.kind === "correction",
    ownerSlot: "read",
  })];
}

export function adaptTaskRef(row) {
  if (!row || row.schemaVersion !== TASK_REF_SCHEMA) return [];
  if (!taskRefOrNull(row.taskRef) || typeof row.operationId !== "string") return [];
  return [base({
    eventId: idFor(`taskref-${row.eventId || row.taskRef}`),
    operationId: row.operationId,
    taskRef: row.taskRef,
    commerceEventId: typeof row.commerceEventId === "string" ? row.commerceEventId : null,
    stage: "qualification",
    sourceClass: row.cohort === "owner_qa" ? "owner_qa" : "explicit_source",
    authority: "explicit_source",
    cohort: typeof row.cohort === "string" ? row.cohort : "unknown",
  })];
}

export function adaptCommerce(row) {
  if (!row || row.v !== 3 || typeof row.id !== "string" || typeof row.route !== "string") return [];
  const method = typeof row.method === "string" ? row.method.toLowerCase() : "get";
  const operationId = /^[a-z0-9:/._-]{1,160}$/.test(`${method}:${row.route}`)
    ? `${method}:${row.route}`
    : "unknown-route";
  const failure = typeof row.paymentFailureCode === "string" && /^[a-z_]{1,64}$/.test(row.paymentFailureCode)
    ? row.paymentFailureCode
    : null;
  const presented = row.paymentPresent === true;
  let settlementStatus = "absent";
  if (presented && Number(row.status) >= 500) settlementStatus = "unknown";
  else if (presented && failure === "payment_service_unavailable") settlementStatus = "unknown";
  else if (presented && Number(row.status) === 402) settlementStatus = "unknown";
  else if (presented && row.result === "paid_success") settlementStatus = "unverified_payment_present";
  const amount = typeof row.settlementAmountAtomic === "string" && ATOMIC.test(row.settlementAmountAtomic)
    ? row.settlementAmountAtomic
    : null;
  const shared = {
    operationId,
    commerceEventId: row.id,
    sourceClass: "server_execution",
    authority: presented ? "trusted_settlement" : "server_execution",
    cohort: "owner_qa",
    httpStatus: Number.isInteger(row.status) ? row.status : null,
    paymentPresented: presented,
    settlementStatus,
    settlementTrusted: false,
    grossSettledAtomic: amount,
    runtimeMs: Number.isInteger(row.durationMs) ? row.durationMs : null,
  };
  const stages = [base({
    ...shared,
    eventId: idFor(`commerce-${row.id}-attempt`),
    stage: "attempted_call",
    reasons: !presented && row.status === 402 ? ["challenge_not_useful"] : [],
  })];
  if (presented) {
    stages.push(base({
      ...shared,
      eventId: idFor(`commerce-${row.id}-settlement`),
      stage: "settlement",
      reasons: [
        ...(settlementStatus === "unknown" ? ["settlement_unknown"] : []),
        ...(failure ? [failure] : []),
      ],
    }));
  }
  if (row.result === "paid_success") {
    stages.push(base({
      ...shared,
      eventId: idFor(`commerce-${row.id}-delivery`),
      stage: "verified_delivery",
      serverExecution: "absent",
      explicitCriterionMet: false,
      authority: "server_execution",
      reasons: ["settlement_not_delivery"],
    }));
  }
  const activation = row.paidUsefulJourney;
  if (activation && typeof activation === "object") {
    stages.push(...adaptActivation({
      schema: JOURNEY_SCHEMA,
      eventId: `activation-${row.id}`,
      operationId,
      producedBy: "paidUsefulJourneyMetadata",
      usefulDelivery: activation.usefulDelivery,
      usefulReason: activation.usefulReason,
      decision: activation.decision,
      actor: activation.actor,
      httpStatus: row.status,
      sourceClass: "server_execution",
    }));
  }
  return stages;
}

export function adaptSeller(row) {
  if (!row || row.schema !== SELLER_SCHEMA) return { observations: [], costs: null };
  const taskRef = HEX64.test(row.taskDigest || "") ? `repair-${row.taskDigest.slice(0, 12)}` : null;
  const usefulMatch = row.classification?.useful === true
    && row.callerSupplied?.establishesUsefulOutput === false
    && row.classification?.http200IsSuccess === false
    && row.observed?.http200IsSuccess === false;
  const missingField = row.classification?.reason === "missing_field_not_paid_demand";
  const repairUseful = row.repair?.useful === true && row.repair?.http200IsSuccess === false;
  const observations = [
    base({
      eventId: idFor(`${taskRef || "seller"}-discovery`),
      operationId: "seller-repair",
      taskRef,
      stage: "task_discovery",
      sourceClass: "explicit_source",
      authority: "explicit_source",
      cohort: "owner_qa",
    }),
    base({
      eventId: idFor(`${taskRef || "seller"}-qualification`),
      operationId: "seller-repair",
      taskRef,
      stage: "qualification",
      sourceClass: "explicit_source",
      authority: "explicit_source",
      cohort: "owner_qa",
    }),
    base({
      eventId: idFor(`${taskRef || "seller"}-attempt`),
      operationId: "seller-repair",
      taskRef,
      stage: "attempted_call",
      sourceClass: "server_execution",
      authority: "server_execution",
      cohort: "owner_qa",
      httpStatus: Number.isInteger(row.observed?.status) ? row.observed.status : null,
    }),
    base({
      eventId: idFor(`${taskRef || "seller"}-expectation`),
      operationId: "seller-repair",
      taskRef,
      stage: "caller_expected_output",
      sourceClass: "caller_supplied",
      authority: "caller_expectation",
      cohort: "owner_qa",
      callerExpectation: "positive",
      expectationAuthority: "caller_supplied",
    }),
  ];
  if (usefulMatch || missingField || row.classification?.reason) {
    observations.push(base({
      eventId: idFor(`${taskRef || "seller"}-delivery`),
      operationId: "seller-repair",
      taskRef,
      stage: "verified_delivery",
      sourceClass: "server_execution",
      authority: "server_execution",
      cohort: "owner_qa",
      httpStatus: Number.isInteger(row.observed?.status) ? row.observed.status : null,
      serverExecution: usefulMatch || repairUseful ? "found" : "unknown",
      explicitCriterionMet: usefulMatch,
      criterionReason: usefulMatch ? (row.classification?.reason || "explicit_criterion") : null,
      reasons: missingField ? ["missing_field"] : [],
    }));
  }
  if (repairUseful) {
    observations.push(base({
      eventId: idFor(`${taskRef || "seller"}-retest`),
      operationId: "seller-repair",
      taskRef,
      stage: "verified_delivery",
      sourceClass: "server_execution",
      authority: "server_execution",
      cohort: "owner_qa",
      serverExecution: "found",
      explicitCriterionMet: true,
      criterionReason: "retest_matched",
    }));
  }
  if (row.later?.reused === true) {
    observations.push(base({
      eventId: idFor(`${taskRef || "seller"}-reuse`),
      operationId: "seller-repair",
      taskRef,
      stage: "authorized_retained_read",
      sourceClass: "server_execution",
      authority: "server_execution",
      cohort: "owner_qa",
      reused: true,
    }));
  }
  const probes = row.metrics?.includedQuotaApiEquivalentEffort;
  const costs = probes && probes.countsAsCash === false && Number.isInteger(probes.probeCount)
    ? { apiEquivalentBuildEffort: { probes: probes.probeCount, countsAsCash: false, countsAsProfit: false } }
    : null;
  return { observations, costs };
}

export function adaptActivation(row) {
  if (!row || row.schema !== JOURNEY_SCHEMA) return [];
  const reason = typeof row.usefulReason === "string" ? row.usefulReason : "not_delivery";
  const server = row.producedBy === "paidUsefulJourneyMetadata";
  const blocked = reason === "audit_incomplete" || reason === "additional_work_missing" || reason === "schema_invalid"
    || reason === "delivery_failed" || reason === "not_delivery" || reason === "body_unavailable";
  return [base({
    eventId: idFor(row.eventId || "activation"),
    operationId: typeof row.operationId === "string" ? row.operationId : SELLER_AUDIT_OPERATION,
    taskRef: taskRefOrNull(row.taskRef),
    stage: "verified_delivery",
    sourceClass: row.sourceClass === "server_execution" || server ? "server_execution" : "caller_supplied",
    authority: server ? "server_execution" : "caller_expectation",
    cohort: row.actor === "owner_test" ? "owner_qa" : "unknown",
    httpStatus: Number.isInteger(row.httpStatus) ? row.httpStatus : null,
    serverExecution: server && row.usefulDelivery === "true" && !blocked ? "found" : "unknown",
    explicitCriterionMet: server && row.usefulDelivery === "true" && reason === "additional_work_present",
    criterionReason: reason === "additional_work_present" ? "additional_work_present" : null,
    callerExpectation: "positive",
    expectationAuthority: server ? "operation_contract" : "caller_supplied",
    reasons: blocked ? [reason] : [],
    paymentPresented: row.paymentPresent === true,
  })];
}

export function adaptMaintained(row) {
  if (!row || row.schema !== MAINTAINED_SCHEMA) return [];
  const taskRef = taskRefOrNull(row.taskRef);
  const operationId = typeof row.operationId === "string" ? row.operationId : "maintained-task";
  const observations = [base({
    eventId: idFor(`${row.eventId || operationId}-discovery`),
    operationId,
    taskRef,
    stage: "task_discovery",
    sourceClass: "explicit_source",
    authority: "explicit_source",
    cohort: "owner_qa",
  })];
  if (row.qualified === true && row.license === "MIT") {
    observations.push(base({
      eventId: idFor(`${row.eventId || operationId}-qualification`),
      operationId,
      taskRef,
      stage: "qualification",
      sourceClass: "explicit_source",
      authority: "explicit_source",
      cohort: "owner_qa",
    }));
  }
  if (row.executed === true) {
    observations.push(base({
      eventId: idFor(`${row.eventId || operationId}-attempt`),
      operationId,
      taskRef,
      stage: "attempted_call",
      sourceClass: "explicit_source",
      authority: "explicit_source",
      cohort: "owner_qa",
      serverExecution: "absent",
      reasons: ["byte_hash_not_useful"],
    }));
  }
  return observations;
}

export function adaptRecord(record) {
  if (!record || typeof record !== "object") {
    return { observations: [], costs: null };
  }
  if (record.schema === OBSERVATION_SCHEMA) return { observations: [record], costs: null };
  if (record.schema === CUSTOMER_SCHEMA) return { observations: adaptCustomer(record), costs: null };
  if (record.schema === METRIC_SCHEMA) return { observations: adaptMetric(record), costs: null };
  if (record.schemaVersion === TASK_REF_SCHEMA) return { observations: adaptTaskRef(record), costs: null };
  if (record.v === 3 && typeof record.route === "string") return { observations: adaptCommerce(record), costs: null };
  if (record.schema === SELLER_SCHEMA) return adaptSeller(record);
  if (record.schema === JOURNEY_SCHEMA) return { observations: adaptActivation(record), costs: null };
  if (record.schema === MAINTAINED_SCHEMA) return { observations: adaptMaintained(record), costs: null };
  return {
    observations: [base({
      eventId: idFor(`unknown-schema-${record.schema || record.v || "row"}`),
      operationId: "unknown-source",
      stage: "task_discovery",
      sourceClass: "unknown",
      authority: "unknown",
      incomplete: true,
      reasons: ["unknown_schema"],
    })],
    costs: null,
  };
}

function linkRevocations(records, observations) {
  const retains = new Map();
  for (const record of records || []) {
    if (record?.schema === CUSTOMER_SCHEMA && record.action === "retain" && typeof record.grantId === "string") {
      retains.set(record.grantId.slice(0, 16), record);
    }
  }
  for (const row of observations) {
    if (row.withdrawn !== true || row.taskRef || row.ownerSlot === "read") continue;
    const match = retains.get(row.ownerSlot);
    if (!match) continue;
    const taskRef = taskRefOrNull(match.taskRef);
    if (taskRef) row.taskRef = taskRef;
    if (typeof match.operationId === "string" && match.operationId.length > 0) row.operationId = match.operationId;
  }
}

export function producerBindings(records) {
  const byEvent = new Map();
  const blocked = new Set();
  const conflicts = [];
  for (const record of records || []) {
    if (!record || record.schemaVersion !== TASK_REF_SCHEMA) continue;
    const taskRef = taskRefOrNull(record.taskRef);
    const commerceEventId = typeof record.commerceEventId === "string" ? record.commerceEventId : "";
    if (!taskRef || !COMMERCE_EVENT_ID.test(commerceEventId) || typeof record.operationId !== "string") continue;
    if (blocked.has(commerceEventId)) continue;
    const prior = byEvent.get(commerceEventId);
    if (!prior) {
      byEvent.set(commerceEventId, { taskRef, operationId: record.operationId });
      continue;
    }
    if (prior.taskRef !== taskRef || prior.operationId !== record.operationId) {
      conflicts.push(commerceEventId);
      byEvent.delete(commerceEventId);
      blocked.add(commerceEventId);
    }
  }
  return { byEvent, conflicts };
}

// Attach a task ref only when a task-ref row names the commerce event id.
// The route operation, settlement flag, and usefulness stay on their own rows.
export function applyProducerBindings(records, observations) {
  const { byEvent, conflicts } = producerBindings(records);
  for (const row of observations || []) {
    if (!row || row.taskRef || typeof row.commerceEventId !== "string") continue;
    if (typeof row.operationId !== "string" || !row.operationId.includes(":/")) continue;
    const binding = byEvent.get(row.commerceEventId);
    if (!binding) continue;
    row.taskRef = binding.taskRef;
  }
  return { conflicts };
}

export function adaptRecords(records) {
  const observations = [];
  const costs = [];
  for (const record of records || []) {
    const adapted = adaptRecord(record);
    observations.push(...adapted.observations);
    if (adapted.costs) costs.push(adapted.costs);
  }
  linkRevocations(records, observations);
  const binding = applyProducerBindings(records, observations);
  return { observations, costs, bindingConflicts: binding.conflicts };
}
