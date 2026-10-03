import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { digest } from "../../free-task-observation-100421/vendor/bounds.mjs";
import { containsRestrictedKey } from "../../../tools/ops/three-site-settlement-join/measure/src/restricted.mjs";
import {
  CLOCK_WINDOW_FIX_APPLIED,
  CLOCK_WINDOW_FIX_CONTENT_ON_MERCHANT161,
  DISPOSITIONS,
  FORBIDDEN_OPERATION,
  PINS,
  PRIOR_VIEW_HEAD,
  PRODUCTION_FRESHNESS_MAX_AGE_MS,
} from "../src/constants.mjs";
import { ViewError } from "../src/errors.mjs";
import { refuseFalseJoin } from "../src/seam.mjs";
import {
  readAttemptUsefulView,
  rejectTamperedJournal,
  replayAttemptReport,
  retainAttemptReport,
} from "../src/view.mjs";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const retainedPath = fileURLToPath(new URL("../../free-task-observation-100421/evidence/two-objectives.retained.json", import.meta.url));
const afterPath = fileURLToPath(new URL("../../free-task-observation-100421/fixtures/after.bundle.json", import.meta.url));
const baselinePath = fileURLToPath(new URL("../../production-funnel-100423/evidence/baseline.stripped.json", import.meta.url));
const binPath = fileURLToPath(new URL("../bin/attempt-useful-view.mjs", import.meta.url));
const seededPath = fileURLToPath(new URL("./seeded-false-join.json", import.meta.url));
const evidencePath = fileURLToPath(new URL("../../../../docs/reviews/sol-live-attempt-delivery-261003/evidence/supplied-export-readback.json", import.meta.url));
const inspectionPath = fileURLToPath(new URL("../export/MERCHANT161-INSPECTION.json", import.meta.url));
const deltaPath = fileURLToPath(new URL("../export/ROOT-INTEGRATION-DELTA.json", import.meta.url));
const MERCHANT161 = "32f07a836fb28e400d56b0e2e876043644bde31a";
const MERCHANT160 = "dc32cf7bf5fd76a5cd9047865f49b2462252897c";
const ACQUISITION_ARTIFACT = "4b7928f315be9d9ec7d14f2604eab1b7b236a63a";
const PRIOR_VIEW_OPERATION = "bc331d8d-2e56-4770-93d2-bc40bc146e8c";

const POSITIVE = "tdb90824374e9fc51c87f350974a336be759233d9b973a73b56c93cbaf7618f";
const NEGATIVE = "te5713fce1add04cdbbdf4697d41d08e207239288e5d1d030191c2f46a68a60";
const CALLER_ONLY = "t5c3b285ea13990250575736af72852f3ff5468f16d18f1caebbcea72c3b0f4";
const CHANGED_REPLAY = "tcf67a0b71435ae6f803645948c757e090a0f828b2d0c2c46fe1e8aaa9ea003";
const MISSING_DELIVERY = "tc8ce82a2f4c0f38687b78ea88c75495e3542c553fd920090b6033b48ba54d8";
const ABSENT_TASK = `t${"ab".repeat(31)}`;

const retained = JSON.parse(readFileSync(retainedPath, "utf8"));
const afterBundle = JSON.parse(readFileSync(afterPath, "utf8"));
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

function view(journal, taskRef, extra = {}) {
  return readAttemptUsefulView({ attemptOf: null, taskRef, journal, ...extra });
}

function responseDigest(journal, taskRef) {
  const bundle = journal.bundle || journal;
  const digests = [];
  for (const source of bundle.sources) {
    if (source.plane !== "retention") continue;
    for (const row of source.records) {
      if (row.action === "retain" && row.taskRef === taskRef) digests.push(row.observation.responseDigest);
    }
  }
  assert.equal(digests.length, 1);
  return digests[0];
}

function assertUnresolvedAttempt(report) {
  assert.equal(report.useful, null);
  assert.equal(report.usefulNegative, null);
  assert.equal(report.stageCounts, null);
  assert.equal(report.populationConversionRate, null);
  assert.equal(report.attemptOf, null);
  assert.equal(report.customer, null);
  assert.equal(report.mintedGrant, false);
  assert.equal(report.liveCoverage, "unresolved");
  assert.equal(typeof report.liveCoverage, "string");
  for (const stage of Object.values(report.stages)) {
    assert.equal(stage.disposition, "unresolved");
    assert.equal(stage.observed, "unknown");
    assert.notEqual(stage.observed, 0);
    assert.ok(DISPOSITIONS.includes(stage.disposition));
  }
}

