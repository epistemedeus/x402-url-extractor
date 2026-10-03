import { journalProducer } from "../../../../commerce-journal-admission.mjs";
import { timingSafeEqual } from "node:crypto";
import { readPersistedAttempt } from "./read.mjs";
import { authorizeOutcomeBinding, openCausalCommerceEvent } from "../../../../commerce-outcome-binding.mjs";
import { requestIdentityFor } from "../../../../useful-result-reuse/customer-grant.mjs";
import { handleUsefulResultReuse } from "../../../../useful-result-reuse/http.mjs";
import { CUSTOMER_MAX_RECORD_BYTES } from "../../../../useful-result-reuse/constants.mjs";
import { createReuseStore } from "../../../../useful-result-reuse/store.mjs";
import { createFreeTaskObservation } from "../../free-task-observation-100421/src/integration.mjs";
import {
  exposeAuthorizedCausalProof,
  handleFreeTaskObservation,
} from "../../free-task-observation-100421/src/http-integration.mjs";
import { createJournalCapture, readBoundedCut } from "./cut.mjs";

const ALLOWED = Object.freeze([
  "app",
  "customerStore",
  "dataDir",
  "internalToken",
  "replayReceipt",
  "telemetry",
  "settlement",
]);

function idle(dataDir, internalToken, reason) {
  return {
    enrolled: false,
    reason,
    dataDir: typeof dataDir === "string" ? dataDir : "",
    internalToken: typeof internalToken === "string" ? internalToken : "",
    customerStore: undefined,
    freeTaskObservation: undefined,
  };
}

