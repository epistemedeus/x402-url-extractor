import { projectCapturedStages } from "./causal-stages.mjs";
import { verifiedCaptureFor } from "./cut.mjs";
import { digest } from "../../free-task-observation-100421/vendor/bounds.mjs";
import { BASE_COMMIT } from "../../free-task-observation-100421/src/export.mjs";
import {
  BUNDLE_SCHEMA,
  projectBundle,
  replayRetained,
  RETAINED_SCHEMA as JOURNAL_RETAINED_SCHEMA,
} from "../../free-task-observation-100421/src/project.mjs";
import { containsRestrictedKey } from "../../../tools/ops/three-site-settlement-join/measure/src/restricted.mjs";
import {
  ADAPT_HEAD,
  ADAPT_JOB_ID,
  ATTEMPT_OF,
  CLOCK_WINDOW_FIX,
  COMPLETE_JOB_ID,
  CLOCK_WINDOW_FIX_APPLIED,
  CLOCK_WINDOW_FIX_COMMIT_ANCESTOR_OF_MERCHANT161,
  CLOCK_WINDOW_FIX_CONTENT_ON_MERCHANT161,
  CLOCK_WINDOW_FIX_ON_THIS_BRANCH,
  DISPOSITIONS,
  EVENT_ID,
  FORBIDDEN_OPERATION,
  HEX64,
  JOB_ID,
  PINS,
  PRIOR_VIEW_HEAD,
  PRODUCTION_FRESHNESS_MAX_AGE_MS,
  REPORT_SCHEMA,
  RETAINED_SCHEMA,
  TASK_REF,
} from "./constants.mjs";
import { fail } from "./errors.mjs";
import { publicSeam } from "./seam.mjs";

const INPUT_KEYS = [
  "attemptOf",
  "baseline",
  "journal",
  "laterInputDigest",
  "link",
  "restart",
  "taskRef",
];
const LABEL_KEYS = new Set(["customer", "customerlabel", "agentid", "globalagentid"]);

function sameKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mentionsForbidden(value, seen = new WeakSet()) {
  if (value === FORBIDDEN_OPERATION) return true;
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => mentionsForbidden(item, seen));
  return Object.values(value).some((item) => mentionsForbidden(item, seen));
}

function badAttemptOf(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => badAttemptOf(item, seen));
  if (Object.prototype.hasOwnProperty.call(value, "attemptOf") && value.attemptOf !== ATTEMPT_OF) return true;
  return Object.values(value).some((item) => badAttemptOf(item, seen));
}

function refuseOwnLabels(object) {
  if (!object || typeof object !== "object") return;
  for (const key of Object.keys(object)) {
    if (LABEL_KEYS.has(normalizeKey(key))) fail("customer_label_refused");
  }
}

function unresolvedStage(reason) {
  return { disposition: "unresolved", reason, observed: "unknown" };
}

function coverageFields(bundle, cohort) {
  const proof = verifiedCaptureFor(bundle);
  const fixtureReplay = bundle.sources.some(source => source.plane === "retention" && source.records.some(row => row.observation?.replay?.provenance === "fixture_rpc"));
  const fixture = fixtureReplay || cohort === "owner_qa" || cohort === "controlled_test" || bundle.sources.some(source => source.kind === "synthetic_fixture");
  const coverage = proof?.coverage || "unknown";
  const runtime = proof?.runtime;
  const production = runtime?.entrypoint === "server.js" && typeof runtime.deploymentId === "string" && runtime.deploymentId.length > 0
    && /^[a-f0-9]{40}$/.test(runtime.source || "") && /^https:\/\//.test(runtime.publicUrl || "");
  return {
    journalCutCoverage: coverage,
    journalCovered: proof ? coverage === "complete" ? true : coverage === "partial" ? false : null : null,
    liveCoverage: production ? coverage : "unresolved",
    liveCoverageReason: production ? "registered_production_journal_capture_customer_usefulness_separate"
      : fixture ? "fixture_or_owner_qa_is_not_live_production_coverage" : "production_capture_unobserved",
    observationClassification: fixture ? "owner_qa_or_fixture" : "external_unknown_or_unverified",
    productionJournalCoverage: production ? coverage : "unknown",
    producerSourceDigest: proof?.sourceDigest || null,
    coverageAuthority: proof ? "authenticated_producer_capture" : "supplied_export_unverified",
  };
}

