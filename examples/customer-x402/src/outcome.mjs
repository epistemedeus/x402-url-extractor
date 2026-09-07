import { OUTCOMES } from "./constants.mjs";
import { decodeSettlementHeader } from "./challenge.mjs";
import { validateBuyerOutput } from "./output.mjs";

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
} = {}) {
  const settlement = decodeSettlementHeader(response);
  const output = validateBuyerOutput(body, requiredOutput);
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
    outputReason: output.reason ?? null,
    outputReport: output.report,
    retainedBody: body,
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
    if (output.valid) {
      return {
        outcome: OUTCOMES.VALID_DELIVERED,
        message:
          "buyer-required output fields are present; settlement remains unverified unless the customer checks chain state separately",
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
