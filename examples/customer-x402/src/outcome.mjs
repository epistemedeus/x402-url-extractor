import { OUTCOMES } from "./constants.mjs";
import { validateBatchBuyerOutput } from "./batch-output.mjs";
import { decodeSettlementHeader } from "./challenge.mjs";
import { validateBuyerOutput } from "./output.mjs";
import { validateVendorBudgetBuyerOutput } from "./vendor-budget-output.mjs";
import { redactValue } from "./redact.mjs";

/**
 * Classify a paid HTTP response. HTTP 200 or a settlement header alone never
 * proves buyer-required output validity. Outcomes stay separate; callers must
 * not auto-retry.
 */
export function classifyPaidResponse({
  response,
  body,
  requiredOutput,
  authorization,
  bodyError = null,
} = {}) {
  const settlement = decodeSettlementHeader(response);
  const mediaType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const batch = Boolean(authorization?.batch);
  let output;
  if (bodyError || mediaType !== requiredOutput.mediaType) {
    output = { valid: false, delivery: "invalid", reason: bodyError || "response Content-Type is not application/json", report: null };
  } else if (authorization?.vendorBudget) {
    output = validateVendorBudgetBuyerOutput(body, authorization);
  } else if (batch) {
    output = validateBatchBuyerOutput(body, authorization);
  } else {
    const single = validateBuyerOutput(body, requiredOutput);
    output = { ...single, delivery: single.delivery || (single.valid ? "useful" : "invalid") };
  }
  const evidence = {
    httpStatus: response.status,
    settlementPresent: settlement.present,
    settlementSuccess: settlement.decoded?.success ?? null,
    settlementTransaction: settlement.decoded?.transaction ?? settlement.decoded?.txHash ?? null,
    settlementVerification: settlement.present
      ? "unverified"
      : "absent",
    settlementParseError: settlement.parseError ?? null,
    outputValid: output.valid,
    outputDelivery: output.delivery ?? null,
    outputReason: output.reason ?? null,
    outputReport: output.report,
    retainedBody: redactValue(body),
    bodyDigest: authorization.bodyDigest ?? null,
    authorizedAmountCapAtomic: authorization.amountCapAtomic,
    selectedNetwork: authorization.network,
    selectedAsset: authorization.asset,
    selectedRecipient: authorization.recipient,
  };

  if (response.status === 402) {
    return {
      outcome: OUTCOMES.UNKNOWN,
      message: "paid request returned another 402; no application retry",
      evidence,
    };
  }

  if (settlement.present && settlement.decoded && settlement.decoded.success === false) {
    return {
      outcome: OUTCOMES.SETTLEMENT_FAILED,
      message: "settlement header reports success=false",
      evidence,
    };
  }

  if (response.status >= 200 && response.status < 300) {
    if (output.valid && output.delivery === "useful") {
      return {
        outcome: batch ? OUTCOMES.USEFUL_DELIVERED : OUTCOMES.VALID_DELIVERED,
        message: batch
          ? "batch rows match buyer intent with per-URL success; settlement remains unverified unless the customer checks chain state separately"
          : "buyer-required output fields are present; settlement remains unverified unless the customer checks chain state separately",
        evidence,
      };
    }
    if (output.valid && output.delivery === "partial") {
      return {
        outcome: OUTCOMES.PARTIAL_DELIVERED,
        message: authorization?.vendorBudget
          ? "vendor pricing comparison matches the authorized rows but contains conflicting or incomparable evidence; not an automatic retry"
          : "paid bounded batch attempt is structurally valid with explicit failed or partial rows; not a refund or automatic retry",
        evidence,
      };
    }
    if (output.valid && output.delivery === "source_refused") {
      return {
        outcome: OUTCOMES.PARTIAL_DELIVERED,
        message: "typed extract record with source HTTP refusal; not empty success and not an automatic retry",
        evidence,
      };
    }
    return {
      outcome: OUTCOMES.PAID_INVALID_OUTPUT,
      message: "HTTP success/settlement does not satisfy buyer-required output",
      evidence,
    };
  }

  return {
    outcome: OUTCOMES.UNKNOWN,
    message: `unexpected HTTP status ${response.status}; no application retry`,
    evidence,
  };
}