function unresolvedStages(reason) {
  return {
    attempt: unresolvedStage(reason),
    delivery: unresolvedStage(reason),
    callerUsefulness: unresolvedStage(reason),
    independentReplay: unresolvedStage(reason),
    retention: unresolvedStage(reason),
    laterUse: unresolvedStage(reason),
    settlement: unresolvedStage(reason),
  };
}

function shell(fields) {
  return {
    schema: REPORT_SCHEMA,
    jobId: JOB_ID,
    attemptOf: ATTEMPT_OF,
    operationRemint: "refused",
    forbiddenOperationId: FORBIDDEN_OPERATION,
    decision: fields.decision,
    reason: fields.reason,
    taskRef: fields.taskRef,
    commerceEventId: fields.commerceEventId,
    operationId: fields.operationId,
    cohort: fields.cohort,
    ...(fields.sourceDeliveryAttribution ? { sourceDeliveryAttribution: fields.sourceDeliveryAttribution } : {}),
    customer: null,
    globalAgentId: null,
    database: null,
    signer: null,
    mintedGrant: false,
    automaticMutationRetries: 0,
    liveCoverage: fields.liveCoverage,
    liveCoverageReason: fields.liveCoverageReason,
    journalCutCoverage: fields.journalCutCoverage,
    productionJournalCoverage: fields.productionJournalCoverage,
    coverageAuthority: fields.coverageAuthority,
    observationClassification: fields.observationClassification,
    outsideUseEstablished: false,
    evidenceKind: fields.evidenceKind,
    journalCovered: fields.journalCovered,
    populationConversionRate: null,
    stageCounts: null,
    recognizedRevenueAtomic: "unknown",
    paymentPermitted: false,
    paymentClassification: fields.paymentClassification || {
      disposition: "unresolved",
      authority: "existing_payment_classifier_not_recomputed",
      joinedToThisAttempt: false,
    },
    useful: fields.useful,
    usefulNegative: fields.usefulNegative,
    inheritedUsefulness: null,
    historicalCriterion: fields.historicalCriterion,
    stages: fields.stages,
    restart: fields.restart,
    publicSeam: fields.publicSeam,
    provenance: {
      reader: "isolated_attempt_useful_view_reuses_421_projectBundle",
      measurement: "not_reimplemented",
      authenticity: fields.coverageAuthority === "authenticated_producer_capture" ? "authenticated_producer_capture_not_customer_identity" : "supplied_journal_not_independently_authenticated",
      identity: "not_inferred",
      pins: PINS,
      observerProducerCommit: BASE_COMMIT,
      observerProducerCommitRole: "conversion_schema_compatibility",
      producerSourceDigest: fields.producerSourceDigest || null,
      clockWindowFix: {
        commit: CLOCK_WINDOW_FIX,
        branch: "codex/task-observer-window-1003",
        applied: CLOCK_WINDOW_FIX_APPLIED,
        onThisBranch: CLOCK_WINDOW_FIX_ON_THIS_BRANCH,
        commitIsAncestorOfMerchant161: CLOCK_WINDOW_FIX_COMMIT_ANCESTOR_OF_MERCHANT161,
        contentPresentOnMerchant161: CLOCK_WINDOW_FIX_CONTENT_ON_MERCHANT161,
        productionFreshnessMaxAgeMs: PRODUCTION_FRESHNESS_MAX_AGE_MS,
      },
      seller041: "frozen_not_rewritten",
      integrationDelta: "applied",
      enrollment: "isolated_branch",
      adapt: {
        jobId: ADAPT_JOB_ID,
        priorViewHead: PRIOR_VIEW_HEAD,
        adaptHead: ADAPT_HEAD,
        priorViewOperationReused: false,
      },
      complete: {
        jobId: COMPLETE_JOB_ID,
        measurementSource: PRIOR_VIEW_HEAD,
        releasedMerchantHead: PINS.releasedMerchantHead,
        publicAcquisitionArtifact: PINS.publicAcquisitionArtifact,
      },
    },
  };
}

function openJournal(journal) {
  if (!journal || typeof journal !== "object") fail("bundle_rejected");
  if (journal.schema === JOURNAL_RETAINED_SCHEMA) {
    replayRetained(journal);
    return journal.bundle;
  }
  if (journal.schema === BUNDLE_SCHEMA) return journal;
  fail("bundle_rejected");
}