test("two retained tasks stay separate attempts and do not become a population rate", () => {
  const positive = view(retained, POSITIVE, { baseline });
  const negative = view(retained, NEGATIVE, { baseline });
  assert.equal(positive.decision, "one_attempt");
  assert.equal(negative.decision, "one_attempt");
  assert.notEqual(positive.commerceEventId, negative.commerceEventId);
  assert.equal(positive.useful, true);
  assert.equal(positive.usefulNegative, null);
  assert.equal(positive.stages.independentReplay.criterion, "positive");
  assert.equal(negative.useful, true);
  assert.equal(negative.usefulNegative, true);
  assert.equal(negative.stages.independentReplay.criterion, "agreed_negative");
  assert.equal(positive.populationConversionRate, null);
  assert.equal(negative.populationConversionRate, null);
  assert.equal(positive.stageCounts, null);
  assert.equal(positive.publicSeam.coveredExternalEvents, 3692);
  assert.equal(positive.publicSeam.coveredExternalEventsAreCustomers, false);
  assert.equal(positive.publicSeam.coveredExternalEventsAreAttemptDenominator, false);
  assert.equal(positive.publicSeam.paidSuccess.observed, null);
  assert.equal(positive.publicSeam.paidSuccess.disposition, "unresolved");
  assert.equal(positive.publicSeam.paidSuccess.reason, "absent_from_covered_byresult_not_zero");
  assert.equal(positive.attemptOf, null);
  assert.equal(negative.attemptOf, null);
  assert.equal(positive.liveCoverage, "unresolved");
  assert.equal(positive.journalCutCoverage, "unknown");
  assert.equal(positive.liveCoverageReason, "fixture_or_owner_qa_is_not_live_production_coverage");
  assert.equal(positive.evidenceKind, "synthetic_fixture");
  assert.equal(positive.recognizedRevenueAtomic, "unknown");
  assert.equal(positive.paymentPermitted, false);
  assert.equal(positive.paymentClassification.disposition, "unresolved");
  assert.equal(positive.paymentClassification.joinedToThisAttempt, false);
  assert.equal(positive.customer, null);
  assert.equal(positive.signer, null);
  assert.equal(positive.database, null);
  assert.equal(positive.mintedGrant, false);
  assert.equal(containsRestrictedKey(positive), false);
  assert.equal(JSON.stringify(positive).includes("transactionFeeWei"), false);
  assert.equal(JSON.stringify(positive).includes("bodyBase64"), false);
});

test("stage dispositions name producer, caller, predicate class, grant, and unresolved payment", () => {
  const report = view(retained, POSITIVE, { baseline });
  assert.equal(report.stages.attempt.disposition, "producer-observed");
  assert.equal(report.stages.delivery.disposition, "producer-observed");
  assert.equal(report.stages.callerUsefulness.disposition, "unresolved");
  assert.equal(report.stages.callerUsefulness.reason, "no_caller_claim");
  assert.equal(report.stages.independentReplay.disposition, "classified");
  assert.equal(report.stages.retention.disposition, "authorized");
  assert.equal(report.stages.laterUse.disposition, "authorized");
  assert.equal(report.stages.settlement.disposition, "unresolved");
  assert.equal(report.stages.settlement.observed, "unknown");
  assert.equal(report.journalCovered, null);
});

test("a useful negative is classified by the existing predicate and is not a payment", () => {
  const report = view(retained, NEGATIVE);
  assert.equal(report.useful, true);
  assert.equal(report.usefulNegative, true);
  assert.equal(report.stages.independentReplay.disposition, "classified");
  assert.equal(report.stages.independentReplay.criterion, "agreed_negative");
  assert.equal(report.stages.settlement.disposition, "unresolved");
  assert.equal(report.recognizedRevenueAtomic, "unknown");
  assert.equal(report.paymentPermitted, false);
});

test("an external caller claim does not establish usefulness", () => {
  const report = view(afterBundle, CALLER_ONLY);
  assert.equal(report.decision, "one_attempt");
  assert.equal(report.stages.callerUsefulness.disposition, "caller asserted");
  assert.equal(report.stages.callerUsefulness.verification, "unverified");
  assert.equal(report.stages.independentReplay.disposition, "unresolved");
  assert.equal(report.useful, null);
  assert.equal(report.liveCoverage, "unresolved");
  assert.equal(typeof report.liveCoverage, "string");
});

