import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DeliveryError } from "../src/errors.mjs";
import { compareReplay, joinSnapshot } from "../src/join.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const bin = resolve(root, "bin/delivery-outcome.mjs");
const digest = "ab".repeat(32);
const tx = `0x${"11".repeat(32)}`;
const closed = "0x593559ea7a19277645a76e41aa29e713ed219db1f97e4be29c9dac9cf6cd4b37";

function snapshot(extra = {}) {
  return {
    schema: "pilot.delivery-outcome.snapshot.v1",
    mode: "synthetic",
    asOf: "2026-10-01T12:00:00.000Z",
    events: [],
    ...extra,
  };
}

function installEvent(overrides = {}) {
  return {
    eventId: "install-1",
    taskRef: "task-install-166",
    experimentId: "native-install-unpaid-call",
    stage: "discovery_or_download",
    install: {
      runtimeVersion: "0.21.5",
      exitCode: 0,
      skillFilePresent: true,
      supportFilesPresent: true,
      spoofedHeader: false,
    },
    ...overrides,
  };
}

function unpaidCall(overrides = {}) {
  return {
    eventId: "call-1",
    taskRef: "task-install-166",
    experimentId: "native-install-unpaid-call",
    stage: "valid_call",
    httpStatus: 200,
    paymentPresent: false,
    criterion: "unpaid_receipt_readable",
    receiptDigest: digest,
    actorLabel: "unknown",
    discoverySource: "goose-native",
    ...overrides,
  };
}

function laterCall(overrides = {}) {
  return {
    eventId: "later-1",
    taskRef: "task-install-166",
    experimentId: "native-install-unpaid-call",
    stage: "later_useful_call",
    httpStatus: 200,
    paymentPresent: false,
    criterion: "second_process_receipt_read",
    receiptDigest: digest,
    ...overrides,
  };
}

function paidBase(overrides = {}) {
  return {
    eventId: "paid-1",
    taskRef: "task-paid-audit",
    experimentId: "free-diagnosis-paid-operation",
    stage: "explicit_purchase_attempt",
    operationPath: "/commerce/seller-integrity-audit",
    decision: "attempt",
    paymentPresent: true,
    httpStatus: 200,
    usefulDelivery: "true",
    usefulReason: "additional_work_present",
    freeSufficient: false,
    incrementalValue: true,
    actorLabel: "unknown",
    cohort: "external_unknown",
    settlementState: "succeeded",
    settlementReference: tx,
    receiptDigest: digest,
    ...overrides,
  };
}