function responseDigestFor(bundle, commerceEventId, taskRef) {
  const digests = [];
  for (const source of bundle.sources) {
    if (source.plane !== "retention" || !Array.isArray(source.records)) continue;
    for (const row of source.records) {
      if (row?.action === "retain" && row.commerceEventId === commerceEventId && row.taskRef === taskRef) {
        digests.push(row.observation?.responseDigest || null);
      }
    }
  }
  return digests.length === 1 ? digests[0] : null;
}

function labelStages(journey) {
  const stages = journey.stages;
  const delivery = stages.delivery_observation.status === "observed"
    ? { disposition: "producer-observed", authority: "producer_journal_http_finish_and_transport",
      ...(stages.delivery_observation.schemaUsefulOutput ? { schemaUsefulOutput: stages.delivery_observation.schemaUsefulOutput, schemaAuthority: stages.delivery_observation.schemaAuthority } : {}) }
    : unresolvedStage(stages.delivery_observation.reasons[0] || "delivery_unknown");
  const caller = stages.caller_asserted_usefulness.status === "asserted"
    ? { disposition: "caller asserted", authority: "caller_claim", verification: "unverified", value: stages.caller_asserted_usefulness.value }
    : unresolvedStage(stages.caller_asserted_usefulness.reasons[0] || "no_caller_claim");
  const replay = stages.independently_replayed_output.status === "observed"
    ? {
      disposition: "classified",
      authority: "existing_fixed_predicate",
      criterion: stages.independently_replayed_output.criterion,
    }
    : unresolvedStage(stages.independently_replayed_output.reasons[0] || "predicate_unknown");
  const retention = stages.authorized_retention.status === "observed"
    ? {
      disposition: "authorized",
      authority: "existing_customer_grant",
      currentRights: stages.authorized_retention.currentRights === true,
    }
    : unresolvedStage(stages.authorized_retention.reasons[0] || "retention_unknown");
  const later = stages.later_use.status === "observed"
    ? { disposition: "authorized", authority: "existing_authorized_retained_read", callerReceipt: "unknown", appliedUse: "unknown" }
    : unresolvedStage(stages.later_use.reasons[0] || "later_use_unknown");
  return {
    attempt: { disposition: "producer-observed", authority: "server_minted_commerce_event_and_task_ref" },
    delivery,
    callerUsefulness: caller,
    independentReplay: replay,
    retention,
    laterUse: later,
    settlement: stages.settlement.status === "observed"
      ? { disposition: "producer-observed", authority: "existing_settlement_journal", recognizedRevenue: "unknown" }
      : unresolvedStage(stages.settlement.reasons[0] || "payment_classification_not_on_this_attempt"),
  };
}

function assertDispositions(stages) {
  for (const stage of Object.values(stages)) {
    if (!DISPOSITIONS.includes(stage.disposition)) fail("disposition_rejected");
  }
}

function readRestart(restart) {
  if (restart == null) return null;
  if (!sameKeys(restart, ["acknowledgement", "physicalRecordEstablished"])) fail("restart_rejected");
  if (!["unknown", "not_established"].includes(restart.acknowledgement)) fail("restart_rejected");
  if (typeof restart.physicalRecordEstablished !== "boolean") fail("restart_rejected");
  return {
    acknowledgement: restart.acknowledgement,
    physicalRecordEstablished: restart.physicalRecordEstablished,
    reconciledBy: restart.physicalRecordEstablished ? "existing_journal_replay" : "write_outcome_unknown",
    mintedGrant: false,
    automaticMutationRetries: 0,
  };
}

function checkLink(link, journey, taskRef, responseDigest) {
  if (link == null) return;
  const keys = Object.keys(link).sort();
  const allowed = responseDigest == null || link.responseDigest === undefined
    ? ["commerceEventId", "operationId", "taskRef"]
    : ["commerceEventId", "operationId", "responseDigest", "taskRef"];
  if (!keys.every((key) => allowed.includes(key)) || !["commerceEventId", "operationId", "taskRef"].every((key) => keys.includes(key))) {
    fail("counterfeit_link");
  }
  if (!EVENT_ID.test(link.commerceEventId || "") || !TASK_REF.test(link.taskRef || "")) fail("counterfeit_link");
  if (link.responseDigest !== undefined && !HEX64.test(link.responseDigest)) fail("counterfeit_link");
  if (!journey || link.commerceEventId !== journey.commerceEventId || link.taskRef !== taskRef || link.operationId !== journey.operationId) {
    fail("counterfeit_link");
  }
  if (link.responseDigest !== undefined && link.responseDigest !== responseDigest) fail("counterfeit_link");
}

