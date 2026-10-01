import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { buildTaskRefRecord, createForwardOutcomeWriter, stableForwardEventId } from "../commerce-outcome-binding.mjs";
import { metricCoverageStatus } from "../commerce-events.mjs";
import {
  assessFreeDiagnosis,
  authorizePurchase,
} from "../paid-useful-journey.mjs";
import { hasDisallowedKey } from "../task-linked-delivery/experiments/delivery-outcome-100173/src/privacy.mjs";
import {
  RECEIPT_METHOD,
  RECEIPT_OPERATION,
  RECEIPT_ROUTE,
  RECEIPT_SCHEMA_NAME,
  RECEIPT_SCHEMA_VERSION,
  clientFromCapture,
  executeClosedSettlement,
  knowledgeView,
  readCapture,
  receiveKnowledge,
} from "./base-receipt.mjs";
import {
  createCustomerRetention,
  listCompatibility,
  listCompatibilityCorrections,
  listCompatibilityRevocations,
} from "./customer-grant.mjs";
import {
  CLOSED_SPONSORED_REF,
  CURRENT_SCHEMA,
  CUSTOMER_MAX_RECORD_BYTES,
  CUSTOMER_RETENTION_DESCRIPTOR,
  DEFAULT_TTL_MS,
  EVIDENCE_CLASSES,
  EXISTING_PAID_OPERATIONS,
  KNOWLEDGE_SCHEMA,
  METRIC_FILE,
  METRIC_KINDS,
  METRIC_SCHEMA,
  PAGE_MAX,
  PRIVATE_FILE,
  PRIVATE_SCHEMA,
  PROTOCOL_ABSENT_FIELDS,
  SHARED_FILE,
  SHARED_SCHEMA,
  SOURCE_ID,
} from "./constants.mjs";
import {
  QualifyError,
  bindingDigest,
  claimFor,
  qualifyBinding,
  recompute,
} from "./qualify.mjs";
import { createReuseStore } from "./store.mjs";

const TX = /^0x[0-9a-f]{64}$/;
const WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function metricEvent(kind, now, extra = {}) {
  if (!METRIC_KINDS.includes(kind)) throw new QualifyError("metric_rejected");
  return {
    at: new Date(now).toISOString(),
    eventId: createHash("sha256").update(`${kind}\0${now}\0${extra.recordId || ""}\0${Math.random()}`).digest("hex").slice(0, 24),
    kind,
    recordId: extra.recordId || null,
    schema: METRIC_SCHEMA,
    taskRef: extra.taskRef || null,
  };
}

function fold(records, { now }) {
  const revoked = new Set(records.filter((row) => row.action === "revoke").map((row) => row.targetId));
  const items = records.filter((row) => row.action !== "revoke" && row.schema);
  return items.map((row) => ({
    ...row,
    revoked: revoked.has(row.recordId) || revoked.has(row.shareId) || row.revoked === true,
    stale: typeof row.expiresAt === "string" && Date.parse(row.expiresAt) <= now,
  }));
}

function latestPrivate(rows, taskRef, operationId) {
  const matches = rows.filter((row) => row.schema === PRIVATE_SCHEMA && row.taskRef === taskRef && row.operationId === operationId);
  return matches.length ? matches[matches.length - 1] : null;
}