test("changed replay evidence inside the journal does not inherit usefulness", () => {
  const report = view(afterBundle, CHANGED_REPLAY);
  assert.equal(report.useful, null);
  assert.equal(report.stages.independentReplay.disposition, "unresolved");
  assert.equal(report.stages.independentReplay.reason, "replayed_output_changed");
  assert.equal(report.inheritedUsefulness, null);
});

test("a changed later digest is refused and does not inherit the covered criterion", () => {
  const bound = responseDigest(retained, POSITIVE);
  const changed = `${bound.slice(0, -1)}${bound.endsWith("0") ? "1" : "0"}`;
  const report = view(retained, POSITIVE, { laterInputDigest: changed });
  assert.equal(report.decision, "reject");
  assert.equal(report.reason, "changed_later_input");
  assert.equal(report.useful, null);
  assert.equal(report.inheritedUsefulness, null);
  assert.equal(report.historicalCriterion, "positive");
  assert.equal(report.stages.laterUse.disposition, "unresolved");
  assert.equal(report.stages.laterUse.reason, "changed_later_input");
});

test("a missing delivery record and a partial cut stay unknown", () => {
  const missingDelivery = view(afterBundle, MISSING_DELIVERY);
  assert.equal(missingDelivery.decision, "one_attempt");
  assert.equal(missingDelivery.stages.attempt.disposition, "producer-observed");
  assert.equal(missingDelivery.stages.delivery.disposition, "unresolved");
  assert.equal(missingDelivery.useful, null);
  assert.equal(missingDelivery.stageCounts, null);

  const partial = structuredClone(retained.bundle);
  for (const source of partial.sources) source.coverage = "partial";
  const partialReport = view(partial, POSITIVE);
  assert.equal(partialReport.decision, "unresolved");
  assert.equal(partialReport.journalCovered, null);
  assertUnresolvedAttempt(partialReport);

  const emptied = structuredClone(retained.bundle);
  for (const source of emptied.sources) {
    if (source.plane === "retention") source.records = [];
  }
  const emptiedReport = view(emptied, POSITIVE);
  assert.equal(emptiedReport.useful, null);
  assert.equal(emptiedReport.stages.delivery.disposition, "unresolved");
  assert.equal(emptiedReport.stageCounts, null);
});

test("a producer-commit mismatch and a foreign population do not join", () => {
  const mismatch = structuredClone(retained.bundle);
  mismatch.sources[0].producerCommit = "91fbf94786658c96c89f94e0f88b03caefd951b0";
  assert.throws(
    () => view(mismatch, POSITIVE),
    (error) => error instanceof ViewError && error.code === "source_mismatch",
  );
  const foreign = structuredClone(retained.bundle);
  foreign.sources[0].populationId = "other-population";
  const report = view(foreign, POSITIVE);
  assert.equal(report.decision, "unresolved");
  assert.equal(report.journalCovered, null);
  assert.equal(report.useful, null);
  assert.equal(report.stageCounts, null);
});

test("a torn cut and a lost record do not mint a grant", () => {
  const torn = structuredClone(retained.bundle);
  for (const source of torn.sources) source.intake.torn = 1;
  const tornReport = view(torn, POSITIVE);
  assert.equal(tornReport.decision, "unresolved");
  assert.equal(tornReport.mintedGrant, false);
  assert.equal(tornReport.automaticMutationRetries, 0);
  assertUnresolvedAttempt(tornReport);

  const lost = view(retained, POSITIVE, {
    restart: { acknowledgement: "not_established", physicalRecordEstablished: false },
  });
  assert.equal(lost.decision, "unresolved");
  assert.equal(lost.reason, "write_outcome_unknown");
  assert.equal(lost.restart.mintedGrant, false);
  assert.equal(lost.restart.automaticMutationRetries, 0);
  assertUnresolvedAttempt(lost);

  const readBack = view(retained, POSITIVE, {
    restart: { acknowledgement: "unknown", physicalRecordEstablished: true },
  });
  assert.equal(readBack.decision, "one_attempt");
  assert.equal(readBack.useful, true);
  assert.equal(readBack.mintedGrant, false);
  assert.equal(readBack.automaticMutationRetries, 0);
  assert.equal(readBack.restart.reconciledBy, "existing_journal_replay");
  assert.equal(readBack.restart.acknowledgement, "unknown");
});