export function readAttemptUsefulView(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("input_rejected");
  if (Object.prototype.hasOwnProperty.call(input, "paymentReplay")
    || Object.prototype.hasOwnProperty.call(input, "database")
    || Object.prototype.hasOwnProperty.call(input, "signer")) {
    fail("payment_replay_refused");
  }
  refuseOwnLabels(input);
  refuseOwnLabels(input.link);
  if (containsRestrictedKey(input)) fail("wallet_or_header_is_not_identity");
  if (!sameKeys(input, INPUT_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(input, key)))) {
    fail("unsupported_authority_field");
  }
  if (!Object.prototype.hasOwnProperty.call(input, "attemptOf") || input.attemptOf !== ATTEMPT_OF) {
    fail("attempt_of_not_null");
  }
  if (mentionsForbidden(input)) fail("operation_remint_refused");
  if (badAttemptOf(input)) fail("attempt_of_not_null");
  if (!TASK_REF.test(input.taskRef || "")) fail("task_rejected");
  if (input.laterInputDigest != null && !HEX64.test(input.laterInputDigest)) fail("changed_later_input");
  const restart = readRestart(input.restart);
  const seam = publicSeam(input.baseline ?? null);
  const bundle = openJournal(input.journal);
  if (!Array.isArray(bundle.sources) || bundle.sources.length === 0) fail("source_mismatch");
  const commits = new Set(bundle.sources.map((source) => source.producerCommit));
  const kinds = new Set(bundle.sources.map((source) => source.kind));
  if (commits.size !== 1 || !commits.has(BASE_COMMIT) || kinds.size !== 1) fail("source_mismatch");
  const evidenceKind = [...kinds][0];
  const observedCoverage = (cohort) => coverageFields(bundle, cohort);
  if (Array.isArray(bundle.question?.taskRefs) && !bundle.question.taskRefs.includes(input.taskRef)) {
    fail("task_not_in_source");
  }
  const narrowed = structuredClone(bundle);
  narrowed.question = { ...narrowed.question, taskRefs: [input.taskRef] };
  let projected;
  try {
    projected = projectBundle(narrowed);
    projected = projectCapturedStages(bundle, projected);
  } catch (error) {
    if (error.code === "source_rejected") fail("source_mismatch");
    if (error.code === "question_task_rejected") fail("task_rejected");
    throw error;
  }
  if (projected.recognizedRevenueAtomic !== "0" || projected.paymentPermitted !== false) {
    fail("revenue_reclassification_refused");
  }
  const covered = projected.denominator?.covered === true;
  const captureProof = verifiedCaptureFor(bundle);
  const attemptCovered = captureProof
    ? ['attempts', 'task_refs'].every(plane => captureProof.planes[plane].coverage === 'complete' && projected.coverage[plane].complete) : covered;
  const boundRefPresent = bundle.sources.some(source => source.plane === 'task_refs' && source.records.some(row => row.taskRef === input.taskRef));
  const journey = projected.journeys?.length === 1 ? projected.journeys[0] : null;
  if (projected.journeys?.length > 1) fail("not_one_attempt");
  if (!journey || journey.taskRef !== input.taskRef) {
    if (input.link) fail("counterfeit_link");
    const reason = boundRefPresent ? 'bound_task_reference_without_attempt' : !attemptCovered
      ? (projected.denominator?.reasons?.[0] || "journal_not_covered")
      : verifiedCaptureFor(bundle) ? "covered_task_absence" : "task_not_in_source";
    const lost = restart && restart.physicalRecordEstablished === false;
    return shell({
      decision: "unresolved",
      reason: lost ? "write_outcome_unknown" : reason,
      taskRef: input.taskRef,
      commerceEventId: null,
      operationId: null,
      cohort: null,
      evidenceKind,
      ...observedCoverage(null),
      useful: null,
      usefulNegative: null,
      historicalCriterion: null,
      stages: attemptCovered && !boundRefPresent && !journey && !lost && captureProof
        ? { ...unresolvedStages("predecessor_not_observed"), attempt: { disposition: "covered-absence", observed: "absent", reason: "no_bound_task_attempt_in_recorded_interval" } }
        : unresolvedStages(lost ? "write_outcome_unknown" : reason),
      restart,
      publicSeam: seam,
    });
  }
  const boundDigest = responseDigestFor(bundle, journey.commerceEventId, input.taskRef);
  checkLink(input.link, journey, input.taskRef, boundDigest);
  let stages = labelStages(journey);
  const criterion = journey.usefulness === "positive" || journey.usefulness === "agreed_negative"
    ? journey.usefulness
    : null;
  const classified = stages.independentReplay.disposition === "classified" && criterion !== null
    && stages.delivery.disposition === "producer-observed";
  let useful = classified ? true : null;
  let usefulNegative = useful === true && criterion === "agreed_negative" ? true : null;
  let decision = "one_attempt";
  let reason = null;
  if (input.laterInputDigest != null && input.laterInputDigest !== boundDigest) {
    stages = {
      ...stages,
      laterUse: unresolvedStage("changed_later_input"),
    };
    useful = null;
    usefulNegative = null;
    decision = "reject";
    reason = "changed_later_input";
  }
  if (restart && restart.physicalRecordEstablished === false) {
    useful = null;
    usefulNegative = null;
    decision = "unresolved";
    reason = "write_outcome_unknown";
    stages = unresolvedStages("write_outcome_unknown");
  }
  assertDispositions(stages);
  const report = shell({
    decision,
    reason,
    taskRef: input.taskRef,
    commerceEventId: journey.commerceEventId,
    operationId: journey.operationId,
    cohort: journey.cohort,
    sourceDeliveryAttribution: journey.sourceDeliveryAttribution,
    evidenceKind,
    ...observedCoverage(journey.cohort),
    useful,
    usefulNegative,
    historicalCriterion: decision === "reject" ? criterion : null,
    ...(stages.settlement.disposition === 'producer-observed' ? { paymentClassification: {
      disposition: 'producer-observed', authority: 'existing_settlement_journal', joinedToThisAttempt: true,
      class: journey.stages.settlement.paymentClass,
    } } : {}),
    stages,
    restart,
    publicSeam: seam,
  });
  if (containsRestrictedKey(report)) fail("wallet_or_header_is_not_identity");
  if (report.attemptOf !== null || report.populationConversionRate !== null || report.stageCounts !== null) {
    fail("population_conversion_refused");
  }
  return report;
}