test("real public snapshot stays an incomplete aggregate", () => {
  const path = resolve(root, "fixtures/real/snapshot.json");
  const body = JSON.parse(readFileSync(path, "utf8"));
  const text = readFileSync(resolve(root, "fixtures/real/commerce-demand.json"), "utf8");
  const replay = compareReplay(body, { files: { "commerce-demand": text } });
  assert.equal(replay.equal, true);
  const readout = replay.readout;
  assert.equal(readout.mode, "real");
  assert.equal(readout.demand.individualJoin, false);
  assert.equal(readout.demand.window.coverage, "unknown_for_full_window");
  assert.equal(readout.demand.window.complete, false);
  assert.equal(readout.demand.customerPlaneNull, true);
  assert.equal(readout.demand.byResult.challenge, 1138);
  assert.equal(readout.demand.byResult.paid_success, 1);
  assert.equal(readout.demand.byResult.discovery, 1425);
  assert.equal(readout.demand.reconciledSettlements, 43);
  assert.equal(readout.demand.unclassifiedSettlementsRemainUnclassified, true);
  assert.equal(readout.demand.independentUseFromSettlements, 0);
  assert.equal(readout.demand.independentPaidSuccessActors, 0);
  assert.equal(readout.demand.independentUsefulDemand, "unknown");
  assert.equal(readout.demand.zeroIsNotHistoricalZero, true);
  assert.equal(readout.recognizedRevenueAtomic, "0");
  assert.equal(readout.historicalCustomers, "unknown");
  assert.equal(readout.customerClaim, false);
  assert.equal(readout.independentUse, 0);
  assert.equal(readout.experiments.nativeInstallUnpaidCall.eligibleCount, 0);
  assert.equal(readout.experiments.nativeInstallUnpaidCall.conversionRate, null);
  assert.equal(readout.experiments.freeDiagnosisPaidOperation.eligibleCount, 0);
  assert.equal(readout.experiments.freeDiagnosisPaidOperation.conversionRate, null);
  assert.equal(readout.experiments.freeDiagnosisPaidOperation.sample.doors, 12);
  assert.equal(readout.experiments.freeDiagnosisPaidOperation.sample.freeSufficient, 12);
  assert.equal(readout.experiments.freeDiagnosisPaidOperation.sample.universalPaidDemandFalsified, false);
  assert.equal(readout.experiments.freeDiagnosisPaidOperation.sample.recheckedThisRun, false);
  assert.equal(readout.experiments.bountyContractReusedArtifact.eligibleCount, 0);
  assert.equal(readout.experiments.bountyContractReusedArtifact.launched, false);
  assert.equal(readout.downloads[0].install, false);
  assert.equal(readout.downloads[0].sha256, "fd31b0224a0abd733bfde042cdbd08e6af29849adad1910ab895b7fdb05587b4");
  assert.equal(readout.catalogChanged, false);
  assert.ok(readout.uncertainty.internal.includes("public_aggregate_has_no_operation_id"));
  assert.ok(readout.uncertainty.external.includes("requested_window_unknown_for_full_window"));
  assert.equal(readout.uncertainty.internal.some((item) => readout.uncertainty.external.includes(item)), false);
  assert.equal(readout.effortPlanes.summed, false);
  assert.equal(readout.effortPlanes.jobCash, null);
  assert.equal(readout.experimentInput.next.enabled, "native-install-unpaid-call");
  assert.equal(readout.pins.launchInferred, false);
  assert.throws(() => joinSnapshot({ ...body, events: [installEvent()] }, { files: { "commerce-demand": text } }), (error) => error.code === "synthetic_mixed_into_real");
});

test("joined install converts only after eligibility, and exit 0 or 200 or 402 do not", () => {
  const joined = joinSnapshot(snapshot({ events: [installEvent(), unpaidCall(), laterCall()] }));
  assert.equal(joined.tasks[0].status, "joined");
  assert.equal(joined.experiments.nativeInstallUnpaidCall.eligibleCount, 1);
  assert.equal(joined.experiments.nativeInstallUnpaidCall.conversionCount, 1);
  assert.equal(joined.actors.user_agent_label, 1);
  assert.equal(joined.actors.unknown_actor, 1);
  assert.equal(joined.independentUse, 0);

  const exitOnly = joinSnapshot(snapshot({
    events: [installEvent({
      install: { runtimeVersion: "0.21.5", exitCode: 0, skillFilePresent: false, supportFilesPresent: false, spoofedHeader: false },
    }), unpaidCall(), laterCall()],
  }));
  assert.equal(exitOnly.tasks[0].nativeInstall, false);
  assert.ok(exitOnly.tasks[0].missingJoinReasons.includes("exit0_without_skill_files"));
  assert.equal(exitOnly.experiments.nativeInstallUnpaidCall.eligibleCount, 0);
  assert.equal(exitOnly.experiments.nativeInstallUnpaidCall.conversionRate, null);

  const only200 = joinSnapshot(snapshot({
    events: [installEvent(), unpaidCall({ criterion: null }), laterCall()],
  }));
  assert.ok(only200.tasks[0].missingJoinReasons.includes("http_200_not_useful"));
  assert.equal(only200.tasks[0].stages.useful_result, 0);
  assert.equal(only200.experiments.nativeInstallUnpaidCall.conversionCount, 0);

  const challenge = joinSnapshot(snapshot({
    events: [installEvent(), unpaidCall({ httpStatus: 402, typedResult: "challenge" })],
  }));
  assert.equal(challenge.tasks[0].stages.valid_call, 0);
  assert.ok(challenge.tasks[0].missingJoinReasons.includes("received_402"));
  assert.ok(challenge.tasks[0].missingJoinReasons.includes("typed_outcome_not_a_journey"));
});