test("counterfeit links, a reminted operation, a parent attempt, and a wallet are refused", () => {
  assert.throws(
    () => view(retained, POSITIVE, {
      link: {
        taskRef: POSITIVE,
        commerceEventId: "00000000-0000-4000-8000-000000000099",
        operationId: "normalized-transaction-receipt",
      },
    }),
    (error) => error instanceof ViewError && error.code === "counterfeit_link",
  );
  assert.throws(
    () => view(retained, ABSENT_TASK),
    (error) => error instanceof ViewError && error.code === "task_not_in_source",
  );
  const absent = view(afterBundle, ABSENT_TASK);
  assert.equal(absent.decision, "unresolved");
  assert.equal(absent.reason, "task_not_in_source");
  assert.equal(absent.useful, null);
  assert.equal(absent.commerceEventId, null);
  assert.equal(absent.stageCounts, null);
  assert.throws(
    () => view(retained, POSITIVE, {
      link: {
        taskRef: POSITIVE,
        commerceEventId: "00000000-0000-4000-8000-000000000099",
        operationId: FORBIDDEN_OPERATION,
      },
    }),
    (error) => error instanceof ViewError && error.code === "operation_remint_refused",
  );
  assert.throws(
    () => readAttemptUsefulView({ attemptOf: "S17-TREASURY-RECV-093086", taskRef: POSITIVE, journal: retained }),
    (error) => error instanceof ViewError && error.code === "attempt_of_not_null",
  );
  assert.throws(
    () => readAttemptUsefulView({ attemptOf: null, taskRef: POSITIVE, journal: retained, wallet: "not-a-customer" }),
    (error) => error instanceof ViewError && error.code === "wallet_or_header_is_not_identity",
  );
  assert.throws(
    () => readAttemptUsefulView({ attemptOf: null, taskRef: POSITIVE, journal: retained, customerLabel: "not-a-customer" }),
    (error) => error instanceof ViewError && error.code === "customer_label_refused",
  );
  assert.throws(
    () => readAttemptUsefulView({ attemptOf: null, taskRef: POSITIVE, journal: retained, paymentReplay: true }),
    (error) => error instanceof ViewError && error.code === "payment_replay_refused",
  );
});

test("a tampered retained journal and a tampered view report do not replay", () => {
  const tampered = structuredClone(retained);
  tampered.report.journeys[0].usefulness = "changed";
  const refusal = rejectTamperedJournal(tampered);
  assert.equal(refusal.decision, "reject");
  assert.equal(refusal.reason, "replay_mismatch");
  assert.equal(refusal.inheritedUsefulness, null);
  assert.equal(refusal.useful, null);
  assert.equal(refusal.mintedGrant, false);

  const input = { attemptOf: null, taskRef: POSITIVE, journal: retained, baseline };
  const report = readAttemptUsefulView(input);
  const packed = retainAttemptReport(input, report);
  assert.deepEqual(replayAttemptReport(packed), report);
  assert.equal(digest(replayAttemptReport(packed)), digest(report));
  packed.report.useful = null;
  assert.throws(
    () => replayAttemptReport(packed),
    (error) => error instanceof ViewError && error.code === "replay_mismatch",
  );
});

test("the seeded false join is rejected against the committed 423 baseline", () => {
  const proposal = JSON.parse(readFileSync(seededPath, "utf8"));
  const refusal = refuseFalseJoin(baseline, proposal);
  assert.equal(refusal.decision, "reject");
  assert.equal(refusal.attemptOf, null);
  assert.equal(refusal.useful, null);
  assert.equal(refusal.populationConversionRate, null);
  assert.equal(refusal.recognizedRevenueAtomic, "unknown");
  assert.deepEqual(refusal.reasons, [
    "actor_or_header_is_not_agent",
    "attempt_of_not_null",
    "counterfeit_link",
    "external_claim_is_not_usefulness",
    "operation_remint_refused",
    "paid_success_absent_is_not_zero",
    "payment_replay_refused",
    "population_conversion_refused",
    "rare_zero_is_not_census",
    "settlement_is_not_customer",
  ]);
});

test("production freshness stays at the strong default and the clock-window fix is not applied", () => {
  const events = readFileSync(fileURLToPath(new URL("../../../../commerce-events.mjs", import.meta.url)), "utf8");
  const observer = readFileSync(fileURLToPath(new URL("../../task-demand-100339/test/observer.test.mjs", import.meta.url)), "utf8");
  assert.match(events, /mcpTypedFreshnessMaxAgeMs = 900_000/);
  assert.equal(PRODUCTION_FRESHNESS_MAX_AGE_MS, 900_000);
  assert.equal(CLOCK_WINDOW_FIX_APPLIED, false);
  assert.equal(observer.includes("phaseStartedAt"), true);
  const source = readFileSync(fileURLToPath(new URL("../src/view.mjs", import.meta.url)), "utf8");
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("sealCausalCommerceEvent"), false);
  assert.match(source, /verifiedCaptureFor/);
});

