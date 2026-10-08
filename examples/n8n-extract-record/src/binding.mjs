import { createHash } from "node:crypto";

const ARTIFACT_ID = /^[a-f0-9]{64}$/;

export function isArtifactId(value) {
  return typeof value === "string" && ARTIFACT_ID.test(value);
}

/**
 * Identity is the caller task, not harness page bodies and not a merchant grant.
 * Key order is the parsed task order so a reordered mapping is a different input.
 */
export function bindingDocument(task) {
  const document = {
    urls: task?.urls,
    fields: task?.fields,
    mapping: task?.mapping,
    schema: task?.schema,
  };
  if (task && Object.prototype.hasOwnProperty.call(task, "requiredOutput")) {
    document.requiredOutput = task.requiredOutput;
  }
  return document;
}

export function bindingText(task) {
  return JSON.stringify(bindingDocument(task));
}

export function bindingId(task) {
  return createHash("sha256").update(bindingText(task)).digest("hex");
}