test("partial, unjoinable, changed task, stale source, and duplicate ids stay distinct", () => {
  const partial = joinSnapshot(snapshot({ events: [installEvent(), unpaidCall()] }));
  assert.equal(partial.tasks[0].status, "partial");
  assert.equal(partial.experiments.nativeInstallUnpaidCall.conversionCount, 0);

  const unjoinable = joinSnapshot(snapshot({
    events: [{ eventId: "bad-1", taskRef: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", stage: "valid_call", prompt: "hidden" }],
  }));
  assert.equal(unjoinable.tasks[0].status, "unjoinable");
  assert.equal(JSON.stringify(unjoinable).includes("hidden"), false);
  assert.equal(JSON.stringify(unjoinable).includes("0xaaaa"), false);

  const changed = joinSnapshot(snapshot({
    tasks: [{ taskRef: "task-install-166", taskDigest: "aa".repeat(32), boundTaskDigest: "bb".repeat(32) }],
    events: [installEvent(), unpaidCall(), laterCall()],
  }));
  assert.equal(changed.tasks[0].decisionCurrent, false);
  assert.ok(changed.tasks[0].missingJoinReasons.includes("task_changed"));
  assert.equal(changed.experiments.nativeInstallUnpaidCall.eligibleCount, 0);

  const stale = joinSnapshot(snapshot({
    sources: [{ id: "old", kind: "export", locator: "memory", sha256: "cc".repeat(32), staleAfter: "2026-09-01T00:00:00.000Z" }],
    events: [installEvent({ sourceId: "old" }), unpaidCall({ sourceId: "old" }), laterCall({ sourceId: "old" })],
  }));
  assert.ok(stale.tasks[0].missingJoinReasons.includes("stale_source"));
  assert.equal(stale.tasks[0].decisionCurrent, false);

  const changedSource = joinSnapshot(snapshot({
    sources: [{ id: "moved", kind: "export", locator: "memory", sha256: "dd".repeat(32), boundSha256: "ee".repeat(32) }],
    events: [installEvent({ sourceId: "moved" })],
  }));
  assert.ok(changedSource.tasks[0].missingJoinReasons.includes("source_changed"));

  const conflict = joinSnapshot(snapshot({
    events: [unpaidCall(), unpaidCall({ httpStatus: 500 })],
  }));
  assert.equal(conflict.tasks[0].status, "unjoinable");
  assert.ok(conflict.tasks[0].missingJoinReasons.includes("duplicate_id_conflict"));

  const once = joinSnapshot(snapshot({ events: [unpaidCall(), { ...unpaidCall() }] }));
  assert.equal(once.tasks[0].stages.valid_call, 1);
});

test("missing delivery, paid failure, invalid output, correction, and free-sufficient settlement", () => {
  const missing = joinSnapshot(snapshot({
    events: [paidBase({ usefulDelivery: "unknown", usefulReason: "not_delivery", settlementState: "succeeded" })],
  }));
  assert.ok(missing.tasks[0].missingJoinReasons.includes("missing_delivery"));
  assert.ok(missing.tasks[0].missingJoinReasons.includes("transaction_is_not_valid_delivery"));
  assert.equal(missing.tasks[0].stages.useful_result, 0);
  assert.equal(missing.experiments.freeDiagnosisPaidOperation.conversionCount, 0);

  const failed = joinSnapshot(snapshot({
    events: [paidBase({ settlementState: "failed", settlementReference: null, usefulDelivery: "false", usefulReason: "delivery_failed" })],
  }));
  assert.ok(failed.tasks[0].missingJoinReasons.includes("paid_failure"));
  assert.equal(failed.tasks[0].stages.settlement, 0);

  const invalid = joinSnapshot(snapshot({
    events: [paidBase({ usefulDelivery: "false", usefulReason: "schema_invalid" })],
  }));
  assert.equal(invalid.tasks[0].stages.settlement, 1);
  assert.equal(invalid.tasks[0].useful, "false");
  assert.ok(invalid.tasks[0].missingJoinReasons.includes("settlement_with_invalid_output"));
  assert.equal(invalid.experiments.freeDiagnosisPaidOperation.conversionCount, 0);

  const corrected = joinSnapshot(snapshot({
    events: [
      paidBase(),
      paidBase({
        eventId: "paid-2",
        stage: "later_useful_call",
        criterion: "second_process_receipt_read",
        correctionOf: "paid-1",
        settlementState: null,
        settlementReference: null,
      }),
    ],
  }));
  assert.equal(corrected.tasks[0].status, "joined");
  assert.equal(corrected.tasks[0].settlementCountedOnce, 1);
  assert.ok(corrected.tasks[0].missingJoinReasons.includes("corrected"));
  assert.equal(corrected.experiments.freeDiagnosisPaidOperation.eligibleCount, 1);
  assert.equal(corrected.experiments.freeDiagnosisPaidOperation.conversionCount, 1);

  const free = joinSnapshot(snapshot({
    events: [paidBase({ freeSufficient: true, incrementalValue: false })],
  }));
  assert.equal(free.tasks[0].stages.settlement, 1);
  assert.equal(free.experiments.freeDiagnosisPaidOperation.eligibleCount, 0);
  assert.equal(free.experiments.freeDiagnosisPaidOperation.conversionRate, null);
  assert.equal(free.experiments.freeDiagnosisPaidOperation.ineligibleSettlementsNotConverted, 1);
});

test("actor classes stay separate and a caller independent label is not independent use", () => {
  const readout = joinSnapshot(snapshot({
    events: [
      unpaidCall({ actorLabel: "independent", cohort: "sponsored_trial", discoverySource: "goose-native" }),
      unpaidCall({
        eventId: "owner-1",
        taskRef: "task-owner",
        actorLabel: "owner_test",
        cohort: "owner_qa",
        discoverySource: null,
        criterion: null,
      }),
      unpaidCall({
        eventId: "recruited-1",
        taskRef: "task-recruited",
        actorLabel: "recruited",
        cohort: "controlled_test",
        discoverySource: null,
        criterion: null,
        independentDemandConfirmed: true,
      }),
    ],
  }));
  assert.equal(readout.actors.unknown_actor, 1);
  assert.equal(readout.actors.sponsored_evaluation, 1);
  assert.equal(readout.actors.owner_qa, 1);
  assert.equal(readout.actors.recruited_buyer, 1);
  assert.equal(readout.actors.user_agent_label, 1);
  assert.equal(readout.actors.independent_use, 0);
  assert.equal(readout.independentUse, 0);
  assert.equal(readout.tasks.find((task) => task.taskRef === "task-install-166").callerClaimIndependent, true);
  assert.ok(readout.tasks.find((task) => task.taskRef === "task-recruited").missingJoinReasons.includes("caller_claim_is_not_independent_use"));
});

test("bounty download is not reuse, and a verified later artifact can convert", () => {
  const download = joinSnapshot(snapshot({
    observations: { downloads: [{ locator: "https://example.invalid/pack.tgz", sha256: digest, bytes: 10, httpStatus: 200 }] },
    events: [{
      eventId: "bounty-download",
      taskRef: "task-bounty",
      experimentId: "bounty-contract-reused-artifact",
      stage: "discovery_or_download",
      download: { httpStatus: 200 },
      rewardPresent: false,
      contractCurrent: false,
    }],
  }));
  assert.equal(download.experiments.bountyContractReusedArtifact.eligibleCount, 0);
  assert.equal(download.tasks[0].downloadOnly, true);
  assert.equal(download.downloads[0].launched, false);

  const reused = joinSnapshot(snapshot({
    events: [{
      eventId: "bounty-reuse",
      taskRef: "task-bounty",
      experimentId: "bounty-contract-reused-artifact",
      stage: "later_useful_call",
      criterion: "verified_artifact_reuse",
      artifactDigest: digest,
      rewardPresent: true,
      contractCurrent: true,
      httpStatus: 200,
    }],
  }));
  assert.equal(reused.experiments.bountyContractReusedArtifact.eligibleCount, 1);
  assert.equal(reused.experiments.bountyContractReusedArtifact.conversionCount, 1);
  assert.equal(reused.experiments.bountyContractReusedArtifact.launched, false);
});

test("catalog change, closed sponsored expense, and seeded directives are rejected or not current", () => {
  const catalog = joinSnapshot(snapshot({
    catalog: { kind: "merchant_openapi", sha256: "aa".repeat(32), boundSha256: "bb".repeat(32) },
    events: [installEvent(), unpaidCall(), laterCall()],
  }));
  assert.equal(catalog.catalogChanged, true);
  assert.equal(catalog.tasks[0].decisionCurrent, false);
  assert.equal(catalog.experiments.nativeInstallUnpaidCall.eligibleCount, 0);

  const sponsored = joinSnapshot(snapshot({
    events: [paidBase({ settlementReference: closed })],
  }));
  assert.equal(sponsored.tasks[0].stages.settlement, 0);
  assert.ok(sponsored.tasks[0].missingJoinReasons.includes("closed_sponsored_expense"));
  assert.equal(sponsored.recognizedRevenueAtomic, "0");

  for (const [directives, code] of [
    [{ relabelUnclassifiedAsIndependent: true }, "relabel_refused"],
    [{ countExit0AsInstall: true }, "exit0_directive_refused"],
    [{ treatHttp200AsUseful: true }, "http200_directive_refused"],
    [{ bookSettlementAsRevenue: true }, "revenue_claim"],
  ]) {
    assert.throws(() => joinSnapshot(snapshot({ directives })), (error) => error instanceof DeliveryError && error.code === code);
  }
  const wallet = `0x${"ab".repeat(20)}`;
  assert.throws(() => joinSnapshot(snapshot({ wallet })), (error) => {
    assert.equal(error.code, "restricted_fields");
    assert.equal(String(error.message).includes(wallet), false);
    return true;
  });
});

test("forward retained use stays unknown usefulness and replays apart from the public snapshot", () => {
  const base = {
    brand: "samedaydesk",
    cohort: "controlled_test",
    commerceEventId: "20000000-0000-4000-8000-000000000011",
    correctionOf: null,
    deliveryClass: null,
    eventId: "20000000-0000-4000-8000-000000000011",
    evidencePlane: "journey_marker",
    method: "GET",
    operationId: "op-v2",
    producerBaseCommit: "ebd6834f3501ace0948b2ad5b7a3df9ab5c6b048",
    receiptDigest: null,
    reuseAuthority: null,
    route: "/extract",
    schemaVersion: "samedaydesk.outcome-binding.forward.v2",
    settlementAuthority: null,
    settlementClass: null,
    settlementReference: null,
    sourcePlane: "forward_instrumenter",
    stage: "call",
    usefulness: null,
    validatorAuthority: null,
    validatorSource: null,
    validatorVerdict: null,
    valueAtomic: null,
    writerId: "x402-url-extractor.createCommerceTelemetry.forward-v2",
  };
  const records = [
    { ...base, eventId: "20000000-0000-4000-8000-000000000010", commerceEventId: "20000000-0000-4000-8000-000000000010", stage: "discovery", route: "/openapi.json" },
    base,
    {
      ...base,
      eventId: "20000000-0000-4000-8000-000000000012",
      stage: "delivery",
      evidencePlane: "schema_delivery",
      receiptDigest: digest,
      deliveryClass: "full_bounded_capture",
      usefulness: "unknown",
      validatorVerdict: "pass",
      validatorAuthority: "merchant_declared_schema",
      validatorSource: "caller_observed_http_bytes",
      settlementClass: "simulated",
    },
    {
      ...base,
      eventId: "20000000-0000-4000-8000-000000000013",
      stage: "settlement",
      evidencePlane: "economic_settlement",
      receiptDigest: digest,
      settlementAuthority: "mocked_settlement_boundary",
      settlementClass: "simulated",
      usefulness: "unknown",
    },
    {
      ...base,
      eventId: "20000000-0000-4000-8000-000000000014",
      stage: "retained_use",
      evidencePlane: "retained_use",
      receiptDigest: digest,
      reuseAuthority: "authenticated_producer_observation",
      usefulness: "unknown",
    },
    {
      schemaVersion: "samedaydesk.outcome-task-ref.v1",
      writerId: base.writerId,
      operationId: "op-v2",
      taskRef: "task-forward-166",
      cohort: "controlled_test",
      commerceEventId: "20000000-0000-4000-8000-000000000011",
      eventId: "20000000-0000-4000-8000-000000000099",
    },
  ];
  const readout = joinSnapshot(snapshot({ forwardRecords: records }));
  assert.equal(readout.forward.controlledEvidenceJoin, true);
  assert.equal(readout.forward.individualJoin, true);
  assert.equal(readout.forward.organicAttribution, false);
  assert.equal(readout.forward.operations[0].externalDemandProved, false);
  assert.equal(readout.forward.unusable.count, 0);
  assert.equal(readout.customerClaim, false);
  assert.equal(readout.forward.operations[0].schemaValidDelivery, true);
  assert.equal(readout.forward.operations[0].usefulness, "unknown");
  assert.equal(readout.forward.operations[0].buyerAttestedUsefulness, false);
  assert.equal(readout.forward.operations[0].canonicalStageJoin, true);
  assert.ok(readout.tasks[0].missingJoinReasons.includes("forward_schema_valid_join_usefulness_unknown"));
  assert.equal(readout.tasks[0].taskRef, "task-forward-166");
  assert.equal(readout.tasks[0].useful, "unknown");
  assert.equal(readout.tasks[0].status, "partial");
  assert.ok(readout.tasks[0].missingJoinReasons.includes("retained_use_usefulness_unknown"));
  assert.equal(readout.recognizedRevenueAtomic, "0");
  assert.equal(readout.independentUse, 0);
  assert.equal(readout.uncertainty.internal.includes("synthetic_control"), true);
  assert.equal(readout.uncertainty.external.includes("synthetic_control"), false);

  const rejectedRef = joinSnapshot(snapshot({
    forwardRecords: [{
      schemaVersion: "samedaydesk.outcome-task-ref.v1",
      writerId: "x402-url-extractor.createCommerceTelemetry.forward-v2",
      operationId: "op-v2",
      taskRef: null,
      cohort: "controlled_test",
      commerceEventId: "20000000-0000-4000-8000-000000000011",
      eventId: "20000000-0000-4000-8000-000000000099",
    }],
  }));
  assert.equal(rejectedRef.tasks.length, 0);
  assert.equal(rejectedRef.forward.unusable.reasons.task_ref_rejected, 1);
  assert.equal(rejectedRef.customerClaim, false);
});

test("cli replays the real snapshot and rejects the seeded relabel", () => {
  const real = spawnSync(process.execPath, [bin, "replay", "--input", resolve(root, "fixtures/real/snapshot.json")], { encoding: "utf8" });
  assert.equal(real.status, 0, real.stderr);
  const readout = JSON.parse(real.stdout);
  assert.equal(readout.demand.reconciledSettlements, 43);
  assert.equal(readout.customerClaim, false);
  const seeded = spawnSync(process.execPath, [bin, "replay", "--input", resolve(root, "fixtures/synthetic/seeded-relabel.json")], { encoding: "utf8" });
  assert.equal(seeded.status, 2);
  assert.equal(JSON.parse(seeded.stderr).reason, "relabel_refused");
  assert.equal(seeded.stdout, "");
});
