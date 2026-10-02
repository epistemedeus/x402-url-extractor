import { digestOf } from "../../../task-linked-delivery/experiments/delivery-outcome-100173/src/canonical.mjs";
import { hasDisallowedKey } from "../../../task-linked-delivery/experiments/delivery-outcome-100173/src/privacy.mjs";
import {
  COMPATIBILITY_SCHEMA,
  DEFAULT_TTL_MS,
} from "../../../useful-result-reuse/constants.mjs";
import {
  listCompatibility,
  listCompatibilityCorrections,
  listCompatibilityRevocations,
} from "../../../useful-result-reuse/customer-grant.mjs";
import { CONTRIBUTION_SCHEMA } from "./constants.mjs";

const PRIVATE_KEYS = new Set([
  "body", "rawbody", "grant", "token", "authorization", "secret", "wallet",
  "customer", "othercustomer", "resultbody", "paymentsignature", "payer",
]);

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function privateKey(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => privateKey(item, seen));
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(String(key).toLowerCase().replace(/[^a-z0-9]/g, ""))) return true;
    if (privateKey(child, seen)) return true;
  }
  return false;
}

export function prepareContribution({ intake, classification, patch, authorized = false, now = Date.now(), marker = null }) {
  if (authorized !== true) {
    return { accepted: false, reason: "authorization_required", paymentPermitted: false, spendingGrantTransferred: false };
  }
  const evidence = {
    callerId: intake.callerId,
    expectedPaths: intake.expectedUsefulOutput.paths,
    method: intake.method,
    origin: intake.origin,
    repairKind: patch?.kind || null,
    route: intake.resource,
    runtime: intake.declaredRuntime,
    sdk: intake.declaredSdk,
    taskDigest: intake.taskDigest,
    usefulOutcome: classification?.outcome || "unknown",
  };
  const row = {
    schema: COMPATIBILITY_SCHEMA,
    action: "share",
    attribution: "Copyright (c) 2026 SameDayDesk",
    corrects: null,
    currentAuthority: false,
    evidence,
    expiresAt: new Date(now + DEFAULT_TTL_MS).toISOString(),
    historicalRevenue: "unknown",
    instructions: Array.isArray(patch?.instructions) ? patch.instructions.slice(0, 8) : [],
    license: "MIT",
    paymentPermitted: false,
    recognizedRevenueAtomic: "0",
    responseOverlay: patch?.responseOverlay || null,
    spendingGrantTransferred: false,
    usefulTransferred: false,
  };
  row.evidenceDigest = digestOf(evidence);
  row.shareId = `c${digestOf({ evidenceDigest: row.evidenceDigest, taskDigest: intake.taskDigest }).slice(0, 32)}`;
  const packed = { ...row, marker };
  const serialized = JSON.stringify(packed);
  const privateText = serialized.includes("PRIVATE_SENTINEL_do_not_keep") || serialized.includes("sk_live_") || /0x[0-9a-fA-F]{40}/.test(serialized);
  if (marker || privateKey(packed) || hasDisallowedKey(row) || privateText || classification?.reason === "private_body_withheld") {
    return {
      accepted: false,
      reason: "private_material",
      paymentPermitted: false,
      spendingGrantTransferred: false,
      usefulTransferred: false,
    };
  }
  const existingReceiptList = listCompatibility([row]);
  return {
    accepted: true,
    reason: "sanitized_derivative",
    schema: CONTRIBUTION_SCHEMA,
    row,
    existingKnowledgePath: {
      module: "useful-result-reuse/customer-grant.mjs",
      schema: COMPATIBILITY_SCHEMA,
      receiptSharesReturned: existingReceiptList.length,
      note: "A repair derivative is not a transaction-receipt share and does not transfer another customer's result.",
    },
    paymentPermitted: false,
    spendingGrantTransferred: false,
    usefulTransferred: false,
    recognizedRevenueAtomic: "0",
    historicalRevenue: "unknown",
    independentExecutionRequired: true,
    hashIsExecution: false,
  };
}

