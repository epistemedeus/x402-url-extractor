import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  authorizeOutcomeBinding,
  buildTaskRefRecord,
  stableForwardEventId,
} from "../commerce-outcome-binding.mjs";
import { digestOf } from "../task-linked-delivery/experiments/delivery-outcome-100173/src/canonical.mjs";
import { hasDisallowedKey } from "../task-linked-delivery/experiments/delivery-outcome-100173/src/privacy.mjs";
import { transactionReceipt } from "../transaction-receipt.mjs";
import { containsAccount, IMPLEMENTATION } from "./base-receipt.mjs";
import {
  COMPATIBILITY_SCHEMA,
  CUSTOMER_FILE,
  CUSTOMER_SCHEMA,
  DEFAULT_TTL_MS,
  SHARED_FILE,
} from "./constants.mjs";
import { QualifyError } from "./qualify.mjs";

const GRANT_TOKEN = /^[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TASK_LABEL = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TX = /^0x[0-9a-f]{64}$/;
const OPERATION_ID = "normalized-transaction-receipt";
const PRODUCT = "samedaydesk-transaction-receipt";
const METHOD = "GET";
const ROUTE = "/chain/transaction-receipt";
const SCHEMA_NAME = "samedaydesk-transaction-receipt";
const SCHEMA_VERSION = "1.0.0";
const ACTIONS = Object.freeze(["read", "revoke", "share-knowledge", "correct-knowledge"]);

function fail(code) {
  throw new QualifyError(code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function contributionId(token, resultId) {
  return `c${sha256(`${sha256(token)}\0${resultId}\0knowledge`).slice(0, 32)}`;
}

function sameHex(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length || left.length !== 64) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// The sold receipt schema names the hash the customer asked for. That one
// product field is not a measurement join key. Every other restricted key
// still refuses the private record.
function receiptForPrivacyCheck(body) {
  if (!plain(body)) return body;
  const copy = structuredClone(body);
  if (plain(copy.request)) delete copy.request.transactionHash;
  return copy;
}

export function requestIdentityFor({ method, route, network, transactionHash, credentialDigest = "" }) {
  return sha256([method, route, network, transactionHash, credentialDigest || ""].join("\0"));
}

function comparableDigest(body) {
  if (!plain(body)) return null;
  const { checkedAt, ...rest } = body;
  return digestOf(rest);
}

export function addressFreeEvidence(body) {
  if (!plain(body) || body.product !== PRODUCT) return null;
  const core = {
    blockNumber: body.transaction?.blockNumber ?? null,
    canonicalUsdcTransferCount: Number(body.receipt?.canonicalUsdcTransferCount || 0),
    decision: body.decision || null,
    movementRef: body.request?.transactionHash || null,
    network: body.chain?.network || null,
    receiptFound: body.receipt?.found === true,
    status: body.transaction?.status || null,
    transactionFeeWei: body.transaction?.transactionFeeWei ?? null,
  };
  if (!Number.isInteger(core.canonicalUsdcTransferCount) || core.canonicalUsdcTransferCount < 0) return null;
  if (core.movementRef !== null && !TX.test(core.movementRef)) return null;
  if (containsAccount(core) || hasDisallowedKey(core)) return null;
  return { ...core, evidenceDigest: digestOf(core) };
}

function usefulSuccess(body) {
  return body?.ok === true
    && body.decision === "found"
    && body.receipt?.found === true
    && (body.transaction?.status === "success" || body.transaction?.status === "reverted");
}

function usefulNegative(body) {
  return body?.ok === true && body.decision === "not_found" && body.receipt?.found === false;
}

function networkName(value) {
  if (value === "eip155:8453" || value === "base") return "base";
  if (value === "eip155:1" || value === "ethereum") return "ethereum";
  return null;
}

function refused(reason, extra = {}) {
  return {
    applied: false,
    currentAuthority: false,
    executionSaved: false,
    historicalRevenue: "unknown",
    knowledgeApplied: false,
    observedSaving: false,
    paymentPermitted: false,
    reason,
    recognizedRevenueAtomic: "0",
    revenueRecognized: false,
    usefulTransferred: false,
    ...extra,
  };
}

export function compatibilityView(row) {
  if (!row || row.schema !== COMPATIBILITY_SCHEMA || row.action === "revoke" || row.action === "correct") return null;
  if (hasDisallowedKey(row) || containsAccount(row.evidence)) return null;
  const evidence = row.evidence;
  if (!evidence || typeof evidence.evidenceDigest !== "string") return null;
  const view = {
    attribution: "Copyright (c) 2026 SameDayDesk",
    corrects: row.corrects || null,
    currentAuthority: false,
    evidence,
    evidenceDigest: evidence.evidenceDigest,
    expiresAt: row.expiresAt,
    historicalRevenue: "unknown",
    implementation: IMPLEMENTATION,
    license: "MIT",
    method: METHOD,
    operationId: OPERATION_ID,
    outcomeSchema: SCHEMA_NAME,
    outcomeSchemaVersion: SCHEMA_VERSION,
    paymentPermitted: false,
    recognizedRevenueAtomic: "0",
    route: ROUTE,
    schema: COMPATIBILITY_SCHEMA,
    shareId: row.shareId,
    source: "bounded public receipt read",
    sourceSha: row.sourceSha,
  };
  if (containsAccount(view) || hasDisallowedKey(view)) return null;
  if (typeof view.shareId !== "string" || typeof view.sourceSha !== "string" || typeof view.expiresAt !== "string") {
    return null;
  }
  return view;
}

export function listCompatibility(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const revoked = new Set(list.filter(row => row?.schema === COMPATIBILITY_SCHEMA && row.action === "revoke").map(row => row.targetId));
  const corrected = new Set(
    list
      .filter((row) => row?.schema === COMPATIBILITY_SCHEMA && typeof row.corrects === "string" && row.corrects)
      .map((row) => row.corrects),
  );
  return list
    .filter((row) => row?.schema === COMPATIBILITY_SCHEMA && !row.revoked && !revoked.has(row.shareId) && !row.stale && !corrected.has(row.shareId))
    .map(compatibilityView)
    .filter(Boolean);
}

export function listCompatibilityCorrections(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.schema === COMPATIBILITY_SCHEMA && row.action === "correct" && typeof row.corrects === "string" && row.corrects)
    .map((row) => ({ corrects: row.corrects, shareId: typeof row.shareId === "string" ? row.shareId : null }));
}

export function listCompatibilityRevocations(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const fromLines = list
    .filter((row) => row?.schema === COMPATIBILITY_SCHEMA && row.action === "revoke" && typeof row.targetId === "string")
    .map((row) => row.targetId);
  const fromFlags = list
    .filter((row) => row?.schema === COMPATIBILITY_SCHEMA && row.revoked === true && typeof row.shareId === "string")
    .map((row) => row.shareId);
  return [...new Set([...fromLines, ...fromFlags])];
}

function emptyRetain(reason, extra = {}) {
  return {
    accepted: false,
    evidenceClass: null,
    expiresAt: null,
    grant: null,
    grantId: null,
    historicalRevenue: "unknown",
    paidValidDelivery: false,
    paymentPermitted: false,
    reason,
    recognizedRevenueAtomic: "0",
    resultId: null,
    taskJoin: null,
    wrote: false,
    ...extra,
  };
}

export function createCustomerRetention({
  customerStore,
  sharedStore,
  writer,
  internalToken = "",
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  remember,
} = {}) {
  if (!customerStore || !sharedStore || typeof remember !== "function") fail("store_required");

  function taskBinding({ taskLabel, requestIdentity, resultId }) {
    const supplied = typeof taskLabel === "string" && taskLabel.length > 0;
    if (supplied && (!TASK_LABEL.test(taskLabel) || taskLabel.startsWith("0x"))) {
      return { rejected: true };
    }
    const label = supplied ? taskLabel : `paid-receipt-${requestIdentity.slice(0, 20)}`;
    if (typeof internalToken !== "string" || Buffer.byteLength(internalToken) < 32) {
      return { rejected: false, taskRef: null, taskJoin: "unbound_artifact", labelStored: false };
    }
    const claim = authorizeOutcomeBinding({
      "x-samedaydesk-internal": internalToken,
      "x-samedaydesk-outcome-operation": OPERATION_ID,
      "x-samedaydesk-outcome-cohort": "external_unknown",
      "x-samedaydesk-outcome-task": label,
    }, internalToken);
    if (!claim?.taskRef) {
      return supplied
        ? { rejected: true }
        : { rejected: false, taskRef: null, taskJoin: "unbound_artifact", labelStored: false };
    }
    const commerceEventId = stableForwardEventId(`${OPERATION_ID}\0customer\0${requestIdentity}\0${resultId}`);
    const taskRefRecord = buildTaskRefRecord({ claim, commerceEventId });
    return {
      rejected: false,
      labelStored: false,
      taskJoin: taskRefRecord ? "bound" : "unbound_artifact",
      taskRef: claim.taskRef,
      taskRefRecord,
    };
  }

  async function customerRows() {
    return customerStore.read(CUSTOMER_FILE);
  }

  function latestForGrant(rows, grantHash) {
    const matches = rows.filter((row) => row?.schema === CUSTOMER_SCHEMA && row.action === "retain" && row.grantHash === grantHash);
    return matches.length ? matches[matches.length - 1] : null;
  }

  function revoked(rows, grantId) {
    return rows.some((row) => row?.action === "revoke" && row.targetId === grantId);
  }

  async function readBound({ token, resultId = null, method = null, resource = null, countRead = true }) {
    if (typeof token !== "string" || !GRANT_TOKEN.test(token)) {
      return { found: false, reason: "grant_rejected", result: null };
    }
    const grantHash = sha256(token);
    const rows = await customerRows();
    const row = latestForGrant(rows, grantHash);
    if (!row || !sameHex(row.grantHash, grantHash)) return { found: false, reason: "grant_rejected", result: null };
    const base = {
      evidenceClass: row.evidenceClass,
      expiresAt: row.expiresAt,
      grantId: row.grantId,
      paidValidDelivery: row.paidValidDelivery === true,
      paymentPermitted: false,
      requestIdentity: row.requestIdentity,
      resultId: row.resultId,
    };
    if (revoked(rows, row.grantId)) return { found: true, reason: "revoked", result: null, ...base };
    if (Date.parse(row.expiresAt) <= now()) return { found: true, reason: "expired", result: null, ...base };
    if (resultId && resultId !== row.resultId) return { found: true, reason: "wrong_result", result: null, ...base };
    if (method && method !== row.method) return { found: true, reason: "wrong_method", result: null, ...base };
    if (resource && resource !== row.route) return { found: true, reason: "wrong_resource", result: null, ...base };
    if (!plain(row.body) || digestOf(row.body) !== row.resultId) {
      return { found: true, reason: "record_integrity", result: null, usable: false, ...base };
    }
    if (countRead && row.evidenceClass !== "execution_failed") {
      await remember("useful_later_read", { recordId: row.recordId, taskRef: row.taskRef || null });
    }
    return {
      found: true,
      reason: null,
      result: row.body,
      currentAuthority: false,
      executionSaved: false,
      historicalRevenue: "unknown",
      method: row.method,
      operationId: row.operationId,
      paymentPermitted: false,
      route: row.route,
      useful: row.paidValidDelivery === true ? "true" : (row.evidenceClass === "useful_negative" ? "false" : "unknown"),
      ...base,
    };
  }

  return Object.freeze({
    async retainDeliveredReceipt({
      optIn = false,
      settlementStatus = "unknown",
      settlementDigest = null,
      body = null,
      taskLabel = null,
      credentialDigest = null,
      retainUntil = null,
      method = METHOD,
      route = ROUTE,
    } = {}) {
      if (optIn !== true) return emptyRetain("not_requested");
      await remember("retention_opt_in", {});
      if (settlementStatus !== "verified") {
        return emptyRetain(settlementStatus === "failed" ? "settlement_failed" : "settlement_unverified");
      }
      if (method !== METHOD || route !== ROUTE) return emptyRetain("wrong_resource");
      if (!plain(body) || body.product !== PRODUCT || body.version !== SCHEMA_VERSION) return emptyRetain("execution_failed");
      if (hasDisallowedKey(receiptForPrivacyCheck(body))) return emptyRetain("restricted_field");
      // A caller flag on the execution body is not settlement or delivery authority.
      if (body.paidValidDelivery === true || body.usefulDelivery === "true") return emptyRetain("supplied_flag_ignored");
      const negative = usefulNegative(body);
      const success = usefulSuccess(body);
      if (!negative && !success) return emptyRetain("execution_failed");
      const network = body.request?.network;
      const transactionHash = body.request?.transactionHash;
      if (!network || !TX.test(transactionHash || "")) return emptyRetain("execution_failed");
      const identity = requestIdentityFor({
        method,
        route,
        network,
        transactionHash,
        credentialDigest: credentialDigest || "",
      });
      const clock = now();
      let expiresAtMs = clock + ttlMs;
      if (retainUntil != null) {
        if (typeof retainUntil !== "string" || retainUntil.length > 40) return emptyRetain("expiry_rejected");
        const parsed = Date.parse(retainUntil);
        if (!Number.isFinite(parsed) || parsed <= clock || parsed > clock + ttlMs) return emptyRetain("expiry_rejected");
        expiresAtMs = parsed;
      }
      const resultId = digestOf(body);
      const comparable = comparableDigest(body);
      const binding = taskBinding({ taskLabel, requestIdentity: identity, resultId });
      if (binding.rejected) return emptyRetain("task_label_rejected");
      const paidValidDelivery = success === true;
      const evidenceClass = paidValidDelivery ? "paid_valid_delivery" : "useful_negative";
      const token = randomBytes(32).toString("hex");
      const grantHash = sha256(token);
      const record = {
        action: "retain",
        actions: [...ACTIONS],
        body,
        comparable,
        createdAt: new Date(clock).toISOString(),
        credentialDigest: credentialDigest ? sha256(credentialDigest) : null,
        evidenceClass,
        eventDigest: resultId,
        expiresAt: new Date(expiresAtMs).toISOString(),
        grantHash,
        grantId: grantHash.slice(0, 16),
        method,
        operationId: OPERATION_ID,
        outcomeSchema: SCHEMA_NAME,
        outcomeSchemaVersion: SCHEMA_VERSION,
        paidValidDelivery,
        paymentPermitted: false,
        recordId: resultId.slice(0, 32),
        requestIdentity: identity,
        resultId,
        route,
        schema: CUSTOMER_SCHEMA,
        settlementDigest: typeof settlementDigest === "string" && HEX64.test(settlementDigest) ? settlementDigest : null,
        settlementStatus: "verified",
        taskJoin: binding.taskJoin,
        taskRef: binding.taskRef,
      };
      if (JSON.stringify(record).includes(token)) return emptyRetain("credential_rejected");
      const lineBytes = Buffer.byteLength(`${JSON.stringify(record)}\n`);
      if (lineBytes > customerStore.maxRecordBytes) return emptyRetain("record_bounds");
      const decision = await customerStore.mutate(CUSTOMER_FILE, async (rows) => {
        const prior = [...rows].reverse().find((row) => (
          row?.schema === CUSTOMER_SCHEMA
          && row.action === "retain"
          && row.requestIdentity === identity
          && !rows.some((item) => item?.action === "revoke" && item.targetId === row.grantId)
        ));
        if (prior && prior.comparable === comparable) {
          return { result: { duplicate: true, resultId: prior.resultId } };
        }
        if (prior) return { result: { conflict: true, resultId: prior.resultId } };
        let taskJoin = binding.taskJoin;
        if (binding.taskRefRecord && writer?.appendTaskRef) {
          const appended = await writer.appendTaskRef(binding.taskRefRecord);
          if (!appended?.accepted) taskJoin = "unbound_artifact";
        }
        return { append: { ...record, taskJoin }, result: { wrote: true, taskJoin } };
      });
      if (decision?.duplicate) {
        return emptyRetain("duplicate", { resultId: decision.resultId });
      }
      if (decision?.conflict) return emptyRetain("result_conflict", { resultId: decision.resultId });
      record.taskJoin = decision?.taskJoin || record.taskJoin;
      await remember("retained_result", { recordId: record.recordId, taskRef: record.taskRef });
      if (paidValidDelivery) {
        await remember("paid_valid_delivery", { recordId: record.recordId, taskRef: record.taskRef });
      }
      return {
        accepted: true,
        evidenceClass,
        expiresAt: record.expiresAt,
        grant: token,
        grantId: record.grantId,
        historicalRevenue: "unknown",
        paidValidDelivery,
        paymentPermitted: false,
        reason: null,
        recognizedRevenueAtomic: "0",
        resultId,
        taskJoin: record.taskJoin,
        wrote: true,
      };
    },

    readDeliveredReceipt(input) {
      return readBound({ ...input, countRead: true });
    },

    async revokeDeliveredReceipt({ token } = {}) {
      const current = await readBound({ token, countRead: false });
      if (!current.found) return { accepted: false, reason: current.reason || "grant_rejected", paymentPermitted: false };
      if (current.reason === "revoked") return { accepted: true, reason: "revoked", paymentPermitted: false };
      if (current.reason && current.reason !== "expired") {
        return { accepted: false, reason: current.reason, paymentPermitted: false };
      }
      await customerStore.append(CUSTOMER_FILE, {
        action: "revoke",
        at: new Date(now()).toISOString(),
        grantId: current.grantId,
        schema: CUSTOMER_SCHEMA,
        targetId: current.grantId,
      });
      // Write a grant-owned tombstone even before its share exists. This also
      // withdraws a concurrently started share that completes after revoke.
      await sharedStore.append(SHARED_FILE, {
        action: "revoke",
        at: new Date(now()).toISOString(),
        schema: COMPATIBILITY_SCHEMA,
        targetId: contributionId(token, current.resultId),
      });
      return { accepted: true, paymentPermitted: false, reason: "revoked" };
    },

    async shareDeliveredKnowledge({ token } = {}) {
      const current = await readBound({ token, countRead: false });
      if (!current.found || current.reason) {
        return { accepted: false, reason: current.reason || "grant_rejected", share: null };
      }
      const evidence = addressFreeEvidence(current.result);
      if (!evidence) return { accepted: false, reason: "restricted_field", share: null };
      const shares = await sharedStore.read(SHARED_FILE);
      const recordId = current.resultId.slice(0, 32);
      const existing = [...shares].reverse().find((row) => (
        row?.schema === COMPATIBILITY_SCHEMA
        && row.action === "share"
        && row.recordId === recordId
        && row.contributionBinding === sha256(token)
        && !shares.some((item) => item?.action === "revoke" && item.targetId === row.shareId)
        && !shares.some((item) => item?.corrects === row.shareId)
      ));
      if (existing) {
        const priorView = compatibilityView(existing);
        if (priorView) return { accepted: true, duplicate: true, share: priorView };
      }
      const shareId = contributionId(token, current.resultId);
      const view = compatibilityView({
        evidence,
        expiresAt: current.expiresAt,
        schema: COMPATIBILITY_SCHEMA,
        shareId,
        sourceSha: evidence.evidenceDigest,
      });
      if (!view) return { accepted: false, reason: "restricted_field", share: null };
      await sharedStore.append(SHARED_FILE, {
        ...view,
        action: "share",
        contributionBinding: sha256(token),
        createdAt: new Date(now()).toISOString(),
        recordId,
      });
      return { accepted: true, share: view };
    },

    async correctDeliveredKnowledge({ token } = {}) {
      const current = await readBound({ token, countRead: false });
      if (!current.found || (current.reason && current.reason !== "expired")) {
        return { accepted: false, applyPrior: false, reason: current.reason || "grant_rejected" };
      }
      const shares = await sharedStore.read(SHARED_FILE);
      const prior = [...shares].reverse().find((row) => (
        row?.schema === COMPATIBILITY_SCHEMA
        && row.action === "share"
        && row.recordId === current.resultId?.slice(0, 32)
        && row.contributionBinding === sha256(token)
      ));
      if (!prior) return { accepted: false, applyPrior: false, reason: "not_found" };
      const shareId = `c${sha256(`${prior.shareId}\0correct\0${now()}`).slice(0, 32)}`;
      await sharedStore.append(SHARED_FILE, {
        action: "correct",
        corrects: prior.shareId,
        createdAt: new Date(now()).toISOString(),
        recordId: prior.recordId,
        schema: COMPATIBILITY_SCHEMA,
        shareId,
      });
      await remember("correction", { recordId: prior.recordId, taskRef: null });
      return { accepted: true, applyPrior: false, corrects: prior.shareId, reason: "corrected" };
    },

    async consumeDeliveredKnowledge({
      derivative,
      client,
      directClient = null,
      publicShares = null,
      corrections = null,
      revocations = null,
      correction = null,
      method = METHOD,
      route = ROUTE,
      outcomeSchema = SCHEMA_NAME,
      outcomeSchemaVersion = SCHEMA_VERSION,
      at = null,
    } = {}) {
      const clock = at == null ? now() : (typeof at === "number" ? at : Date.parse(at));
      if (!derivative || derivative.schema !== COMPATIBILITY_SCHEMA) return refused("not_compatibility");
      if (hasDisallowedKey(derivative) || containsAccount(derivative)) return refused("restricted_field");
      if (method !== derivative.method) return refused("changed_method");
      if (route !== derivative.route) return refused("changed_route");
      if (outcomeSchema !== derivative.outcomeSchema || outcomeSchemaVersion !== derivative.outcomeSchemaVersion) {
        return refused("changed_schema");
      }
      if (
        derivative.operationId !== OPERATION_ID
        || derivative.implementation !== IMPLEMENTATION
        || derivative.route !== ROUTE
        || derivative.method !== METHOD
      ) {
        return refused("foreign_capability");
      }
      if (correction?.corrects === derivative.shareId) return refused("corrected", { applyPrior: false });
      if (Array.isArray(corrections) && corrections.some((item) => item?.corrects === derivative.shareId)) {
        return refused("corrected", { applyPrior: false });
      }
      if (Array.isArray(revocations) && revocations.includes(derivative.shareId)) return refused("revoked");
      if (derivative.revoked === true) return refused("revoked");
      const expires = Date.parse(derivative.expiresAt || "");
      if (!Number.isFinite(expires) || expires <= clock) return refused("expired_scope");
      if (Array.isArray(publicShares)) {
        if (publicShares.some((item) => item?.corrects === derivative.shareId)) {
          return refused("corrected", { applyPrior: false });
        }
        if (!publicShares.some((item) => item?.shareId === derivative.shareId)) {
          return refused("not_current", { applyPrior: false });
        }
      }
      const hash = derivative.evidence?.movementRef;
      const network = networkName(derivative.evidence?.network);
      if (!TX.test(hash || "") || !network || !client) return refused("not_execution");
      const input = { transactionHash: hash, network };
      let laterBody;
      let directBody;
      try {
        laterBody = await transactionReceipt(input, { client, now: () => new Date(clock) });
        directBody = await transactionReceipt(input, {
          client: directClient || client,
          now: () => new Date(clock),
        });
      } catch (error) {
        return refused(error.code || "not_execution");
      }
      const laterEvidence = addressFreeEvidence(laterBody);
      const directEvidence = addressFreeEvidence(directBody);
      if (!laterEvidence || !directEvidence) return refused("restricted_field");
      if (laterEvidence.evidenceDigest !== derivative.sourceSha || laterEvidence.evidenceDigest !== derivative.evidence?.evidenceDigest) {
        return refused("source_changed", {
          continuedExecution: true,
          direct: directEvidence,
          later: laterEvidence,
        });
      }
      const sameUsefulOutput = laterEvidence.evidenceDigest === directEvidence.evidenceDigest;
      if (sameUsefulOutput && laterEvidence.decision) {
        await remember("independently_replayed_utility", { recordId: derivative.shareId || null });
      }
      return {
        applied: false,
        applyPrior: derivative.corrects ? false : null,
        continuedExecution: true,
        currentAuthority: false,
        direct: directEvidence,
        evidenceClass: "independently_replayed_utility",
        executionSaved: false,
        historicalRevenue: "unknown",
        knowledgeApplied: sameUsefulOutput,
        later: laterEvidence,
        observedSaving: false,
        paymentPermitted: false,
        reason: sameUsefulOutput ? "independently_replayed" : "baseline_disagreement",
        recognizedRevenueAtomic: "0",
        revenueRecognized: false,
        sameUsefulOutput,
        usefulTransferred: false,
      };
    },
  });
}

export async function rejectSeededPaidDelivery(value) {
  const claim = plain(value) ? value : null;
  const reasons = [];
  if (!claim) reasons.push("claim_rejected");
  if (claim?.paidValidDelivery === true && claim?.settlementStatus !== "verified") reasons.push("settlement_unverified");
  if (claim?.paidValidDelivery === true && claim?.execution?.decision !== "found") reasons.push("execution_failed");
  if (claim?.grant || claim?.token || claim?.paymentSignature) reasons.push("credential_in_claim");
  if (claim && containsAccount(claim)) reasons.push("restricted_field");
  return { refused: reasons.length > 0, reasons };
}
