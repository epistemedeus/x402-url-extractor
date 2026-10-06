#!/usr/bin/env node
// Join the two settlements that moved the public ledger from the received
// 47 / 1.067 cut to the 49 / 1.092 receipt. Reads those receipts only.
// Does not scan chain logs, invent a transaction hash, or open a new ledger.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { PRIOR_REFERENCE, SCHEMA, violations } from "./check.mjs";

const CURRENT_DEMAND = "/home/ubuntu/root-commerce-observation-1006-recheck/public-demand.json";
const CURRENT_RECEIVING = "/home/ubuntu/root-commerce-observation-1006-recheck/RECEIVING.json";
const PRIOR_DEMAND = "/home/ubuntu/root-commerce-observation-100600/public-demand.json";
const PRIOR_RECEIVING = "/home/ubuntu/root-commerce-observation-100600/RECEIVING.json";
const PRIOR_CLASSIFIED = new URL("../incoming-cash-trace-1005/EVIDENCE.json", import.meta.url);

const CLASS_POLICY = "Explicit known-payer rules classify internal, marketplace validation, incentivized, affiliated, or independently confirmed buyers. Unknown or missing payer identities remain unclassified and never become independent by inference.";
const PRIVATE_REFERENCES = "transaction references remain private";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function usdc(atomic) {
  const value = BigInt(atomic);
  const whole = value / 1000000n;
  const frac = (value % 1000000n).toString().padStart(6, "0");
  const trimmed = frac.replace(/0+$/, "");
  const shown = (trimmed + "000").slice(0, Math.max(3, trimmed.length));
  return `${whole}.${shown}`;
}

function paidCount(demand, route) {
  const value = demand.paidSuccessByRoute?.[route];
  return value === undefined || value === null ? 0 : value;
}

