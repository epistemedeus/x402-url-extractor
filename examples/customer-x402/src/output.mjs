import { validateOutput } from "agent-payment-policy";

export function validateBuyerOutput(body, requiredOutput) {
  try {
    const report = validateOutput(body, {
      mediaType: requiredOutput.mediaType || "application/json",
      requiredFields: requiredOutput.requiredFields,
      maxResponseBytes: requiredOutput.maxResponseBytes,
    });
    if (body?.ok !== true) {
      return {
        valid: false,
        delivery: "invalid",
        reason: "buyer-required ok literal is not true",
        report,
      };
    }
    for (const field of requiredOutput.requiredFields) {
      const value = field.split(".").reduce((current, key) => current?.[key], body);
      if (value === null || value === undefined) throw new Error(`required field is null or missing: ${field}`);
    }
    const sourceStatus = Number(body.status);
    const sourceRefused = body.sourceOk === false
      || (Number.isInteger(sourceStatus) && (sourceStatus < 200 || sourceStatus >= 300));
    if (sourceRefused) {
      return {
        valid: true,
        delivery: "source_refused",
        reason: body.error?.message || `source HTTP ${sourceStatus}`,
        report,
      };
    }
    return { valid: true, delivery: "useful", report };
  } catch (error) {
    return {
      valid: false,
      reason: error.message,
      report: null,
    };
  }
}
