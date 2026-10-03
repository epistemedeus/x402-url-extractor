import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ADAPT_HEAD,
  ADAPT_JOB_ID,
  COMPLETE_JOB_ID,
  PINS,
  PRIOR_VIEW_HEAD,
} from "./constants.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const PRIOR_VIEW_OPERATION = "bc331d8d-2e56-4770-93d2-bc40bc146e8c";
const PRIOR_ADAPT_OPERATION = "03b2c62c-b742-48d2-aaf9-a70e1270f758";
const RELEASED_SERVER_BLOB = "77e0e67c6c62f8e4a5c12d5b84e3bd8c7e74e0b7";

const PATCHES = [
  "task-linked-delivery/experiments/free-task-observation-100421/export/ROOT-OBSERVATION-MOUNT.patch",
  "task-linked-delivery/experiments/free-task-observation-100421/export/ROOT-FREE-RESPONSE-OBSERVATION.patch",
  "task-linked-delivery/experiments/free-task-observation-100421/export/ROOT-CUSTOMER-STORE-ADAPTER.patch",
  "task-linked-delivery/experiments/attempt-useful-view-1005/export/MERCHANT161-SERVER.patch",
];

function read(relative) {
  return readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");
}

function patchChangedLines(relative) {
  const text = read(relative);
  return text.split("\n").filter((line) => (
    (line.startsWith("+") || line.startsWith("-"))
    && !line.startsWith("+++")
    && !line.startsWith("---")
  )).length;
}

function artifactReadback() {
  const text = execFileSync("git", [
    "show",
    `${PINS.publicAcquisitionArtifact}:public-acquisition/receiving/artifact.json`,
  ], { cwd: root, encoding: "utf8" });
  const artifact = JSON.parse(text);
  const serialized = JSON.stringify(artifact);
  return {
    schema: artifact.schema,
    proofClass: artifact.proofClass,
    paidLaunch: artifact.qualifications?.paidLaunch === true,
    independentAdoption: artifact.qualifications?.independentAdoption === true,
    purchaseAuthorization: artifact.qualifications?.purchaseAuthorization === true,
    productionHosted: artifact.remoteIndex?.productionHosted === true,
    hostedAcquisitionVerified: artifact.remoteIndex?.hostedAcquisitionVerified === true,
    draft: artifact.remoteIndex?.draft === true,
    paidSuccessField: serialized.includes("paid_success") ? "present" : "absent",
    enrollsAttemptUsefulView: serialized.includes("attempt-useful-view"),
  };
}

export function integrationDeltaState() {
  const server = read("server.js");
  const http = read("useful-result-reuse/http.mjs");
  const events = read("commerce-events.mjs");
  const binding = read("commerce-outcome-binding.mjs");
  const service = read("useful-result-reuse/service.mjs");
  const applied = server.includes("merchant161ObservationMount")
    && server.includes("freeTaskObservation: observationMount.freeTaskObservation")
    && http.includes("freeTaskObservation")
    && events.includes("freeObservationRequested")
    && binding.includes("freeObservation")
    && service.includes("customerStore = createReuseStore");
  const serverLines = patchChangedLines("task-linked-delivery/experiments/attempt-useful-view-1005/export/MERCHANT161-SERVER.patch");
  const readback = artifactReadback();
  return {
    schema: "samedaydesk.attempt-useful-view.integration-delta.v1",
    integrationBase: PINS.releasedMerchantHead,
    receivedCompletion: "0c29e9fb3a9d31269f666a51957067e1ee98a90e",
    sourceBranch: "codex/sol-live-attempt-delivery-261003",
    deliveryPacket: "docs/reviews/sol-live-attempt-delivery-261003/ROOT-PACKET.md",
    cutContract: "samedaydesk.attempt-useful.journal-cut.v1",
    thisBranchDeployed: false,
    status: applied ? "applied" : "failed",
    enrollment: applied ? "isolated_branch" : "unresolved",
    executable: "task-linked-delivery/experiments/attempt-useful-view-1005/bin/merchant161-delta.mjs",
    headAvailable: true,
    completeJobId: COMPLETE_JOB_ID,
    adaptJobId: ADAPT_JOB_ID,
    adaptHead: ADAPT_HEAD,
    priorViewJobId: "HEAVY-ATTEMPT-USEFUL-VIEW-1005",
    priorViewHead: PRIOR_VIEW_HEAD,
    measurementSource: PRIOR_VIEW_HEAD,
    priorViewOperation: PRIOR_VIEW_OPERATION,
    priorViewOperationReused: false,
    priorAdaptOperation: PRIOR_ADAPT_OPERATION,
    priorAdaptOperationReused: false,
    releasedMerchantHead: PINS.releasedMerchantHead,
    releasedHeadSubject: "Merge pull request #161 from epistemedeus/codex/public-acquisition-receiving-1003",
    historicalReleasedMerchantHead: PINS.historicalReleasedMerchantHead,
    historicalReleasedHeadSubject: "Merge pull request #160 from epistemedeus/codex/root-scoped-repair-launch-1003",
    historicalHeadRole: "historical_only",
    publicAcquisitionArtifact: PINS.publicAcquisitionArtifact,
    publicAcquisitionArtifactSubject: "Record actual public acquisition and cold command receiving",
    releasedServerJsBlob: RELEASED_SERVER_BLOB,
    serverEdited: true,
    serverPublished: false,
    indexPublicationEdited: false,
    artifactJsonCopiedOntoThisBranch: false,
    seller041: PINS.seller041,
    seller041Rewritten: false,
    minimalServerDeltaLines: serverLines,
    observationMountOnReleasedHead: false,
    observationMountOnThisBranch: applied,
    appliedPatches: PATCHES,
    unappliedPatches: [],
    publicAcquisitionReadback: readback,
    attemptOf: null,
    forbiddenOperation: "add923ae-3eb5-474b-8b3e-e376666dee83",
    liveCoverage: "unresolved",
    paidSuccess: "unresolved",
    missingStages: "unknown",
    producers: {
      causalProof301: PINS.causalProof301,
      causalMeasurement395: PINS.causalMeasurement395,
      freeUseObserver421: PINS.freeUseObserver421,
      terminalReader423: PINS.terminalReader423,
    },
    reason: applied
      ? "Selective integration on merchant161 preserves current routes and frozen packets. The native single-process capture signs bounded producer ranges on existing journals using existing authority. This source branch is undeployed; production enrollment and outside usefulness remain unobserved. Root owns release."
      : "The isolated server markers are absent. The delta is not applied.",
  };
}

export function assertDeltaApplied(delta = integrationDeltaState()) {
  if (delta.status !== "applied") {
    const error = new Error("delta_not_applied");
    error.code = "delta_not_applied";
    throw error;
  }
  if (delta.liveCoverage === true || delta.liveCoverage === false) {
    const error = new Error("live_coverage_boolean_refused");
    error.code = "live_coverage_boolean_refused";
    throw error;
  }
  if (delta.paidSuccess === 0 || delta.paidSuccess === "0") {
    const error = new Error("paid_success_absent_is_not_zero");
    error.code = "paid_success_absent_is_not_zero";
    throw error;
  }
  if (delta.publicAcquisitionReadback.paidSuccessField !== "absent") {
    const error = new Error("artifact_paid_success_unexpected");
    error.code = "artifact_paid_success_unexpected";
    throw error;
  }
  return delta;
}
