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
import { readBoundedCut } from "./cut.mjs";

const ALLOWED = Object.freeze([
  "app",
  "customerStore",
  "dataDir",
  "internalToken",
  "replayReceipt",
  "telemetry",
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
  const { app, telemetry, dataDir, internalToken, customerStore = null, replayReceipt = null } = options;
  if (typeof dataDir !== "string" || dataDir.length === 0 || dataDir.includes("://")) {
    return idle(dataDir, internalToken, "persistence_refused");
  }
  if (typeof internalToken !== "string" || Buffer.byteLength(internalToken) < 32) {
    return idle(dataDir, internalToken, "existing_token_required");
  }
  if (typeof telemetry?.causalCommerceEventProof !== "function" || typeof app?.use !== "function") {
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
  const freeTaskObservation = (service) => {
    const bridge = createFreeTaskObservation({
      internalToken,
      writerProcessCount: 1,
      customerStore: store,
      customer: service,
      readCut: async () => {
        if (typeof telemetry.flush === "function") await telemetry.flush();
        return readBoundedCut(dataDir);
      },
      authorizeOutcomeBinding,
      openCausalCommerceEvent,
      requestIdentityFor,
      ...(replayReceipt ? { replayReceipt } : {}),
    });
    return (req, res) => handleFreeTaskObservation(req, res, {
      bridge,
      service,
      handleUsefulResultReuse,
    });
  };
  return {
    enrolled: true,
    reason: null,
    dataDir,
    internalToken,
    customerStore: store,
    freeTaskObservation,
  };
}

export async function reconcilePersistedAttempt({ dataDir, internalToken, request } = {}) {
  if (!request || typeof request !== "object") {
    return { accepted: false, reason: "input_rejected", grantReturned: false, physicalRows: 0, automaticMutationRetries: 0, paymentPermitted: false, recognizedRevenueAtomic: "0" };
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
    readCut: () => readBoundedCut(dataDir),
    authorizeOutcomeBinding,
    openCausalCommerceEvent,
    requestIdentityFor,
  });
  const result = await bridge.reconcile({ ...request, suppliedToken: internalToken });
  const cut = await readBoundedCut(dataDir);
  const physicalRows = cut.retention.filter((row) => row?.action === "retain" && row.commerceEventId === request.commerceEventId).length;
  return {
    accepted: result.accepted === true,
    reason: result.reason,
    grantReturned: result.grant != null,
    physicalRows,
    automaticMutationRetries: 0,
    paymentPermitted: false,
    recognizedRevenueAtomic: "0",
  };
}