export function createUsefulResultReuse({
  dataDir,
  internalToken,
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  store = createReuseStore({ dataDir }),
} = {}) {
  const writer = createForwardOutcomeWriter({ dataDir, internalToken });

  async function privateRows() {
    return fold(await store.read(PRIVATE_FILE), { now: now() });
  }

  async function sharedRows() {
    return fold(await store.read(SHARED_FILE), { now: now() });
  }

  function publicShare(row) {
    return {
      attribution: "Copyright (c) 2026 SameDayDesk",
      computedDigest: row.computedDigest,
      correctionScope: row.correctionOf,
      evidenceClass: "supplied_observation",
      license: "MIT",
      method: row.method,
      operationId: row.operationId,
      outcomeSchema: row.outcomeSchema,
      outcomeSchemaVersion: row.outcomeSchemaVersion,
      qualification: row.qualification,
      route: row.route,
      schema: SHARED_SCHEMA,
      shareId: row.shareId,
      source: "merchant-outcome-binding",
      sourceSha: row.sourceSha,
      taskDigest: row.taskDigest,
      taskRef: row.taskRef,
      useful: row.useful,
      derived: row.derived,
    };
  }

  async function remember(kind, extra) {
    const clock = now();
    await store.append(METRIC_FILE, metricEvent(kind, clock, extra));
  }

  const customer = createCustomerRetention({
    customerStore: createReuseStore({ dataDir, maxRecordBytes: CUSTOMER_MAX_RECORD_BYTES }),
    internalToken,
    now,
    remember,
    sharedStore: store,
    ttlMs,
    writer,
  });

  return Object.freeze({
    async bind(input) {
      const clock = now();
      const qualified = qualifyBinding({
        ...input,
        token: internalToken,
        now: clock,
        expiresAt: clock + ttlMs,
      });
      const appended = await writer.appendTaskRef(qualified.taskRefRecord);
      if (!appended?.accepted) {
        return { accepted: false, reason: appended?.reason || "task_ref_rejected", wrote: false };
      }
      const record = {
        action: "retain",
        assertedDigest: qualified.assertedDigest,
        assertedDigestMatches: qualified.assertedDigestMatches,
        classification: qualified.classification,
        cohort: qualified.cohort,
        computedDigest: qualified.computedDigest,
        correctionOf: qualified.correctionOf,
        createdAt: new Date(clock).toISOString(),
        derived: qualified.derived,
        eventDigest: createHash("sha256").update(JSON.stringify(qualified.joinEvent)).digest("hex"),
        expiresAt: new Date(clock + ttlMs).toISOString(),
        joinEvent: qualified.joinEvent,
        method: qualified.method,
        operationId: qualified.operationId,
        outcomeSchema: qualified.outcomeSchema,
        outcomeSchemaVersion: qualified.outcomeSchemaVersion,
        evidenceClass: "supplied_observation",
        qualification: qualified.qualification,
        recordId: qualified.recordId,
        route: qualified.route,
        schema: PRIVATE_SCHEMA,
        sourceSha: qualified.sourceSha,
        taskDigest: qualified.taskDigest,
        taskRef: qualified.taskRef,
        useful: qualified.useful,
      };
      await store.append(PRIVATE_FILE, record);
      await remember("useful_result_received", { recordId: record.recordId, taskRef: record.taskRef });
      await remember("supplied_observation", { recordId: record.recordId, taskRef: record.taskRef });
      if (qualified.correctionOf) await remember("corrected_reuse", { recordId: record.recordId, taskRef: record.taskRef });
      if (qualified.qualification === "useful" && qualified.useful === "true") {
        await remember("valid_delivery", { recordId: record.recordId, taskRef: record.taskRef });
      }
      return {
        accepted: true,
        assertedDigestMatches: qualified.assertedDigestMatches,
        assertedSuccessIgnored: qualified.assertedSuccessIgnored,
        classification: qualified.classification,
        computedDigest: qualified.computedDigest,
        evidenceClass: "supplied_observation",
        independentUse: false,
        qualification: qualified.qualification,
        recordId: qualified.recordId,
        taskRef: qualified.taskRef,
        useful: qualified.useful,
        wrote: true,
      };
    },

    async retrieve({ taskLabel, operationId, classification, suppliedToken }) {
      const { claim } = claimFor({ token: internalToken, suppliedToken, taskLabel, operationId, classification });
      const rows = await privateRows();
      const row = latestPrivate(rows, claim.taskRef, operationId);
      if (!row) return { found: false, reason: "not_found" };
      const integrityMaterial = row.evidenceClass === "server_executed_output" ? row.projection : row.joinEvent;
      const integrity = createHash("sha256").update(JSON.stringify(integrityMaterial)).digest("hex");
      if (integrity !== row.eventDigest) return { found: false, reason: "record_integrity", usable: false };
      if (row.revoked) {
        return {
          found: true,
          useful: "unknown",
          usable: false,
          reason: "revoked",
          qualification: "revoked",
          derived: null,
          evidenceClass: row.evidenceClass || "supplied_observation",
          independentUse: 0,
          executionSaved: false,
          currentAuthority: false,
          paymentPermitted: false,
        };
      }
      if (row.evidenceClass === "server_executed_output") {
        return {
          found: true,
          useful: "unknown",
          usable: false,
          reason: "server_executed_not_supplied_delivery",
          qualification: row.qualification,
          derived: null,
          evidenceClass: "server_executed_output",
          recordId: row.recordId,
          taskRef: row.taskRef,
          independentUse: 0,
          executionSaved: false,
          currentAuthority: false,
          paymentPermitted: false,
          recomputed: false,
        };
      }
      const clock = now();
      const readout = recompute(row.joinEvent, {
        asOf: new Date(clock).toISOString(),
        boundSourceSha: row.sourceSha,
        boundTaskDigest: row.taskDigest,
        sourceSha: row.sourceSha,
        staleAfter: row.expiresAt,
        taskDigest: row.taskDigest,
        taskRef: row.taskRef,
      });
      const task = readout.tasks.find((item) => item.taskRef === row.taskRef);
      const useful = task?.useful || "unknown";
      if (row.stale || task?.decisionCurrent !== true) {
        return {
          found: true,
          useful,
          usable: false,
          reason: row.stale ? "stale" : "not_current",
          qualification: row.qualification,
          derived: row.derived,
          recordId: row.recordId,
          taskRef: row.taskRef,
          independentUse: 0,
          executionSaved: false,
          currentAuthority: false,
          missingJoinReasons: task?.missingJoinReasons || [],
        };
      }
      await remember("scoped_reuse", { recordId: row.recordId, taskRef: row.taskRef });
      return {
        found: true,
        useful,
        usable: row.qualification === "useful" && useful === "true",
        reason: null,
        qualification: row.qualification,
        derived: row.derived,
        recordId: row.recordId,
        taskRef: row.taskRef,
        operationId: row.operationId,
        method: row.method,
        route: row.route,
        outcomeSchema: row.outcomeSchema,
        outcomeSchemaVersion: row.outcomeSchemaVersion,
        classification: row.classification,
        assertedDigestMatches: row.assertedDigestMatches,
        evidenceClass: "supplied_observation",
        independentUse: 0,
        callerClaimIndependent: row.classification === "independent",
        executionSaved: false,
        currentAuthority: false,
        recomputed: true,
      };
    },

    async share({ taskLabel, operationId, classification, suppliedToken }) {
      const retrieved = await this.retrieve({ taskLabel, operationId, classification, suppliedToken });
      if (!retrieved.found || retrieved.reason) {
        return { accepted: false, reason: retrieved.reason || "not_found" };
      }
      const rows = await privateRows();
      const { claim } = claimFor({ token: internalToken, suppliedToken, taskLabel, operationId, classification });
      const row = latestPrivate(rows, claim.taskRef, operationId);
      const shareId = `s${createHash("sha256").update(`${row.recordId}\0share`).digest("hex").slice(0, 32)}`;
      const shared = {
        ...publicShare({ ...row, shareId }),
        action: "share",
        createdAt: new Date(now()).toISOString(),
        expiresAt: row.expiresAt,
        joinEvent: row.joinEvent,
        recordId: row.recordId,
        shareId,
      };
      await store.append(SHARED_FILE, shared);
      return { accepted: true, share: publicShare(shared) };
    },

    async revoke({ taskLabel, operationId, classification, suppliedToken, share = false }) {
      const { claim } = claimFor({ token: internalToken, suppliedToken, taskLabel, operationId, classification });
      const rows = await privateRows();
      const row = latestPrivate(rows, claim.taskRef, operationId);
      if (!row) return { accepted: false, reason: "not_found" };
      await store.append(PRIVATE_FILE, {
        action: "revoke",
        schema: PRIVATE_SCHEMA,
        targetId: row.recordId,
        taskRef: row.taskRef,
        at: new Date(now()).toISOString(),
      });
      if (share) {
        const shares = await sharedRows();
        const match = [...shares].reverse().find((item) => item.recordId === row.recordId);
        if (match) {
          await store.append(SHARED_FILE, {
            action: "revoke",
            schema: SHARED_SCHEMA,
            targetId: match.shareId,
            at: new Date(now()).toISOString(),
          });
        }
      }
      return { accepted: true, reason: "revoked" };
    },

    async consume({ shareId, taskLabel, operationId, classification, method, route, outcomeSchema, outcomeSchemaVersion, sourceSha, suppliedToken }) {
      const shares = await sharedRows();
      const share = [...shares].reverse().find((item) => item.shareId === shareId && item.schema === SHARED_SCHEMA);
      if (!share) return refuseConsume("not_found");
      let consumerRef = null;
      try {
        consumerRef = claimFor({
          token: internalToken,
          suppliedToken,
          taskLabel,
          operationId,
          classification,
        }).claim.taskRef;
      } catch (error) {
        return refuseConsume(error.code || "unauthorized");
      }
      if (consumerRef !== share.taskRef) {
        return refuseConsume("different_task", { usefulTransferred: false, taskRef: share.taskRef });
      }
      if (method !== share.method) return refuseConsume("changed_method");
      if (route !== share.route) return refuseConsume("changed_route");
      if (outcomeSchema !== share.outcomeSchema || outcomeSchemaVersion !== share.outcomeSchemaVersion) {
        return refuseConsume("changed_schema");
      }
      const privateLog = await privateRows();
      const corrected = privateLog.some((row) => row.correctionOf === share.recordId && row.schema === PRIVATE_SCHEMA);
      const currentDigest = bindingDigest({ method, operationId, outcomeSchema, outcomeSchemaVersion, route });
      const clock = now();
      const joinEvent = share.joinEvent || privateLog.find((row) => row.recordId === share.recordId)?.joinEvent;
      if (!joinEvent) return refuseConsume("record_integrity");
      let readout;
      try {
        readout = recompute(joinEvent, {
          asOf: new Date(clock).toISOString(),
          boundSourceSha: sourceSha,
          boundTaskDigest: share.taskDigest,
          sourceSha: share.sourceSha,
          staleAfter: share.expiresAt,
          taskDigest: currentDigest,
          taskRef: share.taskRef,
        });
      } catch (error) {
        return refuseConsume(error.code || "join_rejected");
      }
      const task = readout.tasks.find((item) => item.taskRef === share.taskRef);
      const reasons = new Set(task?.missingJoinReasons || []);
      const latest = latestPrivate(privateLog, share.taskRef, share.operationId);
      if (share.revoked || latest?.revoked) return refuseConsume("revoked", { useful: task?.useful || "unknown" });
      if (corrected || reasons.has("corrected")) {
        const replacement = [...privateLog].reverse().find((row) => row.correctionOf === share.recordId);
        return {
          ...refuseConsume("corrected", { useful: task?.useful || "unknown" }),
          correctedQualification: replacement?.qualification || null,
          applyPrior: false,
        };
      }
      if (share.stale || reasons.has("stale_source")) return refuseConsume("stale", { useful: task?.useful || "unknown" });
      if (reasons.has("source_changed") || sourceSha !== share.sourceSha) return refuseConsume("source_changed");
      if (reasons.has("task_changed") || currentDigest !== share.taskDigest) return refuseConsume("task_changed");
      if (task?.decisionCurrent !== true) return refuseConsume("not_current", { missingJoinReasons: [...reasons] });
      if (task?.useful === "false" || share.qualification === "failed" || share.qualification === "not_useful") {
        return {
          ...refuseConsume("useful_negative", { useful: "false" }),
          qualification: share.qualification,
          derived: share.derived,
          retained: true,
        };
      }
      if (share.qualification === "partial" || share.qualification === "unavailable" || task?.useful !== "true") {
        return {
          ...refuseConsume(share.qualification === "unavailable" ? "unavailable" : "partial", { useful: task?.useful || "unknown" }),
          qualification: share.qualification,
          derived: share.derived,
          retained: true,
        };
      }
      return {
        applied: true,
        reason: "current_applicable",
        useful: "true",
        qualification: share.qualification,
        derived: share.derived,
        usefulTransferred: true,
        executionSaved: false,
        currentAuthority: false,
        observationAccepted: true,
        paymentPermitted: false,
        independentUse: 0,
        taskRef: share.taskRef,
      };
    },

    async current({ limit = 20, cursor = null } = {}) {
      const bounded = Number.isInteger(limit) && limit >= 1 && limit <= PAGE_MAX ? limit : null;
      if (!bounded) throw new QualifyError("page_rejected");
      const priv = await privateRows();
      const latestByTask = new Map();
      const correctedIds = new Set();
      for (const row of priv) {
        if (row.schema !== PRIVATE_SCHEMA) continue;
        latestByTask.set(`${row.taskRef}\0${row.operationId}`, row);
        if (typeof row.correctionOf === "string") correctedIds.add(row.correctionOf);
      }
      const sharedLog = await sharedRows();
      const shares = sharedLog
        .filter((row) => row.schema === SHARED_SCHEMA && !row.revoked && !row.stale)
        .filter((row) => latestByTask.get(`${row.taskRef}\0${row.operationId}`)?.revoked !== true)
        .filter((row) => !correctedIds.has(row.recordId))
        .map(publicShare);
      let start = 0;
      if (cursor) {
        const index = shares.findIndex((row) => row.shareId === cursor);
        if (index === -1) throw new QualifyError("page_rejected");
        start = index + 1;
      }
      const page = shares.slice(start, start + bounded);
      const coverage = await this.metrics();
      return {
        schema: CURRENT_SCHEMA,
        productionHosted: false,
        hostedReuseVerified: false,
        customerRetentionHostedVerified: false,
        independentAdoption: "unknown",
        independentRepeat: "unknown",
        coverage: coverage.coverage,
        recognizedRevenueAtomic: "0",
        historicalRevenue: "unknown",
        customerRetention: CUSTOMER_RETENTION_DESCRIPTOR,
        items: page,
        knowledge: listKnowledge(sharedLog),
        compatibility: listCompatibility(sharedLog),
        compatibilityCorrections: listCompatibilityCorrections(sharedLog),
        compatibilityRevocations: listCompatibilityRevocations(sharedLog),
        page: {
          limit: bounded,
          nextCursor: start + bounded < shares.length ? page[page.length - 1]?.shareId || null : null,
        },
      };
    },

    async metrics() {
      const rows = await store.read(METRIC_FILE);
      const counts = Object.fromEntries(METRIC_KINDS.map((kind) => [kind, 0]));
      let earliest = null;
      for (const row of rows) {
        if (row.schema !== METRIC_SCHEMA || !METRIC_KINDS.includes(row.kind)) continue;
        counts[row.kind] += 1;
        const at = Date.parse(row.at || "");
        if (Number.isFinite(at)) earliest = earliest === null ? at : Math.min(earliest, at);
      }
      const clock = now();
      const status = metricCoverageStatus({
        generatedAtMs: clock,
        requestedWindowStartMs: clock - WINDOW_MS,
        retainedObservationStartMs: earliest,
      });
      return {
        schema: METRIC_SCHEMA,
        ...counts,
        independentRepeat: "unknown",
        coverage: status.coverage,
        complete: false,
        recognizedRevenueAtomic: "0",
        historicalRevenue: "unknown",
        fetchIsNotAdoption: true,
        evidenceClass: {
          valid_delivery: "supplied_observation",
          ...Object.fromEntries(EVIDENCE_CLASSES.map((name) => [name, counts[name] || 0])),
          verified_settlement: counts.verified_settlement,
        },
      };
    },

    async noteExposure() {
      await remember("exposure", {});
    },

    async notePaidAttempt(record) {
      if (record?.purchaseAuthorized !== true || record?.paymentSent !== false) return { accepted: false };
      await remember("paid_attempt", {});
      return { accepted: true, paymentSent: false };
    },

    async verifySettlement({ taskLabel, operationId, classification, suppliedToken, capture = null, client = null, receiptFile = null }) {
      const clock = now();
      const { claim, cohort } = claimFor({
        token: internalToken,
        suppliedToken,
        taskLabel,
        operationId,
        classification,
      });
      if (operationId !== RECEIPT_OPERATION) throw new QualifyError("foreign_capability");
      const loaded = capture || (receiptFile ? await readCapture(receiptFile) : null);
      const executionClient = client || (loaded ? clientFromCapture(loaded) : null);
      if (!executionClient) throw new QualifyError("not_execution");
      let executed;
      try {
        executed = await executeClosedSettlement({ client: executionClient, now: () => new Date(clock) });
      } catch (error) {
        throw new QualifyError(error.code || "not_execution");
      }
      const projection = {
        blockNumber: executed.projection.blockNumber,
        decision: executed.projection.decision,
        evidenceDigest: executed.projection.evidenceDigest,
        matchedAtomic: executed.projection.matchedAtomic,
        movementRef: executed.projection.movementRef,
        network: executed.projection.network,
        receiptFound: executed.projection.receiptFound,
        status: executed.projection.status,
        transactionFeeWei: executed.projection.transactionFeeWei,
      };
      const recordId = createHash("sha256")
        .update(`${claim.taskRef}\0${operationId}\0${clock}\0${projection.evidenceDigest}\0settlement`)
        .digest("hex")
        .slice(0, 32);
      const commerceEventId = stableForwardEventId(`${operationId}\0receipt\0${claim.taskRef}\0${recordId}`);
      const taskRefRecord = buildTaskRefRecord({ claim, commerceEventId });
      if (!taskRefRecord) return { accepted: false, reason: "task_ref_rejected", wrote: false, evidenceClass: "server_executed_output" };
      const appended = await writer.appendTaskRef(taskRefRecord);
      if (!appended?.accepted) {
        return { accepted: false, reason: appended?.reason || "task_ref_rejected", wrote: false, evidenceClass: "server_executed_output" };
      }
      const record = {
        action: "retain",
        classification,
        cohort,
        createdAt: new Date(clock).toISOString(),
        evidenceClass: "server_executed_output",
        eventDigest: createHash("sha256").update(JSON.stringify(projection)).digest("hex"),
        expiresAt: new Date(clock + ttlMs).toISOString(),
        method: RECEIPT_METHOD,
        operationId,
        outcomeSchema: RECEIPT_SCHEMA_NAME,
        outcomeSchemaVersion: RECEIPT_SCHEMA_VERSION,
        projection,
        qualification: executed.projection.qualification,
        recordId,
        route: RECEIPT_ROUTE,
        schema: PRIVATE_SCHEMA,
        sourceSha: executionClient.sourceSha || null,
        taskRef: claim.taskRef,
      };
      await store.append(PRIVATE_FILE, record);
      await remember("server_executed_output", { recordId, taskRef: claim.taskRef });
      return {
        accepted: executed.projection.pinMatch === true,
        currentAuthority: false,
        elapsedMs: executed.elapsedMs,
        evidenceClass: "server_executed_output",
        executionSaved: false,
        paymentPermitted: false,
        projection,
        providerCalls: executed.providerCalls,
        qualification: executed.projection.qualification,
        recordId,
        sourceSha: record.sourceSha,
        usefulTransferred: false,
        wrote: true,
      };
    },

    async shareKnowledge({ taskLabel, operationId, classification, suppliedToken }) {
      const { claim } = claimFor({ token: internalToken, suppliedToken, taskLabel, operationId, classification });
      const row = latestPrivate(await privateRows(), claim.taskRef, operationId);
      if (!row || row.evidenceClass !== "server_executed_output") return { accepted: false, reason: "not_found" };
      if (row.revoked) return { accepted: false, reason: "revoked" };
      if (row.stale) return { accepted: false, reason: "expired_scope" };
      if (row.qualification !== "pin_match" || !row.sourceSha) return { accepted: false, reason: "pin_mismatch" };
      const shareId = `k${createHash("sha256").update(`${row.recordId}\0knowledge`).digest("hex").slice(0, 32)}`;
      const view = knowledgeView({
        corrects: null,
        evidence: row.projection,
        expiresAt: row.expiresAt,
        schema: KNOWLEDGE_SCHEMA,
        shareId,
        sourceSha: row.sourceSha,
      });
      if (!view) return { accepted: false, reason: "restricted_field" };
      await store.append(SHARED_FILE, {
        ...view,
        action: "share",
        createdAt: new Date(now()).toISOString(),
        recordId: row.recordId,
      });
      return { accepted: true, share: view };
    },

    async correctKnowledge({ taskLabel, operationId, classification, suppliedToken, capture = null, client = null, receiptFile = null }) {
      const clock = now();
      const { claim } = claimFor({ token: internalToken, suppliedToken, taskLabel, operationId, classification });
      const row = latestPrivate(await privateRows(), claim.taskRef, operationId);
      if (!row || row.evidenceClass !== "server_executed_output") return { accepted: false, reason: "not_found", applyPrior: false };
      const loaded = capture || (receiptFile ? await readCapture(receiptFile) : null);
      const executionClient = client || (loaded ? clientFromCapture(loaded) : null);
      if (!executionClient) throw new QualifyError("not_execution");
      let executed;
      try {
        executed = await executeClosedSettlement({ client: executionClient, now: () => new Date(clock) });
      } catch (error) {
        throw new QualifyError(error.code || "not_execution");
      }
      await remember("server_executed_output", { recordId: row.recordId, taskRef: claim.taskRef });
      const shares = (await sharedRows()).filter((item) => item.schema === KNOWLEDGE_SCHEMA && item.recordId === row.recordId && !item.revoked);
      const prior = shares.length ? shares[shares.length - 1] : null;
      if (!executed.projection.pinMatch || executionClient.sourceSha !== row.sourceSha) {
        return {
          accepted: false,
          applyPrior: false,
          evidenceClass: "server_executed_output",
          paymentPermitted: false,
          reason: executed.projection.pinMatch ? "source_changed" : "pin_mismatch",
        };
      }
      const shareId = `k${createHash("sha256").update(`${row.recordId}\0knowledge\0${prior?.shareId || ""}\0${clock}`).digest("hex").slice(0, 32)}`;
      const view = knowledgeView({
        corrects: prior?.shareId || null,
        evidence: {
          blockNumber: executed.projection.blockNumber,
          decision: executed.projection.decision,
          evidenceDigest: executed.projection.evidenceDigest,
          matchedAtomic: executed.projection.matchedAtomic,
          movementRef: executed.projection.movementRef,
          network: executed.projection.network,
          receiptFound: executed.projection.receiptFound,
          status: executed.projection.status,
          transactionFeeWei: executed.projection.transactionFeeWei,
        },
        expiresAt: row.expiresAt,
        schema: KNOWLEDGE_SCHEMA,
        shareId,
        sourceSha: executionClient.sourceSha,
      });
      if (!view) return { accepted: false, applyPrior: false, reason: "restricted_field" };
      await store.append(SHARED_FILE, {
        ...view,
        action: "share",
        createdAt: new Date(clock).toISOString(),
        recordId: row.recordId,
      });
      await remember("corrected_reuse", { recordId: row.recordId, taskRef: claim.taskRef });
      return { accepted: true, applyPrior: false, corrects: prior?.shareId || null, share: view };
    },

    async replayKnowledge({ derivative, client = null, capture = null, receiptFile = null, correction = null, method, route, outcomeSchema, outcomeSchemaVersion, at = null }) {
      const loaded = capture || (receiptFile ? await readCapture(receiptFile) : null);
      const executionClient = client || (loaded ? clientFromCapture(loaded) : null);
      const result = await receiveKnowledge({
        derivative,
        client: executionClient,
        correction,
        method,
        route,
        outcomeSchema,
        outcomeSchemaVersion,
        now: at || now(),
      });
      if (result.knowledgeApplied === true && result.evidenceClass === "independently_replayed_utility") {
        await remember("independently_replayed_utility", { recordId: derivative?.shareId || null });
      }
      return result;
    },

    async revokeKnowledge({ taskLabel, operationId, classification, suppliedToken }) {
      const { claim } = claimFor({ token: internalToken, suppliedToken, taskLabel, operationId, classification });
      const row = latestPrivate(await privateRows(), claim.taskRef, operationId);
      if (!row) return { accepted: false, reason: "not_found" };
      const shares = (await sharedRows()).filter((item) => item.schema === KNOWLEDGE_SCHEMA && item.recordId === row.recordId && !item.revoked);
      const latest = shares.length ? shares[shares.length - 1] : null;
      if (!latest) return { accepted: false, reason: "not_found" };
      await store.append(SHARED_FILE, {
        action: "revoke",
        schema: KNOWLEDGE_SCHEMA,
        targetId: latest.shareId,
        at: new Date(now()).toISOString(),
      });
      return { accepted: true, reason: "revoked" };
    },

    nextPaid(requirement, options = {}) {
      return selectExistingPaidOperation(requirement, options);
    },

    retainDeliveredReceipt: customer.retainDeliveredReceipt,
    readDeliveredReceipt: customer.readDeliveredReceipt,
    revokeDeliveredReceipt: customer.revokeDeliveredReceipt,
    shareDeliveredKnowledge: customer.shareDeliveredKnowledge,
    correctDeliveredKnowledge: customer.correctDeliveredKnowledge,
    consumeDeliveredKnowledge: customer.consumeDeliveredKnowledge,
  });
}