test("the cold command reports one useful task and the seeded command exits 2", () => {
  const reportRun = spawnSync(process.execPath, [
    binPath,
    "report",
    "--receipt",
    retainedPath,
    "--task",
    POSITIVE,
    "--baseline",
    baselinePath,
  ], { cwd: root, encoding: "utf8" });
  assert.equal(reportRun.status, 0, reportRun.stderr);
  assert.equal(reportRun.stdout, readFileSync(evidencePath, "utf8"));
  const report = JSON.parse(reportRun.stdout);
  assert.equal(report.decision, "one_attempt");
  assert.equal(report.taskRef, POSITIVE);
  assert.equal(report.useful, true);
  assert.equal(report.liveCoverage, "unresolved");
  assert.equal(typeof report.liveCoverage, "string");
  assert.equal(report.attemptOf, null);
  assert.equal(report.publicSeam.paidSuccess.observed, null);
  assert.equal(report.publicSeam.paidSuccess.disposition, "unresolved");
  assert.equal(report.publicSeam.coveredExternalEvents, 3692);
  assert.equal(report.publicSeam.releasedMerchantHead, MERCHANT161);
  assert.equal(report.publicSeam.historicalReleasedMerchantHead, MERCHANT160);
  assert.equal(report.publicSeam.publicAcquisitionArtifact, ACQUISITION_ARTIFACT);
  assert.equal(report.provenance.integrationDelta, "applied");
  assert.equal(report.provenance.enrollment, "isolated_branch");
  assert.equal(report.liveCoverage, "unresolved");
  assert.equal(typeof report.liveCoverage, "string");
  assert.equal(report.populationConversionRate, null);
  assert.equal(containsRestrictedKey(report), false);

  const rejectRun = spawnSync(process.execPath, [
    binPath,
    "reject",
    "--input",
    seededPath,
    "--baseline",
    baselinePath,
  ], { cwd: root, encoding: "utf8" });
  assert.equal(rejectRun.status, 2);
  assert.equal(rejectRun.stdout, "");
  const refusal = JSON.parse(rejectRun.stderr);
  assert.equal(refusal.decision, "reject");
  assert.ok(refusal.reasons.includes("paid_success_absent_is_not_zero"));
  assert.ok(refusal.reasons.includes("population_conversion_refused"));
  assert.ok(refusal.reasons.includes("operation_remint_refused"));
});

