import { laterApplicability } from "../src/later.mjs";

export const REGRESSION_SCHEMA = "samedaydesk.seller-repair-regression.v1";
export const CALLER_REGRESSION_SCHEMA = "samedaydesk.seller-repair-caller-regression.v1";

const ACCEPTED = new Set([REGRESSION_SCHEMA, CALLER_REGRESSION_SCHEMA]);

function changed(artifact, caller) {
  return caller.taskDigest !== artifact.taskDigest
    || caller.sdk !== artifact.declaredSdk
    || caller.origin !== artifact.target?.origin
    || caller.method !== artifact.target?.method
    || caller.resource !== artifact.target?.resource
    || caller.expectValue !== artifact.expected?.value;
}

function closed(reason, extra = {}) {
  return {
    refused: true,
    reason,
    probed: false,
    executed: false,
    usefulTransferred: false,
    paymentPermitted: false,
    trusted: false,
    independentRetest: false,
    ...extra,
  };
}

// A caller flag or a submitted file is not execution, trust, sharing, or payment.
// Compatible reuse still needs an owned execution witness from this process.
export function consumeLaterArtifact(artifact, caller = {}, execution = null) {
  if (!artifact || !ACCEPTED.has(artifact.schema)) {
    return closed("artifact_schema");
  }
  if (artifact.trusted === true || caller.trustSubmitted === true) {
    return closed("submitted_artifact_is_not_trusted");
  }
  const asserted = caller.independentRetest === true || caller.submittedReport === true;
  const submittedRetest = caller.retest != null && execution?.owned !== true;
  if ((asserted || submittedRetest) && execution?.owned !== true) {
    return closed("caller_assertion_is_not_execution", {
      predicateReason: changed(artifact, caller) ? "stale_applicability" : null,
    });
  }
  if (changed(artifact, caller)) {
    return closed("stale_applicability", { reused: false });
  }
  if (typeof caller.callerId === "string" && caller.callerId !== artifact.callerId) {
    return closed("wrong_owner", { reused: false });
  }
  const owned = execution?.owned === true;
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
    retest: owned ? execution.retest || null : null,
    independentRetest: owned && execution.probed === true,
  });
  return {
    refused: later.reused !== true,
    ...later,
    probed: owned && execution.probed === true,
    executed: owned,
    trusted: false,
    paymentPermitted: false,
    independentRetest: owned && execution.probed === true,
  };
}
