import { importOutcomeText } from "../../../tools/ops/three-site-settlement-join/measure/src/outcome-binding.mjs";
import { sha256 } from "./canonical.mjs";
import { TASK_REF_RE, TASK_REF_SCHEMA } from "./constants.mjs";
import { fail } from "./errors.mjs";
import { assertProjectable } from "./privacy.mjs";

const TASK_KEYS = ["cohort", "commerceEventId", "eventId", "operationId", "schemaVersion", "taskRef", "writerId"];

function sameKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

export function isTaskRefRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !sameKeys(value, TASK_KEYS)) return false;
  if (value.schemaVersion !== TASK_REF_SCHEMA) return false;
  if (typeof value.taskRef !== "string" || typeof value.operationId !== "string") return false;
  if (!TASK_REF_RE.test(value.taskRef) || !TASK_REF_RE.test(value.operationId)) return false;
  if (!["controlled_test", "external_unknown", "owner_qa", "sponsored_trial"].includes(value.cohort)) return false;
  if (value.taskRef.startsWith("0x") || value.taskRef.startsWith("bc1") || value.taskRef.includes("@")) return false;
  if (value.operationId.startsWith("0x") || value.operationId.startsWith("bc1") || value.operationId.includes("@")) return false;
  return typeof value.eventId === "string" && typeof value.commerceEventId === "string" && typeof value.writerId === "string";
}

export function splitTaskRefs(records) {
  const taskRefs = [];
  const forward = [];
  let dropped = 0;
  for (const record of records) {
    if (isTaskRefRecord(record)) {
      taskRefs.push({
        schemaVersion: record.schemaVersion,
        operationId: record.operationId,
        taskRef: record.taskRef,
        cohort: record.cohort,
        commerceEventId: record.commerceEventId,
        eventId: record.eventId,
      });
    } else if (record && typeof record === "object" && record.schemaVersion === TASK_REF_SCHEMA) {
      dropped += 1;
    } else forward.push(record);
  }
  return { taskRefs, forward, dropped };
}

export function projectForwardRecords(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return {
      operations: [],
      taskRefs: [],
      unusable: { count: 0, reasons: {} },
      individualJoin: false,
      controlledEvidenceJoin: false,
      externalDemandProved: false,
      organicAttribution: false,
    };
  }
  assertProjectable(records);
  const split = splitTaskRefs(records);
  if (split.forward.length === 0) {
    return {
      operations: [],
      taskRefs: split.taskRefs,
      unusable: {
        count: split.dropped,
        reasons: split.dropped ? { task_ref_rejected: split.dropped } : {},
      },
      individualJoin: false,
      controlledEvidenceJoin: false,
      externalDemandProved: false,
      organicAttribution: false,
    };
  }
  const text = `${split.forward.map((row) => JSON.stringify(row)).join("\n")}\n`;
  let receipt;
  try {
    receipt = importOutcomeText(text, {
      kind: "forward_export",
      path: "snapshot.forwardRecords",
      sha256: sha256(text),
      bytes: Buffer.byteLength(text),
    });
  } catch (error) {
    if (error?.code === "restricted_fields" || error?.code === "revenue_claim") throw error;
    fail("invalid_snapshot");
  }
  if (receipt.recognizedRevenueAtomic !== "0") fail("revenue_claim");
  const unusable = {
    count: (receipt.unusable?.count || 0) + split.dropped,
    reasons: { ...(receipt.unusable?.reasons || {}) },
  };
  if (split.dropped) unusable.reasons.task_ref_rejected = split.dropped;
  return {
    operations: (receipt.forward?.operations || []).map((op) => ({
      operationId: op.operationId,
      cohort: op.cohort,
      canonicalStageJoin: op.canonicalStageJoin === true,
      schemaValidDelivery: op.schemaValidDelivery === true,
      missingStages: op.missingStages,
      quarantine: op.quarantine,
      buyerAttestedUsefulness: false,
      usefulness: "unknown",
      retainedUseAuthority: op.retainedUseAuthority,
      externalDemandProved: false,
      recognizedRevenueAtomic: "0",
      secondUseAfterCorrection: op.secondUseAfterCorrection === true,
    })),
    taskRefs: split.taskRefs,
    unusable,
    individualJoin: receipt.individualJoin === true,
    controlledEvidenceJoin: receipt.controlledEvidenceJoin === true,
    externalDemandProved: false,
    organicAttribution: false,
  };
}
