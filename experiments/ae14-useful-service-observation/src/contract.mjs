// Optional extension of the existing caller-result handback.
// Dispositions stay on the canonical feedback writer. This contract adds
// retained-use and next-task declarations, and keeps them off the paid body.

import {
  CALLER_RESULT_DISPOSITIONS,
  CALLER_RESULT_FEEDBACK_PATH,
  CALLER_RESULT_REASON_CATEGORIES,
  CALLER_RESULT_USEFULNESS,
  callerResultFeedbackPublicContract,
} from "../../../caller-result-client/src/contract.mjs";

export const OBSERVATION_SCHEMA = "samedaydesk.useful-service-observation.v1";
export const RELEASE_SCHEMA = "samedaydesk.useful-service-observation.release-candidate.v1";
export const OBSERVATION_FILENAME = "useful-service-observation.ndjson";
export const SERVING_SOURCE_SHA = "82a51274e7dc7a7600b90f1317a6be6b28442592";
export const SERVING_TREE = "f95a351e763cc903f7caa4159788cb4ceacddf91";
export const SERVING_VERSION = "1.23.52";
export const COVERAGE_RESULT = "this_retained_result_only";
export const COVERAGE_WINDOW = "unknown_for_full_window";
export const COVERAGE_GAP = "gap";
export const USEFULNESS_UNKNOWN = CALLER_RESULT_USEFULNESS;
export const PRIOR_CAPABILITY_HEADER = "x-samedaydesk-prior-caller-result";
export const OBSERVATION_LINK_REL = "useful-service-observation";

export const OBSERVATION_LINK = `<${CALLER_RESULT_FEEDBACK_PATH}>; rel="${OBSERVATION_LINK_REL}"; title="${OBSERVATION_SCHEMA}"`;

export const RETAINED_USE = Object.freeze(["retained", "not_retained"]);
export const NEXT_TASK_RELATIONS = Object.freeze(["distinct_later_task", "same_task", "none"]);
export const ORIGIN_LABELS = Object.freeze(["owner_qa", "sponsored", "external_unknown"]);
export const ACTOR_CONTINUITY = Object.freeze(["none", "pseudonym", "capability"]);
export const CONTINUATION_ACCESS = Object.freeze(["purchased", "free_entitled", "pseudonym_only"]);

export const TASK_REF = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const TENANT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const SHA40 = /^[a-f0-9]{40}$/;
export const SHA256_HEX = /^[a-f0-9]{64}$/;
export const TX = /^0x[a-f0-9]{64}$/;

export const MAX_EXTENSION_BYTES = 1024;
export const MAX_OBSERVATION_FILE_BYTES = 256 * 1024;

export const BLIND_SPOTS = Object.freeze([
  "missing_response_stays_unknown",
  "usefulness_measurement_stays_unknown",
  "schema_valid_is_not_caller_useful",
  "pseudonym_continuity_is_not_independent_control",
  "user_agent_label_is_not_referral_or_identity",
  "unclassified_settlements_are_not_outside_customers",
  "task_link_is_not_payer_identity",
  "full_window_coverage_is_not_assumed",
  "origin_label_is_not_an_outside_customer",
  "declared_task_link_is_not_an_observed_purchase",
  "outside_answer_requires_observed_qualification",
  "e08_useful_work_requires_observed_review",
  "h_join_requires_an_h_result_in_inputs",
  "measurement_journal_not_read",
]);

export const E18_HEAD_USED = "11871c33e294ad6acecd0fa7049d9104d9152723";

const COMPLETE_DELIVERY = new Set([
  "full_bounded_capture",
  "complete_useful",
  "useful_negative",
  "source_refusal",
]);

export function isSchemaValidDelivery(validation) {
  return validation?.validatorVerdict === "pass" && COMPLETE_DELIVERY.has(validation?.deliveryClass);
}

export function extensionPublicFields() {
  return {
    schema: OBSERVATION_SCHEMA,
    optional: true,
    charged: false,
    payerIdentity: false,
    usefulness: USEFULNESS_UNKNOWN,
    path: CALLER_RESULT_FEEDBACK_PATH,
    priorHeader: PRIOR_CAPABILITY_HEADER,
    maxExtensionBytes: MAX_EXTENSION_BYTES,
    dispositions: [...CALLER_RESULT_DISPOSITIONS],
    reasonCategories: [...CALLER_RESULT_REASON_CATEGORIES],
    retainedUse: [...RETAINED_USE],
    nextTaskRelations: [...NEXT_TASK_RELATIONS],
    originLabels: [...ORIGIN_LABELS],
    fields: ["disposition", "reasonCategory", "retainedUse", "nextTask", "originLabel", "tenant", "sourceSha", "priorBinding", "decline"],
    nextTaskFields: ["relation", "taskRef"],
    priorBindingFields: ["paidEvidenceId", "taskRef"],
    coverage: COVERAGE_RESULT,
    windowCoverage: COVERAGE_WINDOW,
    declineOmitsDisposition: true,
  };
}

export function usefulServiceObservationPublicContract() {
  return {
    ...callerResultFeedbackPublicContract(),
    usefulServiceObservation: extensionPublicFields(),
  };
}
