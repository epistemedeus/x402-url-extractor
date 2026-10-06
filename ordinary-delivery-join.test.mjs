import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isCanonicalMcpTypedCommerceEvent } from "./commerce-events.mjs";
import { SCHEMA_VERSION } from "./commerce-settlement-reconciler.mjs";
import {
  authorizeOutcomeBinding,
  buildHttpFinishForwardRecords,
  buildTaskRefRecord,
  isForwardV2Record,
  isSchemaValidDeliveryEvidence,
} from "./commerce-outcome-binding.mjs";
import { bindMerchantHttpDeliveryContracts } from "./http-delivery-evidence/bind-merchant-contracts.mjs";
import { SETTLEMENT_CLASS } from "./http-delivery-evidence/classify.mjs";
import { digestMcpCallId, digestMcpPayload, digestResponseBytes } from "./http-delivery-evidence/digest.mjs";
import { MCP_MORPHO_RESOURCE } from "./http-delivery-evidence/mcp-delivery.mjs";
import {
  recordFromObservedMcpDelivery,
  sealObservedMcpToolResult,
} from "./http-delivery-evidence/mcp-delivery.mjs";
import { recordFromObservedResponse as recordHttp } from "./http-delivery-evidence/store.mjs";
import { extractCapture, historicalV1Row, validExtractBody } from "./http-delivery-evidence/test/helpers.mjs";
import {
  FILE_CLASSES,
  PRODUCER_BASE_SHA,
  joinOrdinaryDeliveries,
  receiveOrdinaryDeliveryJoin,
  reportViolations,
} from "./ordinary-delivery-join.mjs";

bindMerchantHttpDeliveryContracts();

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const SHA = PRODUCER_BASE_SHA;
const WINDOW_START = "2026-10-06T00:00:00.000Z";
const WINDOW_END = "2026-10-06T04:00:00.000Z";
const TOKEN = "ordinary-delivery-join-test-token-32";
const OFFER = "ab".repeat(32);
const UPSTREAM = "synthetic-upstream-marker";

const id = (n) => `10061006-1006-4006-8006-${String(n).padStart(12, "0")}`;
const ref = (digit) => `0x${String(digit).repeat(64)}`;
const at = (minute) => `2026-10-06T01:${String(minute).padStart(2, "0")}:00.000Z`;
const fingerprint = (n) => `${n}${n}`.repeat(32).slice(0, 64);

function ndjson(rows) {
  return `${rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row))).join("\n")}\n`;
}

function observeHttp({ paidEvidenceId, resource, body, settlementReference, requestDigest, capturedAt }) {
  return recordHttp({
    method: "GET",
    resource,
    responseBytes: Buffer.from(JSON.stringify(body)),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.REAL_UNVERIFIED,
    settlementReference,
    payerClass: "unclassified",
    paidEvidenceId,
    requestDigest,
    capturedAt,
  });
}

function paidFrom(validation, fields) {
  return historicalV1Row({
    id: fields.id || validation.paidEvidenceId,
    method: validation?.method || fields.method,
    route: validation?.resource || fields.route,
    requestDigest: validation?.requestDigest || fields.requestDigest,
    responseDigest: validation?.responseDigest || fields.responseDigest,
    settlementReference: fields.settlementReference || validation?.settlementReference,
    requestStartedAt: fields.timestamp,
    responseFinishedAt: fields.timestamp,
    payerClass: fields.payerClass || "unclassified",
    credentialFingerprint: fields.fingerprint,
    paymentProtocol: fields.paymentProtocol || "x402",
    originClass: "external",
    source: "direct-or-unattributed",
  });
}

function ledgerFrom(paid, fields) {
  return {
    schemaVersion: SCHEMA_VERSION,
    state: "reconciled",
    sourceEventId: fields.sourceEventId || paid.id,
    sourceEventTimestamp: fields.timestamp,
    route: fields.route || paid.route,
    protocol: fields.protocol || paid.paymentProtocol,
    paymentClass: fields.paymentClass,
    settlementReference: fields.settlementReference || paid.settlementReference,
    amountAtomic: fields.amountAtomic,
  };
}

function claimFor(operationId, label) {
  return authorizeOutcomeBinding({
    "x-samedaydesk-internal": TOKEN,
    "x-samedaydesk-outcome-operation": operationId,
    "x-samedaydesk-outcome-cohort": "external_unknown",
    "x-samedaydesk-outcome-task": label,
  }, TOKEN);
}

function forwardsFor(paid, validation, operationId) {
  return buildHttpFinishForwardRecords({
    claim: claimFor(operationId, "synthetic-label-forward"),
    event: {
      id: paid.id,
      method: paid.method,
      route: paid.route,
      result: "paid_success",
      status: 200,
    },
    paidEvidence: paid,
    httpDeliveryRecord: validation,
  });
}

function mcpFailed(paidEvidenceId, settlementReference, callId, error) {
  const seal = sealObservedMcpToolResult({
    tool: "morpho_position",
    productSku: "samedaydesk-morpho-position",
    resource: MCP_MORPHO_RESOURCE,
    issuedOfferDigest: OFFER,
    callId,
    result: {
      content: [{ type: "text", text: JSON.stringify({ ok: false, error, charged: false }) }],
      isError: true,
    },
    settlementReference,
  });
  const row = recordFromObservedMcpDelivery({
    observation: seal,
    settlementState: "succeeded",
    paidEvidenceId,
    settlementClass: SETTLEMENT_CLASS.REAL_UNVERIFIED,
    capturedAt: WINDOW_START,
  });
  assert.ok(row, callId);
  return row;
}

function rowAt(report, timestamp) {
  const found = report.rows.filter((row) => row.sourceEventTimestamp === timestamp);
  assert.equal(found.length, 1, timestamp);
  return found[0];
}

