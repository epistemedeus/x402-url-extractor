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