function bucket(map, key) {
  return map?.[key] || { settlements: 0, amountAtomic: "0" };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function stableString(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function populationPaid(demand, name) {
  return demand.trafficProvenance?.populations?.[name]?.paidSuccesses;
}

function anchorProblems({ current, prior, currentReceiving, priorReceiving, currentBytes, priorBytes, priorClassified }) {
  const problems = [];
  const bad = (code) => problems.push(code);
  if (currentReceiving?.status !== 200 || currentReceiving?.cash !== 0) bad("current_receiving");
  if (currentReceiving?.classification !== "owner_monitor_readback") bad("current_receiving_class");
  if (currentReceiving?.bytes !== currentBytes) bad("current_receiving_bytes");
  if (priorReceiving?.status !== 200 || priorReceiving?.cash !== 0) bad("prior_receiving");
  if (priorReceiving?.bytes !== priorBytes) bad("prior_receiving_bytes");
  if (current?.requestedWindowComplete !== true || current?.requestedWindowCoverage !== "complete") bad("current_window");
  if (prior?.requestedWindowComplete !== true || prior?.requestedWindowCoverage !== "complete") bad("prior_window");
  if (current?.requestedWindowEnd !== current?.generatedAt) bad("current_window_end");
  if (prior?.requestedWindowEnd !== prior?.generatedAt) bad("prior_window_end");
  if (!String(current?.settlementEvidencePolicy || "").includes(PRIVATE_REFERENCES)) bad("reference_policy");
  if (current?.paymentClassPolicy !== CLASS_POLICY || prior?.paymentClassPolicy !== CLASS_POLICY) bad("class_policy");

  const currentLedger = current?.settlementReconciliation?.ledger;
  const priorLedger = prior?.settlementReconciliation?.ledger;
  if (currentLedger?.reconciledSettlements !== 49 || currentLedger?.amountAtomic !== "1092000") bad("current_ledger");
  if (priorLedger?.reconciledSettlements !== 47 || priorLedger?.amountAtomic !== "1067000") bad("prior_ledger");
  if (currentLedger?.invalidLines !== 0 || priorLedger?.invalidLines !== 0) bad("invalid_lines");
  if (current?.settlementReconciliation?.issues && Object.keys(current.settlementReconciliation.issues).length !== 0) {
    bad("current_issues");
  }
  for (const name of ["internal", "validation"]) {
    const left = bucket(priorLedger?.byClass, name);
    const right = bucket(currentLedger?.byClass, name);
    if (left.settlements !== right.settlements || left.amountAtomic !== right.amountAtomic) bad(`${name}_moved`);
  }
  if (bucket(priorLedger?.byClass, "internal").settlements !== 12) bad("internal_count");
  if (bucket(priorLedger?.byClass, "internal").amountAtomic !== "577000") bad("internal_amount");
  if (bucket(priorLedger?.byClass, "validation").settlements !== 1) bad("validation_count");
  if (bucket(priorLedger?.byClass, "validation").amountAtomic !== "10000") bad("validation_amount");

  const routes = new Set([
    ...Object.keys(priorLedger?.byRoute || {}),
    ...Object.keys(currentLedger?.byRoute || {}),
  ]);
  const deltas = [];
  for (const route of routes) {
    const left = bucket(priorLedger.byRoute, route);
    const right = bucket(currentLedger.byRoute, route);
    const settlementDelta = right.settlements - left.settlements;
    const amountDelta = BigInt(right.amountAtomic) - BigInt(left.amountAtomic);
    if (settlementDelta !== 0 || amountDelta !== 0n) {
      deltas.push({ route, settlementDelta, amountDelta: amountDelta.toString() });
    }
  }
  const expected = [
    { route: "/extract", settlementDelta: 1, amountDelta: "5000" },
    { route: "/defi/morpho-position", settlementDelta: 1, amountDelta: "20000" },
  ];
  const same = deltas.length === expected.length && expected.every((row) => deltas.some((delta) => (
    delta.route === row.route
    && delta.settlementDelta === row.settlementDelta
    && delta.amountDelta === row.amountDelta
  )));
  if (!same) bad("route_delta");

  const unclassifiedPrior = bucket(priorLedger?.byClass, "unclassified");
  const unclassifiedCurrent = bucket(currentLedger?.byClass, "unclassified");
  if (unclassifiedCurrent.settlements - unclassifiedPrior.settlements !== 2) bad("unclassified_count");
  if ((BigInt(unclassifiedCurrent.amountAtomic) - BigInt(unclassifiedPrior.amountAtomic)) !== 25000n) {
    bad("unclassified_amount");
  }

  if (paidCount(prior, "/extract") !== 0 || paidCount(current, "/extract") !== 1) bad("extract_paid_window");
  if (paidCount(prior, "/defi/morpho-position") !== 1 || paidCount(current, "/defi/morpho-position") !== 2) {
    bad("morpho_paid_window");
  }
  const paidTotal = Object.values(current.paidSuccessByRoute || {}).reduce((sum, value) => sum + value, 0);
  if (current.paidSuccessByProtocol?.x402 !== paidTotal) bad("protocol");
  if (Object.keys(current.paidSuccessByProtocol || {}).length !== 1) bad("protocol");
  const discovery = current.paidSuccessByDiscoverySourceRoute?.["direct-or-unattributed"] || {};
  if (discovery["/extract"] !== 1 || discovery["/defi/morpho-position"] !== 2) bad("discovery_route");
  if (Object.keys(current.paidSuccessByDiscoverySource || {}).some((key) => key !== "direct-or-unattributed")) {
    bad("discovery_source");
  }
  if (populationPaid(current, "unattributedExternal") !== paidTotal) bad("origin_population");
  for (const name of ["verifiedInternal", "selfReportedOwnerMonitor", "scanner", "crawler"]) {
    if (populationPaid(current, name) !== 0) bad("origin_population");
  }
  if (current.missingSettlementReferencePaidSuccesses !== 0) bad("missing_reference_count");
  if (current.settlementEvidenceByClass?.unclassified?.withReference !== paidTotal) bad("reference_coverage");
  if (current.paymentEvidence?.customerPlane?.buyerValidDeliveryCount !== null) bad("buyer_delivery_count");
  if (current.paymentEvidence?.boundaries?.settlementNeverProvesBuyerValidDelivery !== true) bad("delivery_boundary");
  if (current.independentPaidSuccessActors !== 0) bad("independent_actors");

  const priorTime = Date.parse(priorClassified?.chain?.incoming?.time || "");
  const inWindow = (demand) => priorTime >= Date.parse(demand.requestedWindowStart)
    && priorTime <= Date.parse(demand.requestedWindowEnd);
  if (priorClassified?.join?.settlementReference !== PRIOR_REFERENCE) bad("prior_classified_reference");
  if (priorClassified?.join?.route !== "/defi/morpho-position") bad("prior_classified_route");
  if (priorClassified?.join?.amountAtomic !== "20000") bad("prior_classified_amount");
  if (!Number.isFinite(priorTime) || !inWindow(prior) || !inWindow(current)) bad("prior_classified_window");
  return problems;
}

function row({
  route,
  amountAtomic,
  priorWindowCount,
  currentWindowCount,
  extra,
}) {
  return {
    route,
    routeTableMethod: "GET",
    methodObserved: null,
    methodBoundary: "The receipt identifies the path. Merchant source 91e14dce binds this path with app.get. The captured method of this call is not in the receipt.",
    amountAtomic,
    displayUsdc: usdc(amountAtomic),
    settlementReference: null,
    referenceBoundary: "The authorized receipt follows settlementEvidencePolicy: raw transaction references stay private and public output has coverage counts only. Neither receipt contains a transaction hash for this new row. No chain census was run to supply one.",
    paymentClass: "unclassified",
    classificationDecision: "remain_unclassified",
    decisionDate: "2026-10-06",
    protocol: "x402",
    ordinaryRequestJoined: true,
    ordinaryRequestKind: "paid_success",
    priorWindowCount,
    currentWindowCount,
    ledgerDelta: 1,
    eventId: null,
    exactTimestamp: null,
    timestampBoundary: "The row is inside the current complete one-day stream and absent from the prior complete one-day stream. The receipt does not publish the event id or the exact event time.",
    discoverySource: "direct-or-unattributed",
    originPopulation: "unattributed_external",
    actorBoundToSettlement: false,
    customerIdentity: null,
    ownerMarkerAbsenceProvesOutsideBuyer: false,
    independentBuyer: false,
    callerBoundary: "Every paid success in the current complete window is direct-or-unattributed and in unattributedExternal. Verified internal, owner-monitor, scanner, and crawler paid successes are 0. The window has 2 paid-success actors and 1 repeat across 3 successes, with no actor-to-route binding. A missing owner marker does not prove an outside buyer. independentPaidSuccessActors is 0.",
    deliveryRecordPresent: false,
    copiedFromPriorDelivery: false,
    sufficiency: "unknown",
    acceptance: "unknown",
    usefulness: "unknown",
    deliveryBoundary: "The receipt has no validation row, response digest, schema verdict, or captured body for this settlement. buyerValidDeliveryCount is null, and settlementNeverProvesBuyerValidDelivery is true. The seller-integrity diagnostic plane is a different route and has 0 observations. Rare-funnel coverage for the requested window is unknown_for_full_window, so that store is not this delivery record. Prior extract and Morpho delivery facts are not copied.",
    ...extra,
  };
}

export function buildEvidence(parts) {
  const problems = anchorProblems(parts);
  if (problems.length) {
    const error = new Error(problems.join(","));
    error.code = "anchor";
    error.problems = problems;
    throw error;
  }
  const { current, prior, currentReceiving, priorReceiving, hashes, priorClassified } = parts;
  const currentLedger = current.settlementReconciliation.ledger;
  const priorLedger = prior.settlementReconciliation.ledger;
  return {
    schema: SCHEMA,
    jobId: "ROOT-1006-SETTLEMENT-JOIN",
    decisionDate: "2026-10-06",
    cash: 0,
    newTelemetryLedger: false,
    chainCensus: false,
    handlerChange: false,
    merchantSourceSha: "91e14dce308c9d049d6422a4a6570919db46875a",
    pilotMainHeadAtAdmit: "5f9f50de08181d7980b2adca1ffdb7a946e4bda2",
    pilotMainHeadVerifiedThisRun: false,
    sources: {
      currentDemand: {
        path: CURRENT_DEMAND,
        sha256: hashes.currentDemand,
        bytes: parts.currentBytes,
        generatedAt: current.generatedAt,
      },
      currentReceiving: {
        path: CURRENT_RECEIVING,
        sha256: hashes.currentReceiving,
        status: currentReceiving.status,
        bytes: currentReceiving.bytes,
        classification: currentReceiving.classification,
        cash: currentReceiving.cash,
        url: currentReceiving.url || null,
        startedAt: currentReceiving.startedAt,
        receivedAt: currentReceiving.receivedAt,
      },
      priorDemand: {
        path: PRIOR_DEMAND,
        sha256: hashes.priorDemand,
        bytes: parts.priorBytes,
        generatedAt: prior.generatedAt,
        role: "received_47_cut",
      },
      priorReceiving: {
        path: PRIOR_RECEIVING,
        sha256: hashes.priorReceiving,
        status: priorReceiving.status,
        bytes: priorReceiving.bytes,
        classification: priorReceiving.classification,
        cash: priorReceiving.cash,
        url: priorReceiving.url || null,
      },
      priorClassifiedSettlement: {
        path: "experiments/incoming-cash-trace-1005/EVIDENCE.json",
        sha256: hashes.priorClassified,
        role: "already_classified_excluded",
      },
      paymentClassPolicy: current.paymentClassPolicy,
    },
    owners: {
      canonicalSettlement: "unchanged",
      canonicalSettlementSymbol: "reconcileCommerceSettlementEvents",
      classification: "unchanged",
      classificationRule: "unknown or missing payer identity remains unclassified",
      internalSettlements: 12,
      internalAmountAtomic: "577000",
      internalDisplayUsdc: usdc("577000"),
      validationSettlements: 1,
      validationAmountAtomic: "10000",
      validationDisplayUsdc: usdc("10000"),
    },
    ledger: {
      canonicalCountSource: "settlementReconciliation.ledger.reconciledSettlements",
      priorSettlements: priorLedger.reconciledSettlements,
      currentSettlements: currentLedger.reconciledSettlements,
      priorAmountAtomic: priorLedger.amountAtomic,
      currentAmountAtomic: currentLedger.amountAtomic,
      priorDisplayUsdc: usdc(priorLedger.amountAtomic),
      currentDisplayUsdc: usdc(currentLedger.amountAtomic),
      settlementDelta: 2,
      amountAtomicDelta: "25000",
      displayUsdcDelta: usdc("25000"),
      unclassifiedSettlementDelta: 2,
      unclassifiedAmountAtomicDelta: "25000",
      issueCount: Object.keys(current.settlementReconciliation.issues || {}).length,
      invalidLines: currentLedger.invalidLines,
      reconciledThisRun: current.settlementReconciliation.lastScan.reconciledThisRun,
      priorEligibleSettlementReferences: prior.settlementReconciliation.lastScan.eligibleSettlementReferences,
      currentEligibleSettlementReferences: current.settlementReconciliation.lastScan.eligibleSettlementReferences,
      windowDistinctSettlementReferences: current.distinctSettlementReferences,
      windowCountIsNotCanonical: true,
      currentStreamCoverage: current.requestedWindowCoverage,
      rareFunnelCoverage: current.durableRareFunnel.coverage.requestedWindowCoverage,
    },
    excludedPriorSettlement: {
      settlementReference: priorClassified.join.settlementReference,
      route: priorClassified.join.route,
      amountAtomic: priorClassified.join.amountAtomic,
      time: priorClassified.chain.incoming.time,
      countedAsNew: false,
      reason: "This reference is the already classified 2026-10-05 Morpho settlement inside both one-day windows. The current window's second Morpho paid success is the new row.",
    },
    settlements: [
      row({
        route: "/extract",
        amountAtomic: "5000",
        priorWindowCount: 0,
        currentWindowCount: 1,
        extra: { retainedAlreadyClassifiedInsideBothWindows: false },
      }),
      row({
        route: "/defi/morpho-position",
        amountAtomic: "20000",
        priorWindowCount: 1,
        currentWindowCount: 2,
        extra: { retainedAlreadyClassifiedInsideBothWindows: true },
      }),
    ],
    notTheseSettlements: {
      routes: ["/schemaforge", "/read"],
      reason: "Current-window credential attempts on /schemaforge and /read are not paid successes and did not move the settlement ledger.",
    },
    repair: {
      needed: false,
      reason: "Each new atomic amount joins one route by the ledger delta, and the complete paid-success stream moves by the same one count on that route. The receipt's known-payer rule leaves both unclassified because no payer identity is present. No delivery row is in the receipt to correct. Publishing the withheld transaction references, backfilling a body, or opening a new telemetry ledger is outside this receipt.",
    },
  };
}

async function loadReceipts() {
  const files = await Promise.all([
    readFile(CURRENT_DEMAND),
    readFile(CURRENT_RECEIVING),
    readFile(PRIOR_DEMAND),
    readFile(PRIOR_RECEIVING),
    readFile(PRIOR_CLASSIFIED),
  ]);
  const [currentBytes, currentReceivingBytes, priorBytes, priorReceivingBytes, priorClassifiedBytes] = files;
  return {
    current: JSON.parse(currentBytes.toString("utf8")),
    currentReceiving: JSON.parse(currentReceivingBytes.toString("utf8")),
    prior: JSON.parse(priorBytes.toString("utf8")),
    priorReceiving: JSON.parse(priorReceivingBytes.toString("utf8")),
    priorClassified: JSON.parse(priorClassifiedBytes.toString("utf8")),
    currentBytes: currentBytes.length,
    priorBytes: priorBytes.length,
    hashes: {
      currentDemand: sha256(currentBytes),
      currentReceiving: sha256(currentReceivingBytes),
      priorDemand: sha256(priorBytes),
      priorReceiving: sha256(priorReceivingBytes),
      priorClassified: sha256(priorClassifiedBytes),
    },
  };
}

export async function evidenceFromReceipts() {
  return buildEvidence(await loadReceipts());
}

function mutateInternal(parts) {
  const copy = structuredClone(parts);
  copy.current.settlementReconciliation.ledger.byClass.internal.settlements = 13;
  return copy;
}

async function selfTest() {
  const parts = await loadReceipts();
  const evidence = buildEvidence(parts);
  const found = violations(evidence);
  if (found.length) {
    console.error(JSON.stringify({ ok: false, stage: "live", violations: found }));
    process.exit(1);
  }
  let refused = false;
  try {
    buildEvidence(mutateInternal(parts));
  } catch (error) {
    refused = error.code === "anchor" && error.problems.includes("internal_moved");
  }
  if (!refused) {
    console.error(JSON.stringify({ ok: false, stage: "seeded_internal_move", refused }));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    liveViolations: found,
    seededInternalMove: "rejected",
    settlements: evidence.settlements.map((rowItem) => ({
      route: rowItem.route,
      amountAtomic: rowItem.amountAtomic,
      settlementReference: rowItem.settlementReference,
      paymentClass: rowItem.paymentClass,
    })),
  }));
  return evidence;
}