function runCli(args) {
  return spawnSync(process.execPath, [path.join(ROOT, "ordinary-delivery-join-cli.mjs"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function typedEvent({ id: eventId, timestamp, result, offer = OFFER }) {
  const paid = result === "paid_success";
  const replay = result === "replay_success";
  const event = {
    v: 4,
    sourceContract: "mcp_typed_outcome",
    id: eventId,
    ts: timestamp,
    authority: "seller_declared",
    evidenceClass: "seller_operational",
    accounting: false,
    revenue: false,
    demand: false,
    independentUse: false,
    chainTruth: false,
    payerIdentity: false,
    action: "emit",
    result,
    reason: paid ? "typed_paid_success" : replay ? "typed_replay_success" : "typed_application_failure",
    paymentPresent: true,
    paymentCredentialParsed: true,
    handlerInvoked: !replay,
    applicationOutcome: paid ? "success" : replay ? "replay" : "error",
    settlementState: result === "application_failure" ? "not_attempted" : "succeeded",
    binding: {
      tool: "morpho_position",
      productSku: "samedaydesk-morpho-position",
      resource: MCP_MORPHO_RESOURCE,
      issuedOfferDigest: offer,
    },
  };
  assert.equal(isCanonicalMcpTypedCommerceEvent(event), true, eventId);
  return event;
}

function emptyMorphoBody() {
  return {
    ok: true,
    address: "0x1111111111111111111111111111111111111111",
    chain: { id: 8453, name: "Base mainnet" },
    fetchedAt: "2026-10-06T01:12:00.000Z",
    latestIndexedAt: null,
    positionCount: 0,
    truncated: false,
    positions: [],
    source: {
      provider: "synthetic",
      authority: "indexed",
      directRpc: { verdict: "disabled", checkedPositions: 0 },
    },
    boundary: "synthetic-boundary",
  };
}

function mcpObserved(paidEvidenceId, settlementReference, callId, body, isError = false) {
  const text = JSON.stringify(body);
  const seal = sealObservedMcpToolResult({
    tool: "morpho_position",
    productSku: "samedaydesk-morpho-position",
    resource: MCP_MORPHO_RESOURCE,
    issuedOfferDigest: OFFER,
    callId,
    result: { content: [{ type: "text", text }], isError },
    settlementReference,
  });
  const row = recordFromObservedMcpDelivery({
    observation: seal,
    settlementState: isError ? "not_attempted" : "succeeded",
    paidEvidenceId,
    settlementClass: SETTLEMENT_CLASS.REAL_UNVERIFIED,
    capturedAt: WINDOW_START,
  });
  assert.ok(row, callId);
  assert.equal(row.callDigest, digestMcpCallId(callId));
  assert.equal(row.responseDigest, digestMcpPayload(Buffer.from(text, "utf8")));
  assert.notEqual(row.responseDigest, digestResponseBytes(Buffer.from(text, "utf8")));
  return row;
}

test("constructed records join by event, digest, route, and reference", async () => {
  const sameBody = validExtractBody();
  const requestA = fingerprint(1);
  const requestB = fingerprint(2);
  const http1 = observeHttp({
    paidEvidenceId: id(1),
    resource: "/extract",
    body: sameBody,
    settlementReference: ref(1),
    requestDigest: requestA,
    capturedAt: at(1),
  });
  const http2 = observeHttp({
    paidEvidenceId: id(2),
    resource: "/extract",
    body: sameBody,
    settlementReference: ref(2),
    requestDigest: requestB,
    capturedAt: at(2),
  });
  assert.equal(http1.responseDigest, http2.responseDigest);
  assert.equal(http1.deliveryClass, "full_bounded_capture");
  assert.equal(http1.validatorVerdict, "pass");
  assert.equal(http1.usefulness, "unknown");
  assert.notEqual(http1.paidEvidenceId, http2.paidEvidenceId);

  const http3 = observeHttp({
    paidEvidenceId: id(3),
    resource: "/extract",
    body: sameBody,
    settlementReference: ref(2),
    requestDigest: fingerprint(3),
    capturedAt: at(3),
  });
  const http6 = observeHttp({
    paidEvidenceId: id(6),
    resource: "/extract",
    body: validExtractBody({ capture: extractCapture({ textTruncated: true }) }),
    settlementReference: ref(6),
    requestDigest: fingerprint(6),
    capturedAt: at(6),
  });
  assert.equal(http6.deliveryClass, "truncated_partial");
  assert.equal(http6.validatorVerdict, "pass");
  const http7 = observeHttp({
    paidEvidenceId: id(7),
    resource: "/defi/morpho-position",
    body: { ok: false, error: UPSTREAM, charged: false },
    settlementReference: ref(7),
    requestDigest: fingerprint(7),
    capturedAt: at(7),
  });
  assert.equal(http7.deliveryClass, "upstream_failed");
  assert.equal(http7.validatorVerdict, "invalid");
  const http11 = observeHttp({
    paidEvidenceId: id(11),
    resource: "/extract",
    body: validExtractBody(),
    settlementReference: ref("a"),
    requestDigest: fingerprint(8),
    capturedAt: at(11),
  });
  const http15 = observeHttp({
    paidEvidenceId: id(15),
    resource: "/extract",
    body: validExtractBody(),
    settlementReference: ref("b"),
    requestDigest: fingerprint(9),
    capturedAt: at(15),
  });
  const http18 = observeHttp({
    paidEvidenceId: id(18),
    resource: "/extract",
    body: validExtractBody(),
    settlementReference: ref("c"),
    requestDigest: fingerprint(4),
    capturedAt: at(18),
  });
  const paid1 = paidFrom(http1, { timestamp: at(1), fingerprint: fingerprint(5), settlementReference: ref(1) });
  const paid2 = paidFrom(http2, { timestamp: at(2), fingerprint: "12".repeat(32), settlementReference: ref(2) });
  const paid3 = paidFrom(http3, {
    timestamp: at(3),
    fingerprint: "13".repeat(32),
    settlementReference: ref(3),
  });
  const paid4 = paidFrom(null, {
    id: id(4),
    timestamp: at(4),
    method: "GET",
    route: "/extract",
    requestDigest: fingerprint(4),
    responseDigest: "44".repeat(32),
    settlementReference: ref(4),
    fingerprint: "14".repeat(32),
    payerClass: "unclassified",
  });
  const paid5 = paidFrom(null, {
    id: id(5),
    timestamp: at(5),
    method: "GET",
    route: "/extract",
    requestDigest: "15".repeat(32),
    responseDigest: "45".repeat(32),
    settlementReference: ref(5),
    fingerprint: "15".repeat(32),
  });
  const paid6 = paidFrom(http6, { timestamp: at(6), fingerprint: "16".repeat(32), settlementReference: ref(6) });
  const paid7 = paidFrom(http7, { timestamp: at(7), fingerprint: "17".repeat(32), settlementReference: ref(7) });
  const typed8 = typedEvent({ id: id(8), timestamp: at(8), result: "application_failure" });
  const paid9 = paidFrom(null, {
    id: id(9),
    timestamp: at(9),
    method: "GET",
    route: "/extract",
    requestDigest: "19".repeat(32),
    responseDigest: "49".repeat(32),
    settlementReference: ref(1),
    fingerprint: "19".repeat(32),
  });
  const http9 = observeHttp({
    paidEvidenceId: id(9),
    resource: "/extract",
    body: validExtractBody(),
    settlementReference: ref(1),
    requestDigest: "19".repeat(32),
    capturedAt: at(9),
  });
  const paid11 = paidFrom(http11, { timestamp: at(11), fingerprint: "21".repeat(32), settlementReference: ref("a") });
  const paid15 = paidFrom(http15, { timestamp: at(15), fingerprint: "25".repeat(32), settlementReference: ref("b") });
  const paid16 = paidFrom(null, {
    id: id(16),
    timestamp: at(16),
    method: "GET",
    route: "/extract",
    requestDigest: "26".repeat(32),
    responseDigest: "46".repeat(32),
    settlementReference: ref("d"),
    fingerprint: "26".repeat(32),
    paymentProtocol: "mpp",
  });
  const http16 = observeHttp({
    paidEvidenceId: id(16),
    resource: "/extract",
    body: validExtractBody(),
    settlementReference: ref("d"),
    requestDigest: "26".repeat(32),
    capturedAt: at(16),
  });
  const paid18 = paidFrom(http18, { timestamp: at(18), fingerprint: "28".repeat(32), settlementReference: ref("c") });
  const typed19 = typedEvent({ id: id(19), timestamp: at(19), result: "application_failure" });
  const duplicatePaid = paidFrom(http1, {
    id: id(21),
    timestamp: at(21),
    fingerprint: "31".repeat(32),
    settlementReference: ref("f"),
  });
  const duplicatePaidAgain = { ...duplicatePaid, responseDigest: "99".repeat(32) };
  const paidOutside = paidFrom(null, {
    id: id(10),
    timestamp: "2026-10-05T12:00:00.000Z",
    method: "GET",
    route: "/extract",
    requestDigest: "20".repeat(32),
    responseDigest: "40".repeat(32),
    settlementReference: ref(9),
    fingerprint: "20".repeat(32),
  });
  const orphan = paidFrom(null, {
    id: id(30),
    timestamp: at(30),
    method: "GET",
    route: "/extract",
    requestDigest: "30".repeat(32),
    responseDigest: "30".repeat(32),
    settlementReference: ref(7),
    fingerprint: "30".repeat(32),
    payerClass: "independent",
  });
  const mcp8 = mcpFailed(id(8), ref(8), "call-e8", UPSTREAM);
  assert.notEqual(mcp8.responseDigest, digestResponseBytes(Buffer.from(JSON.stringify({ ok: false, error: UPSTREAM, charged: false }))));
  assert.equal(mcp8.deliveryClass, "upstream_failed");
  const typed18 = typedEvent({ id: id(18), timestamp: at(18), result: "application_failure" });
  const mcp18 = mcpFailed(id(18), ref("c"), "call-e18", UPSTREAM);
  const mcp19a = mcpFailed(id(19), ref("e"), "call-e19a", UPSTREAM);
  const mcp19b = mcpFailed(id(19), ref("e"), "call-e19b", `${UPSTREAM}-other`);
  assert.notEqual(mcp19a.responseDigest, mcp19b.responseDigest);

  const forward1 = forwardsFor(paid1, http1, "op-ordinary-e1");
  assert.equal(forward1.some((row) => isSchemaValidDeliveryEvidence(row)), true);
  const forward11 = forwardsFor(paid11, http11, "op-ordinary-e11").map((row) => {
    const copy = JSON.parse(JSON.stringify(row));
    if (copy.stage === "delivery") copy.receiptDigest = "f".repeat(64);
    assert.equal(isForwardV2Record(copy), true);
    return copy;
  });
  assert.equal(forward11.some((row) => row.stage === "delivery" && row.receiptDigest === "f".repeat(64)), true);
  const task1 = buildTaskRefRecord({ claim: claimFor("op-ordinary-e1", "synthetic-label-e1"), commerceEventId: paid1.id });
  const task15a = buildTaskRefRecord({ claim: claimFor("op-ordinary-e15", "synthetic-label-e15a"), commerceEventId: paid15.id });
  const task15b = buildTaskRefRecord({ claim: claimFor("op-ordinary-e15", "synthetic-label-e15b"), commerceEventId: paid15.id });
  assert.ok(task1 && task15a && task15b);
  assert.notEqual(task15a.taskRef, task15b.taskRef);

  const declarations = [
    {
      source: "caller",
      disposition: "not_useful",
      paidEvidenceId: paid1.id,
      requestDigest: paid1.requestDigest,
      settlementReference: paid1.settlementReference,
    },
    {
      source: "caller",
      disposition: "useful",
      paidEvidenceId: paid2.id,
      requestDigest: paid2.requestDigest,
      settlementReference: ref(3),
    },
    { source: "model", inferred: true, disposition: "useful", paidEvidenceId: paid6.id, requestDigest: paid6.requestDigest, settlementReference: paid6.settlementReference },
    {
      source: "caller",
      disposition: "useful",
      paidEvidenceId: paid7.id,
      requestDigest: paid7.requestDigest,
      settlementReference: paid7.settlementReference,
    },
    {
      source: "caller",
      disposition: "not_useful",
      paidEvidenceId: paid7.id,
      requestDigest: paid7.requestDigest,
      settlementReference: ref(1),
    },
  ];

  const memory = joinOrdinaryDeliveries({
    settlements: [
      ledgerFrom(paid1, { timestamp: at(1), paymentClass: "unclassified", amountAtomic: "5000" }),
    ],
    paidEvidence: [paid1],
    validations: [http1],
    forwardRecords: forward1,
    taskRefs: [task1],
    callerDeclarations: declarations,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    sourceSha: SHA,
  });
  const memoryRow = rowAt(memory, at(1));
  assert.equal(memoryRow.disposition, "exact_join");
  assert.equal(memoryRow.individualJoin, true);
  assert.equal(memoryRow.callerAcceptance, "bound");
  assert.equal(memoryRow.callerDisposition, "not_useful");
  assert.equal(memoryRow.callerReason, "caller_declared");
  assert.equal(memoryRow.usefulness, "unknown");
  assert.equal(memoryRow.outcomeDelivery, "schema_valid");
  assert.equal(memoryRow.taskRefBound, true);
  assert.equal(JSON.stringify(memory).includes(task1.taskRef), false);

  const roundTrip = joinOrdinaryDeliveries({
    settlements: [ledgerFrom(paid1, { timestamp: at(1), paymentClass: "unclassified", amountAtomic: "5000" })],
    paidEvidence: [paid1],
    validations: [JSON.parse(JSON.stringify(http1))],
    forwardRecords: forward1,
    taskRefs: [task1],
    callerDeclarations: declarations,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    sourceSha: SHA,
  });
  assert.equal(rowAt(roundTrip, at(1)).callerAcceptance, "unknown");
  assert.equal(rowAt(roundTrip, at(1)).callerReason, "historical_intent_not_retained");
  assert.equal(rowAt(roundTrip, at(1)).callerDisposition, null);
  assert.equal(rowAt(roundTrip, at(1)).disposition, "exact_join");

  const dir = await mkdtemp(path.join(tmpdir(), "ordinary-delivery-join-"));
  try {
    const files = {
      [FILE_CLASSES.settlementLedger]: ndjson([
        "{",
        ledgerFrom(paid1, { timestamp: at(1), paymentClass: "unclassified", amountAtomic: "5000" }),
        ledgerFrom(paid2, { timestamp: at(2), paymentClass: "unclassified", amountAtomic: "5000" }),
        ledgerFrom(paid3, { timestamp: at(3), paymentClass: "unclassified", amountAtomic: "5000" }),
        ledgerFrom(paid4, { timestamp: at(4), paymentClass: "internal", amountAtomic: "5000" }),
        ledgerFrom(paid5, { timestamp: at(5), paymentClass: "unclassified", amountAtomic: "5000" }),
        ledgerFrom(paid6, { timestamp: at(6), paymentClass: "unclassified", amountAtomic: "5000" }),
        ledgerFrom(paid7, { timestamp: at(7), paymentClass: "unclassified", amountAtomic: "20000" }),
        ledgerFrom(null, {
          timestamp: at(8),
          paymentClass: "unclassified",
          amountAtomic: "20000",
          sourceEventId: id(8),
          route: "/mcp",
          protocol: "x402",
          settlementReference: ref(8),
        }),
        ledgerFrom(paid9, { timestamp: at(9), paymentClass: "unclassified", amountAtomic: "5000", settlementReference: ref(1) }),
        ledgerFrom(paidOutside, { timestamp: "2026-10-05T12:00:00.000Z", paymentClass: "unclassified", amountAtomic: "5000" }),
        ledgerFrom(paid11, { timestamp: at(11), paymentClass: "unclassified", amountAtomic: "5000" }),
        ledgerFrom(paid15, { timestamp: at(15), paymentClass: "unclassified", amountAtomic: "5000" }),
        ledgerFrom(paid16, { timestamp: at(16), paymentClass: "unclassified", amountAtomic: "5000", protocol: "x402" }),
        ledgerFrom(paid18, { timestamp: at(18), paymentClass: "unclassified", amountAtomic: "5000" }),
        ledgerFrom(null, {
          timestamp: at(19),
          paymentClass: "unclassified",
          amountAtomic: "20000",
          sourceEventId: id(19),
          route: "/mcp",
          protocol: "x402",
          settlementReference: ref("e"),
        }),
        ledgerFrom(duplicatePaid, { timestamp: at(21), paymentClass: "unclassified", amountAtomic: "5000" }),
        ledgerFrom(null, {
          timestamp: at(22),
          paymentClass: "unclassified",
          amountAtomic: "5000",
          sourceEventId: id(40),
          route: "/extract",
          protocol: "x402",
          settlementReference: `0x${"ab".repeat(32)}`,
        }),
      ]),
      [FILE_CLASSES.paidSuccessEvidence]: ndjson([
        "{v:1}",
        paid1, paid2, paid3, paid4, paid5, paid6, paid7, paid9, paid11, paid15, paid16, paid18,
        duplicatePaid, duplicatePaidAgain, paidOutside, orphan,
      ]),
      [FILE_CLASSES.httpValidation]: ndjson([
        "{",
        JSON.parse(JSON.stringify(http1)),
        JSON.parse(JSON.stringify(http2)),
        JSON.parse(JSON.stringify(http3)),
        JSON.parse(JSON.stringify(http6)),
        JSON.parse(JSON.stringify(http7)),
        JSON.parse(JSON.stringify(http9)),
        JSON.parse(JSON.stringify(http11)),
        JSON.parse(JSON.stringify(http15)),
        JSON.parse(JSON.stringify(http16)),
        JSON.parse(JSON.stringify(http18)),
        { paidEvidenceId: id(5) },
      ]),
      [FILE_CLASSES.commerceEvents]: ndjson([
        { sourceContract: "mcp_typed_outcome", v: 4 },
        typed8,
        typed18,
        typed19,
      ]),
      [FILE_CLASSES.mcpDelivery]: ndjson([
        JSON.parse(JSON.stringify(mcp8)),
        JSON.parse(JSON.stringify(mcp18)),
        JSON.parse(JSON.stringify(mcp19a)),
        JSON.parse(JSON.stringify(mcp19b)),
      ]),
      [FILE_CLASSES.outcomeBinding]: ndjson(["{", ...forward1]),
      [FILE_CLASSES.outcomeBindingRotated]: ndjson(forward11),
      [FILE_CLASSES.taskRef]: ndjson([task1, task15a, "{"]),
      [FILE_CLASSES.taskRefRotated]: ndjson([task15b]),
    };
    for (const [name, text] of Object.entries(files)) {
      await writeFile(path.join(dir, name), text, { mode: 0o600 });
    }
    const declarationsPath = path.join(dir, "caller-declarations.ndjson");
    await writeFile(declarationsPath, ndjson(declarations), { mode: 0o600 });
    const before = await stamp(dir);
    const report = await receiveOrdinaryDeliveryJoin({
      dataDir: dir,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      coverage: "unknown_for_full_window",
      sourceSha: SHA,
      callerDeclarations: declarations,
    });
    const after = await stamp(dir);
    assert.deepEqual(after, before);
    assert.deepEqual(reportViolations(report), []);
    assert.equal(report.schema, "samedaydesk.ordinary-delivery-join.v1");
    assert.equal(report.producerBaseSha, SHA);
    assert.equal(report.sourceSha, SHA);
    assert.equal(report.window.exhaustive, false);
    assert.equal(report.aggregateRouteDeltaIsNotAnIndividualJoin, true);
    assert.equal(report.schemaValidityIsBuyerUsefulness, false);
    assert.deepEqual(report.customerPlane, {
      attributableCustomerCount: null,
      buyerValidDeliveryCount: null,
      repeatIndependentCustomerCount: null,
    });
    assert.equal(report.boundaries.settlementNeverProvesBuyerValidDelivery, true);
    assert.equal(report.withheldOutsideWindow, 1);
    assert.ok(report.rejectedLines.some((item) => item.file === FILE_CLASSES.httpValidation && item.count >= 2));
    assert.ok(report.rejectedLines.some((item) => item.file === FILE_CLASSES.settlementLedger && item.count >= 1));
    assert.ok(report.rejectedLines.some((item) => item.file === FILE_CLASSES.commerceEvents && item.count >= 1));

    const exact = rowAt(report, at(1));
    const twin = rowAt(report, at(2));
    assert.equal(exact.disposition, "exact_join");
    assert.equal(exact.eventCanonical, "http_v1");
    assert.equal(exact.individualJoin, true);
    assert.equal(exact.httpAttached, 1);
    assert.equal(exact.mcpAttached, 0);
    assert.equal(exact.callerAcceptance, "unknown");
    assert.equal(exact.usefulness, "unknown");
    assert.equal(exact.outcomeDelivery, "schema_valid");
    assert.equal(exact.taskRefBound, true);
    assert.equal(exact.paymentClass, "unclassified");
    assert.equal(exact.amountAtomic, "5000");
    assert.equal(twin.disposition, "exact_join");
    assert.equal(twin.individualJoin, true);
    assert.equal(twin.httpAttached, 1);
    assert.equal(twin.callerAcceptance, "foreign");
    assert.equal(twin.callerReason, "identity_mismatch");
    assert.notEqual(exact.sourceEventTimestamp, twin.sourceEventTimestamp);

    const borrowed = rowAt(report, at(3));
    assert.equal(borrowed.disposition, "conflicting_join");
    assert.equal(borrowed.individualJoin, false);
    assert.ok(borrowed.reasons.includes("reference_cannot_borrow"));
    assert.equal(borrowed.httpAttached, 0);

    const internal = rowAt(report, at(4));
    assert.equal(internal.disposition, "missing_capture");
    assert.equal(internal.paymentClass, "internal");
    assert.equal(internal.callerAcceptance, "absent");
    assert.equal(internal.callerReason, "declaration_absent");
    assert.equal(internal.httpAttached, 0);

    const malformed = rowAt(report, at(5));
    assert.equal(malformed.disposition, "rejected_schema");
    assert.ok(malformed.reasons.includes("validation_schema_rejected"));
    assert.equal(malformed.httpAttached, 0);

    const truncated = rowAt(report, at(6));
    assert.equal(truncated.disposition, "incomplete_capture");
    assert.equal(truncated.deliveryClass, "truncated_partial");
    assert.equal(truncated.validatorVerdict, "pass");
    assert.equal(truncated.usefulness, "unknown");
    assert.equal(truncated.callerAcceptance, "foreign");
    assert.equal(truncated.callerReason, "declaration_source_rejected");

    const upstream = rowAt(report, at(7));
    assert.equal(upstream.disposition, "rejected_schema");
    assert.equal(upstream.deliveryClass, "upstream_failed");
    assert.equal(upstream.validatorVerdict, "invalid");
    assert.equal(upstream.callerAcceptance, "foreign");
    assert.equal(upstream.callerReason, "multiple_declarations");

    const mcpOnly = rowAt(report, at(8));
    assert.equal(mcpOnly.disposition, "rejected_schema");
    assert.equal(mcpOnly.eventCanonical, "mcp_typed_outcome");
    assert.equal(mcpOnly.paidEvidencePresent, false);
    assert.equal(mcpOnly.httpAttached, 0);
    assert.equal(mcpOnly.mcpAttached, 1);
    assert.equal(mcpOnly.deliveryClass, "upstream_failed");

    const replay = rowAt(report, at(9));
    assert.equal(replay.disposition, "replayed_or_unknown_settlement");
    assert.ok(replay.reasons.includes("duplicate_settlement_reference"));
    assert.equal(replay.httpAttached, 0);
    assert.equal(replay.deliveryClass, null);
    assert.equal(report.rows.some((row) => row.sourceEventTimestamp === "2026-10-05T12:00:00.000Z"), false);

    const digestConflict = rowAt(report, at(11));
    assert.equal(digestConflict.disposition, "conflicting_join");
    assert.ok(digestConflict.reasons.includes("outcome_digest_conflict"));
    assert.equal(digestConflict.httpAttached, 1);
    assert.equal(digestConflict.individualJoin, false);

    const taskConflict = rowAt(report, at(15));
    assert.equal(taskConflict.disposition, "conflicting_join");
    assert.ok(taskConflict.reasons.includes("task_ref_conflict"));
    assert.equal(taskConflict.taskRefBound, false);
    assert.equal(taskConflict.individualJoin, false);

    const protocolConflict = rowAt(report, at(16));
    assert.equal(protocolConflict.disposition, "conflicting_join");
    assert.ok(protocolConflict.reasons.includes("settlement_does_not_match_paid_event"));
    assert.equal(protocolConflict.httpAttached, 0);

    const channelConflict = rowAt(report, at(18));
    assert.equal(channelConflict.disposition, "conflicting_join");
    assert.equal(channelConflict.eventCanonical, "http_v1+mcp_typed_outcome");
    assert.ok(channelConflict.reasons.includes("capture_channel_conflict"));
    assert.equal(channelConflict.reasons.includes("capture_digest_conflict"), false);
    assert.equal(channelConflict.httpAttached, 1);
    assert.equal(channelConflict.mcpAttached, 1);

    const mcpConflict = rowAt(report, at(19));
    assert.equal(mcpConflict.disposition, "conflicting_join");
    assert.equal(mcpConflict.eventCanonical, "mcp_typed_outcome");
    assert.equal(mcpConflict.paidEvidencePresent, false);
    assert.ok(mcpConflict.reasons.includes("capture_digest_conflict"));
    assert.equal(mcpConflict.mcpAttached, 2);

    const duplicateEvidence = rowAt(report, at(21));
    assert.equal(duplicateEvidence.disposition, "replayed_or_unknown_settlement");
    assert.ok(duplicateEvidence.reasons.includes("duplicate_paid_evidence"));
    assert.equal(duplicateEvidence.individualJoin, false);

    const absentPaid = rowAt(report, at(22));
    assert.equal(absentPaid.disposition, "replayed_or_unknown_settlement");
    assert.ok(absentPaid.reasons.includes("paid_evidence_absent"));

    const unknownSettlement = report.rows.find((row) => row.reasons.includes("settlement_not_in_canonical_ledger"));
    assert.ok(unknownSettlement);
    assert.equal(unknownSettlement.paymentClass, null);
    assert.equal(unknownSettlement.disposition, "replayed_or_unknown_settlement");
    assert.equal(report.rows.filter((row) => row.reasons.includes("settlement_not_in_canonical_ledger")).length, 1);

    const published = JSON.stringify(report);
    for (const needle of [
      "ok.example", "requestedUrl", UPSTREAM, "payment-signature", "BEGIN PRIVATE KEY",
      "credentialFingerprint", "independent", task1.taskRef, task15a.taskRef, task15b.taskRef,
      "synthetic-label-e1", TOKEN, ref(1), fingerprint(5),
    ]) {
      assert.equal(published.includes(needle), false, needle);
    }
    assert.equal(published.includes("0x"), false);
    assert.equal(report.rows.every((row) => row.local === undefined), true);
    assert.equal(report.rows.every((row) => row.individualJoin === (row.disposition === "exact_join")), true);

    const identified = await receiveOrdinaryDeliveryJoin({
      dataDir: dir,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      sourceSha: SHA,
      includeLocalIds: true,
      callerDeclarations: declarations,
    });
    assert.equal(rowAt(identified, at(1)).local.settlementReference, ref(1));
    assert.equal(rowAt(identified, at(2)).local.settlementReference, ref(2));
    assert.notEqual(rowAt(identified, at(1)).local.sourceEventId, rowAt(identified, at(2)).local.sourceEventId);
    assert.deepEqual(await stamp(dir), before);

    const cli = runCli([
      "--data-dir", dir,
      "--window-start", WINDOW_START,
      "--window-end", WINDOW_END,
      "--coverage", "unknown_for_full_window",
      "--source-sha", SHA,
      "--caller-declarations", declarationsPath,
    ]);
    assert.equal(cli.status, 0, cli.stderr);
    const cliReport = JSON.parse(cli.stdout);
    assert.deepEqual(cliReport.counts, report.counts);
    assert.equal(cliReport.rows.length, report.rows.length);
    assert.equal(cli.stdout.includes(ref(1)), false);
    assert.deepEqual(await stamp(dir), before);
    const saved = path.join(dir, "honest-report.json");
    await writeFile(saved, cli.stdout);
    const accepted = runCli(["--check-report", saved]);
    assert.equal(accepted.status, 0, accepted.stdout);
    assert.equal(accepted.stdout.trim(), "[]");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty stores stay empty and a missing directory is not created", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ordinary-delivery-empty-"));
  try {
    const report = await receiveOrdinaryDeliveryJoin({
      dataDir: dir,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      coverage: "complete",
      sourceSha: SHA,
    });
    assert.equal(report.window.exhaustive, true);
    assert.deepEqual(report.counts, {
      exact_join: 0,
      conflicting_join: 0,
      missing_capture: 0,
      rejected_schema: 0,
      incomplete_capture: 0,
      replayed_or_unknown_settlement: 0,
    });
    assert.deepEqual(await readdir(dir), []);
    const missing = path.join(dir, "absent-producer");
    const cli = runCli([
      "--data-dir", missing,
      "--window-start", WINDOW_START,
      "--window-end", WINDOW_END,
      "--source-sha", SHA,
    ]);
    assert.equal(cli.status, 2);
    await assert.rejects(stat(missing));
    const badWindow = runCli([
      "--data-dir", dir,
      "--window-start", "later",
      "--window-end", "earlier",
      "--source-sha", SHA,
    ]);
    assert.equal(badWindow.status, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a count join without capture is refused", () => {
  const seeded = runCli(["--check-report", "experiments/ordinary-delivery-join-1006/fixtures/seeded-count-join.json"]);
  assert.equal(seeded.status, 1);
  const codes = JSON.parse(seeded.stdout);
  assert.ok(codes.includes("exact_join_without_capture"));
  assert.ok(codes.includes("usefulness_filled"));
  const help = runCli(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /commerce-settlements\.ndjson/);
  assert.match(help.stdout, /commerce-paid-success-evidence\.ndjson/);
  assert.match(help.stdout, /commerce-events\.ndjson/);
  assert.match(help.stdout, /commerce-events\.1\.ndjson/);
  assert.match(help.stdout, /mcp_typed_outcome/);
  assert.match(help.stdout, /http-response-validation\.v1\.ndjson/);
  assert.match(help.stdout, /mcp-tool-delivery\.v1\.ndjson/);
  assert.match(help.stdout, /2026-10-06T00:17:10\.607Z/);
  assert.match(help.stdout, /2026-10-06T04:53:48\.437Z/);
  assert.match(help.stdout, new RegExp(SHA));
});

test("the receiver does not write ledgers or import the payment server", async () => {
  const library = await readFile(new URL("./ordinary-delivery-join.mjs", import.meta.url), "utf8");
  const cli = await readFile(new URL("./ordinary-delivery-join-cli.mjs", import.meta.url), "utf8");
  for (const source of [library, cli]) {
    assert.equal(source.includes("writeFile"), false);
    assert.equal(source.includes("appendFile"), false);
    assert.equal(source.includes("mkdir"), false);
    assert.equal(source.includes("server.js"), false);
  }
  assert.equal(library.includes("isCanonicalMcpTypedCommerceEvent"), true);
  assert.equal(library.includes("commerce-events.ndjson"), true);
  assert.equal(library.includes("callDigest: record.callDigest"), false);
  assert.equal(library.includes("historicalV1Row"), false);
  assert.throws(() => joinOrdinaryDeliveries({}), /window start and end are required/);
});

test("typed MCP canonical joins without an HTTP v1 row", async () => {
  const body = emptyMorphoBody();
  const left = mcpObserved(id(12), ref(4), "call-left", body);
  const right = mcpObserved(id(13), ref(5), "call-right", body);
  assert.equal(left.responseDigest, right.responseDigest);
  assert.notEqual(left.callDigest, right.callDigest);
  assert.notEqual(left.paidEvidenceId, right.paidEvidenceId);
  const typedLeft = typedEvent({ id: id(12), timestamp: at(12), result: "paid_success" });
  const typedRight = typedEvent({ id: id(13), timestamp: at(13), result: "paid_success" });
  const settlements = [
    ledgerFrom(null, {
      timestamp: at(12),
      paymentClass: "unclassified",
      amountAtomic: "20000",
      sourceEventId: id(12),
      route: "/mcp",
      protocol: "x402",
      settlementReference: ref(4),
    }),
    ledgerFrom(null, {
      timestamp: at(13),
      paymentClass: "unclassified",
      amountAtomic: "20000",
      sourceEventId: id(13),
      route: "/mcp",
      protocol: "x402",
      settlementReference: ref(5),
    }),
  ];
  const joined = joinOrdinaryDeliveries({
    settlements,
    paidEvidence: [],
    typedEvents: [typedLeft, typedRight],
    mcpDeliveries: [left, right],
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    sourceSha: SHA,
    includeLocalIds: true,
  });
  assert.deepEqual(reportViolations(joined), []);
  const first = rowAt(joined, at(12));
  const second = rowAt(joined, at(13));
  assert.equal(first.disposition, "exact_join");
  assert.equal(second.disposition, "exact_join");
  assert.equal(first.eventCanonical, "mcp_typed_outcome");
  assert.equal(second.eventCanonical, "mcp_typed_outcome");
  assert.equal(first.paidEvidencePresent, false);
  assert.equal(first.httpAttached, 0);
  assert.equal(first.mcpAttached, 1);
  assert.equal(first.usefulness, "unknown");
  assert.equal(first.deliveryClass, "useful_negative");
  assert.notEqual(first.local.sourceEventId, second.local.sourceEventId);
  assert.equal(JSON.stringify(joined).includes(id(12)), true);

  const foreignCall = { ...left, callDigest: "ab".repeat(32) };
  const foreignOffer = typedEvent({ id: id(12), timestamp: at(12), result: "paid_success", offer: "cd".repeat(32) });
  const foreignReference = joinOrdinaryDeliveries({
    settlements: [settlements[0]],
    typedEvents: [typedLeft],
    mcpDeliveries: [{ ...left, settlementReference: ref(9) }],
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    sourceSha: SHA,
  });
  const callReport = joinOrdinaryDeliveries({
    settlements: [settlements[0]],
    typedEvents: [typedLeft],
    mcpDeliveries: [foreignCall],
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    sourceSha: SHA,
  });
  const offerReport = joinOrdinaryDeliveries({
    settlements: [settlements[0]],
    typedEvents: [foreignOffer],
    mcpDeliveries: [left],
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    sourceSha: SHA,
  });
  assert.equal(rowAt(callReport, at(12)).disposition, "conflicting_join");
  assert.ok(rowAt(callReport, at(12)).reasons.includes("foreign_call"));
  assert.equal(rowAt(callReport, at(12)).individualJoin, false);
  assert.equal(rowAt(offerReport, at(12)).disposition, "conflicting_join");
  assert.ok(rowAt(offerReport, at(12)).reasons.includes("foreign_offer"));
  assert.equal(rowAt(foreignReference, at(12)).disposition, "conflicting_join");
  assert.ok(rowAt(foreignReference, at(12)).reasons.includes("foreign_reference"));

  const replay = typedEvent({ id: id(14), timestamp: at(14), result: "replay_success" });
  const replayed = joinOrdinaryDeliveries({
    settlements: [ledgerFrom(null, {
      timestamp: at(14),
      paymentClass: "unclassified",
      amountAtomic: "20000",
      sourceEventId: id(14),
      route: "/mcp",
      protocol: "x402",
      settlementReference: ref(6),
    })],
    typedEvents: [replay],
    mcpDeliveries: [mcpObserved(id(14), ref(6), "call-replay", body)],
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    sourceSha: SHA,
  });
  assert.equal(rowAt(replayed, at(14)).disposition, "replayed_or_unknown_settlement");
  assert.ok(rowAt(replayed, at(14)).reasons.includes("typed_replay"));
  assert.equal(rowAt(replayed, at(14)).individualJoin, false);

  const unknown = joinOrdinaryDeliveries({
    settlements: [],
    typedEvents: [typedLeft],
    mcpDeliveries: [left],
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    sourceSha: SHA,
  });
  assert.equal(unknown.rows.length, 1);
  assert.equal(unknown.rows[0].disposition, "replayed_or_unknown_settlement");
  assert.ok(unknown.rows[0].reasons.includes("settlement_not_in_canonical_ledger"));
  assert.equal(unknown.rows[0].usefulness, "unknown");
});

async function stamp(dir) {
  const names = (await readdir(dir)).sort();
  const out = [];
  for (const name of names) {
    const info = await stat(path.join(dir, name));
    out.push([name, String(info.mtimeNs), info.size]);
  }
  return out;
}
test("canonical settlement cannot borrow another transport, protocol, time or event canon", () => {
  const eventId = id(41);
  const event = typedEvent({ id: eventId, timestamp: at(41), result: "paid_success" });
  const capture = mcpObserved(eventId, ref(4), "call-root-domain", emptyMorphoBody());
  const canonical = ledgerFrom(null, {
    timestamp: at(41), paymentClass: "unclassified", amountAtomic: "20000",
    sourceEventId: eventId, route: "/mcp", protocol: "x402", settlementReference: ref(4),
  });
  const base = {
    settlements: [canonical], typedEvents: [event], mcpDeliveries: [capture],
    windowStart: WINDOW_START, windowEnd: WINDOW_END, sourceSha: SHA,
  };
  assert.equal(joinOrdinaryDeliveries(base).rows[0].disposition, "exact_join");
  for (const [change, reason] of [
    [{ route: "/extract" }, "foreign_route"],
    [{ protocol: "mpp" }, "foreign_protocol"],
    [{ sourceEventTimestamp: at(42) }, "foreign_event_time"],
  ]) {
    const row = joinOrdinaryDeliveries({ ...base, settlements: [{ ...canonical, ...change }] }).rows[0];
    assert.equal(row.disposition, "conflicting_join", reason);
    assert.equal(row.individualJoin, false, reason);
    assert.ok(row.reasons.includes(reason), reason);
  }
  const paid = paidFrom(null, {
    id: eventId, timestamp: at(41), method: "POST", route: "/mcp",
    requestDigest: capture.requestDigest, responseDigest: capture.responseDigest,
    settlementReference: ref(4), fingerprint: "61".repeat(32),
  });
  const collision = joinOrdinaryDeliveries({ ...base, paidEvidence: [paid] }).rows[0];
  assert.equal(collision.disposition, "conflicting_join");
  assert.ok(collision.reasons.includes("multiple_event_canons"));
  assert.equal(collision.individualJoin, false);

  const httpCapture = observeHttp({
    paidEvidenceId: id(43), resource: "/extract", body: validExtractBody(),
    settlementReference: ref(8), requestDigest: "62".repeat(32), capturedAt: at(43),
  });
  const httpPaid = paidFrom(httpCapture, { timestamp: at(43), fingerprint: "63".repeat(32) });
  const httpLedger = ledgerFrom(httpPaid, {
    timestamp: at(43), paymentClass: "unclassified", amountAtomic: "5000",
  });
  const http = {
    settlements: [httpLedger], paidEvidence: [httpPaid], validations: [httpCapture],
    windowStart: WINDOW_START, windowEnd: WINDOW_END, sourceSha: SHA,
  };
  assert.equal(joinOrdinaryDeliveries(http).rows[0].disposition, "exact_join");
  const wrongTime = joinOrdinaryDeliveries({
    ...http, settlements: [{ ...httpLedger, sourceEventTimestamp: at(44) }],
  }).rows[0];
  assert.equal(wrongTime.disposition, "conflicting_join");
  assert.equal(wrongTime.individualJoin, false);
  assert.ok(wrongTime.reasons.includes("settlement_does_not_match_paid_event"));
});
