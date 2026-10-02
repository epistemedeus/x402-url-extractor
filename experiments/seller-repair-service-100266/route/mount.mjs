import express from "express";

import { SellerRepairError } from "../src/errors.mjs";
import { observePaidOutcome } from "../src/handoff.mjs";
import { normalizeMachineRequest } from "../src/machine.mjs";
import { runJourney } from "../src/journey.mjs";

const ROUTE = "/commerce/seller-repair-diagnosis";

function diagnosis(result, extra = {}) {
  const settlement = extra.settlement || null;
  return {
    schema: "samedaydesk.seller-repair-diagnosis.v1",
    charged: false,
    paymentSent: false,
    priceChanged: false,
    skuAdded: false,
    duplicate: extra.duplicate === true,
    probesRepeated: extra.duplicate === true ? 0 : undefined,
    requestId: extra.requestId || null,
    callerId: result?.callerId || null,
    operationId: result?.operationId || null,
    declaredSdk: result?.declaredSdk || null,
    target: result?.target || null,
    taskDigest: result?.taskDigest || null,
    challenge: extra.challenge || null,
    settlement,
    execution: {
      attempted: result?.observation?.liveAdapter === "live",
      failed: result?.observation?.independentlyObserved !== true && result?.classification?.outcome !== "free_sufficient" && result?.classification?.outcome !== "mismatch",
      status: result?.observed?.status ?? null,
      liveAdapter: result?.observation?.liveAdapter || "not_run",
    },
    delivery: {
      valid: settlement?.actualValidDelivery === true,
      source: "paid_audit",
    },
    usefulOutput: {
      matched: result?.classification?.useful === true,
      reason: result?.classification?.reason || extra.reason || null,
      outcome: result?.classification?.outcome || extra.outcome || null,
      http200IsSuccess: false,
    },
    nextAction: result?.classification?.nextAction || extra.nextAction || null,
    repair: result?.repair
      ? {
        useful: result.repair.useful === true,
        reason: result.repair.reason,
        changedOutput: result.repair.changedOutput || null,
        deployedCounterpartyRepair: false,
        counterpartyMutated: false,
      }
      : null,
    paid: {
      connected: result?.paidAudit?.connected === true,
      usefulDelta: result?.paidAudit?.usefulDelta === true,
      gap: result?.paidAudit?.gap || null,
      purchasePerformed: false,
      purchaseRecommended: false,
      priceDisplay: "$0.01",
      priceAtomic: "10000",
      route: "/commerce/seller-integrity-audit",
      answersUsefulOutput: false,
    },
    observation: result?.observation || null,
    coverage: "unknown",
    adaptationMaintenanceCost: "unknown",
    tokens: "unknown",
    recognizedRevenueAtomic: "0",
  };
}

export function createSellerRepairDiagnosis({ store = new Map(), lookupImpl = null, merchantBase = null } = {}) {
  return async function sellerRepairDiagnosis(req, res) {
    res.set("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.status(405);
      return res.json({ charged: false, paymentSent: false, error: "method_not_allowed" });
    }
    try {
      const machine = normalizeMachineRequest(req.body || {});
      if (machine.unsupported) {
        return res.json(diagnosis(null, {
          outcome: "unsupported",
          reason: machine.reason,
          nextAction: "unsupported",
        }));
      }
      if (machine.requestId) {
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(machine.requestId)) {
          res.status(400);
          return res.json({ charged: false, paymentSent: false, error: "requestId is invalid" });
        }
        const prior = store.get(machine.requestId);
        if (prior && prior.digest === machine.digest) {
          return res.json(diagnosis(prior.result, { duplicate: true, requestId: machine.requestId, settlement: prior.settlement }));
        }
        if (prior) {
          res.status(409);
          return res.json({ charged: false, paymentSent: false, duplicate: true, reason: "duplicate_conflict" });
        }
      }
      const result = await runJourney({
        intake: machine.intake,
        baseUrl: machine.intake.origin,
        lookupImpl,
        live: machine.probe ? "auto" : "evidence",
        paidReport: machine.paidReport,
        merchantBase: null,
      });
      let settlement = null;
      if (machine.settlement && typeof machine.settlement === "object") {
        const observed = observePaidOutcome({ ...machine.settlement, intake: { ...machine.intake, resource: machine.intake.resource } });
        settlement = {
          preserved: observed.preserved,
          actualValidDelivery: observed.actualValidDelivery,
          paymentSentByPackage: false,
          recognizedRevenueAtomic: "0",
        };
      }
      const body = diagnosis(result, { requestId: machine.requestId, settlement, challenge: merchantBase ? { consulted: false } : null });
      if (machine.requestId) {
        if (store.size > 64) store.clear();
        store.set(machine.requestId, { digest: machine.digest, result, settlement });
      }
      return res.json(body);
    } catch (error) {
      const message = error instanceof SellerRepairError ? error.message : "invalid seller repair request";
      const unsupported = /method must be GET|probeConsent class is not supported|method_not_read_only/.test(message);
      if (unsupported) {
        return res.json(diagnosis(null, { outcome: "unsupported", reason: message, nextAction: "unsupported" }));
      }
      res.status(400);
      return res.json({
        charged: false,
        paymentSent: false,
        error: message,
        usefulOutput: { matched: false, http200IsSuccess: false },
      });
    }
  };
}

export function mountSellerRepairDiagnosis(app, options = {}) {
  const handler = createSellerRepairDiagnosis(options);
  app.all(ROUTE, express.json({ limit: "64kb", strict: true }), (req, res, next) => {
    if (req.method !== "POST") {
      res.set("Cache-Control", "no-store");
      res.status(405);
      return res.json({ charged: false, paymentSent: false, error: "method_not_allowed" });
    }
    return handler(req, res, next);
  });
  return { route: ROUTE, method: "POST", charged: false, priceChanged: false, skuAdded: false };
}