test("merchant161 is the released pin and the isolated server delta is applied", () => {
  const inspection = JSON.parse(readFileSync(inspectionPath, "utf8"));
  const delta = JSON.parse(readFileSync(deltaPath, "utf8"));
  assert.equal(PINS.releasedMerchantHead, MERCHANT161);
  assert.equal(PINS.historicalReleasedMerchantHead, MERCHANT160);
  assert.equal(PINS.publicAcquisitionArtifact, ACQUISITION_ARTIFACT);
  assert.equal(PINS.seller041, "015f07d5a75d02a4e74709b17b2b1176501e92a5");
  assert.equal(inspection.priorViewHead, PRIOR_VIEW_HEAD);
  assert.equal(inspection.priorViewOperation, PRIOR_VIEW_OPERATION);
  assert.equal(inspection.priorViewOperationReused, false);
  assert.equal(inspection.remoteMasterMatchesMerchant161, true);
  assert.equal(inspection.remoteMaster, MERCHANT161);
  assert.equal(inspection.publicAcquisitionArtifact.sha, ACQUISITION_ARTIFACT);
  assert.equal(inspection.publicAcquisitionArtifact.isSecondParentOfMerchant161, true);
  assert.equal(inspection.merchant160.role, "historical_only");
  assert.equal(inspection.blobs.serverJs.merchant160, inspection.blobs.serverJs.merchant161);
  assert.equal(inspection.freeTaskObservation.merchant161ServerAndUsefulResultReuse.matches, 0);
  assert.deepEqual(inspection.diffNameOnlyMerchant160ToMerchant161, [
    "public-acquisition/receiving/artifact.json",
  ]);
  assert.equal(
    inspection.blobs.publicAcquisitionReceivingArtifact.thisBranch,
    inspection.blobs.publicAcquisitionReceivingArtifact.merchant160,
  );
  assert.notEqual(
    inspection.blobs.publicAcquisitionReceivingArtifact.thisBranch,
    inspection.blobs.publicAcquisitionReceivingArtifact.merchant161,
  );
  assert.equal(inspection.artifactReadback.qualifications.paidLaunch, false);
  assert.equal(inspection.artifactReadback.remoteIndex.productionHosted, false);
  assert.equal(inspection.artifactReadback.remoteIndex.hostedAcquisitionVerified, false);
  assert.equal(inspection.artifactReadback.paidSuccessMentions, 0);
  assert.equal(inspection.artifactReadback.attemptUsefulViewMentions, 0);
  assert.equal(inspection.clockWindowFix.commitIsAncestorOfMerchant161, false);
  assert.equal(inspection.clockWindowFix.observerTestBlobEqualsMerchant161, CLOCK_WINDOW_FIX_CONTENT_ON_MERCHANT161);
  assert.equal(delta.status, "applied");
  assert.equal(delta.enrollment, "isolated_branch");
  assert.equal(delta.releasedMerchantHead, MERCHANT161);
  assert.equal(delta.historicalReleasedMerchantHead, MERCHANT160);
  assert.equal(delta.publicAcquisitionArtifact, ACQUISITION_ARTIFACT);
  assert.equal(delta.serverEdited, true);
  assert.equal(delta.serverPublished, false);
  assert.equal(delta.indexPublicationEdited, false);
  assert.equal(delta.artifactJsonCopiedOntoThisBranch, false);
  assert.equal(delta.seller041Rewritten, false);
  assert.equal(delta.observationMountOnReleasedHead, false);
  assert.equal(delta.observationMountOnThisBranch, true);
  assert.ok(delta.minimalServerDeltaLines > 0);
  assert.equal(delta.priorViewOperationReused, false);
  assert.equal(delta.priorViewOperation, PRIOR_VIEW_OPERATION);
  assert.equal(delta.priorViewHead, PRIOR_VIEW_HEAD);
  assert.equal(delta.measurementSource, PRIOR_VIEW_HEAD);
  assert.equal(delta.adaptHead, "e687ca11c2e05e8ac41ede83dc1b98cfe46c3a7c");
  assert.equal(delta.priorAdaptOperation, "03b2c62c-b742-48d2-aaf9-a70e1270f758");
  assert.equal(delta.priorAdaptOperationReused, false);
  assert.equal(delta.missingStages, "unknown");
  assert.equal(delta.liveCoverage, "unresolved");
  assert.notEqual(delta.liveCoverage, false);
  assert.equal(delta.paidSuccess, "unresolved");
  assert.notEqual(delta.paidSuccess, 0);
  assert.equal(delta.attemptOf, null);
  const report = view(retained, POSITIVE, { baseline });
  assert.equal(report.provenance.pins.releasedMerchantHead, MERCHANT161);
  assert.equal(report.provenance.pins.historicalReleasedMerchantHead, MERCHANT160);
  assert.equal(report.provenance.pins.publicAcquisitionArtifact, ACQUISITION_ARTIFACT);
  assert.equal(report.publicSeam.releasedMerchantHead, MERCHANT161);
  assert.equal(report.provenance.integrationDelta, "applied");
  assert.equal(report.provenance.enrollment, "isolated_branch");
  assert.equal(report.provenance.adapt.jobId, "HEAVY-ATTEMPT-USEFUL-ADAPT-161-1005");
  assert.equal(report.provenance.adapt.priorViewHead, PRIOR_VIEW_HEAD);
  assert.equal(report.provenance.adapt.adaptHead, "e687ca11c2e05e8ac41ede83dc1b98cfe46c3a7c");
  assert.equal(report.provenance.adapt.priorViewOperationReused, false);
  assert.equal(report.provenance.complete.jobId, "HEAVY-ATTEMPT-USEFUL-COMPLETE-161-1005");
  assert.equal(report.provenance.complete.measurementSource, PRIOR_VIEW_HEAD);
  assert.equal(report.liveCoverage, "unresolved");
  assert.equal(typeof report.liveCoverage, "string");
  assert.equal(report.publicSeam.paidSuccess.observed, null);
  assert.equal(report.publicSeam.paidSuccess.reason, "absent_from_covered_byresult_not_zero");
  assert.equal(JSON.stringify(report).includes(PRIOR_VIEW_OPERATION), false);
  assert.equal(JSON.stringify(report).includes(FORBIDDEN_OPERATION), true);
});