export function correctContribution(contribution, { now = Date.now(), replacement }) {
  if (!contribution?.accepted) return { accepted: false, reason: "nothing_to_correct" };
  const corrected = prepareContribution({
    intake: replacement.intake,
    classification: replacement.classification,
    patch: replacement.patch,
    authorized: true,
    now,
  });
  if (!corrected.accepted) return corrected;
  const control = {
    schema: COMPATIBILITY_SCHEMA,
    action: "correct",
    corrects: contribution.row.shareId,
    shareId: corrected.row.shareId,
    expiresAt: corrected.row.expiresAt,
  };
  return { ...corrected, control, supersedes: contribution.row.shareId };
}

export function revokeContribution(contribution) {
  if (!contribution?.row?.shareId) return { revoked: false, reason: "nothing_to_revoke" };
  return {
    schema: COMPATIBILITY_SCHEMA,
    action: "revoke",
    targetId: contribution.row.shareId,
    revoked: true,
    paymentPermitted: false,
    spendingGrantTransferred: false,
  };
}

function executionWitness(execution, contribution) {
  const evidence = contribution?.row?.evidence;
  if (!evidence || !execution || execution.independent !== true || execution.hashOnly === true) return false;
  if (typeof execution.callerId !== "string" || !execution.callerId || execution.callerId === evidence.callerId) return false;
  if (execution.operationId !== `${evidence.method} ${evidence.route}`) return false;
  if (typeof execution.observedDigest !== "string" || !/^[0-9a-f]{64}$/.test(execution.observedDigest)) return false;
  if (execution.observedDigest === contribution.row.evidenceDigest) return false;
  if (execution.observedDigest === contribution.row.shareId) return false;
  return true;
}

export function replayContribution({ contribution, corrections = [], revocations = [], now = Date.now(), taskDigest, sdk, target = null, execution = null }) {
  const rows = [
    contribution?.row,
    contribution?.control,
    ...corrections,
    ...revocations,
  ].filter(Boolean);
  const revoked = new Set(listCompatibilityRevocations(rows));
  const corrected = new Set(listCompatibilityCorrections(rows).map((item) => item.corrects));
  const shareId = contribution?.row?.shareId;
  if (!contribution?.accepted || !shareId) {
    return { reused: false, reason: "contribution_absent", usefulTransferred: false, paymentPermitted: false };
  }
  if (revoked.has(shareId) || contribution.row.revoked === true) {
    return { reused: false, reason: "revoked", usefulTransferred: false, paymentPermitted: false, spendingGrantTransferred: false };
  }
  if (corrected.has(shareId)) {
    return { reused: false, reason: "corrected", usefulTransferred: false, paymentPermitted: false, spendingGrantTransferred: false };
  }
  if (Date.parse(contribution.row.expiresAt) <= now) {
    return { reused: false, reason: "expired", usefulTransferred: false, paymentPermitted: false, spendingGrantTransferred: false };
  }
  const evidence = contribution.row.evidence;
  const targetMatches = Boolean(target)
    && target.origin === evidence.origin
    && target.method === evidence.method
    && (target.resource === evidence.route || target.route === evidence.route);
  if (taskDigest !== evidence.taskDigest || sdk !== evidence.sdk || !targetMatches) {
    return { reused: false, reason: "stale_applicability", usefulTransferred: false, paymentPermitted: false, spendingGrantTransferred: false };
  }
  if (!executionWitness(execution, contribution)) {
    return {
      reused: false,
      reason: "hash_is_not_execution",
      usefulTransferred: false,
      paymentPermitted: false,
      spendingGrantTransferred: false,
      hashIsExecution: false,
      independentExecutionRequired: true,
    };
  }
  return {
    reused: true,
    reason: "independent_execution",
    usefulTransferred: false,
    hashIsExecution: false,
    paymentPermitted: false,
    spendingGrantTransferred: false,
    recognizedRevenueAtomic: "0",
    historicalRevenue: "unknown",
    shareId,
    receiptSharesReturned: listCompatibility(rows).length,
  };
}
