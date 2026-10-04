import { validateOutput } from "agent-payment-policy";

import { decideExtractTask } from "./extract-task.mjs";

function withTask(result, task) {
  return { ...result, task };
}

export function validateBuyerOutput(body, requiredOutput) {
  const task = decideExtractTask(body, requiredOutput?.task ?? null);
  if (task.delivery === "invalid") {
    return withTask({
      valid: false,
      delivery: "invalid",
      reason: task.nextAction.statement,
      report: null,
    }, task);
  }
  if (body?.ok !== true) {
    return withTask({
      valid: task.delivery === "unavailable",
      delivery: task.delivery === "unavailable" ? "unavailable" : "invalid",
      reason: task.nextAction.statement,
      report: null,
    }, task);
  }
  try {
    const report = validateOutput(body, {
      mediaType: requiredOutput.mediaType || "application/json",
      requiredFields: requiredOutput.requiredFields,
      maxResponseBytes: requiredOutput.maxResponseBytes,
    });
    for (const field of requiredOutput.requiredFields) {
      const value = field.split(".").reduce((current, key) => current?.[key], body);
      if (value === null || value === undefined) throw new Error(`required field is null or missing: ${field}`);
    }
    if (task.delivery === "source_refused" || task.delivery === "partial" || task.delivery === "metadata_sufficient" || task.delivery === "excerpt_sufficient") {
      return withTask({
        valid: true,
        delivery: task.delivery,
        reason: task.nextAction.statement,
        report,
      }, task);
    }
    return withTask({ valid: true, delivery: "useful", report }, task);
  } catch (error) {
    return withTask({
      valid: false,
      delivery: "invalid",
      reason: error.message,
      report: null,
    }, task);
  }
}
