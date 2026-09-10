import {
  BASEPAY_TIP_COMMIT,
  MAPPING_GIT_BLOB,
  MAPPING_SHA256,
  REPLAY_RESULT_GIT_BLOB,
  REPLAY_RESULT_SHA256,
  RESULT_GIT_BLOB,
  RESULT_SHA256,
  SYNTHETIC_MAPPING_BYTES,
  SYNTHETIC_MAPPING_GIT_BLOB,
  SYNTHETIC_MAPPING_SHA256,
  SYNTHETIC_PUBLISHED_BYTES,
  SYNTHETIC_PUBLISHED_GIT_BLOB,
  SYNTHETIC_PUBLISHED_SHA256,
  SYNTHETIC_REPLAY_BYTES,
  SYNTHETIC_REPLAY_GIT_BLOB,
  SYNTHETIC_REPLAY_SHA256,
} from "./pins.mjs";
import { fail } from "./errors.mjs";
import { LAYER2_NAME } from "./layers.mjs";

/** Layer-1: caller-supplied observation assertions. */
export const EVIDENCE_ORIGIN_LAYER1 = "caller_supplied_observation_assertions";

/**
 * Layer-2 origins. Keep these distinct:
 * 1) synthetic_offline_fixture — in-tree lab shape, default offline path
 * 2) provided_report — acquired/pinned upstream JSON or the same bytes
 * 3) caller_supplied_unverified_report — explicit extra JSON, not a known pin
 * 4) pinned_worker_replay_artifact — S89 worker replay bytes only
 * 5) separately_labelled_harness_input — explicit --harness-result path
 *
 * provided_report is never promoted to independent harness replay.
 */
export const EVIDENCE_ORIGIN = Object.freeze({
  SYNTHETIC: "synthetic_offline_fixture",
  PROVIDED_REPORT: "provided_report",
  CALLER_UNVERIFIED: "caller_supplied_unverified_report",
  PINNED_WORKER_REPLAY: "pinned_worker_replay_artifact",
  SEPARATELY_LABELLED_HARNESS: "separately_labelled_harness_input",
});

export const KNOWN_LAYER2_PINS = Object.freeze([
  Object.freeze({
    gitBlobSha: RESULT_GIT_BLOB,
    sha256: RESULT_SHA256,
    bytes: 10230,
    label: "upstream published result",
    origin: EVIDENCE_ORIGIN.PROVIDED_REPORT,
  }),
  Object.freeze({
    gitBlobSha: MAPPING_GIT_BLOB,
    sha256: MAPPING_SHA256,
    bytes: 6033,
    label: "upstream taxonomy mapping",
    origin: EVIDENCE_ORIGIN.PROVIDED_REPORT,
  }),
  Object.freeze({
    gitBlobSha: REPLAY_RESULT_GIT_BLOB,
    sha256: REPLAY_RESULT_SHA256,
    bytes: 10230,
    label: "pinned worker replay artifact",
    origin: EVIDENCE_ORIGIN.PINNED_WORKER_REPLAY,
  }),
  Object.freeze({
    gitBlobSha: SYNTHETIC_PUBLISHED_GIT_BLOB,
    sha256: SYNTHETIC_PUBLISHED_SHA256,
    bytes: SYNTHETIC_PUBLISHED_BYTES,
    label: "synthetic published fixture",
    origin: EVIDENCE_ORIGIN.SYNTHETIC,
  }),
  Object.freeze({
    gitBlobSha: SYNTHETIC_MAPPING_GIT_BLOB,
    sha256: SYNTHETIC_MAPPING_SHA256,
    bytes: SYNTHETIC_MAPPING_BYTES,
    label: "synthetic mapping fixture",
    origin: EVIDENCE_ORIGIN.SYNTHETIC,
  }),
  Object.freeze({
    gitBlobSha: SYNTHETIC_REPLAY_GIT_BLOB,
    sha256: SYNTHETIC_REPLAY_SHA256,
    bytes: SYNTHETIC_REPLAY_BYTES,
    label: "synthetic replay-shape fixture",
    origin: EVIDENCE_ORIGIN.SYNTHETIC,
  }),
]);

const PIN_BY_BLOB = new Map(KNOWN_LAYER2_PINS.map((pin) => [pin.gitBlobSha, pin]));

export function assertPinIntegrity(digest, label) {
  const pin = PIN_BY_BLOB.get(digest.gitBlobSha);
  if (!pin) return;
  if (digest.sha256 !== pin.sha256 || digest.bytes !== pin.bytes) {
    fail(
      `${label} git blob ${digest.gitBlobSha} matched ${pin.label} but sha256/bytes did not`,
      { kind: "blob_mismatch", layer: LAYER2_NAME },
    );
  }
}

export function classifyLayer2EvidenceOrigin(gitBlobSha, { separatelyLabelled = false } = {}) {
  if (gitBlobSha === REPLAY_RESULT_GIT_BLOB) {
    return EVIDENCE_ORIGIN.PINNED_WORKER_REPLAY;
  }
  const pin = PIN_BY_BLOB.get(gitBlobSha);
  if (pin?.origin === EVIDENCE_ORIGIN.PROVIDED_REPORT) {
    return EVIDENCE_ORIGIN.PROVIDED_REPORT;
  }
  if (pin?.origin === EVIDENCE_ORIGIN.SYNTHETIC) {
    return EVIDENCE_ORIGIN.SYNTHETIC;
  }
  if (separatelyLabelled) {
    return EVIDENCE_ORIGIN.SEPARATELY_LABELLED_HARNESS;
  }
  return EVIDENCE_ORIGIN.CALLER_UNVERIFIED;
}

/**
 * Independent tip-replay confirmation is only the pinned worker-replay bytes
 * at the BasePay tip with a 19/19 pass. provided_report cannot self-assert this.
 */
export function independentTipReplayConfirmed({ gitBlobSha, commit, replayPass }) {
  return gitBlobSha === REPLAY_RESULT_GIT_BLOB
    && commit === BASEPAY_TIP_COMMIT
    && replayPass === true;
}

export function isIndependentlyExecutedHarnessOrigin(origin) {
  return origin === EVIDENCE_ORIGIN.PINNED_WORKER_REPLAY
    || origin === EVIDENCE_ORIGIN.SEPARATELY_LABELLED_HARNESS;
}
