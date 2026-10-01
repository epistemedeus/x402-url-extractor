import {
  ACTOR_LABELS,
  CLOSED_SPONSORED_REF,
  DISCOVERY_LABELS,
  EVENT_ID_RE,
  HEX64,
  PAID_OPERATION_PATH,
  TASK_REF_RE,
  TX,
  USEFUL_REASONS,
  emptyActors,
} from "./constants.mjs";
import { hasDisallowedKey } from "./privacy.mjs";

const EVENT_KEYS = new Set([
  "actorLabel", "artifactDigest", "callKind", "cohort", "contractCurrent", "correctionOf",
  "criterion", "decision", "discoverySource", "download", "eventId", "experimentId",
  "freeSufficient", "httpStatus", "incrementalValue", "independentDemandConfirmed",
  "install", "operationId", "operationPath", "paymentPresent", "receiptDigest",
  "rewardPresent", "route", "settlementReference", "settlementState", "sourceId",
  "stage", "taskDigest", "taskRef", "typedResult", "usefulDelivery", "usefulReason",
]);

const STAGES = new Set([
  "discovery_or_download", "valid_call", "useful_result", "explicit_purchase_attempt",
  "settlement", "later_useful_call",
]);

const TYPED = new Set([
  "application_failure", "challenge", "invalid", "paid_success", "protocol_discovery",
  "replay_success", "settlement_failure", "telemetry_incomplete",
]);

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function blank() {
  return {
    usable: false,
    reasons: [],
    stages: {
      discovery_or_download: false,
      valid_call: false,
      useful_result: false,
      explicit_purchase_attempt: false,
      settlement: false,
      later_useful_call: false,
    },
    actors: emptyActors(),
    installEstablished: false,
    downloadEstablished: false,
    nativeInstall: false,
    receiptDigest: null,
    settlementEstablished: false,
    settlementReferenceKept: null,
    useful: "unknown",
    callerClaimIndependent: false,
    independentUse: false,
    correctionOf: null,
    eventId: null,
    taskRef: null,
    experimentId: null,
    operationId: null,
    taskDigest: null,
    sourceId: null,
    freeSufficient: null,
    incrementalValue: null,
    rewardPresent: null,
    contractCurrent: null,
    artifactVerified: false,
    typedNotAJourney: false,
    paidOperation: false,
    unpaidUseful: false,
    cohort: null,
  };
}

function acceptedTaskRef(value) {
  if (typeof value !== "string" || !TASK_REF_RE.test(value)) return null;
  if (value.startsWith("0x") || value.startsWith("bc1") || value.includes("@")) return null;
  return value;
}

