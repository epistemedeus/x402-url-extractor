import { outputMatches } from "./paths.mjs";

function base(intake, declared, observed) {
  return {
    declared: {
      source: declared.source,
      requiredPaths: declared.requiredPaths,
      provesExecution: false,
      provesUsefulEquivalence: false,
    },
    observed: {
      status: observed?.status ?? null,
      paths: observed?.privateSentinel ? [] : (observed?.paths || []),
      byteLength: observed?.byteLength ?? 0,
      bodyRetained: observed?.bodyRetained === true && observed?.privateSentinel !== true,
      http200IsSuccess: false,
    },
    callerSupplied: intake.callerEvidence
      ? { present: true, executed: false, establishesUsefulOutput: false }
      : { present: false, executed: false, establishesUsefulOutput: false },
    paidAuditRequired: false,
    purchasePerformed: false,
  };
}

export function classify({ intake, declared, observed, stopped = null }) {
  const view = base(intake, declared, observed);
  if (stopped === "method_not_read_only" || intake.method !== "GET") {
    return { ...view, outcome: "unsupported", reason: "method_not_read_only", nextAction: "unsupported", useful: false };
  }
  if (intake.question === "semantic") {
    return {
      ...view,
      outcome: "unsupported",
      reason: "semantic_question_unsupported",
      nextAction: "unsupported",
      useful: false,
    };
  }
  if (!observed) {
    const reason = ["effort_exhausted", "total_body_ceiling", "total_response_deadline", "target_not_authorized", "resource_not_authorized"].includes(stopped)
      ? stopped
      : "body_not_observed";
    return { ...view, outcome: "unknown", reason, nextAction: "unknown", useful: false };
  }
  if (observed.privateSentinel) {
    return { ...view, outcome: "unknown", reason: "private_body_withheld", nextAction: "unknown", useful: false };
  }
  if (observed.redirectUnfollowed) {
    return { ...view, outcome: "unknown", reason: "redirect_unfollowed", nextAction: "unknown", useful: false };
  }
  if (observed.bodyDeadline) {
    return { ...view, outcome: "unknown", reason: "body_deadline", nextAction: "unknown", useful: false };
  }
  if (observed.bodyCeiling || observed.reason === "body_ceiling") {
    return { ...view, outcome: "unknown", reason: "body_ceiling", nextAction: "unknown", useful: false };
  }
  if (observed.status === 402) {
    return {
      ...view,
      outcome: "unknown",
      reason: "paid_body_not_read",
      nextAction: "unknown",
      useful: false,
      handoffAvailable: true,
      note: "The existing 0.01 audit also does not read a paid body.",
    };
  }
  if (observed.status !== 200 || observed.json !== true) {
    return { ...view, outcome: "unknown", reason: "body_not_observed", nextAction: "unknown", useful: false };
  }

  const useful = outputMatches(observed, intake.expectedUsefulOutput);
  const expected = intake.expectedUsefulOutput.paths;
  const declaredHasExpected = expected.every((path) => declared.requiredPaths.includes(path));
  const contradicted = expected.some((path) => declared.requiredPaths.includes(path) && !observed.paths.includes(path));

  if (useful) {
    return {
      ...view,
      outcome: "free_sufficient",
      reason: declaredHasExpected ? "observed_output_matches_declaration" : "observed_output_sufficient_declaration_incomplete",
      nextAction: "free_sufficient",
      useful: true,
    };
  }
  if (contradicted) {
    return {
      ...view,
      outcome: "mismatch",
      reason: "body_contradicts_declaration",
      nextAction: intake.question === "declaration_contract" ? "existing_audit_handoff" : "repair",
      useful: false,
    };
  }
  if (intake.question === "declaration_contract") {
    return {
      ...view,
      outcome: "unknown",
      reason: "declaration_question_not_settled_by_missing_field",
      nextAction: "existing_audit_handoff",
      useful: false,
      handoffAvailable: true,
    };
  }
  return {
    ...view,
    outcome: "unknown",
    reason: "missing_field_not_paid_demand",
    nextAction: "unknown",
    useful: false,
  };
}
