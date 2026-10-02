import { hasDisallowedKey } from "../../../task-linked-delivery/experiments/delivery-outcome-100173/src/privacy.mjs";

export function rejectSeeded(claim) {
  const reasons = [];
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) reasons.push("claim_not_object");
  if (claim?.treatHttp200AsUseful === true || claim?.http200IsSuccess === true) reasons.push("http200_is_not_useful");
  if (claim?.paidAuditRequired === true || claim?.forcedPurchase === true) reasons.push("forced_purchase");
  if (claim?.claim === "useful_repair" && claim?.body && !claim.body?.result?.sku) reasons.push("repair_not_useful");
  if (typeof claim?.recognizedRevenueAtomic === "string" && claim.recognizedRevenueAtomic !== "0") reasons.push("revenue_claim");
  if (claim?.cashAtomic && claim.cashAtomic !== "unknown") reasons.push("unknown_cash_relabeled");
  if (hasDisallowedKey(claim)) reasons.push("restricted_fields");
  return {
    refused: reasons.length > 0,
    reasons,
    paymentSent: false,
    recognizedRevenueAtomic: "0",
    historicalRevenue: "unknown",
  };
}
