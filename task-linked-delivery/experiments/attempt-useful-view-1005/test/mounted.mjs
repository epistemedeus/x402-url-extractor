import assert from "node:assert/strict";
import { createHash } from 'node:crypto';
import express from "express";
import { createCommerceTelemetry } from "../../../../commerce-events.mjs";
import { createCommerceSettlementReconciler } from "../../../../commerce-settlement-reconciler.mjs";
import { registerCommerceRuntime } from "../../../../commerce-journal-admission.mjs";
import { CUSTOMER_MAX_RECORD_BYTES } from "../../../../useful-result-reuse/constants.mjs";
import { mountUsefulResultReuse } from "../../../../useful-result-reuse/http.mjs";
import { createReuseStore } from "../../../../useful-result-reuse/store.mjs";
import { transactionReceipt } from "../../../../transaction-receipt.mjs";
import { fixtureClient } from "../../free-task-observation-100421/test/receipt-fixtures.mjs";
import { nodePort, TOKEN } from "../../free-task-observation-100421/test/native-ports.mjs";
import { merchant161ObservationMount } from "../src/enroll.mjs";
import { installPaidReceiptRetention, noteReceiptRetention } from "../../../../useful-result-reuse/delivery.mjs";
const SECRET = "synthetic-free-observation-actor-secret-100421";
export async function boot(dataDir, { fault = null, maxBytes, storeMaxBytes, settlementEnabled = false, settlementClient = null, paid = false, runtime = null, replay = true, metricFault = null } = {}) {
  const telemetry = createCommerceTelemetry({
    dataDir,
    maxBytes,
    internalToken: TOKEN,
    secret: SECRET,
    writerProcessCount: 1,
  });
  const physical = createReuseStore({ dataDir, maxFileBytes: storeMaxBytes, maxRecordBytes: CUSTOMER_MAX_RECORD_BYTES });
  let injected = false;
  const customerStore = fault === "lost_ack"
    ? {
      ...physical,
      async mutate(name, work) {
        let lose = false;
        const result = await physical.mutate(name, async (rows) => {
          const outcome = await work(rows);
          if (outcome?.append?.evidenceClass === "free_observed_delivery" && !injected) {
            injected = true;
            lose = true;
          }
          return outcome;
        });
        if (lose) throw new Error("isolated lost acknowledgement");
        return result;
      },
    }
    : physical;
  const app = express();
  app.use(telemetry.middleware);
  app.use(express.json({ limit: "24kb" }));
  if (runtime) registerCommerceRuntime(app, runtime);
  const settlement = settlementEnabled ? createCommerceSettlementReconciler({
    dataDir, actorSecret: SECRET, settlementEvidenceSince: new Date().toISOString(),
    treasury: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
    client: settlementClient || { getTransactionReceipt() { throw new Error("No payment RPC authorized in this test"); } },
  }) : null;
  const mounted = merchant161ObservationMount({
    app,
    telemetry,
    settlement,
    dataDir,
    internalToken: TOKEN,
    customerStore,
    ...(replay ? { replayReceipt: (input) => nodePort("receipt-replay.mjs", input) } : {}),
  });
  assert.equal(mounted.enrolled, true, mounted.reason);
  await mounted.capture.ready;
  const metricStore = createReuseStore({ dataDir });
  let lostRead = false;
  const serviceStore = metricFault === "lost_read_ack" ? { ...metricStore,
    async append(name, row) {
      await metricStore.append(name, row);
      if (row.kind === "useful_later_read" && !lostRead) { lostRead = true; throw new Error("isolated read acknowledgement lost"); }
    },
  } : metricStore;
  const reuse = mountUsefulResultReuse(app, {
    dataDir,
    internalToken: TOKEN,
    customerStore: mounted.customerStore,
    store: serviceStore,
    freeTaskObservation: mounted.freeTaskObservation,
  });
  if (paid) installPaidReceiptRetention(app, () => reuse.service.retainDeliveredReceipt.bind(reuse.service), {
    causalEventProof: res => telemetry.causalCommerceEventProof(res),
    causalTaskBinding: res => telemetry.causalCommerceTaskBinding(res),
  });
  app.get("/chain/transaction-receipt", async (req, res) => {
    const hash = req.query.transactionHash;
    const body = await transactionReceipt(
      { network: req.query.network, transactionHash: hash },
      { client: fixtureClient(hash) },
    );
    if (paid) {
      // Isolated rail fixture only: no signer, facilitator or provider is called.
      res.locals.samedaydeskPayment = { protocol: 'x402' };
      const paymentReference = '0x' + createHash('sha256').update('isolated-rail:' + hash).digest('hex');
      res.set('payment-response', Buffer.from(JSON.stringify({ success: true, transaction: paymentReference,
        network: 'eip155:8453', payer: '0x1111111111111111111111111111111111111111', amount: '50000' })).toString('base64'));
      noteReceiptRetention(req, res, body);
    }
    res.json(body);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    telemetry,
    customerStore,
    settlement,
    app,
    capture: mounted.capture,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await telemetry.flush();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
