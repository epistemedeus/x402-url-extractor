import { laterApplicability } from "../src/later.mjs";

export const REGRESSION_SCHEMA = "samedaydesk.seller-repair-regression.v1";

function changed(artifact, caller) {
  return caller.taskDigest !== artifact.taskDigest
    || caller.sdk !== artifact.declaredSdk
    || caller.origin !== artifact.target?.origin
    || caller.method !== artifact.target?.method
    || caller.resource !== artifact.target?.resource
    || caller.expectValue !== artifact.expected?.value;
}

// A file is not execution and is not a share grant. Changed inputs are refused
// before any probe. The same binding still requires a new retest.
export function consumeLaterArtifact(artifact, caller = {}) {
  if (!artifact || artifact.schema !== REGRESSION_SCHEMA) {
    return { refused: true, reason: "artifact_schema", probed: false, usefulTransferred: false, paymentPermitted: false, trusted: false };
  }
  if (artifact.trusted === true || caller.trustSubmitted === true) {
    return {
      refused: true,
      reason: "submitted_artifact_is_not_trusted",
      probed: false,
      usefulTransferred: false,
      paymentPermitted: false,
      trusted: false,
    };
  }
  if (changed(artifact, caller)) {
    return {
      refused: true,
      reason: "stale_applicability",
      probed: false,
      usefulTransferred: false,
      paymentPermitted: false,
      trusted: false,
      reused: false,
    };
  }
  const later = laterApplicability({
    intake: {
      taskDigest: artifact.taskDigest,
      declaredSdk: artifact.declaredSdk,
      callerId: artifact.callerId,
      origin: artifact.target.origin,
      method: artifact.target.method,
      resource: artifact.target.resource,
    },
    taskDigest: caller.taskDigest,
    sdk: caller.sdk,
    target: { origin: caller.origin, method: caller.method, resource: caller.resource },
    callerId: caller.callerId,
    retest: caller.retest || null,
    independentRetest: caller.independentRetest === true,
  });
  return {
    refused: later.reused !== true,
    ...later,
    probed: caller.independentRetest === true,
    trusted: false,
    paymentPermitted: false,
  };
}
