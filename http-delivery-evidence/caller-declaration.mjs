import { httpDeliveryEmissionAllowed } from "./contract.mjs";
import { USEFULNESS_UNKNOWN } from "./classify.mjs";

const DISPOSITIONS = new Set(["useful", "not_useful"]);

/**
 * Caller usefulness is a supplied statement bound to the same request, event,
 * and settlement as the validation row. Delivery class does not fill it in.
 * The validation record's usefulness field stays unknown.
 */
export function declareCallerUsefulness({ validation, declaration } = {}) {
  const absent = (reason) => ({
    present: false,
    disposition: null,
    reason,
    source: null,
    usefulness: USEFULNESS_UNKNOWN,
    paidEvidenceId: validation?.paidEvidenceId || null,
  });
  if (!declaration) return absent("declaration_absent");
  if (
    declaration.inferred === true
    || declaration.source === "model"
    || declaration.source === "delivery_class"
  ) {
    return absent("model_inference_rejected");
  }
  if (declaration.source !== "caller") return absent("declaration_source_rejected");
  if (!DISPOSITIONS.has(declaration.disposition)) return absent("disposition_rejected");
  if (!validation || validation.usefulness !== USEFULNESS_UNKNOWN) {
    return absent("validation_usefulness_must_stay_unknown");
  }
  if (!httpDeliveryEmissionAllowed(validation.paidEvidenceId)) {
    return absent("historical_intent_not_retained");
  }
  const sameEvent = declaration.paidEvidenceId === validation.paidEvidenceId;
  const sameRequest = declaration.requestDigest === validation.requestDigest
    && typeof validation.requestDigest === "string";
  const sameSettlement = typeof declaration.settlementReference === "string"
    && typeof validation.settlementReference === "string"
    && declaration.settlementReference.toLowerCase() === validation.settlementReference.toLowerCase();
  if (!sameEvent || !sameRequest || !sameSettlement) return absent("identity_mismatch");
  return {
    present: true,
    disposition: declaration.disposition,
    reason: "caller_declared",
    source: "caller",
    usefulness: USEFULNESS_UNKNOWN,
    paidEvidenceId: validation.paidEvidenceId,
  };
}
