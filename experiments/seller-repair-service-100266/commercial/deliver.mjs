import { spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CATALOG_SKU, PAID_PRICE_ATOMIC, PAID_PRICE_DISPLAY, PAID_PRODUCT, PAID_ROUTE } from "../src/constants.mjs";
import { normalizeMachineRequest } from "../src/machine.mjs";
import { probeOnce } from "../src/probe.mjs";
import { assessPublicOrigin } from "../src/public-target.mjs";
import { runJourney } from "../src/journey.mjs";
import { prepareContribution, replayContribution } from "../src/contribution.mjs";
import { consumeLaterArtifact, REGRESSION_SCHEMA } from "./later-consumer.mjs";
import { rejectSeeded } from "../src/seed.mjs";

export { consumeLaterArtifact, REGRESSION_SCHEMA };

export const MERCHANT_HEAD = "c1518cce1b60799044cfd8b8a749abb150299a63";
export const MAINTAINED_INSPECTION = Object.freeze({
  package: "maintained-operations",
  version: "0.1.0",
  url: "https://neomorphic.io/downloads/maintained-operations/0.1.0/maintained-operations-0.1.0.tar.gz",
  sha256: "b68024a3b359b354b6869cfdc4621f1eb2947cb40311bf7bafcbd546b0cdabc9",
  bytes: 104792,
  license: "MIT",
  copyright: "Copyright (c) 2026 Neomorphic LLC",
  runtime: "Node.js 22",
  source: "packages/retained-task 0.1.0 and packages/change-monitor 0.1.0",
  providesSellerDiagnosis: false,
  providesRepairRetest: false,
  inspectedAt: "2026-10-02T08:21:11.000Z",
  note: "The public runner rechecks one retained observatory task. It does not accept a seller operation, expected output, or repair retest.",
});

export const PRODUCTION_OBSERVATION = Object.freeze({
  observedAt: "2026-10-02T08:21:11.000Z",
  diagnosis: {
    method: "POST",
    url: "https://agents.samedaydesk.com/commerce/seller-repair-diagnosis",
    emptyBodyStatus: 400,
    mounted: true,
    charged: false,
    paymentSent: false,
    error: "operation must be GET and one exact path",
  },
  paidAudit: {
    method: "GET",
    url: "https://agents.samedaydesk.com/commerce/seller-integrity-audit?origin=https%3A%2F%2Fagent402.tools&route=%2Fapi%2Funemployment-rate&method=GET",
    status: 402,
    amount: "10000",
    network: "eip155:8453",
    scheme: "exact",
    priceDisplay: PAID_PRICE_DISPLAY,
    priceChanged: false,
  },
  unemployment: {
    method: "GET",
    url: "https://agent402.tools/api/unemployment-rate",
    status: 402,
    baseExactAmount: "5000",
    network: "eip155:8453",
    scheme: "exact",
    outputSchemaRequired: ["date", "current", "months", "history", "source"],
    bodyPurchased: false,
    defect: false,
    order: false,
  },
  acquisition: {
    url: "https://agents.samedaydesk.com/.well-known/public-acquisition/index.json",
    draft: true,
    productionHosted: false,
    hostedAcquisitionVerified: false,
    listsSellerRepairConsumer020: true,
    assetCount: 16,
  },
});

const COMMAND = "node experiments/seller-repair-service-100266/bin/commercial-path.mjs";
const DISPOSABLE_TOKEN = "commercial-path-disposable-token-32b";

