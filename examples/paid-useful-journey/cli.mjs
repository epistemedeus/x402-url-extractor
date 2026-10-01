#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { compareDiscoveryLive } from "../../discovery-drift.mjs";
import {
  assessFreeDiagnosis,
  createJourneySession,
  declineOffer,
  joinPaidUsefulJourney,
  loadCommerceJourneyFiles,
  presentOffer,
  purchaseAuthorized,
  recordLaterReuse,
} from "../../paid-useful-journey.mjs";

const [command, ...rest] = process.argv.slice(2);
const session = createJourneySession();

function flag(name, fallback = null) {
  const index = rest.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = rest[index + 1];
  if (value === undefined || value.startsWith("--")) return true;
  return value;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function diagnosis() {
  const catalog = await readJson(flag("catalog"));
  const live = await readJson(flag("live"));
  const stale = flag("stale-ms");
  const report = compareDiscoveryLive(catalog, live, {
    now: Date.now(),
    staleMs: stale == null ? null : Number(stale),
  });
  return { report, assessment: assessFreeDiagnosis(report) };
}

function summaryOffer(presented) {
  return {
    ok: presented.ok === true,
    reason: presented.reason,
    status: presented.status ?? null,
    paymentSent: false,
    revenueRecognized: false,
    terms: presented.offer?.terms ?? null,
    termsDigest: presented.offer?.termsDigest ?? null,
    expiresAt: presented.offer?.expiresAt ?? null,
    journeyId: null,
  };
}

async function main() {
  if (command === "diagnose") {
    const { assessment } = await diagnosis();
    print({
      eligible: assessment.eligible,
      reason: assessment.reason,
      freeResult: assessment.freeResult,
      offeredOperation: assessment.offeredOperation,
      diagnosisId: assessment.diagnosisId,
      journeyId: assessment.journeyId,
      purchaseAuthorized: false,
      paymentSent: false,
      revenueRecognized: false,
    });
    return 0;
  }

  if (command === "live-unpaid") {
    const origin = flag("origin", "https://agents.samedaydesk.com");
    const url = new URL("/commerce/seller-integrity-audit", origin);
    url.searchParams.set("origin", "https://example.com");
    url.searchParams.set("route", "/extract");
    url.searchParams.set("method", "GET");
    const response = await fetch(url, { method: "GET", redirect: "manual", headers: { accept: "application/json" } });
    const encoded = response.headers.get("payment-required");
    let challenge = null;
    if (encoded) {
      try { challenge = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { challenge = null; }
      if (!challenge) {
        try { challenge = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); } catch { challenge = null; }
      }
    }
    const accept = challenge?.accepts?.find((item) => item?.scheme === "exact") || null;
    const link = response.headers.get("link") || "";
    print({
      status: response.status,
      paymentSent: false,
      revenueRecognized: false,
      amount: accept?.amount ?? null,
      payTo: accept?.payTo ?? null,
      network: accept?.network ?? null,
      asset: accept?.asset ?? null,
      maxTimeoutSeconds: accept?.maxTimeoutSeconds ?? null,
      serviceDesc: link.includes("service-desc"),
      purchaseEvidence: link.includes("purchase-evidence"),
    });
    return response.status === 402 && accept?.amount && accept?.payTo ? 0 : 2;
  }

  if (!["offer", "decline", "purchase", "reuse", "join"].includes(command)) {
    print({
      error: "usage",
      commands: ["diagnose", "offer", "decline", "purchase", "reuse", "join", "live-unpaid"],
    });
    return 1;
  }

  if (command === "join") {
    const loaded = await loadCommerceJourneyFiles(flag("data-dir"));
    const joined = joinPaidUsefulJourney({
      events: loaded.events,
      forwardRecords: loaded.forwardRecords,
      journeyId: flag("journey"),
      claimedSettlement: flag("claim-settlement"),
    });
    print({ ...joined, unreadable: loaded.unreadable });
    return 0;
  }

  const { assessment } = await diagnosis();
  const merchant = flag("merchant");
  const actor = flag("actor", "unknown");
  const now = Date.now();
  if (command === "offer" || command === "decline" || command === "purchase" || command === "reuse") {
    if (!assessment.eligible) {
      print({
        eligible: false,
        reason: assessment.reason,
        freeResult: assessment.freeResult,
        paymentSent: false,
        revenueRecognized: false,
      });
      return 0;
    }
  }
  if (command === "offer") {
    const presented = await presentOffer({ merchantBase: merchant, assessment, actor, now });
    print({
      ...summaryOffer(presented),
      journeyId: assessment.journeyId,
      diagnosisId: assessment.diagnosisId,
      freeResult: assessment.freeResult,
    });
    return presented.ok ? 0 : 2;
  }
  if (command === "decline") {
    const declined = await declineOffer({ merchantBase: merchant, assessment, actor });
    print({ ...declined, journeyId: assessment.journeyId, revenueRecognized: false });
    return declined.ok ? 0 : 2;
  }
  if (command === "reuse") {
    const reused = await recordLaterReuse({
      merchantBase: merchant,
      assessment,
      actor,
      usefulDelivery: flag("useful"),
    });
    print({ ...reused, journeyId: assessment.journeyId });
    return reused.ok ? 0 : 2;
  }
  const presented = await presentOffer({ merchantBase: merchant, assessment, actor, now });
  if (!presented.ok) {
    print({ ...summaryOffer(presented), journeyId: assessment.journeyId });
    return 2;
  }
  const loaded = flag("data-dir") ? await loadCommerceJourneyFiles(flag("data-dir")) : { events: [] };
  const purchased = await purchaseAuthorized({
    merchantBase: merchant,
    assessment,
    authorization: {
      authorizePurchase: flag("authorize") === true,
      termsDigest: presented.offer.termsDigest,
      expiresAt: presented.offer.expiresAt,
      target: assessment.target,
      actor,
    },
    now,
    testMode: flag("test-mode") === true,
    priorEvents: loaded.events,
    session,
  });
  print({
    ok: purchased.ok,
    reason: purchased.reason,
    status: purchased.status ?? null,
    paymentSent: purchased.paymentSent,
    testMode: purchased.testMode,
    financialOutcome: purchased.financialOutcome ?? null,
    settlementReference: purchased.settlementReference ?? null,
    usefulDelivery: purchased.usefulDelivery ?? "unknown",
    usefulReason: purchased.usefulReason ?? null,
    journeyId: assessment.journeyId,
    revenueRecognized: false,
  });
  return purchased.paymentSent && purchased.ok ? 0 : 2;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  print({ error: String(error?.message || error), paymentSent: false, revenueRecognized: false });
  process.exitCode = 1;
});
