// A seller-integrity report is not evidence that the caller's useful body ran.
// Incomplete local audits stay incomplete. A finished advisory report still
// does not read that body and does not create a purchase.

export function paidReportAnswersCaller(body) {
  const completed = body?.report?.auditCompleted === true;
  const readsBody = body?.boundary?.responseBodyRead === true || body?.report?.repairPlan?.boundary?.sellerRuntimeVerified === true;
  return {
    answersUsefulOutput: false,
    paidAuditRequired: false,
    purchaseRecommended: false,
    purchasePerformed: false,
    auditCompleted: completed,
    reason: readsBody
      ? "paid_report_boundary_does_not_answer_caller"
      : completed
        ? "paid_report_does_not_read_useful_body"
        : "audit_incomplete_retained",
  };
}

export function paidDeltaForCaller({ question, freeNextAction, report, intake = null }) {
  const view = paidReportAnswersCaller(report);
  const base = {
    ...view,
    connected: false,
    usefulDelta: false,
    gap: report ? view.reason : "paid_report_not_supplied",
    nextAction: freeNextAction,
    serves: null,
  };
  if (!report) return base;
  const request = report.request;
  if (intake && request && (request.origin !== intake.origin || request.route !== intake.resource || String(request.method || "").toUpperCase() !== intake.method)) {
    return { ...base, gap: "target_mismatch" };
  }
  if (question !== "declaration_contract") {
    return {
      ...base,
      gap: view.reason === "audit_incomplete_retained" ? view.reason : "paid_report_does_not_read_useful_body",
    };
  }
  if (view.auditCompleted !== true) return { ...base, gap: "audit_incomplete_retained" };
  const findings = Array.isArray(report.report?.findings) ? report.report.findings : [];
  const actions = Array.isArray(report.report?.repairPlan?.actions) ? report.report.repairPlan.actions : [];
  const contract = report.report?.responseContract;
  const hasContract = Boolean(contract) && typeof contract === "object" && !Array.isArray(contract) && Object.keys(contract).length > 0;
  if (findings.length === 0 && actions.length === 0 && !hasContract) {
    return { ...base, gap: "paid_report_has_no_declaration_delta" };
  }
  return {
    ...base,
    connected: true,
    usefulDelta: true,
    gap: null,
    serves: "declaration_contract",
    answersUsefulOutput: false,
    purchaseRecommended: false,
    purchasePerformed: false,
  };
}