function listKnowledge(rows) {
  const corrected = new Set(
    rows
      .filter((row) => row.schema === KNOWLEDGE_SCHEMA && typeof row.corrects === "string" && row.corrects)
      .map((row) => row.corrects),
  );
  return rows
    .filter((row) => row.schema === KNOWLEDGE_SCHEMA && !row.revoked && !row.stale && !corrected.has(row.shareId))
    .map((row) => knowledgeView(row))
    .filter(Boolean);
}

function refuseConsume(reason, extra = {}) {
  return {
    applied: false,
    reason,
    usefulTransferred: false,
    executionSaved: false,
    currentAuthority: false,
    observationAccepted: false,
    paymentPermitted: false,
    independentUse: 0,
    ...extra,
  };
}

function receiptAlreadySatisfies(body) {
  if (!plain(body)) return false;
  if (body.product !== "samedaydesk-transaction-receipt") return false;
  if (!["found", "not_found", "rpc_unavailable"].includes(body.decision)) return false;
  return plain(body.transaction) && typeof body.transaction.status === "string";
}

function standardChallenge(body) {
  if (!plain(body)) return false;
  const fields = new Set(Object.keys(body));
  return body.x402Version === 2 && fields.has("accepts") && PROTOCOL_ABSENT_FIELDS.every((name) => !fields.has(name));
}