async function main() {
  const write = process.argv.includes("--write");
  const checkLive = process.argv.includes("--check-live");
  const self = process.argv.includes("--self-test");
  if (self) {
    await selfTest();
    return;
  }
  const evidence = await evidenceFromReceipts();
  const found = violations(evidence);
  if (found.length) {
    console.error(JSON.stringify({ ok: false, violations: found }));
    process.exit(1);
  }
  const text = stableString(evidence);
  if (write) {
    const out = new URL("./EVIDENCE.json", import.meta.url);
    await writeFile(out, text);
  }
  if (checkLive) {
    const committed = await readFile(new URL("./EVIDENCE.json", import.meta.url), "utf8");
    if (committed !== text) {
      console.error(JSON.stringify({ ok: false, violations: ["evidence_drift"] }));
      process.exit(1);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    currentSettlements: evidence.ledger.currentSettlements,
    priorSettlements: evidence.ledger.priorSettlements,
    amountAtomicDelta: evidence.ledger.amountAtomicDelta,
    settlements: evidence.settlements.map((rowItem) => ({
      route: rowItem.route,
      amountAtomic: rowItem.amountAtomic,
      displayUsdc: rowItem.displayUsdc,
      settlementReference: rowItem.settlementReference,
      paymentClass: rowItem.paymentClass,
      sufficiency: rowItem.sufficiency,
      acceptance: rowItem.acceptance,
    })),
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(error.code === "anchor" ? 2 : 1);
  });
}