export function retainAttemptReport(input, report) {
  const again = readAttemptUsefulView(input);
  if (digest(again) !== digest(report)) fail("report_not_reproducible");
  return {
    schema: RETAINED_SCHEMA,
    attemptOf: ATTEMPT_OF,
    taskRef: input.taskRef,
    laterInputDigest: input.laterInputDigest ?? null,
    restart: input.restart ?? null,
    link: input.link ?? null,
    baseline: input.baseline ?? null,
    journal: input.journal,
    report,
  };
}

export function replayAttemptReport(retained) {
  if (!retained || retained.schema !== RETAINED_SCHEMA) fail("retained_rejected");
  if (retained.attemptOf !== ATTEMPT_OF) fail("attempt_of_not_null");
  const again = readAttemptUsefulView({
    attemptOf: ATTEMPT_OF,
    taskRef: retained.taskRef,
    journal: retained.journal,
    laterInputDigest: retained.laterInputDigest ?? null,
    baseline: retained.baseline ?? null,
    restart: retained.restart ?? null,
    link: retained.link ?? null,
  });
  if (digest(again) !== digest(retained.report)) fail("replay_mismatch");
  return again;
}

export function rejectTamperedJournal(journal) {
  try {
    replayRetained(journal);
  } catch (error) {
    if (error.code === "replay_mismatch") {
      return {
        decision: "reject",
        reason: "replay_mismatch",
        attemptOf: ATTEMPT_OF,
        inheritedUsefulness: null,
        useful: null,
        mintedGrant: false,
        recognizedRevenueAtomic: "unknown",
      };
    }
    throw error;
  }
  fail("wrong_join", "tampered journal was accepted");
}
