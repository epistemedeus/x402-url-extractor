import { canonicalJson, digestOf, sha256 } from "./canonical.mjs";
import {
  EVIDENCE_JOIN_COMMIT,
  EXPERIMENT_INPUT_SCHEMA,
  READOUT_SCHEMA,
  SNAPSHOT_SCHEMA,
  emptyActors,
  emptyStages,
} from "./constants.mjs";
import { projectDemandText } from "./demand.mjs";
import { eligibilityReport } from "./eligibility.mjs";
import { fail } from "./errors.mjs";
import { projectForwardRecords } from "./forward.mjs";
import { assertEnvelope, refusesDirective } from "./privacy.mjs";
import { projectEvent } from "./project-event.mjs";

const MEASUREMENT = Object.freeze({
  question: "Which existing event shows that an agent got a useful task result and returned, rather than only downloading or receiving a 402?",
  notSufficient: Object.freeze([
    ["commerce_demand_aggregate", "counts_have_no_individual_task_join"],
    ["http_402_or_typed_challenge", "application_was_not_run"],
    ["download_or_tarball_http_200", "bytes_are_not_a_task_result"],
    ["native_cli_exit_0", "exit_0_without_skill_and_support_files"],
    ["paid_success_response_digest", "validator_authority_is_none"],
    ["http_200", "status_is_not_a_task_criterion"],
    ["typed_handler_success", "handler_success_is_not_task_usefulness"],
    ["settlement_reference", "a_transaction_is_not_valid_delivery"],
    ["forward_schema_valid_delivery", "usefulness_stays_unknown"],
    ["actor_hmac_wallet_or_reviewer_alias", "not_an_identity"],
  ]).map(([source, because]) => ({ source, because })),
  closestReturnEvent: {
    source: "forward_v2_retained_use",
    authority: "authenticated_producer_observation",
    establishes: "later_observation_of_the_same_receipt",
    doesNotEstablish: "useful_task_result_or_independent_customer",
  },
  usefulnessAuthority: "explicit_task_criterion_only",
  unknownClassification: "reused",
});