const QUOTA_DOCUMENT = {
  openapi: "3.1.0",
  paths: {
    "/v1/quota": {
      get: {
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["quota"],
                  properties: {
                    quota: {
                      type: "object",
                      required: ["remaining"],
                      properties: { remaining: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

export function isFixedCatalogExample(input) {
  if (!input || typeof input !== "object") return false;
  const origin = input.origin;
  const operation = input.operation;
  const resource = input.resource
    || operation?.resource
    || (typeof operation === "string" ? operation.split(" ")[1] : null);
  const value = input.expect?.value ?? input.expectedUsefulOutput?.equals?.value;
  return origin === "https://seller.example" && resource === "/catalog/item" && value === CATALOG_SKU;
}

export function rejectCommercialSeed(claim) {
  const seeded = rejectSeeded(claim);
  const reasons = [...seeded.reasons];
  if (claim?.targetReturned402 === true && (claim?.purchaseRecommended === true || claim?.defect === true || claim?.order === true)) {
    reasons.push("target_402_is_not_a_defect_or_order");
  }
  if (claim?.trusted === true || claim?.submittedArtifactTrusted === true) reasons.push("submitted_artifact_is_not_trusted");
  if (claim?.causalIdentityGrantsUsefulness === true || claim?.commerceEventIsSettlement === true) {
    reasons.push("causal_identity_is_not_authority");
  }
  if (claim?.savingsAtomic && claim.savingsAtomic !== "unknown") reasons.push("savings_not_measured");
  if (claim?.fixedExampleIsCallerTask === true) reasons.push("fixed_example_is_not_caller_task");
  if (isFixedCatalogExample(claim)) reasons.push("fixed_example_is_not_caller_task");
  return {
    refused: reasons.length > 0,
    reasons,
    paymentSent: false,
    recognizedRevenueAtomic: "0",
    historicalRevenue: "unknown",
  };
}

export function buyerPath(observation = PRODUCTION_OBSERVATION) {
  return {
    schema: "samedaydesk.seller-repair-buyer-path.v1",
    charged: false,
    priceChanged: false,
    skuAdded: false,
    humanPage: false,
    command: `${COMMAND} buyer`,
    deliverCommand: `${COMMAND} deliver`,
    laterCommand: `${COMMAND} later --artifact <regression.json> --caller <caller.json>`,
    freeDiagnosis: {
      route: "POST /commerce/seller-repair-diagnosis",
      charged: false,
      answers: [
        "whether the observed GET body matches the caller's expected path and value",
        "a useful negative when the field is missing and that gap is not a purchase",
        "transport refusals for a private address, DNS change, redirect, body ceiling, or whole-response deadline",
        "that a caller-reviewed retest changed the compared output on a stand-in the caller already runs",
      ],
      doesNotAnswer: [
        "a paid response body",
        "a deployed counterparty repair",
        "handler execution proved by HTTP 200, a declared field, or a paid-success flag",
        "settlement, reuse, or recognized revenue",
      ],
    },
    paidAudit: {
      product: PAID_PRODUCT,
      route: PAID_ROUTE,
      priceDisplay: PAID_PRICE_DISPLAY,
      priceAtomic: PAID_PRICE_ATOMIC,
      distinctWhen: "The caller asked for declaration_contract work and a completed report for the same origin, route, and method adds a declaration finding the free body comparison does not already state.",
      answersUsefulOutput: false,
      purchaseRecommended: false,
      purchasePerformed: false,
    },
    customerAuthority: {
      freeDiagnosis: "No payment authority. A live public probe requires probeConsent class public-https and confirmed true. Evidence mode does not probe.",
      paidAudit: "The customer's own payment authority. This path does not grant it and does not pay.",
      share: "The existing useful-result-reuse compatibility authorization. A submitted regression file is not trusted and does not grant sharing.",
    },
    possibleRevenueDistinctFromAcceptedOrder: true,
    acceptedPaidOrder: false,
    recognizedRevenueAtomic: "0",
    production: observation,
  };
}

export function invitationPacket(observation = PRODUCTION_OBSERVATION) {
  return {
    schema: "samedaydesk.seller-repair-invitation.v1",
    id: "agent402-unemployment-followup",
    doNotSend: ["payment", "PAYMENT-SIGNATURE", "email", "outreach", "target POST"],
    sent: false,
    acceptedPaidOrder: false,
    possibleRevenueDistinctFromAcceptedOrder: true,
    recognizedRevenueAtomic: "0",
    task: {
      callerId: "agent402-unemployment-followup",
      origin: "https://agent402.tools",
      operation: "GET /api/unemployment-rate",
      sdk: "agent402-smoke",
      runtime: "github-actions",
      defect: false,
      order: false,
      reason: "The unpaid Base exact challenge already requires date, current, months, history, and source. HTTP 402 is the target's price, not a repair order and not a reason to pay the 0.01 audit.",
    },
    directBaseline: observation.unemployment,
    paidAuditDoNotCall: observation.paidAudit,
    diagnosis: {
      ...observation.diagnosis,
      body: {
        callerId: "agent402-unemployment-followup",
        origin: "https://agent402.tools",
        operation: "GET /api/unemployment-rate",
        sdk: "agent402-smoke",
        runtime: "github-actions",
        transport: "public-https",
        probe: false,
        paidIntent: false,
        requestId: "ra02-agent402-unemployment-20261002",
        question: "useful_output",
        expect: { paths: ["date", "current", "months", "history", "source"] },
        observed: {
          status: 402,
          contentType: "application/json",
          json: false,
        },
      },
    },
    command: `${COMMAND} buyer`,
    customerAuthority: buyerPath(observation).customerAuthority,
    purchaseRecommended: false,
    priceChanged: false,
    skuAdded: false,
  };
}

function resourcePath(input) {
  if (typeof input.operation === "string") return input.operation.split(" ")[1];
  return input.operation?.resource || input.resource;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

function sendJson(res, status, body) {
  const encoded = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(encoded) });
  res.end(encoded);
}

function certMaterial() {
  const dir = mkdtempSync(join(tmpdir(), "seller-repair-commercial-"));
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  const out = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-keyout", key, "-out", cert,
    "-days", "1", "-nodes", "-subj", "/CN=quota.example",
  ], { encoding: "utf8" });
  if (out.status !== 0) throw new Error(out.stderr || "openssl_failed");
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

function httpsServer(material, onRequest) {
  return listen(https.createServer({ key: material.key, cert: material.cert }, onRequest));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  return JSON.parse(text);
}

export async function transportRefusals() {
  const privateDecision = await assessPublicOrigin("https://intranet.example", {
    lookupImpl: async () => [{ address: "10.1.2.3", family: 4 }],
  });
  let dnsHits = 0;
  const dnsServer = http.createServer((_req, res) => {
    dnsHits += 1;
    sendJson(res, 200, { status: "ready" });
  });
  await listen(dnsServer);
  const material = certMaterial();
  let redirectHits = 0;
  const redirectServer = await httpsServer(material, (req, res) => {
    redirectHits += 1;
    if (new URL(req.url, "https://status.example").pathname === "/openapi.json") return sendJson(res, 200, { openapi: "3.1.0", paths: {} });
    res.writeHead(302, { location: "/elsewhere" });
    res.end();
  });
  const ceiling = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(`{"status":"${"x".repeat(80)}"}`);
  });
  await listen(ceiling);
  const trickle = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write("{");
    const interval = setInterval(() => res.write(" "), 10);
    res.on("close", () => clearInterval(interval));
  });
  await listen(trickle);
  try {
    let lookups = 0;
    const moved = await runJourney({
      intake: normalizeMachineRequest({
        callerId: "dns-caller",
        origin: "https://status.example",
        operation: "GET /v1/health",
        sdk: "node-https@22",
        expect: { path: "status", value: "ready" },
        task: "Confirm whether a DNS change between the gate and the probe refuses the health read.",
        maxEffort: { probes: 2, bodyBytes: 1024, deadlineMs: 1000, totalBodyBytes: 2048, totalResponseMs: 2000, redirects: 0 },
      }).intake,
      baseUrl: "https://status.example",
      lookupImpl: async () => {
        lookups += 1;
        return [{ address: lookups % 2 ? "93.184.216.34" : "1.1.1.1", family: 4 }];
      },
      socket: { host: "127.0.0.1", port: dnsServer.address().port, rejectUnauthorized: false },
    });
    const redirected = await probeOnce({
      baseUrl: "https://status.example",
      route: "/v1/health",
      deadlineMs: 1000,
      bodyBytes: 4096,
      socket: { host: "127.0.0.1", port: redirectServer.address().port, rejectUnauthorized: false },
    });
    const capped = await probeOnce({
      baseUrl: `http://127.0.0.1:${ceiling.address().port}`,
      route: "/v1/health",
      deadlineMs: 1000,
      bodyBytes: 32,
    });
    const slow = await probeOnce({
      baseUrl: `http://127.0.0.1:${trickle.address().port}`,
      route: "/v1/health",
      deadlineMs: 80,
      bodyBytes: 4096,
    });
    return {
      private: {
        refused: privateDecision.ok === false && privateDecision.reason === "target_not_public",
        reason: privateDecision.reason,
        probes: 0,
      },
      dnsChanged: {
        refused: moved.classification.reason === "dns_changed",
        reason: moved.classification.reason,
        probes: dnsHits,
      },
      redirect: {
        refused: redirected.redirectUnfollowed === true,
        reason: "redirect_unfollowed",
        followed: 0,
      },
      bodyCeiling: {
        refused: capped.bodyCeiling === true || capped.reason === "body_ceiling",
        reason: capped.reason || "body_ceiling",
      },
      deadline: {
        refused: slow.bodyDeadline === true && slow.reason === "body_deadline",
        reason: slow.reason,
      },
    };
  } finally {
    await Promise.all([close(dnsServer), close(redirectServer), close(ceiling), close(trickle)]);
  }
}

function buildArtifact({ repair, negative, directRepair, directNegative, share, executionMs }) {
  const probes = (repair.metrics?.callerEffort?.probes || 0) + (negative.metrics?.callerEffort?.probes || 0);
  return {
    schema: REGRESSION_SCHEMA,
    trusted: false,
    hashIsExecution: false,
    usefulTransferred: false,
    paymentPermitted: false,
    deployedCounterpartyRepair: false,
    recognizedRevenueAtomic: "0",
    callerId: repair.callerId,
    taskDigest: repair.taskDigest,
    operationId: repair.operationId,
    declaredSdk: repair.declaredSdk,
    target: repair.target,
    expected: {
      path: repair.expectedUsefulOutput?.equals?.path || repair.expectedUsefulOutput?.paths?.[0],
      value: repair.expectedUsefulOutput?.equals?.value,
    },
    provenance: {
      merchantHead: MERCHANT_HEAD,
      package: "seller-repair-service-100266",
      license: "MIT",
      copyright: "Copyright (c) 2026 SameDayDesk",
      runtime: process.version,
      maintained: MAINTAINED_INSPECTION,
      fixedCatalogExample: false,
    },
    execution: {
      command: `${COMMAND} deliver`,
      beforeDigest: repair.observed?.digest || null,
      directDigest: directRepair.digest,
      directAgrees: directRepair.digest === repair.observed?.digest,
      outcome: repair.classification.outcome,
      probes,
      redirectsFollowed: 0,
    },
    retest: {
      useful: repair.repair?.useful === true,
      reason: repair.repair?.reason || null,
      class: repair.repair?.class || null,
      changedOutput: repair.repair?.changedOutput || null,
      deployedCounterpartyRepair: false,
      counterpartyMutated: false,
    },
    negative: {
      callerId: negative.callerId,
      operationId: negative.operationId,
      declaredSdk: negative.declaredSdk,
      taskDigest: negative.taskDigest,
      useful: negative.classification.useful === true,
      reason: negative.classification.reason,
      http200IsSuccess: false,
      directAgrees: directNegative.digest === negative.observed?.digest,
      purchaseRecommended: false,
    },
    share: {
      accepted: share.accepted === true,
      reason: share.reason,
      trusted: false,
      usefulTransferred: false,
      spendingGrantTransferred: false,
    },
    laterCommand: `${COMMAND} later --artifact <regression.json> --caller <caller.json>`,
    resources: {
      cash: { atomic: "0", countsAsCash: true, reason: "no_payment_executed" },
      apiEquivalent: { probes, tokens: "unknown", countsAsCash: false },
      includedQuota: { known: false, reason: "included_quota_not_metered", countsAsCash: false },
      reviewAdaptation: { known: false, reason: "original_token_review_cost_unknown", countsAsCash: false },
      executionMs,
      founderEngineeringCost: "unknown",
      founderCommissionGrossUsdc: "3.00",
      founderCommissionNetUsdc: "2.85",
      founderCommissionIsThisRun: false,
      historicalBankedRevenueUsdc: 10.955,
      historicalCountsAsMargin: false,
      savings: "unknown",
    },
  };
}

function controlRecords(foreignEventId) {
  return [
    {
      schemaVersion: "samedaydesk.outcome-task-ref.v1",
      taskRef: "task-dup-a",
      operationId: "post:/commerce/seller-repair-diagnosis",
      commerceEventId: foreignEventId,
      eventId: "dup-a",
    },
    {
      schemaVersion: "samedaydesk.outcome-task-ref.v1",
      taskRef: "task-dup-b",
      operationId: "post:/commerce/seller-repair-diagnosis",
      commerceEventId: foreignEventId,
      eventId: "dup-b",
    },
    {
      schemaVersion: "samedaydesk.outcome-task-ref.v1",
      taskRef: "task-torn-missing",
      operationId: "get:/chain/transaction-receipt",
      commerceEventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      eventId: "torn-task",
    },
    {
      schema: "samedaydesk.useful-result-reuse.customer-grant.v1",
      action: "retain",
      grantId: "failedsettle0001",
      taskRef: "repair-failed-settlement",
      operationId: "normalized-transaction-receipt",
      recordId: "failed-settlement-row",
      settlementStatus: "failed",
      paidValidDelivery: false,
      evidenceClass: "paid_valid_delivery",
      body: { decision: "rpc_unavailable" },
    },
    {
      schema: "samedaydesk.useful-result-reuse.customer-grant.v1",
      action: "retain",
      grantId: "owner-a-grant-001",
      taskRef: "repair-cross-owner",
      operationId: "normalized-transaction-receipt",
      recordId: "cross-owner-retain",
      settlementStatus: "verified",
      paidValidDelivery: true,
      evidenceClass: "paid_valid_delivery",
      comparable: "ab".repeat(32),
      body: { decision: "found" },
    },
    {
      schema: "samedaydesk.useful-result-reuse.customer-grant.v1",
      action: "revoke",
      targetId: "owner-b-grant-099",
      taskRef: "repair-cross-owner",
      operationId: "normalized-transaction-receipt",
    },
    {
      v: 3,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      method: "GET",
      route: "/chain/transaction-receipt",
      status: 200,
      result: "paid_success",
      paymentPresent: true,
      replayed: true,
      durationMs: 5,
    },
    { schema: "not-a-known-schema", note: "preserve unknown" },
  ];
}

function summarizeEconomics(receipt, diagnosisIds) {
  const diagnosis = receipt.observations.filter((row) => diagnosisIds.has(row.commerceEventId));
  const failed = receipt.journeys.find((journey) => journey.taskRef === "repair-failed-settlement");
  const cross = receipt.journeys.find((journey) => journey.taskRef === "repair-cross-owner");
  const replay = receipt.journeys.find((journey) => (journey.commerceEventIds || []).includes("cccccccc-cccc-4ccc-8ccc-cccccccccccc"));
  const torn = receipt.journeys.find((journey) => journey.taskRef === "task-torn-missing");
  const sellerUseful = receipt.journeys.find((journey) => journey.operationId === "seller-repair" && journey.useful === "true");
  return {
    recognizedRevenueAtomic: receipt.economics?.recognizedRevenueAtomic || receipt.query?.recognizedRevenueAtomic,
    demandEstablished: receipt.demandEstablished,
    gaps: receipt.gaps,
    diagnosisBound: diagnosis.some((row) => row.taskRef),
    diagnosisSettlementTrusted: diagnosis.some((row) => row.settlementTrusted),
    diagnosisUseful: diagnosis.some((row) => row.useful === "true"),
    causalGrantsUsefulness: Boolean(sellerUseful && (sellerUseful.commerceEventIds || []).some((id) => diagnosisIds.has(id))),
    failedSettlementTrusted: failed?.settlementTrusted === true,
    failedSettlementStatus: failed?.settlementStatus || null,
    duplicateConflict: receipt.gaps.includes("causal_binding_conflict"),
    tornUnsettled: torn?.settlementTrusted !== true,
    missingCommerceSide: receipt.gaps.includes("commerce_event_not_task_bound"),
    crossOwnerRevocationTransferred: cross?.revocationTransferred === true,
    crossOwnerSlots: cross?.ownerSlots?.length || 0,
    replayUseful: replay?.useful === "true",
    replaySettlementTrusted: replay?.settlementTrusted === true,
    unknownPreserved: receipt.gaps.includes("unknown_source"),
    negativePreserved: receipt.observations.some((row) => (row.reasons || []).includes("missing_field")),
    tokenMeter: receipt.meters?.tokenMeter,
    cashCountsSeparately: receipt.economics?.planes?.cashMarginal?.countsAsCash === true
      && receipt.economics?.planes?.apiEquivalentBuildEffort?.countsAsCash === false,
  };
}

export async function runCommercialDeliver({ repairCaller, negativeCaller, authorizeShare = false } = {}) {
  if (isFixedCatalogExample(repairCaller) || isFixedCatalogExample(negativeCaller)) {
    return { ok: false, reason: "fixed_example_is_not_caller_task", paymentSent: false, recognizedRevenueAtomic: "0" };
  }
  const repairMachine = normalizeMachineRequest(repairCaller);
  const negativeMachine = normalizeMachineRequest(negativeCaller);
  if (repairMachine.operationId === negativeMachine.operationId && repairMachine.intake.declaredSdk === negativeMachine.intake.declaredSdk) {
    return { ok: false, reason: "cases_not_distinct", paymentSent: false };
  }
  const started = Date.now();
  const material = certMaterial();
  const broken = await httpsServer(material, (req, res) => {
    const path = new URL(req.url, "https://quota.example").pathname;
    if (path === "/openapi.json") return sendJson(res, 200, QUOTA_DOCUMENT);
    return sendJson(res, 200, { quota: { limit: 100 } });
  });
  const repaired = await httpsServer(material, (req, res) => {
    const path = new URL(req.url, "https://quota.example").pathname;
    if (path === "/openapi.json") return sendJson(res, 200, QUOTA_DOCUMENT);
    return sendJson(res, 200, { quota: { limit: 100, remaining: "3" } });
  });
  const negativeServer = await httpsServer(material, (req, res) => {
    const path = new URL(req.url, "https://status.example").pathname;
    if (path === "/openapi.json") return sendJson(res, 200, { openapi: "3.1.0", paths: {} });
    return sendJson(res, 200, { note: "up" });
  });
  const lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
  const { createServer } = await import("node:http");
  const express = (await import("express")).default;
  const { createCommerceTelemetry } = await import("../../../commerce-events.mjs");
  const { openCausalCommerceEvent } = await import("../../../commerce-outcome-binding.mjs");
  const { mountSellerRepairDiagnosis } = await import("../route/mount.mjs");
  const { mkdtemp, readFile } = await import("node:fs/promises");
  const { evaluateBundle } = await import("../../../task-linked-delivery/experiments/useful-economics-100290/src/evaluate.mjs");
  const { BUNDLE_SCHEMA } = await import("../../../task-linked-delivery/experiments/useful-economics-100290/src/constants.mjs");
  const dataDir = await mkdtemp(join(tmpdir(), "commercial-merchant-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    internalToken: DISPOSABLE_TOKEN,
    secret: "commercial-path-actor-secret-32bytes",
    writerProcessCount: 1,
  });
  const app = express();
  app.disable("x-powered-by");
  app.use(telemetry.middleware);
  app.use((req, res, next) => {
    const proof = telemetry.causalCommerceEventProof(res);
    if (proof) res.set("x-commercial-causal-proof", proof);
    next();
  });
  mountSellerRepairDiagnosis(app, { lookupImpl });
  const merchant = createServer(app);
  await listen(merchant);
  const proofs = [];
  try {
    const repairSocket = { host: "127.0.0.1", port: broken.address().port, rejectUnauthorized: false };
    const retestSocket = { host: "127.0.0.1", port: repaired.address().port, rejectUnauthorized: false };
    const negativeSocket = { host: "127.0.0.1", port: negativeServer.address().port, rejectUnauthorized: false };
    const repair = await runJourney({
      intake: repairMachine.intake,
      baseUrl: repairMachine.intake.origin,
      retestBaseUrl: repairMachine.intake.origin,
      lookupImpl,
      socket: repairSocket,
      retestSocket,
      authorizeContribution: authorizeShare,
    });
    const directRepair = await probeOnce({
      baseUrl: repairMachine.intake.origin,
      route: repairMachine.intake.resource,
      deadlineMs: repairMachine.intake.maxEffort.deadlineMs,
      bodyBytes: repairMachine.intake.maxEffort.bodyBytes,
      socket: repairSocket,
    });
    const negative = await runJourney({
      intake: negativeMachine.intake,
      baseUrl: negativeMachine.intake.origin,
      lookupImpl,
      socket: negativeSocket,
      authorizeContribution: false,
    });
    const directNegative = await probeOnce({
      baseUrl: negativeMachine.intake.origin,
      route: negativeMachine.intake.resource,
      deadlineMs: negativeMachine.intake.maxEffort.deadlineMs,
      bodyBytes: negativeMachine.intake.maxEffort.bodyBytes,
      socket: negativeSocket,
    });
    const refusals = await transportRefusals();
    async function post(body) {
      const response = await fetch(`http://127.0.0.1:${merchant.address().port}/commerce/seller-repair-diagnosis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, proof: response.headers.get("x-commercial-causal-proof"), body: text ? JSON.parse(text) : null };
    }
    const repairDiagnosis = await post({ ...repairCaller, probe: false, paidIntent: false, requestId: "repair-100308" });
    const repairReplay = await post({ ...repairCaller, probe: false, paidIntent: false, requestId: "repair-100308" });
    const negativeDiagnosis = await post({ ...negativeCaller, probe: false, paidIntent: false, requestId: "negative-100308" });
    proofs.push(repairDiagnosis.proof, negativeDiagnosis.proof);
    await telemetry.flush();
    const opened = proofs.filter(Boolean).map((proof) => openCausalCommerceEvent(proof, DISPOSABLE_TOKEN));
    const lines = (await readFile(telemetry.paths.currentPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const diagnosisEvents = lines.filter((row) => row.route === "/commerce/seller-repair-diagnosis");
    const diagnosisIds = new Set(diagnosisEvents.map((row) => row.id));
    const share = prepareContribution({
      intake: repair.callerId ? repairMachine.intake : repairMachine.intake,
      classification: repair.classification,
      patch: repairMachine.intake.patch,
      authorized: authorizeShare,
    });
    const artifact = buildArtifact({
      repair,
      negative,
      directRepair,
      directNegative,
      share,
      executionMs: Date.now() - started,
    });
    const foreignEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const bundle = {
      schema: BUNDLE_SCHEMA,
      coverage: "supplied_records",
      costs: { cashMarginalAtomic: { atomic: "0" } },
      records: [
        repair,
        negative,
        ...diagnosisEvents,
        ...controlRecords(foreignEventId),
      ],
    };
    const receipt = await evaluateBundle(bundle);
    const economics = summarizeEconomics(receipt, diagnosisIds);
    const laterChanged = consumeLaterArtifact(artifact, {
      callerId: "later-agent",
      taskDigest: artifact.taskDigest,
      sdk: artifact.declaredSdk,
      origin: artifact.target.origin,
      method: artifact.target.method,
      resource: "/v1/quota-changed",
      expectValue: artifact.expected.value,
    });
    const hashOnly = share.accepted
      ? replayContribution({
        contribution: share,
        now: Date.parse(share.row.expiresAt) - 1000,
        taskDigest: repair.taskDigest,
        sdk: repair.declaredSdk,
        target: repair.target,
      })
      : { reused: false, reason: share.reason, usefulTransferred: false };
    const checks = {
      repairMismatch: repair.classification.outcome === "mismatch",
      repairUseful: repair.repair?.useful === true,
      repairClass: repair.repair?.class === "caller_reviewed_retest",
      directRepairAgrees: directRepair.digest === repair.observed?.digest,
      negativeNotUseful: negative.classification.useful === false,
      negativeMissingField: negative.classification.reason === "missing_field_not_paid_demand",
      directNegativeAgrees: directNegative.digest === negative.observed?.digest,
      distinctTasks: repair.taskDigest !== negative.taskDigest,
      distinctSdks: repair.declaredSdk !== negative.declaredSdk,
      privateRefused: refusals.private.refused === true && refusals.private.probes === 0,
      dnsRefused: refusals.dnsChanged.refused === true,
      redirectRefused: refusals.redirect.refused === true,
      bodyCeilingRefused: refusals.bodyCeiling.refused === true,
      deadlineRefused: refusals.deadline.refused === true,
      artifactUntrusted: artifact.trusted === false,
      laterStale: laterChanged.reason === "stale_applicability" && laterChanged.probed === false && laterChanged.usefulTransferred === false,
      diagnosisUncharged: repairDiagnosis.body?.charged === false && repairDiagnosis.body?.paymentSent === false,
      duplicateRetained: repairReplay.body?.duplicate === true,
      http200IsNotSuccess: negativeDiagnosis.body?.usefulOutput?.http200IsSuccess === false,
      diagnosisEventsRecorded: diagnosisEvents.length >= 2,
      proofsOpened: opened.length >= 2 && opened.every((id) => diagnosisIds.has(id)),
      revenueZero: economics.recognizedRevenueAtomic === "0",
      diagnosisNotUseful: economics.diagnosisUseful === false,
      diagnosisNotSettlement: economics.diagnosisSettlementTrusted === false && economics.diagnosisBound === false,
      causalDoesNotGrantUsefulness: economics.causalGrantsUsefulness === false,
      failedSettlementUntrusted: economics.failedSettlementTrusted === false,
      duplicateConflict: economics.duplicateConflict === true,
      tornUnsettled: economics.tornUnsettled === true,
      missingCommerceSide: economics.missingCommerceSide === true,
      crossOwnerRevocationNotTransferred: economics.crossOwnerRevocationTransferred === false,
      replayNotUseful: economics.replayUseful === false && economics.replaySettlementTrusted === false,
      unknownPreserved: economics.unknownPreserved === true,
      negativePreserved: economics.negativePreserved === true,
      hashReplayDoesNotTransfer: hashOnly.usefulTransferred === false,
      cashSeparated: economics.cashCountsSeparately === true,
    };
    const failed = Object.entries(checks).filter(([, passed]) => passed !== true).map(([name]) => name);
    const ok = failed.length === 0;
    return {
      ok,
      failed,
      detail: {
        repairOutcome: repair.classification.outcome,
        repairReason: repair.classification.reason,
        repairUseful: repair.repair?.useful === true,
        repairClass: repair.repair?.class || null,
        negativeReason: negative.classification.reason,
        diagnosisStatus: repairDiagnosis.status,
        diagnosisError: repairDiagnosis.body?.error || null,
        eventCount: diagnosisEvents.length,
        eventRoutes: [...new Set(lines.map((row) => row.route))],
        proofsOpened: opened.filter(Boolean).length,
        refusalReasons: {
          private: refusals.private.reason,
          dns: refusals.dnsChanged.reason,
          redirect: refusals.redirect.refused,
          body: refusals.bodyCeiling.reason,
          deadline: refusals.deadline.reason,
        },
      },
      schema: "samedaydesk.seller-repair-commercial.v1",
      charged: false,
      paymentSent: false,
      priceChanged: false,
      skuAdded: false,
      recognizedRevenueAtomic: "0",
      artifact,
      refusals,
      diagnosis: {
        repairStatus: repairDiagnosis.status,
        negativeStatus: negativeDiagnosis.status,
        duplicate: repairReplay.body?.duplicate === true,
        charged: false,
        eventIds: [...diagnosisIds],
        proofsOpened: opened.filter(Boolean).length,
        route: "/commerce/seller-repair-diagnosis",
      },
      economics,
      laterChanged,
      shareReplay: { reason: hashOnly.reason, usefulTransferred: hashOnly.usefulTransferred === true, trusted: false },
      buyer: buyerPath(),
      invitation: invitationPacket(),
    };
  } finally {
    await Promise.all([close(broken), close(repaired), close(negativeServer), close(merchant)]);
  }
}

export function defaultCallers() {
  return {
    repairCaller: {
      callerId: "quota-caller-100308",
      origin: "https://quota.example",
      operation: "GET /v1/quota",
      sdk: "node-https@22",
      runtime: `node/${process.versions.node}`,
      task: "Caller asks whether GET /v1/quota on https://quota.example returns quota.remaining equal to the string 3.",
      expect: { path: "quota.remaining", value: "3" },
      observed: { status: 200, json: { quota: { limit: 100 } }, contentType: "application/json" },
      patch: {
        kind: "response_overlay",
        instructions: ["Return quota.remaining as the string 3 from the seller quota counter."],
        responseOverlay: { quota: { remaining: "3" } },
      },
      question: "useful_output",
      paidIntent: false,
      probe: false,
    },
    negativeCaller: {
      callerId: "negative-caller-100308",
      origin: "https://status.example",
      operation: "GET /v1/health",
      sdk: "python-httpx@1",
      runtime: "python/3.12.0",
      task: "Caller asks whether GET /v1/health on https://status.example returns status equal to ready for python-httpx.",
      expect: { path: "status", value: "ready" },
      observed: { status: 200, json: { note: "up" }, contentType: "application/json" },
      question: "useful_output",
      paidIntent: false,
      probe: false,
    },
  };
}