export function merchant161ObservationMount(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return idle("", "", "input_rejected");
  if (Object.keys(options).some((key) => !ALLOWED.includes(key))) return idle(options.dataDir, options.internalToken, "unsupported_authority_field");
  const { app, telemetry, dataDir, internalToken, customerStore = null, replayReceipt = null, settlement = null } = options;
  if (typeof dataDir !== "string" || dataDir.length === 0 || dataDir.includes("://")) {
    return idle(dataDir, internalToken, "persistence_refused");
  }
  if (typeof internalToken !== "string" || Buffer.byteLength(internalToken) < 32) {
    return idle(dataDir, internalToken, "existing_token_required");
  }
  if (!journalProducer(telemetry) || typeof telemetry?.causalCommerceEventProof !== "function" || typeof app?.use !== "function") {
    return idle(dataDir, internalToken, "existing_ports_required");
  }
  if (replayReceipt != null && typeof replayReceipt !== "function") return idle(dataDir, internalToken, "replay_port_rejected");
  const store = customerStore || createReuseStore({ dataDir, maxRecordBytes: CUSTOMER_MAX_RECORD_BYTES });
  if (typeof store?.mutate !== "function" || typeof store?.read !== "function") {
    return idle(dataDir, internalToken, "existing_store_required");
  }
  app.use((req, res, next) => {
    try {
      exposeAuthorizedCausalProof(req, res, { telemetry, internalToken, authorizeOutcomeBinding });
    } catch {
      // A missed proof header does not authorize payment or another route.
    }
    next();
  });
  const capture = createJournalCapture({ app, telemetry, dataDir, internalToken, settlement });
  const freeTaskObservation = (service) => {
    const bridge = createFreeTaskObservation({
      internalToken,
      writerProcessCount: 1,
      customerStore: store,
      customer: service,
      readCut: async () => {
        return capture.capture();
      },
      authorizeOutcomeBinding,
      openCausalCommerceEvent,
      requestIdentityFor,
      ...(replayReceipt ? { replayReceipt } : {}),
    });
    return (req, res) => {
      if (req.path === "/.well-known/useful-result-reuse/current.json"
        && (req.method === "GET" && req.headers["x-samedaydesk-result-action"] === "read-attempt-cut"
          || req.method === "POST" && req.headers["x-samedaydesk-result-action"] === "start-attempt-capture")) {
        const supplied = req.headers["x-samedaydesk-internal"];
        const tokenOk = typeof supplied === "string" && Buffer.byteLength(supplied) === Buffer.byteLength(internalToken)
          && timingSafeEqual(Buffer.from(supplied), Buffer.from(internalToken));
        res.set("Cache-Control", "no-store");
        if (!tokenOk) { res.status(403).json({ error: "unauthorized" }); return true; }
        const url = new URL(req.originalUrl, "http://127.0.0.1");
        if ([...url.searchParams.keys()].some(k => k !== "cutId")) { res.status(400).json({ error: "query_rejected" }); return true; }
        if (req.method === "POST") {
          if (Object.keys(req.body || {}).length || url.searchParams.size) { res.status(400).json({ error: "input_rejected" }); return true; }
          void (async () => {
            await capture.begin();
            const cut = await capture.capture();
            res.json({ schema: "samedaydesk.useful-result-reuse.current.v1", captureStarted: true,
              cutId: cut.cutId, window: cut.window, planeCoverage: cut.planes, paymentPermitted: false });
          })().catch(e => res.status(503).json({ error: e.code || "capture_unavailable" }));
          return true;
        }
        const taskRef = req.headers["x-samedaydesk-outcome-task-ref"];
        if (!/^t[a-f0-9]{62}$/.test(taskRef || "")) { res.status(400).json({ error: "task_rejected" }); return true; }
        void (async () => {
          const cutId = url.searchParams.get("cutId");
          if (cutId && !/^[a-f0-9-]{36}$/.test(cutId)) { res.status(400).json({ error: "cut_rejected" }); return; }
          const cut = cutId ? await readBoundedCut(dataDir, { internalToken, cutId }) : await capture.capture();
          const report = await readPersistedAttempt({ dataDir, taskRef, internalToken, cut, commerceEventId: req.headers["x-samedaydesk-causal-attempt"] || null });
          res.json(report);
        })().catch(e => res.status(503).json({ error: e.code || "cut_unavailable" }));
        return true;
      }
      return handleFreeTaskObservation(req, res, {
      bridge,
      service,
      handleUsefulResultReuse,
    });
    };
  };
  return {
    enrolled: true,
    reason: null,
    dataDir,
    internalToken,
    customerStore: store,
    freeTaskObservation,
    capture,
  };
}

export async function reconcilePersistedAttempt({ dataDir, internalToken, request } = {}) {
  if (!request || typeof request !== "object") {
    return { accepted: false, reason: "input_rejected", grantReturned: false, physicalRows: 0, automaticMutationRetries: 0, paymentPermitted: false, recognizedRevenueAtomic: "unknown" };
  }
  const customerStore = createReuseStore({ dataDir, maxRecordBytes: CUSTOMER_MAX_RECORD_BYTES });
  const customer = {
    async readDeliveredReceipt() {
      return { found: false, reason: "not_used", result: null };
    },
    async revokeDeliveredReceipt() {
      return { accepted: false, reason: "not_used" };
    },
  };
  const bridge = createFreeTaskObservation({
    internalToken,
    writerProcessCount: 1,
    customerStore,
    customer,
    readCut: () => readBoundedCut(dataDir, { internalToken }),
    authorizeOutcomeBinding,
    openCausalCommerceEvent,
    requestIdentityFor,
  });
  const result = await bridge.reconcile({ ...request, suppliedToken: internalToken });
  const physicalRows = (await customerStore.read("useful-result-customer.ndjson")).filter((row) => row?.action === "retain" && row.commerceEventId === request.commerceEventId).length;
  return {
    accepted: result.accepted === true,
    reason: result.reason,
    grantReturned: result.grant != null,
    physicalRows,
    automaticMutationRetries: 0,
    paymentPermitted: false,
    recognizedRevenueAtomic: "unknown",
  };
}