export function selectExistingPaidOperation(requirement, { authorization = null, offer = null, now = Date.now() } = {}) {
  if (!plain(requirement) || typeof requirement.name !== "string") throw new QualifyError("requirement_rejected");
  if (hasDisallowedKey(requirement)) throw new QualifyError("restricted_field");
  const baseline = plain(requirement.freeBaseline) ? requirement.freeBaseline : null;
  if (!baseline) {
    return paidDecision({
      freeSufficient: false,
      offeredOperation: null,
      reason: "free_baseline_missing",
    });
  }
  if (hasDisallowedKey(baseline)) throw new QualifyError("restricted_field");
  const download = baseline.kind === "download" || baseline.method === "HEAD" || baseline.download === true;
  if (download && (baseline.httpStatus === 200 || baseline.httpStatus === 204)) {
    return paidDecision({
      freeSufficient: true,
      offeredOperation: null,
      reason: "download_is_not_a_purchase",
    });
  }
  if (baseline.kind === "asserted_digest" || requirement.name === "asserted_digest") {
    return paidDecision({
      freeSufficient: false,
      offeredOperation: null,
      reason: "digest_is_not_delivery",
      purchaseReason: "digest_is_not_delivery",
    });
  }
  if (requirement.name === "protocol_challenge_fields" || (baseline.kind === "payment_required" && standardChallenge(baseline.body))) {
    if (requirement.name !== "normalized_transaction_receipt" && requirement.name !== "seller_contract_decision") {
      return paidDecision({
        freeSufficient: true,
        offeredOperation: null,
        reason: "application_fields_absent_by_design",
        absentFields: [...PROTOCOL_ABSENT_FIELDS],
      });
    }
  }
  if (requirement.name === "seller_contract_decision") {
    if (baseline.kind === "payment_required" || standardChallenge(baseline.body)) {
      return paidDecision({
        freeSufficient: true,
        offeredOperation: null,
        reason: "challenge_fields_are_not_an_audit_gap",
      });
    }
    const report = baseline.report;
    if (!plain(report)) {
      return paidDecision({ freeSufficient: false, offeredOperation: null, reason: "free_baseline_missing" });
    }
    const assessed = assessFreeDiagnosis(report);
    if (!assessed.eligible || !assessed.offeredOperation) {
      return paidDecision({
        freeSufficient: true,
        offeredOperation: null,
        reason: assessed.reason || "free_result_sufficient",
      });
    }
    return finishPaid(EXISTING_PAID_OPERATIONS.seller_contract_decision, "seller_contract_unresolved", authorization, offer, now);
  }
  if (requirement.name === "normalized_transaction_receipt") {
    const reference = typeof baseline.txReference === "string" ? baseline.txReference.toLowerCase() : "";
    if (reference === CLOSED_SPONSORED_REF) {
      return paidDecision({
        freeSufficient: true,
        offeredOperation: null,
        reason: "closed_sponsored_reference",
      });
    }
    if (receiptAlreadySatisfies(baseline.body) || baseline.hasNormalizedReceipt === true) {
      return paidDecision({
        freeSufficient: true,
        offeredOperation: null,
        reason: "free_result_sufficient",
      });
    }
    if (!TX.test(reference)) {
      return paidDecision({
        freeSufficient: false,
        offeredOperation: null,
        reason: "transaction_reference_absent",
      });
    }
    return finishPaid(EXISTING_PAID_OPERATIONS.normalized_transaction_receipt, "normalized_receipt_unmet", authorization, offer, now);
  }
  return paidDecision({
    freeSufficient: false,
    offeredOperation: null,
    reason: "no_existing_operation_meets_requirement",
  });
}

