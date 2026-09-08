import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  parseAbiItem,
} from "viem";

import {
  createCommerceTelemetry,
  sanitizeSettlementSourceDeliveryAttribution,
  summarizeSettlementSourceDelivery,
  unknownSettlementSourceDeliverySummary,
} from "./commerce-events.mjs";
import {
  BASE_USDC,
  createCommerceSettlementReconciler,
  reconcileCommerceSettlementEvents,
  summarizeCommerceSettlementLedger,
  summarizeSettlementSourceDelivery as summarizeFromReconciler,
} from "./commerce-settlement-reconciler.mjs";
import { buildCommercePaymentEvidenceReadout } from "./commerce-payment-evidence.mjs";

const SECRET = "settlement-source-delivery-test-secret";
const PAYER = "0x1111111111111111111111111111111111111111";
const TREASURY = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const REFERENCE = `0x${"a".repeat(64)}`;
const REFERENCE_B = `0x${"b".repeat(64)}`;
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
// Synthetic identifiers model the rotation gap without publishing live traces.
const HISTORICAL_MORPHO_EVENT_ID = "00000000-0000-4000-8000-000000000010";
const HISTORICAL_EXTRACT_EVENT_ID = "00000000-0000-4000-8000-000000000011";

function actorFor(address) {
  return createHmac("sha256", SECRET)
    .update(`payer:${address.toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
}

function event(overrides = {}) {
  return {
    v: 3,
    id: "00000000-0000-4000-8000-000000000001",
    ts: "2026-09-05T01:16:09.391Z",
    originClass: "external",
    agentDiscoverySource: null,
    declaredAgentDiscoverySource: null,
    observedAgentDiscoverySource: null,
    discoverySourceKind: "none",
    route: "/defi/morpho-position",
    result: "paid_success",
    status: 200,
    paymentProtocol: "x402",
    paymentActor: actorFor(PAYER),
    settlementReference: REFERENCE,
    settlementAmountAtomic: "20000",
    settlementNetwork: "eip155:8453",
    settlementCurrency: BASE_USDC,
    ...overrides,
  };
}

function receipt({ amount = 20000n, from = PAYER, status = "success", to = TREASURY } = {}) {
  return {
    status,
    blockNumber: 123n,
    logs: [{
      address: getAddress(BASE_USDC),
      topics: encodeEventTopics({
        abi: [TRANSFER],
        eventName: "Transfer",
        args: { from: getAddress(from), to: getAddress(to) },
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    }],
  };
}

function clientFor(value) {
  return {
    async getTransactionReceipt() { return value; },
    async getBlock() { return { timestamp: 1_754_742_000n }; },
  };
}

async function reconcile(events, value = receipt(), ledgerContents = "") {
  return reconcileCommerceSettlementEvents(
    events.map((item) => JSON.stringify(item)).join("\n"),
    ledgerContents,
    {
      actorSecret: SECRET,
      client: clientFor(value),
      payerClasses: [{ address: PAYER, class: "validation" }],
      settlementEvidenceSince: "2026-08-09T13:49:54.000Z",
      treasury: TREASURY,
      now: () => new Date("2026-09-07T20:00:00.000Z"),
    },
  );
}

test("reconcile snapshots allowlisted source and delivery facts and they survive event rotation", async () => {
  const sourced = event({
    id: HISTORICAL_MORPHO_EVENT_ID,
    declaredAgentDiscoverySource: "agent-skills",
    observedAgentDiscoverySource: "agent402",
    discoverySourceKind: "declared_header",
    agentDiscoverySource: "agent-skills",
  });
  const result = await reconcile([sourced]);
  assert.equal(result.issues.length, 0);
  assert.equal(result.newRecords.length, 1);
  const record = result.newRecords[0];
  assert.equal(record.paymentClass, "validation");
  assert.equal(record.payerContinuity, "matched_request_pseudonym");
  assert.equal(record.sourceDeliveryAttribution.originClass, "external");
  assert.equal(record.sourceDeliveryAttribution.originVerification, "unverified");
  assert.equal(record.sourceDeliveryAttribution.declaredDiscoverySource, "agent-skills");
  assert.equal(record.sourceDeliveryAttribution.observedDiscoverySource, "agent402");
  assert.equal(record.sourceDeliveryAttribution.discoverySourceKind, "declared_header");
  assert.equal(record.sourceDeliveryAttribution.discoverySourceVerification, "unverified");
  assert.equal(record.sourceDeliveryAttribution.responseStatus, 200);
  assert.equal(record.sourceDeliveryAttribution.responseResult, "paid_success");
  assert.equal(record.sourceDeliveryAttribution.buyerValidOutput, "unknown");
  assert.equal(record.sourceDeliveryAttribution.deliveryValidation, "not_checked");
  assert.equal(record.sourceDeliveryAttribution.customerDemand, "unknown");
  assert.equal(record.sourceDeliveryAttribution.repeatDemand, "unknown");

  const dir = await mkdtemp(path.join(tmpdir(), "c15-rotate-"));
  try {
    const currentPath = path.join(dir, "commerce-events.ndjson");
    const rotatedPath = path.join(dir, "commerce-events.1.ndjson");
    await writeFile(currentPath, `${JSON.stringify(sourced)}\n`);
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: SECRET,
      client: clientFor(receipt()),
      dataDir: dir,
      eventPaths: [rotatedPath, currentPath],
      payerClasses: [{ address: PAYER, class: "validation" }],
      settlementEvidenceSince: "2026-08-09T13:49:54.000Z",
      treasury: TREASURY,
    });
    const run = await reconciler.reconcile();
    assert.equal(run.lastError, null);
    await writeFile(rotatedPath, `${JSON.stringify(sourced)}\n`);
    await writeFile(currentPath, "");
    await rm(rotatedPath);
    const ledger = await readFile(path.join(dir, "commerce-settlements.ndjson"), "utf8");
    assert.equal(ledger.includes(HISTORICAL_MORPHO_EVENT_ID), true);
    assert.equal(ledger.includes("agent-skills-v1"), false);
    const persisted = JSON.parse(ledger.trim());
    assert.equal(persisted.sourceDeliveryAttribution.declaredDiscoverySource, "agent-skills");
    assert.equal(persisted.sourceDeliveryAttribution.buyerValidOutput, "unknown");
    const summary = summarizeFromReconciler(persisted);
    assert.equal(summary.sourceEventId, HISTORICAL_MORPHO_EVENT_ID);
    assert.equal(summary.discoverySourceKind, "declared_header");
    assert.equal(summary.customerDemand, "unknown");
    assert.equal(JSON.stringify(summary).includes(PAYER), false);
    const publicSummary = summarizeCommerceSettlementLedger(ledger);
    assert.equal(publicSummary.reconciledSettlements, 1);
    assert.equal(JSON.stringify(publicSummary).includes("agent-skills"), false);
    assert.equal(JSON.stringify(publicSummary).includes(HISTORICAL_MORPHO_EVENT_ID), false);
    assert.equal(JSON.stringify(publicSummary).includes(REFERENCE), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy events without split stay truthful unknown and do not invent a declared source", async () => {
  const legacy = event({
    id: HISTORICAL_EXTRACT_EVENT_ID,
    ts: "2026-09-05T02:14:51.444Z",
    route: "/extract",
    settlementAmountAtomic: "5000",
  });
  delete legacy.declaredAgentDiscoverySource;
  delete legacy.observedAgentDiscoverySource;
  delete legacy.discoverySourceKind;
  const result = await reconcile([legacy], receipt({ amount: 5000n }));
  assert.equal(result.newRecords.length, 1);
  const attribution = result.newRecords[0].sourceDeliveryAttribution;
  assert.equal(attribution.declaredDiscoverySource, null);
  assert.equal(attribution.observedDiscoverySource, null);
  assert.equal(attribution.discoverySourceKind, "unknown");
  assert.equal(attribution.discoverySourceVerification, "unknown");
  assert.equal(attribution.originClass, "external");
  assert.equal(attribution.originVerification, "unverified");
  assert.equal(attribution.buyerValidOutput, "unknown");
  assert.equal(attribution.customerDemand, "unknown");
});

test("source spoof and unknown identity stay unverified and never become customers", async () => {
  const spoofed = event({
    originClass: "independent_customer",
    agentDiscoverySource: "vip-buyer",
    declaredAgentDiscoverySource: "independent",
    observedAgentDiscoverySource: null,
    discoverySourceKind: "declared_header",
  });
  const result = await reconcile([spoofed]);
  assert.equal(result.issues.length, 0);
  assert.equal(result.newRecords.length, 1);
  assert.equal(result.newRecords[0].sourceDeliveryAttribution, undefined);
  const collapsedSpoof = event({
    originClass: "customer",
    agentDiscoverySource: "vip-buyer",
  });
  delete collapsedSpoof.declaredAgentDiscoverySource;
  delete collapsedSpoof.observedAgentDiscoverySource;
  delete collapsedSpoof.discoverySourceKind;
  const collapsed = await reconcile([collapsedSpoof], receipt(), "");
  assert.equal(collapsed.newRecords.length, 1);
  assert.equal(collapsed.newRecords[0].sourceDeliveryAttribution.originClass, "unknown");
  assert.equal(collapsed.newRecords[0].sourceDeliveryAttribution.originVerification, "unknown");
  assert.equal(collapsed.newRecords[0].sourceDeliveryAttribution.collapsedDiscoverySource, null);
  assert.equal(collapsed.newRecords[0].sourceDeliveryAttribution.discoverySourceVerification, "unknown");
  assert.equal(collapsed.newRecords[0].sourceDeliveryAttribution.customerDemand, "unknown");
});

test("published runtime declared sources stay unverified through settlement composition", async () => {
  for (const source of ["claude-code-marketplace", "goose-native"]) {
    const result = await reconcile([event({
      declaredAgentDiscoverySource: source,
      observedAgentDiscoverySource: null,
      discoverySourceKind: "declared_header",
      agentDiscoverySource: source,
    })]);
    assert.equal(result.issues.length, 0);
    assert.equal(result.newRecords.length, 1);
    const attribution = result.newRecords[0].sourceDeliveryAttribution;
    assert.equal(attribution.declaredDiscoverySource, source);
    assert.equal(attribution.collapsedDiscoverySource, source);
    assert.equal(attribution.discoverySourceKind, "declared_header");
    assert.equal(attribution.discoverySourceVerification, "unverified");
    assert.equal(attribution.originVerification, "unverified");
    assert.equal(attribution.customerDemand, "unknown");
    assert.equal(attribution.buyerValidOutput, "unknown");
    assert.equal(JSON.stringify(result.newRecords[0]).includes(`${source}-v1`), false);
  }
});

test("contradictory or invalid metadata is omitted without blocking valid settlement", async () => {
  const contradictory = event({
    declaredAgentDiscoverySource: null,
    observedAgentDiscoverySource: "agent402",
    discoverySourceKind: "declared_header",
    agentDiscoverySource: "agent402",
  });
  const result = await reconcile([contradictory]);
  assert.equal(result.issues.length, 0);
  assert.equal(result.newRecords.length, 1);
  assert.equal(result.newRecords[0].amountAtomic, "20000");
  assert.equal(result.newRecords[0].sourceDeliveryAttribution, undefined);
});

test("hostile extra fields never copy secrets, bodies, URLs, or credentials into the ledger", async () => {
  const hostile = event({
    apiKey: "sk-live-secret-do-not-store",
    authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.secret",
    rawUrl: "https://buyer.example/extract?wallet=0xdead&query=private",
    requestBody: "{\"ssn\":\"123-45-6789\"}",
    responseBody: "{\"email\":\"buyer@example.com\"}",
    userAgent: "Mozilla/5.0 secret-ua",
    declaredAgentDiscoverySource: "agent-skills",
    observedAgentDiscoverySource: null,
    discoverySourceKind: "declared_header",
    agentDiscoverySource: "agent-skills",
  });
  const result = await reconcile([hostile]);
  const encoded = JSON.stringify(result.newRecords[0]);
  assert.equal(result.newRecords.length, 1);
  assert.equal(encoded.includes("sk-live-secret-do-not-store"), false);
  assert.equal(encoded.includes("eyJhbGciOiJIUzI1NiJ9"), false);
  assert.equal(encoded.includes("buyer.example"), false);
  assert.equal(encoded.includes("123-45-6789"), false);
  assert.equal(encoded.includes("buyer@example.com"), false);
  assert.equal(encoded.includes("secret-ua"), false);
  assert.equal(encoded.includes("apiKey"), false);
  assert.equal(encoded.includes("requestBody"), false);
  assert.equal(result.newRecords[0].sourceDeliveryAttribution.declaredDiscoverySource, "agent-skills");
  const keys = Object.keys(result.newRecords[0].sourceDeliveryAttribution).sort();
  assert.deepEqual(keys, [
    "buyerValidOutput",
    "collapsedDiscoverySource",
    "customerDemand",
    "declaredDiscoverySource",
    "deliveryValidation",
    "deliveryValidationAuthority",
    "discoverySourceKind",
    "discoverySourceVerification",
    "observedDiscoverySource",
    "originClass",
    "originVerification",
    "repeatDemand",
    "responseResult",
    "responseStatus",
    "schemaVersion",
  ]);
});

test("legacy ledger rows stay unchanged and the helper reports truthful unknown", () => {
  const legacyRow = {
    schemaVersion: "samedaydesk.commerce-settlement-reconciliation.v1",
    reconciliationId: `sddsr_${"b".repeat(40)}`,
    reconciledAt: "2026-08-09T15:00:00.000Z",
    state: "reconciled",
    sourceEventId: "event-1",
    sourceEventTimestamp: "2026-08-09T14:00:00.000Z",
    route: "/extract",
    protocol: "x402",
    paymentClass: "unclassified",
    settlementReference: REFERENCE,
    network: "eip155:8453",
    asset: BASE_USDC,
    treasury: TREASURY,
    amountAtomic: "5000",
    blockNumber: "123",
    blockTimestamp: "2026-08-09T14:00:00.000Z",
    payerContinuity: "matched_request_pseudonym",
  };
  const encoded = JSON.stringify(legacyRow);
  assert.equal(encoded.includes("sourceDeliveryAttribution"), false);
  const summary = summarizeSettlementSourceDelivery(legacyRow);
  assert.deepEqual(summary.originClass, unknownSettlementSourceDeliverySummary().originClass);
  assert.equal(summary.discoverySourceKind, "unknown");
  assert.equal(summary.buyerValidOutput, "unknown");
  assert.equal(summary.customerDemand, "unknown");
  assert.equal(summary.repeatDemand, "unknown");
  assert.equal(summary.settlementState, "reconciled");
  assert.equal(summary.route, "/extract");
  assert.equal(summary.sourceEventId, "event-1");
  const publicSummary = summarizeCommerceSettlementLedger(`${encoded}\n`);
  assert.equal(publicSummary.reconciledSettlements, 1);
  assert.deepEqual(Object.keys(publicSummary).sort(), [
    "amountAtomic",
    "byClass",
    "byRoute",
    "distinctSettlementReferences",
    "invalidLines",
    "reconciledSettlements",
    "schemaVersion",
  ]);
});

test("duplicate replay does not rewrite an existing row or backfill attribution", async () => {
  const first = await reconcile([event()]);
  assert.equal(first.newRecords.length, 1);
  const withoutAttribution = { ...first.newRecords[0] };
  delete withoutAttribution.sourceDeliveryAttribution;
  const second = await reconcile(
    [event({
      declaredAgentDiscoverySource: "agentverse",
      observedAgentDiscoverySource: null,
      discoverySourceKind: "declared_header",
      agentDiscoverySource: "agentverse",
    })],
    receipt(),
    JSON.stringify(withoutAttribution),
  );
  assert.equal(second.alreadyReconciled, 1);
  assert.equal(second.newRecords.length, 0);
  assert.equal(second.issues.length, 0);
});

test("concurrent eligible references still fail closed on duplicates and preserve one-write semantics", async () => {
  const duplicate = await reconcile([
    event({ id: "00000000-0000-4000-8000-000000000001" }),
    event({ id: "00000000-0000-4000-8000-000000000002" }),
  ]);
  assert.deepEqual(duplicate.issues.map((item) => item.code), ["duplicate_paid_event_reference"]);
  assert.equal(duplicate.newRecords.length, 0);

  const distinct = await reconcile([
    event({ id: HISTORICAL_MORPHO_EVENT_ID, settlementReference: REFERENCE }),
    event({
      id: HISTORICAL_EXTRACT_EVENT_ID,
      ts: "2026-09-05T02:14:51.444Z",
      route: "/extract",
      settlementReference: REFERENCE_B,
      settlementAmountAtomic: "5000",
    }),
  ], receipt());
  // The mocked client returns the morpho amount for every hash, so the extract
  // row mismatches and must not be invented as settled.
  assert.equal(distinct.newRecords.length, 1);
  assert.equal(distinct.newRecords[0].sourceEventId, HISTORICAL_MORPHO_EVENT_ID);
  assert.equal(distinct.issues.some((item) => item.code === "response_amount_mismatch"), true);
});

test("public payment-evidence schema consumers keep customer and buyer-valid planes null", () => {
  const record = {
    schemaVersion: "samedaydesk.commerce-settlement-reconciliation.v1",
    state: "reconciled",
    sourceEventId: HISTORICAL_MORPHO_EVENT_ID,
    route: "/defi/morpho-position",
    paymentClass: "unclassified",
    settlementReference: REFERENCE,
    amountAtomic: "20000",
    sourceDeliveryAttribution: sanitizeSettlementSourceDeliveryAttribution(event({
      id: HISTORICAL_MORPHO_EVENT_ID,
      declaredAgentDiscoverySource: "agent-skills",
      observedAgentDiscoverySource: null,
      discoverySourceKind: "declared_header",
      agentDiscoverySource: "agent-skills",
    })),
  };
  const ledgerSummary = summarizeCommerceSettlementLedger(`${JSON.stringify(record)}\n`);
  const readout = buildCommercePaymentEvidenceReadout({
    eventSnapshot: {
      paidSuccessActors: 0,
      repeatPaidSuccessActors: 0,
      requestedWindowStart: "2026-09-01T00:00:00.000Z",
      requestedWindowCoverage: "unknown_for_full_window",
      coverage: { metrics: { external: { coverage: "unknown_for_full_window" } } },
    },
    settlementReconciliation: {
      enabled: true,
      settlementEvidenceSince: "2026-08-09T13:49:54.000Z",
      ledger: ledgerSummary,
    },
  });
  assert.equal(readout.customerPlane.attributableCustomerCount, null);
  assert.equal(readout.customerPlane.buyerValidDeliveryCount, null);
  assert.equal(readout.customerPlane.repeatIndependentCustomerCount, null);
  assert.equal(JSON.stringify(readout).includes("agent-skills"), false);
  assert.equal(JSON.stringify(readout).includes(HISTORICAL_MORPHO_EVENT_ID), false);
  assert.equal(ledgerSummary.reconciledSettlements, 1);
});

test("baseline limitation: HTTP 200 paid_success is not buyer-valid output and settlement is not demand", () => {
  const attribution = sanitizeSettlementSourceDeliveryAttribution(event({ status: 200, result: "paid_success" }));
  assert.equal(attribution.responseStatus, 200);
  assert.equal(attribution.responseResult, "paid_success");
  assert.equal(attribution.buyerValidOutput, "unknown");
  assert.equal(attribution.deliveryValidation, "not_checked");
  assert.equal(attribution.customerDemand, "unknown");
  assert.equal(attribution.repeatDemand, "unknown");
  assert.notEqual(attribution.originVerification, "verified_internal_token");
});

test("real HTTP writer to reconciliation and rotation keeps source claims distinct from token authority", async () => {
  for (const [suppliedToken, expectedClass, expectedVerification] of [
    [undefined, "owner_monitor", "unverified"],
    ["wrong-token", "owner_monitor", "unverified"],
    ["test-owner-token-with-at-least-32-bytes", "internal", "verified_internal_token"],
  ]) {
    const dir = await mkdtemp(path.join(tmpdir(), "c15-writer-review-"));
    try {
      const telemetry = createCommerceTelemetry({
        dataDir: dir, secret: SECRET,
        internalToken: "test-owner-token-with-at-least-32-bytes",
      });
      const listeners = new Map();
      const response = Buffer.from(JSON.stringify({
        success: true, transaction: REFERENCE, network: "eip155:8453",
      })).toString("base64");
      telemetry.middleware({
        path: "/extract", url: "/extract?url=https://private.example/secret-query",
        method: "GET", query: { url: "https://private.example/secret-query" },
        headers: {
          "user-agent": "SameDayDesk-Monitor/claimed-not-proven",
          "x-samedaydesk-internal": suppliedToken,
          "x-samedaydesk-agent-source": "agent-skills-v1",
          "payment-signature": Buffer.from(JSON.stringify({ payload: { authorization: { from: PAYER } } })).toString("base64"),
        }, ip: "203.0.113.90", socket: {},
      }, {
        statusCode: 200,
        once(name, listener) { listeners.set(name, listener); },
        getHeader(name) { return name.toLowerCase() === "payment-response" ? response : undefined; },
      }, () => {});
      listeners.get("finish")();
      await telemetry.flush();
      const eventPath = path.join(dir, "commerce-events.ndjson");
      const written = JSON.parse((await readFile(eventPath, "utf8")).trim());
      assert.equal(written.result, "paid_success");
      assert.equal(written.originClass, expectedClass);
      const reconciler = createCommerceSettlementReconciler({
        actorSecret: SECRET, client: clientFor(receipt()), dataDir: dir,
        eventPaths: [eventPath], treasury: TREASURY,
        settlementEvidenceSince: "2020-01-01T00:00:00.000Z",
      });
      await Promise.all([reconciler.reconcile(), reconciler.reconcile()]);
      const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
      const raw = await readFile(ledgerPath, "utf8");
      const rows = raw.trim().split("\n").map(JSON.parse);
      assert.equal(rows.length, 1);
      const source = rows[0].sourceDeliveryAttribution;
      assert.equal(source.originVerification, expectedVerification);
      assert.equal(source.declaredDiscoverySource, "agent-skills");
      assert.equal(source.discoverySourceVerification, "unverified");
      assert.equal(source.buyerValidOutput, "unknown");
      for (const secret of ["private.example", "secret-query", "claimed-not-proven", "test-owner-token", "payment-signature"]) {
        assert.equal(raw.includes(secret), false);
      }
      await rm(eventPath);
      await reconciler.reconcile();
      assert.equal(await readFile(ledgerPath, "utf8"), raw);
      assert.equal(summarizeSettlementSourceDelivery(rows[0]).originVerification, expectedVerification);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("malformed optional ledger attribution stays unknown without changing money, identity, or replay", async () => {
  const first = await reconcile([event()]);
  const record = first.newRecords[0];
  const originalSummary = summarizeCommerceSettlementLedger(JSON.stringify(record));
  for (const malformed of [null, [], "bad", { ...record.sourceDeliveryAttribution, originVerification: "verified_owner_monitor_ua" },
    { ...record.sourceDeliveryAttribution, declaredDiscoverySource: "agent-skills", discoverySourceKind: "none" },
    { ...record.sourceDeliveryAttribution, rawRequest: "secret" }]) {
    const row = { ...record, sourceDeliveryAttribution: malformed };
    const encoded = JSON.stringify(row);
    assert.deepEqual(summarizeCommerceSettlementLedger(encoded), originalSummary);
    assert.equal(summarizeSettlementSourceDelivery(row).originClass, "unknown");
    const replay = await reconcile([event()], receipt(), encoded);
    assert.equal(replay.alreadyReconciled, 1);
    assert.equal(replay.newRecords.length, 0);
    assert.equal(replay.invalidLedgerLines, 0);
  }
});