function isoMs(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function bindingId(snapshot) {
  return digestOf({
    schema: snapshot.schema,
    mode: snapshot.mode,
    asOf: snapshot.asOf,
    sources: (snapshot.sources || []).map((source) => ({
      id: source.id,
      kind: source.kind,
      locator: source.locator,
      sha256: source.sha256,
    })),
    catalogSha256: snapshot.catalog?.sha256 || null,
  });
}

function catalogChanged(snapshot) {
  const catalog = snapshot.catalog;
  if (!catalog || typeof catalog !== "object") return false;
  return typeof catalog.boundSha256 === "string" && catalog.boundSha256 !== catalog.sha256;
}

function sourceState(source, asOf) {
  const asOfMs = isoMs(asOf);
  const staleMs = isoMs(source.staleAfter);
  if (source.stale === true || (staleMs !== null && asOfMs !== null && asOfMs > staleMs)) return "stale_source";
  return "current";
}

function addActors(target, extra) {
  for (const key of Object.keys(target)) target[key] += extra[key] || 0;
}

function finishTask(taskRef, rows, snapshot) {
  const usable = rows.filter((row) => row.usable);
  const reasons = new Set(rows.flatMap((row) => row.reasons));
  const stages = emptyStages();
  const actors = emptyActors();
  const seen = new Map();
  let duplicate = false;
  let nativeInstall = false;
  let download = false;
  let receipt = null;
  let laterReceipt = null;
  let settlementReference = null;
  let useful = "unknown";
  let callerClaimIndependent = false;
  let paidOperation = false;
  let freeSufficient = null;
  let incrementalValue = null;
  let rewardPresent = null;
  let contractCurrent = null;
  let artifactVerified = false;
  let experimentId = null;
  let taskDigest = null;
  let boundDigest = null;
  let unpaidUseful = false;
  const corrections = new Set(usable.map((row) => row.correctionOf).filter(Boolean));
  for (const row of usable) {
    const prior = seen.get(row.eventId);
    const material = canonicalJson({ ...row, reasons: row.reasons });
    if (prior && prior !== material) duplicate = true;
    if (!prior) {
      seen.set(row.eventId, material);
      for (const stage of Object.keys(stages)) if (row.stages[stage]) stages[stage] += 1;
      addActors(actors, row.actors);
    }
    if (row.nativeInstall) nativeInstall = true;
    if (row.downloadEstablished) download = true;
    if (row.receiptDigest && row.stages.useful_result) receipt = row.receiptDigest;
    if (row.receiptDigest && row.stages.later_useful_call) laterReceipt = row.receiptDigest;
    if (row.settlementEstablished) settlementReference = row.settlementReferenceKept;
    if (row.useful === "false") useful = "false";
    else if (row.useful === "true" && useful !== "false") useful = "true";
    if (row.callerClaimIndependent) callerClaimIndependent = true;
    if (row.paidOperation) paidOperation = true;
    if (row.freeSufficient !== null) freeSufficient = row.freeSufficient;
    if (row.incrementalValue !== null) incrementalValue = row.incrementalValue;
    if (row.rewardPresent !== null) rewardPresent = row.rewardPresent;
    if (row.contractCurrent !== null) contractCurrent = row.contractCurrent;
    if (row.artifactVerified) artifactVerified = true;
    if (row.unpaidUseful) unpaidUseful = true;
    if (row.experimentId) experimentId = row.experimentId;
    if (row.taskDigest) taskDigest = row.taskDigest;
  }
  const declared = (snapshot.tasks || []).find((item) => item.taskRef === taskRef);
  if (declared?.taskDigest && HEX_OK(declared.taskDigest)) boundDigest = declared.taskDigest;
  if (declared?.boundTaskDigest && declared.taskDigest && declared.boundTaskDigest !== declared.taskDigest) {
    reasons.add("task_changed");
  }
  if (taskDigest && boundDigest && taskDigest !== boundDigest) reasons.add("task_changed");
  const sourceIds = [...new Set(usable.map((row) => row.sourceId).filter(Boolean))];
  for (const sourceId of sourceIds) {
    const source = (snapshot.sources || []).find((item) => item.id === sourceId);
    if (!source) reasons.add("missing_source");
    else if (sourceState(source, snapshot.asOf) === "stale_source") reasons.add("stale_source");
    if (source?.boundSha256 && source.sha256 && source.boundSha256 !== source.sha256) reasons.add("source_changed");
  }
  if (duplicate) reasons.add("duplicate_id_conflict");
  if (laterReceipt && receipt && laterReceipt !== receipt) reasons.add("wrong_receipt");
  if (stages.settlement > 0 && stages.useful_result === 0 && useful !== "true") reasons.add("missing_delivery");
  if (corrections.size > 0) reasons.add("corrected");
  const blocking = ["duplicate_id_conflict", "task_changed", "stale_source", "source_changed", "task_ref_not_a_pseudonym", "unjoinable_event"];
  const blocked = [...reasons].some((reason) => blocking.includes(reason));
  const decisionCurrent = !blocked && !catalogChanged(snapshot);
  if (catalogChanged(snapshot)) reasons.add("catalog_changed");
  let status = "partial";
  if (!usable.length || blocked) status = "unjoinable";
  else if (experimentId === "native-install-unpaid-call" && nativeInstall && stages.valid_call && stages.useful_result && stages.later_useful_call) status = "joined";
  else if (experimentId === "free-diagnosis-paid-operation" && stages.explicit_purchase_attempt && stages.settlement && stages.useful_result && stages.later_useful_call && useful === "true") status = "joined";
  else if (experimentId === "bounty-contract-reused-artifact" && artifactVerified && stages.later_useful_call && useful === "true") status = "joined";
  else if ([...reasons].some((reason) => ["duplicate_id_conflict", "unjoinable_event"].includes(reason))) status = "unjoinable";
  return {
    taskRef,
    experimentId,
    status,
    decisionCurrent: decisionCurrent && status !== "unjoinable",
    stages,
    actors,
    nativeInstall,
    downloadOnly: download && !nativeInstall,
    useful,
    callerClaimIndependent,
    independentUse: 0,
    paidOperation,
    freeSufficient,
    incrementalValue,
    rewardPresent,
    contractCurrent,
    artifactVerified,
    settlementReference,
    unpaidUseful,
    missingJoinReasons: [...reasons].sort(),
    correctedEventIds: [...corrections].sort(),
    settlementCountedOnce: stages.settlement > 0 ? 1 : 0,
  };
}

function HEX_OK(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function uncertainty(snapshot, demand) {
  const internal = ["task_ref_writer_not_deployed"];
  const external = [];
  if (snapshot.mode === "synthetic") internal.push("synthetic_control");
  if (snapshot.mode === "real") internal.push("public_aggregate_has_no_operation_id");
  if ((snapshot.events || []).some((event) => event.typedResult)) internal.push("typed_outcome_not_a_journey");
  if (snapshot.observations?.sdsSuppliedRowGetStatus === 404) internal.push("sds_supplied_row_get_not_a_readiness_proof");
  if (!demand) return { internal: internal.sort(), external };
  if (demand.window.coverage !== "complete") external.push("requested_window_unknown_for_full_window");
  if (demand.customerPlaneNull) external.push("customer_plane_null");
  if (demand.independentUsefulDemand === "unknown") external.push("independent_useful_demand_unknown");
  if (demand.independentPaidSuccessActors === 0 && demand.window.coverage !== "complete") {
    external.push("zero_independent_actors_inside_incomplete_window");
  }
  return { internal: internal.sort(), external: external.sort() };
}

function missingInstrumentation(snapshot) {
  const missing = [
    "no_public_event_distinguishes_native_install_from_download",
    "forward_task_ref_not_emitted_by_deployed_merchant",
    "retained_use_does_not_record_task_usefulness",
    "typed_mcp_decision_is_not_a_five_stage_journey",
  ];
  if (snapshot.observations?.sdsSuppliedRowGetStatus === 404) missing.push("sds_supplied_row_post_not_sent_get_was_404");
  if (snapshot.citedSample && snapshot.citedSample.recheckedThisRun !== true) missing.push("twelve_door_sample_not_reprobed_this_run");
  if (snapshot.observations?.neoCommitApiStatus === 404) missing.push("neo_commit_api_unreadable_tarball_is_not_reuse");
  return missing.sort();
}

function nextExperiment(experiments) {
  return {
    enabled: "native-install-unpaid-call",
    reason: "Eligibility is defined. The consumer can replay a redacted install receipt and an unpaid call. Public sources do not contain that receipt yet.",
    notEnabled: [
      {
        id: "free-diagnosis-paid-operation",
        reason: "The cited twelve-door sample has no eligible denominator. That negative is not universal paid-demand proof.",
      },
      {
        id: "bounty-contract-reused-artifact",
        reason: "The public pack download is not a verified reused artifact and is not a launch.",
      },
    ],
    consumes: EXPERIMENT_INPUT_SCHEMA,
    waitingFor: experiments.nativeInstallUnpaidCall.doesNotCount,
  };
}

export function joinSnapshot(snapshot, inputs = {}) {
  if (!snapshot || snapshot.schema !== SNAPSHOT_SCHEMA || (snapshot.mode !== "real" && snapshot.mode !== "synthetic")) {
    fail("invalid_snapshot");
  }
  const directive = refusesDirective(snapshot);
  if (directive) fail(directive);
  assertEnvelope(snapshot);
  if (snapshot.mode === "real" && Array.isArray(snapshot.events) && snapshot.events.length > 0) {
    fail("synthetic_mixed_into_real");
  }
  let demand = null;
  const demandSource = (snapshot.sources || []).find((source) => source.kind === "public_aggregate");
  if (demandSource) {
    const text = inputs.files?.[demandSource.id];
    if (typeof text !== "string") fail("source_digest_mismatch");
    if (sha256(text) !== demandSource.sha256 || Buffer.byteLength(text) !== demandSource.bytes) fail("source_digest_mismatch");
    demand = projectDemandText(text, demandSource.locator);
  }
  const forward = projectForwardRecords(snapshot.forwardRecords || []);
  const projected = (snapshot.events || []).map(projectEvent);
  const byTask = new Map();
  for (const row of projected) {
    const key = row.taskRef || `unjoinable:${row.eventId || "none"}`;
    const list = byTask.get(key) || [];
    list.push(row);
    byTask.set(key, list);
  }
  const tasks = [...byTask.entries()]
    .map(([taskRef, rows]) => finishTask(taskRef, rows, snapshot))
    .sort((left, right) => left.taskRef.localeCompare(right.taskRef));
  for (const ref of forward.taskRefs) {
    const operation = forward.operations.find((item) => item.operationId === ref.operationId) || null;
    const existing = tasks.find((task) => task.taskRef === ref.taskRef);
    const note = operation?.canonicalStageJoin
      ? "forward_schema_valid_join_usefulness_unknown"
      : "forward_task_ref_without_useful_result";
    if (existing) {
      existing.forwardOperationId = ref.operationId;
      existing.missingJoinReasons = [...new Set([...existing.missingJoinReasons, note])].sort();
      if (existing.useful !== "true") existing.useful = "unknown";
    } else {
      tasks.push({
        taskRef: ref.taskRef,
        experimentId: null,
        status: "partial",
        decisionCurrent: !catalogChanged(snapshot),
        stages: emptyStages(),
        actors: emptyActors(),
        nativeInstall: false,
        downloadOnly: false,
        useful: "unknown",
        callerClaimIndependent: false,
        independentUse: 0,
        paidOperation: false,
        freeSufficient: null,
        incrementalValue: null,
        rewardPresent: null,
        contractCurrent: null,
        artifactVerified: false,
        settlementReference: null,
        unpaidUseful: false,
        missingJoinReasons: [note, "retained_use_usefulness_unknown"].sort(),
        correctedEventIds: [],
        settlementCountedOnce: 0,
        forwardOperationId: ref.operationId,
        forwardCanonicalJoin: operation?.canonicalStageJoin === true,
      });
    }
  }
  tasks.sort((left, right) => left.taskRef.localeCompare(right.taskRef));
  const downloads = (snapshot.observations?.downloads || []).map((row) => ({
    locator: row.locator,
    sha256: row.sha256,
    bytes: row.bytes,
    httpStatus: row.httpStatus,
    install: false,
    usefulResult: false,
    launched: false,
  }));
  const experiments = eligibilityReport({
    tasks,
    citedSample: snapshot.citedSample || null,
    downloads: downloads.length,
  });
  const actors = emptyActors();
  for (const task of tasks) addActors(actors, task.actors);
  actors.independent_use = 0;
  const readout = {
    schema: READOUT_SCHEMA,
    bindingId: bindingId(snapshot),
    mode: snapshot.mode,
    asOf: snapshot.asOf,
    evidenceJoinCommit: EVIDENCE_JOIN_COMMIT,
    pins: snapshot.pins || null,
    catalogChanged: catalogChanged(snapshot),
    catalog: snapshot.catalog || null,
    recognizedRevenueAtomic: "0",
    historicalCustomers: "unknown",
    customerClaim: false,
    independentUse: 0,
    measurement: MEASUREMENT,
    demand,
    forward,
    tasks,
    actors,
    settlementIsNotDelivery: true,
    http200IsNotUseful: true,
    exit0IsNotInstall: true,
    experiments,
    uncertainty: uncertainty(snapshot, demand),
    missingInstrumentation: missingInstrumentation(snapshot),
    effortPlanes: {
      source: "overview/EXPERIMENT-RETURN-LEDGER.json#researchAccounting.views",
      jobCash: null,
      measuredApiEquivalent: null,
      includedQuotaOpportunityCost: null,
      sharedRnd: null,
      demonstratedLaterReuse: null,
      summed: false,
      recognizedRevenueAtomic: "0",
    },
    downloads,
    inputOrderIgnored: true,
  };
  readout.experimentInput = experimentInput(readout);
  return readout;
}

function experimentInput(readout) {
  return {
    schema: EXPERIMENT_INPUT_SCHEMA,
    bindingId: readout.bindingId,
    mode: readout.mode,
    asOf: readout.asOf,
    catalogChanged: readout.catalogChanged,
    recognizedRevenueAtomic: "0",
    customerClaim: false,
    experiments: readout.experiments,
    next: nextExperiment(readout.experiments),
    missingInstrumentation: readout.missingInstrumentation,
    uncertainty: readout.uncertainty,
  };
}

export function compareReplay(snapshot, inputs) {
  const first = joinSnapshot(snapshot, inputs);
  const second = joinSnapshot(snapshot, inputs);
  return { equal: canonicalJson(first) === canonicalJson(second), bindingId: first.bindingId, readout: first };
}