export function projectEvent(event) {
  const out = blank();
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    out.reasons.push("unjoinable_event");
    return out;
  }
  if (hasDisallowedKey(event)) {
    if (typeof event.eventId === "string" && EVENT_ID_RE.test(event.eventId)) out.eventId = event.eventId;
    if (typeof event.taskRef === "string" && !acceptedTaskRef(event.taskRef)) out.reasons.push("task_ref_not_a_pseudonym");
    out.reasons.push("restricted_field_not_projected");
    out.reasons = [...new Set(out.reasons)].sort();
    return out;
  }
  for (const key of Object.keys(event)) {
    if (!EVENT_KEYS.has(key)) {
      out.reasons.push("unknown_field");
      return out;
    }
  }
  if (!EVENT_ID_RE.test(event.eventId || "")) {
    out.reasons.push("unjoinable_event");
    return out;
  }
  out.eventId = event.eventId;
  const taskRef = acceptedTaskRef(event.taskRef);
  if (!taskRef) {
    out.reasons.push("task_ref_not_a_pseudonym");
    return out;
  }
  out.taskRef = taskRef;
  out.usable = true;
  out.experimentId = typeof event.experimentId === "string" ? event.experimentId : null;
  out.operationId = acceptedTaskRef(event.operationId);
  out.sourceId = typeof event.sourceId === "string" ? event.sourceId : null;
  out.taskDigest = typeof event.taskDigest === "string" && HEX64.test(event.taskDigest) ? event.taskDigest : null;
  out.correctionOf = acceptedTaskRef(event.correctionOf) || (EVENT_ID_RE.test(event.correctionOf || "") ? event.correctionOf : null);
  if (event.freeSufficient === true || event.freeSufficient === false) out.freeSufficient = event.freeSufficient;
  if (event.incrementalValue === true || event.incrementalValue === false) out.incrementalValue = event.incrementalValue;
  if (event.rewardPresent === true || event.rewardPresent === false) out.rewardPresent = event.rewardPresent;
  if (event.contractCurrent === true || event.contractCurrent === false) out.contractCurrent = event.contractCurrent;
  out.paidOperation = event.operationPath === PAID_OPERATION_PATH || event.route === PAID_OPERATION_PATH;
  if (typeof event.artifactDigest === "string" && HEX64.test(event.artifactDigest)) out.artifactVerified = true;
  if (typeof event.receiptDigest === "string" && HEX64.test(event.receiptDigest)) out.receiptDigest = event.receiptDigest;

  if (event.install && typeof event.install === "object") {
    const install = event.install;
    const files = install.skillFilePresent === true && install.supportFilesPresent === true;
    const spoofed = install.spoofedHeader === true;
    const version = typeof install.runtimeVersion === "string" && install.runtimeVersion.length > 0 && install.runtimeVersion.length <= 32;
    if (install.exitCode === 0 && !files) out.reasons.push("exit0_without_skill_files");
    if (spoofed) out.reasons.push("spoofed_header_not_native_install");
    if (files && !spoofed && version) {
      out.installEstablished = true;
      out.nativeInstall = true;
      out.stages.discovery_or_download = true;
    }
  }
  if (event.download && typeof event.download === "object" && event.download.httpStatus === 200) {
    out.downloadEstablished = true;
    out.stages.discovery_or_download = true;
    out.reasons.push("download_is_not_install_or_useful_result");
  }

  const status = Number.isInteger(event.httpStatus) ? event.httpStatus : null;
  if (status === 402 || event.typedResult === "challenge") {
    out.reasons.push("received_402");
  } else if (status !== null && status >= 200 && status < 300 && (event.stage === "valid_call" || event.stage === "useful_result" || event.stage === "later_useful_call")) {
    out.stages.valid_call = true;
  } else if (status !== null && status >= 400) {
    out.reasons.push("call_not_valid");
  }

  const explicitUseful = event.usefulDelivery === "true"
    && event.usefulReason === "additional_work_present"
    && event.decision === "attempt";
  const unpaidCriterion = event.criterion === "unpaid_receipt_readable"
    && out.receiptDigest
    && status !== null
    && status >= 200
    && status < 300
    && event.paymentPresent === false;
  if (explicitUseful || unpaidCriterion) {
    out.stages.useful_result = true;
    out.useful = "true";
    out.unpaidUseful = unpaidCriterion === true;
  } else if (event.usefulDelivery === "false") {
    out.useful = "false";
    out.reasons.push(USEFUL_REASONS.has(event.usefulReason) ? event.usefulReason : "useful_result_rejected");
  } else if (status !== null && status >= 200 && status < 300 && event.stage !== "later_useful_call" && event.stage !== "discovery_or_download") {
    out.reasons.push("http_200_not_useful");
    out.useful = "unknown";
  }

  if (event.decision === "attempt" && event.paymentPresent === true && status !== 402) {
    out.stages.explicit_purchase_attempt = true;
    out.actors.qualified_attempt += 1;
  } else if (event.decision === "decline") {
    out.reasons.push("declined_purchase");
  } else if (event.stage === "explicit_purchase_attempt" && event.paymentPresent !== true) {
    out.reasons.push("attempt_without_explicit_payment");
  }

  if (event.typedResult) {
    out.typedNotAJourney = true;
    out.reasons.push("typed_outcome_not_a_journey");
    if (!TYPED.has(event.typedResult)) out.reasons.push("unknown_field");
    if (event.typedResult === "paid_success") out.reasons.push("handler_success_not_task_useful");
    if (event.typedResult === "settlement_failure") out.reasons.push("paid_failure");
    if (event.typedResult === "application_failure") out.reasons.push("application_failure");
  }

  const reference = event.settlementReference ?? null;
  if (reference !== null && !TX.test(reference)) {
    out.reasons.push("settlement_reference_rejected");
  } else if (reference === CLOSED_SPONSORED_REF) {
    out.reasons.push("closed_sponsored_expense");
  } else if (event.settlementState === "failed" || event.typedResult === "settlement_failure") {
    out.reasons.push("paid_failure");
  } else if (event.settlementState === "succeeded" && reference) {
    out.stages.settlement = true;
    out.settlementEstablished = true;
    out.settlementReferenceKept = reference;
    if (out.useful !== "true") out.reasons.push("transaction_is_not_valid_delivery");
    if (out.useful === "false") out.reasons.push("settlement_with_invalid_output");
  } else if (reference && event.settlementState !== "succeeded") {
    out.reasons.push("transaction_without_delivery_evidence");
  } else if (event.settlementState === "unknown") {
    out.reasons.push("settlement_outcome_unknown");
  }

  if (event.stage === "later_useful_call") {
    if (event.criterion === "second_process_receipt_read" && out.receiptDigest && out.useful !== "false") {
      out.stages.later_useful_call = true;
    } else if (event.criterion === "retained_use" || event.usefulReason === "retained_use_usefulness_unknown") {
      out.reasons.push("retained_use_usefulness_unknown");
    } else {
      out.reasons.push("later_call_not_useful");
    }
  }
  if (event.criterion === "verified_artifact_reuse" && out.artifactVerified && event.stage === "later_useful_call") {
    out.stages.later_useful_call = true;
    out.stages.useful_result = true;
    out.useful = "true";
  }

  if (!STAGES.has(event.stage)) out.reasons.push("unknown_stage");

  if (ACTOR_LABELS.has(event.actorLabel)) {
    if (event.actorLabel === "owner_test") out.actors.owner_qa += 1;
    else if (event.actorLabel === "recruited") out.actors.recruited_buyer += 1;
    else {
      out.actors.unknown_actor += 1;
      if (event.actorLabel === "independent") out.callerClaimIndependent = true;
    }
  } else if (event.actorLabel != null) {
    out.reasons.push("actor_label_rejected");
    out.actors.unknown_actor += 1;
  }
  if (event.discoverySource != null) {
    if (DISCOVERY_LABELS.has(event.discoverySource)) out.actors.user_agent_label += 1;
    else out.reasons.push("discovery_label_rejected");
  }
  if (event.cohort === "sponsored_trial" || event.cohort === "owner_qa" || event.cohort === "external_unknown" || event.cohort === "controlled_test") {
    out.cohort = event.cohort;
  } else if (event.cohort != null) {
    out.reasons.push("cohort_rejected");
  }
  if (out.cohort === "sponsored_trial") out.actors.sponsored_evaluation += 1;
  if (out.cohort === "owner_qa" && event.actorLabel !== "owner_test") out.actors.owner_qa += 1;
  out.independentUse = false;
  if (hasOwn(event, "independentDemandConfirmed")) {
    out.reasons.push("caller_claim_is_not_independent_use");
  }
  out.reasons = [...new Set(out.reasons)].sort();
  return out;
}