function finishPaid(operation, reason, authorization, offer, now) {
  let purchase = { ok: false, reason: "authorization_required" };
  if (authorization && offer) purchase = authorizePurchase({ authorization, offer, now });
  return paidDecision({
    freeSufficient: false,
    offeredOperation: {
      method: operation.method,
      route: operation.route,
      product: operation.product,
      documentedFields: [...operation.documentedFields],
      priceAuthority: operation.priceAuthority,
      priceCopied: false,
    },
    reason,
    purchaseAuthorized: purchase.ok === true,
    purchaseReason: purchase.reason,
  });
}

function paidDecision(fields) {
  return {
    schema: "samedaydesk.useful-result-reuse.paid-next.v1",
    freeSufficient: fields.freeSufficient === true,
    offeredOperation: fields.offeredOperation || null,
    reason: fields.reason,
    absentFields: fields.absentFields || null,
    purchaseAuthorized: fields.purchaseAuthorized === true,
    purchaseReason: fields.purchaseReason || (fields.offeredOperation ? "authorization_required" : fields.reason),
    paymentSent: false,
    requestConstructed: false,
    replayBoundary: "idempotency-replay",
    revenueRecognized: false,
    newSku: false,
  };
}

export async function rejectSeededFixture(file) {
  const raw = JSON.parse(await readFile(file, "utf8"));
  const refusals = [];
  const token = "seed-token-not-a-secret-value-0123456789abcdef";
  try {
    qualifyBinding({
      token,
      taskLabel: raw.task,
      operationId: raw.operationId,
      method: raw.method,
      route: raw.route,
      outcomeSchema: raw.outcomeSchema,
      outcomeSchemaVersion: raw.outcomeSchemaVersion,
      classification: raw.classification,
      outcome: raw.outcome,
      assertedDigest: raw.assertedDigest || null,
      now: Date.parse("2026-10-01T00:00:00.000Z"),
      expiresAt: Date.parse("2026-10-08T00:00:00.000Z"),
    });
    return { refused: false, reason: "seeded_claim_accepted" };
  } catch (error) {
    refusals.push(error.code || "rejected");
  }
  if (raw.digestOnly) {
    try {
      const qualified = qualifyBinding({
        token,
        taskLabel: raw.task,
        operationId: raw.operationId,
        method: raw.method,
        route: raw.route,
        outcomeSchema: raw.outcomeSchema,
        outcomeSchemaVersion: raw.outcomeSchemaVersion,
        classification: raw.classification,
        outcome: null,
        assertedDigest: raw.assertedDigest,
        now: Date.parse("2026-10-01T00:00:00.000Z"),
        expiresAt: Date.parse("2026-10-08T00:00:00.000Z"),
      });
      if (qualified.qualification === "useful" || qualified.useful === "true") {
        return { refused: false, reason: "digest_became_delivery" };
      }
      refusals.push("digest_not_delivery");
    } catch (error) {
      refusals.push(error.code || "rejected");
    }
  }
  return { refused: refusals.length > 0, reasons: refusals };
}

export { SOURCE_ID };
