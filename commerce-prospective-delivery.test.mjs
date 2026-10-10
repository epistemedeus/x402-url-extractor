import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";

import { authorizeOutcomeBinding, buildTaskRefRecord } from "./commerce-outcome-binding.mjs";
import {
  BASE_USDC,
  SCHEMA_VERSION,
  createCommerceSettlementReconciler,
  readCommerceSettlementAdmission,
} from "./commerce-settlement-reconciler.mjs";
import { bindMerchantHttpDeliveryContracts } from "./http-delivery-evidence/bind-merchant-contracts.mjs";
import { SETTLEMENT_CLASS } from "./http-delivery-evidence/classify.mjs";
import { recordFromObservedResponse as recordHttp } from "./http-delivery-evidence/store.mjs";
import { extractCapture, historicalV1Row, validExtractBody } from "./http-delivery-evidence/test/helpers.mjs";
import { isCanonicalMcpTypedCommerceEvent } from "./commerce-events.mjs";
import { MCP_MORPHO_RESOURCE } from "./http-delivery-evidence/mcp-delivery.mjs";
import { FILE_CLASSES } from "./ordinary-delivery-join.mjs";
import {
  PROSPECTIVE_FILENAME,
  PROSPECTIVE_SOURCE_VERSION,
  appendProspectiveObservations,
  applyDeclaredFeedback,
  classifyProspectiveObservation,
  commerceProspectiveDeliveryOutputSchema,
  observationFromJoin,
  projectProspectiveDelivery,
  prospectiveEvidenceKey,
  readProspectiveDelivery,
  recordProspectiveFeedback,
  retainProspectiveDeliveries,
} from "./commerce-prospective-delivery.mjs";

bindMerchantHttpDeliveryContracts();

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(ROOT, "fixtures", "prospective-delivery-cold");
const TOKEN = "prospective-delivery-test-token-32";
const validatePacket = new Ajv({ allErrors: true, strict: false }).compile(commerceProspectiveDeliveryOutputSchema());
const id = (n) => `10061010-1010-4010-8010-${String(n).padStart(12, "0")}`;
function ref(label) {
  const text = String(label).toLowerCase();
  if (!/^[0-9a-f]+$/.test(text) || 64 % text.length !== 0) throw new Error(`bad ref label ${label}`);
  return `0x${text.repeat(64 / text.length)}`;
}
const at = (minute) => `2026-10-10T12:${String(minute).padStart(2, "0")}:00.000Z`;
const fingerprint = (n) => `${n}${n}`.repeat(32).slice(0, 64);
const NOW = Date.parse("2026-10-10T12:30:00.000Z");

function ndjson(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function settled({ eventId, reference, timestamp, amount, route = "/extract", protocol = "x402" }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    state: "reconciled",
    sourceEventId: eventId,
    sourceEventTimestamp: timestamp,
    route,
    protocol,
    paymentClass: "unclassified",
    settlementReference: reference,
    network: "eip155:8453",
    asset: BASE_USDC,
    amountAtomic: amount,
  };
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
    payerClass: "unclassified",
    credentialFingerprint: fields.fingerprint,
    paymentProtocol: "x402",
    originClass: "external",
    source: "direct-or-unattributed",
  });
}

function typedEvent(eventId, timestamp, result) {
  const paid = result === "paid_success";
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
    reason: paid ? "typed_paid_success" : "typed_application_failure",
    paymentPresent: true,
    paymentCredentialParsed: true,
    handlerInvoked: true,
    applicationOutcome: paid ? "success" : "error",
    settlementState: paid ? "succeeded" : "not_attempted",
    binding: {
      tool: "morpho_position",
      productSku: "samedaydesk-morpho-position",
      resource: MCP_MORPHO_RESOURCE,
      issuedOfferDigest: "ab".repeat(32),
    },
  };
  assert.equal(isCanonicalMcpTypedCommerceEvent(event), true);
  return event;
}

function taskFor(eventId, cohort, operationId) {
  const claim = authorizeOutcomeBinding({
    "x-samedaydesk-internal": TOKEN,
    "x-samedaydesk-outcome-operation": operationId,
    "x-samedaydesk-outcome-cohort": cohort,
    "x-samedaydesk-outcome-task": "synthetic-label",
  }, TOKEN);
  const record = buildTaskRefRecord({ claim, commerceEventId: eventId });
  assert.ok(record, operationId);
  return record;
}

function observation(reference, technical, fields = {}) {
  const observed = observationFromJoin({
    disposition: technical === "validated_response" ? "exact_join" : "missing_capture",
    validatorVerdict: technical === "validated_response" ? "pass" : null,
    reasons: technical === "no_response" ? ["paid_evidence_absent"] : ["event_digest_route_reference"],
    deliveryClass: technical === "dropped_connection" ? "transport_failure" : "full_bounded_capture",
    requestedUrl: "https://secret.example/path?token=raw-secret",
  }, {
    evidenceKey: prospectiveEvidenceKey(reference),
    technical,
    taskClass: fields.taskClass,
    channel: fields.channel,
  }, fields.observedAt || at(30));
  return observed;
}

async function tempDir() {
  return mkdtemp(path.join(tmpdir(), "prospective-delivery-"));
}

async function writeStores(dir, files) {
  for (const [name, rows] of Object.entries(files)) {
    await writeFile(path.join(dir, name), ndjson(rows), { mode: 0o600 });
  }
}

async function packetFor(dir, ledgerRows, fields = {}) {
  const ledger = ndjson(ledgerRows);
  return {
    ledger,
    packet: await readProspectiveDelivery({
      dataDir: dir,
      ledger,
      generatedAt: "2026-10-10T13:00:00.000Z",
      ...fields,
    }),
  };
}

function assertPrivacy(text, secrets) {
  for (const secret of secrets) {
    assert.equal(text.includes(secret), false, secret);
  }
}

function assertHonestCoverage(packet) {
  assert.equal(packet.coverage.historicalBackfill, false);
  assert.equal(packet.coverage.historicalComplete, false);
  assert.equal(packet.coverage.requestedWindowComplete, false);
  assert.equal(packet.coverage.zeroProspectiveIsNotHistoricalZero, true);
  assert.equal(packet.coverage.retainedEventFilesRequired, false);
  assert.equal(packet.recognizedIncomeAtomic, null);
  assert.equal(packet.customerAttribution, null);
  assert.equal(packet.independentRepeat, null);
  assert.equal(packet.usefulness, "unknown");
  assert.equal(packet.boundaries.paymentIsNotACustomer, true);
  assert.equal(packet.boundaries.schemaPassIsNotAcceptance, true);
  assert.equal(packet.boundaries.declaredFeedbackIsNotVerifiedUsefulness, true);
  assert.equal(packet.boundaries.ownerQaIsNotACustomer, true);
  assert.equal(packet.boundaries.parentAdmissionRemainsMoneyAuthority, true);
  assert.equal(validatePacket(packet), true, JSON.stringify(validatePacket.errors));
}

test("classification keeps technical delivery apart from duplicate, conflict, and failure", () => {
  assert.equal(classifyProspectiveObservation({
    disposition: "exact_join",
    validatorVerdict: "pass",
    reasons: ["event_digest_route_reference"],
    deliveryClass: "full_bounded_capture",
  }), "validated_response");
  assert.equal(classifyProspectiveObservation({
    disposition: "replayed_or_unknown_settlement",
    reasons: ["duplicate_settlement_reference"],
  }), "duplicate_ignored");
  assert.equal(classifyProspectiveObservation({
    disposition: "replayed_or_unknown_settlement",
    reasons: ["paid_evidence_absent"],
  }), "no_response");
  assert.equal(classifyProspectiveObservation({
    disposition: "incomplete_capture",
    reasons: ["truncated_or_partial_capture"],
    deliveryClass: "truncated_partial",
    validatorVerdict: "pass",
  }), "partial");
  assert.equal(classifyProspectiveObservation({
    disposition: "incomplete_capture",
    reasons: ["capture_not_complete"],
    deliveryClass: "transport_failure",
    validatorVerdict: "unknown",
  }), "dropped_connection");
  assert.equal(classifyProspectiveObservation({
    disposition: "rejected_schema",
    reasons: ["output_schema_rejected"],
    deliveryClass: "malformed_body",
    validatorVerdict: "invalid",
  }), "schema_invalid");
  assert.equal(classifyProspectiveObservation({
    disposition: "rejected_schema",
    reasons: ["output_schema_rejected"],
    deliveryClass: "upstream_failed",
    validatorVerdict: "invalid",
  }), "failure_after_settlement");
  assert.equal(classifyProspectiveObservation({
    disposition: "conflicting_join",
    reasons: ["capture_channel_conflict", "multiple_event_canons"],
    deliveryClass: "full_bounded_capture",
    validatorVerdict: "pass",
  }), "channel_conflict");
  assert.equal(classifyProspectiveObservation({
    disposition: "replayed_or_unknown_settlement",
    reasons: ["typed_replay"],
    deliveryClass: "full_bounded_capture",
    validatorVerdict: "pass",
  }), "validated_response");
  assert.equal(classifyProspectiveObservation({
    disposition: "replayed_or_unknown_settlement",
    reasons: ["duplicate_paid_evidence"],
  }), "unknown");
  const source = readFileSync(new URL("./commerce-prospective-delivery.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("amountAtomic +="), false);
  assert.equal(source.includes("parseLines"), false);
});

test("validated settlement stays after raw event deletion and a fresh process", async () => {
  const dir = await tempDir();
  const reference = ref("ab");
  const historical = ref("cd");
  const eventId = id(1);
  const http = observeHttp({
    paidEvidenceId: eventId,
    resource: "/extract",
    body: validExtractBody(),
    settlementReference: reference,
    requestDigest: fingerprint(1),
    capturedAt: at(1),
  });
  assert.equal(http.deliveryClass, "full_bounded_capture");
  assert.equal(http.validatorVerdict, "pass");
  assert.equal(http.usefulness, "unknown");
  const paid = paidFrom(http, { timestamp: at(1), fingerprint: fingerprint(2), settlementReference: reference });
  const task = taskFor(eventId, "external_unknown", "op-prospective-validated");
  const owner = taskFor(id(2), "owner_qa", "op-prospective-owner");
  const rows = [
    settled({ eventId, reference, timestamp: at(1), amount: "5000" }),
    settled({ eventId: id(2), reference: ref("ef"), timestamp: at(2), amount: "5000" }),
    settled({ eventId: id(9), reference: historical, timestamp: at(9), amount: "9000" }),
  ];
  try {
    await writeStores(dir, {
      [FILE_CLASSES.settlementLedger]: rows,
      [FILE_CLASSES.paidSuccessEvidence]: [paid],
      [FILE_CLASSES.httpValidation]: [JSON.parse(JSON.stringify(http))],
      [FILE_CLASSES.taskRef]: [task, owner],
    });
    await retainProspectiveDeliveries({
      dataDir: dir,
      settlementReferences: [reference, ref("ef")],
      now: NOW,
    });
    const before = await readFile(path.join(dir, PROSPECTIVE_FILENAME), "utf8");
    await retainProspectiveDeliveries({
      dataDir: dir,
      settlementReferences: [reference.toUpperCase(), ref("ef")],
      now: NOW + 1000,
    });
    const afterReplay = await readFile(path.join(dir, PROSPECTIVE_FILENAME), "utf8");
    assert.equal(afterReplay, before);
    await rm(path.join(dir, FILE_CLASSES.paidSuccessEvidence));
    await rm(path.join(dir, FILE_CLASSES.httpValidation));
    await rm(path.join(dir, FILE_CLASSES.taskRef));
    const { packet } = await packetFor(dir, rows);
    assert.equal(packet.decision, "prospective");
    assert.equal(packet.comparable, true);
    assert.equal(packet.technical.validated_response, 1);
    assert.equal(packet.technical.no_response, 1);
    assert.equal(packet.declaredTaskClass.external_unknown, 1);
    assert.equal(packet.declaredTaskClass.owner_qa, 1);
    assert.equal(packet.coverage.admittedWithoutProspectiveObservation, 1);
    assert.equal(packet.bindsToParent.amountAtomic, "19000");
    assert.equal(packet.bindsToParent.reconciledSettlements, 3);
    assert.equal(packet.sourceVersion, PROSPECTIVE_SOURCE_VERSION);
    assertHonestCoverage(packet);
    assertPrivacy(JSON.stringify(packet), [reference, historical, eventId, task.taskRef, owner.taskRef, "https://"]);
    assertPrivacy(afterReplay, [reference, task.taskRef, "requestedUrl", "raw-secret"]);
    const child = spawnSync(process.execPath, [path.join(ROOT, "commerce-prospective-delivery-cold.mjs"), dir], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PROSPECTIVE_GENERATED_AT: "2026-10-10T13:00:00.000Z" },
    });
    assert.equal(child.status, 0, child.stderr);
    const cold = JSON.parse(child.stdout);
    assert.equal(cold.technical.validated_response, 1);
    assert.equal(cold.technical.no_response, 1);
    assert.equal(cold.coverage.historicalComplete, false);
    assert.equal(cold.bindsToParent.amountAtomic, "19000");
    assert.equal(cold.usefulness, "unknown");
    assertPrivacy(child.stdout, [reference, eventId, task.taskRef]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("same amount and different references stay distinct while http plus mcp counts once", async () => {
  const dir = await tempDir();
  const first = ref("12");
  const second = ref("34");
  const duplicated = ref("56");
  const httpA = observeHttp({
    paidEvidenceId: id(11),
    resource: "/extract",
    body: validExtractBody(),
    settlementReference: first,
    requestDigest: fingerprint(3),
    capturedAt: at(11),
  });
  const httpB = observeHttp({
    paidEvidenceId: id(12),
    resource: "/extract",
    body: validExtractBody(),
    settlementReference: second,
    requestDigest: fingerprint(4),
    capturedAt: at(12),
  });
  const partial = observeHttp({
    paidEvidenceId: id(13),
    resource: "/extract",
    body: validExtractBody({ capture: extractCapture({ textTruncated: true }) }),
    settlementReference: ref("78"),
    requestDigest: fingerprint(5),
    capturedAt: at(13),
  });
  const failed = observeHttp({
    paidEvidenceId: id(14),
    resource: "/defi/morpho-position",
    body: { ok: false, error: "synthetic-upstream", charged: false },
    settlementReference: ref("90"),
    requestDigest: fingerprint(6),
    capturedAt: at(14),
  });
  const conflicted = observeHttp({
    paidEvidenceId: id(15),
    resource: "/extract",
    body: validExtractBody(),
    settlementReference: duplicated,
    requestDigest: fingerprint(7),
    capturedAt: at(15),
  });
  assert.equal(partial.deliveryClass, "truncated_partial");
  assert.equal(failed.deliveryClass, "upstream_failed");
  const rows = [
    settled({ eventId: id(11), reference: first, timestamp: at(11), amount: "5000" }),
    settled({ eventId: id(12), reference: second, timestamp: at(12), amount: "5000" }),
    settled({ eventId: id(13), reference: ref("78"), timestamp: at(13), amount: "5000" }),
    settled({
      eventId: id(14),
      reference: ref("90"),
      timestamp: at(14),
      amount: "5000",
      route: "/defi/morpho-position",
    }),
    settled({ eventId: id(15), reference: duplicated, timestamp: at(15), amount: "5000" }),
    settled({ eventId: id(16), reference: duplicated, timestamp: at(16), amount: "5000" }),
    settled({ eventId: id(17), reference: ref("a1"), timestamp: at(17), amount: "5000" }),
  ];
  try {
    await writeStores(dir, {
      [FILE_CLASSES.settlementLedger]: rows,
      [FILE_CLASSES.paidSuccessEvidence]: [
        paidFrom(httpA, { timestamp: at(11), fingerprint: fingerprint(8), settlementReference: first }),
        paidFrom(httpB, { timestamp: at(12), fingerprint: fingerprint(9), settlementReference: second }),
        paidFrom(partial, { timestamp: at(13), fingerprint: "13".repeat(32), settlementReference: ref("78") }),
        paidFrom(failed, { timestamp: at(14), fingerprint: "14".repeat(32), settlementReference: ref("90") }),
        paidFrom(conflicted, { timestamp: at(15), fingerprint: "15".repeat(32), settlementReference: duplicated }),
      ],
      [FILE_CLASSES.httpValidation]: [httpA, httpB, partial, failed, conflicted].map((row) => JSON.parse(JSON.stringify(row))),
      [FILE_CLASSES.commerceEvents]: [typedEvent(id(15), at(15), "paid_success")],
    });
    await retainProspectiveDeliveries({
      dataDir: dir,
      settlementReferences: [first, second, ref("78"), ref("90"), duplicated, ref("a1")],
      now: NOW,
    });
    const admission = readCommerceSettlementAdmission(ndjson(rows));
    const packet = await readProspectiveDelivery({
      dataDir: dir,
      admission,
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(packet.technical.validated_response, 2);
    assert.equal(packet.technical.partial, 1);
    assert.equal(packet.technical.failure_after_settlement, 1);
    assert.equal(packet.technical.channel_conflict, 1);
    assert.equal(packet.technical.no_response, 1);
    assert.equal(packet.bindsToParent.amountAtomic, admission.summary.amountAtomic);
    assert.equal(packet.bindsToParent.amountAtomic, "30000");
    assert.equal(packet.bindsToParent.reconciledSettlements, 6);
    assert.equal(admission.duplicateReferencesIgnored, 1);
    assertHonestCoverage(packet);
    const malformed = observeHttp({
      paidEvidenceId: id(18),
      resource: "/extract",
      body: { nope: true },
      settlementReference: ref("b2"),
      requestDigest: fingerprint("a"),
      capturedAt: at(18),
    });
    assert.equal(malformed.validatorVerdict, "invalid");
    const malformedTechnical = classifyProspectiveObservation({
      disposition: "rejected_schema",
      reasons: ["output_schema_rejected"],
      deliveryClass: malformed.deliveryClass,
      validatorVerdict: malformed.validatorVerdict,
    });
    assert.equal(malformedTechnical, malformed.deliveryClass === "upstream_failed" ? "failure_after_settlement" : "schema_invalid");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("feedback, replay, corruption, mismatch, and saturation stay bounded", async () => {
  const dir = await tempDir();
  const reference = ref("c3");
  const key = prospectiveEvidenceKey(reference);
  const ledger = [settled({ eventId: id(21), reference, timestamp: at(21), amount: "42000" })];
  try {
    const early = await recordProspectiveFeedback(dir, {
      evidenceKey: key,
      disposition: "useful",
      seal: "binds_declaration",
    });
    assert.equal(early.reason, "record_absent");
    const dropped = observation(reference, "dropped_connection");
    assert.equal(dropped.technical, "dropped_connection");
    await appendProspectiveObservations(dir, [dropped], { now: NOW });
    const stored = (await readProspectiveDelivery({
      dataDir: dir,
      ledger: ndjson(ledger),
      generatedAt: "2026-10-10T13:00:00.000Z",
    }));
    assert.equal(stored.technical.dropped_connection, 1);
    assert.equal(stored.declaredFeedback.absent, 1);
    const journalBefore = await stat(path.join(dir, PROSPECTIVE_FILENAME));
    await appendProspectiveObservations(dir, [dropped], { now: NOW + 5000 });
    assert.equal((await stat(path.join(dir, PROSPECTIVE_FILENAME))).size, journalBefore.size);
    const filled = await recordProspectiveFeedback(dir, {
      evidenceKey: key,
      disposition: "useful",
      seal: "binds_declaration",
      taskClass: "external_unknown",
      receivedAt: "2026-10-10T12:40:00.000Z",
      expiresAt: "2026-10-17T12:40:00.000Z",
    });
    assert.equal(filled.ok, true);
    assert.equal(filled.record.technical, "dropped_connection");
    assert.equal(filled.record.feedback, "declared_useful");
    const conflict = await recordProspectiveFeedback(dir, {
      evidenceKey: key,
      disposition: "not_useful",
      seal: "binds_declaration",
    });
    assert.equal(conflict.reason, "conflicting_declaration");
    assert.equal(conflict.record.feedback, "declared_useful");
    const replay = await recordProspectiveFeedback(dir, {
      evidenceKey: key,
      disposition: "useful",
      seal: "binds_declaration",
    });
    assert.equal(replay.idempotentReplay, true);
    const foreign = applyDeclaredFeedback(filled.record, {
      evidenceKey: prospectiveEvidenceKey(ref("d4")),
      disposition: "useful",
      seal: "binds_declaration",
    });
    assert.equal(foreign.reason, "foreign");
    assert.equal(foreign.record.technical, "dropped_connection");
    const late = applyDeclaredFeedback(filled.record, {
      evidenceKey: key,
      disposition: "not_useful",
      seal: "binds_declaration",
      late: true,
    });
    assert.equal(late.reason, "late");
    const expired = applyDeclaredFeedback(filled.record, {
      evidenceKey: key,
      disposition: "not_useful",
      seal: "binds_declaration",
      expired: true,
    });
    assert.equal(expired.reason, "expired");
    const pastExpiry = applyDeclaredFeedback(filled.record, {
      evidenceKey: key,
      disposition: "not_useful",
      seal: "binds_declaration",
      receivedAt: "2026-10-18T00:00:00.000Z",
      expiresAt: "2026-10-17T00:00:00.000Z",
    });
    assert.equal(pastExpiry.reason, "expired");
    const cross = applyDeclaredFeedback({ ...filled.record, taskClass: "external_unknown", feedback: "absent", feedbackSeal: "none" }, {
      evidenceKey: key,
      disposition: "useful",
      seal: "binds_declaration",
      taskClass: "owner_qa",
    });
    assert.equal(cross.reason, "cross_task");
    assert.equal(cross.record.technical, "dropped_connection");
    const unsealed = applyDeclaredFeedback({ ...filled.record, feedback: "absent", feedbackSeal: "none" }, {
      evidenceKey: key,
      disposition: "useful",
      seal: "none",
    });
    assert.equal(unsealed.reason, "unsealed");
    const technicalChange = observation(reference, "validated_response");
    const sizeBeforeConflict = (await stat(path.join(dir, PROSPECTIVE_FILENAME))).size;
    await appendProspectiveObservations(dir, [technicalChange], { now: NOW });
    assert.equal((await stat(path.join(dir, PROSPECTIVE_FILENAME))).size, sizeBeforeConflict);
    await appendFile(path.join(dir, PROSPECTIVE_FILENAME), "{", { mode: 0o600 });
    const torn = await readProspectiveDelivery({
      dataDir: dir,
      ledger: ndjson(ledger),
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(torn.technical.dropped_connection, 1);
    assert.equal(torn.declaredFeedback.declared_useful, 1);
    assert.equal(torn.technical.validated_response, 0);
    assert.equal(torn.coverage.corruptLines, 1);
    assert.equal(torn.comparable, false);
    assertHonestCoverage(torn);

    const mismatchDir = await tempDir();
    await writeFile(path.join(mismatchDir, PROSPECTIVE_FILENAME), `${JSON.stringify({
      schemaVersion: "samedaydesk.commerce-prospective-delivery-header.v0",
      captureVersion: "prospective_delivery_v0",
      prospectiveSince: at(1),
      sourceVersion: "0",
    })}\n`, { mode: 0o600 });
    const mismatched = await readProspectiveDelivery({
      dataDir: mismatchDir,
      ledger: ndjson(ledger),
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(mismatched.decision, "version_mismatch");
    assert.equal(mismatched.comparable, false);
    assert.equal(mismatched.technical.validated_response, 0);
    assert.equal(mismatched.coverage.historicalComplete, false);
    assert.equal(mismatched.coverage.zeroProspectiveIsNotHistoricalZero, true);
    await rm(mismatchDir, { recursive: true, force: true });

    const corruptDir = await tempDir();
    await writeFile(path.join(corruptDir, PROSPECTIVE_FILENAME), "{not-json\n", { mode: 0o600 });
    const corrupt = await readProspectiveDelivery({
      dataDir: corruptDir,
      ledger: ndjson(ledger),
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(corrupt.decision, "unreadable");
    assert.equal(corrupt.comparable, false);
    assertHonestCoverage(corrupt);
    await rm(corruptDir, { recursive: true, force: true });

    const boundDir = await tempDir();
    await appendProspectiveObservations(boundDir, [
      observation(ref("e1"), "validated_response"),
      observation(ref("e2"), "no_response"),
      observation(ref("e3"), "partial", { technical: "partial" }),
    ], { now: NOW, maxRecords: 2 });
    const saturated = await readFile(path.join(boundDir, PROSPECTIVE_FILENAME), "utf8");
    const firstBound = await readProspectiveDelivery({
      dataDir: boundDir,
      ledger: ndjson([
        settled({ eventId: id(31), reference: ref("e1"), timestamp: at(1), amount: "1" }),
        settled({ eventId: id(32), reference: ref("e2"), timestamp: at(2), amount: "1" }),
        settled({ eventId: id(33), reference: ref("e3"), timestamp: at(3), amount: "1" }),
      ]),
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(firstBound.decision, "saturated");
    assert.equal(firstBound.coverage.projectionSaturated, true);
    assert.equal(firstBound.technical.validated_response, 1);
    assert.equal(firstBound.technical.no_response, 1);
    assert.equal(firstBound.technical.partial, 0);
    assert.equal(firstBound.comparable, false);
    const grown = saturated.length;
    await appendProspectiveObservations(boundDir, [observation(ref("e4"), "unknown", { technical: "unknown" })], {
      now: NOW,
      maxRecords: 2,
    });
    assert.equal((await readFile(path.join(boundDir, PROSPECTIVE_FILENAME), "utf8")).length, grown);
    await rm(boundDir, { recursive: true, force: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent writes, stale cuts, and unexpected units do not invent a second amount", async () => {
  const dir = await tempDir();
  try {
    await Promise.all([
      appendProspectiveObservations(dir, [observation(ref("f1"), "validated_response")], { now: NOW }),
      appendProspectiveObservations(dir, [observation(ref("f2"), "schema_invalid", { technical: "schema_invalid" })], { now: NOW }),
    ]);
    await Promise.all([
      appendProspectiveObservations(dir, [observation(ref("f3"), "validated_response")], { now: NOW }),
      appendProspectiveObservations(dir, [observation(ref("f3"), "no_response")], { now: NOW }),
    ]);
    const rows = [
      settled({ eventId: id(41), reference: ref("f1"), timestamp: at(1), amount: "1000" }),
      settled({ eventId: id(42), reference: ref("f2"), timestamp: at(2), amount: "1000" }),
      settled({ eventId: id(43), reference: ref("f3"), timestamp: at(3), amount: "1000" }),
      {
        schemaVersion: SCHEMA_VERSION,
        state: "reconciled",
        settlementReference: ref("f4"),
        amountAtomic: "1.5",
        unit: "ETH",
      },
    ];
    const admission = readCommerceSettlementAdmission(`${ndjson(rows)}{\n`);
    const packet = await readProspectiveDelivery({
      dataDir: dir,
      admission,
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(packet.technical.validated_response + packet.technical.no_response, 2);
    assert.equal(packet.technical.schema_invalid, 1);
    assert.equal(Object.values(packet.technical).reduce((sum, value) => sum + value, 0), 3);
    assert.equal(packet.bindsToParent.amountAtomic, admission.summary.amountAtomic);
    assert.equal(packet.bindsToParent.amountAtomic, "3000");
    assert.equal(admission.summary.invalidLines > 0, true);
    assert.equal(packet.recognizedIncomeAtomic, null);
    const staleCut = await readProspectiveDelivery({
      dataDir: dir,
      admission,
      suppliedCutId: "ab".repeat(32),
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(staleCut.decision, "stale_cut");
    assert.equal(staleCut.comparable, false);
    assert.equal(staleCut.bindsToParent.amountAtomic, "3000");
    assert.equal(staleCut.bindsToParent.matchesSuppliedSummary, false);
    const staleSummary = await readProspectiveDelivery({
      dataDir: dir,
      admission,
      suppliedSummary: { ...admission.summary, amountAtomic: "1" },
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(staleSummary.decision, "stale_cut");
    assert.equal(staleSummary.bindsToParent.amountAtomic, admission.summary.amountAtomic);
    const empty = projectProspectiveDelivery({
      journalText: "",
      admission,
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(empty.decision, "not_started");
    assert.equal(empty.comparable, false);
    assert.equal(empty.coverage.admittedWithoutProspectiveObservation, admission.admitted.length);
    assert.equal(empty.technical.validated_response, 0);
    assert.equal(empty.coverage.historicalComplete, false);
    assertHonestCoverage(empty);
    const text = await readFile(path.join(dir, PROSPECTIVE_FILENAME), "utf8");
    assert.equal(text.includes(ref("f1")), false);
    assert.equal(text.includes("ETH"), false);
    assert.equal(text.includes("secret.example"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("status echoes the parent admission and an empty store is not historical zero", async () => {
  const dir = await tempDir();
  try {
    const rows = [settled({ eventId: id(51), reference: ref("aa"), timestamp: at(1), amount: "25000" })];
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: "",
      client: {},
      dataDir: dir,
      eventPaths: [],
      network: "eip155:8453",
      asset: BASE_USDC,
      treasury: "",
    });
    await writeFile(reconciler.ledgerPath, ndjson(rows));
    const status = await reconciler.status();
    assert.equal(status.ledger.amountAtomic, "25000");
    assert.equal(status.prospectiveDelivery.decision, "not_started");
    assert.equal(status.prospectiveDelivery.bindsToParent.amountAtomic, status.ledger.amountAtomic);
    assert.equal(status.prospectiveDelivery.bindsToParent.admissionCutId, readCommerceSettlementAdmission(ndjson(rows)).admissionCutId);
    assert.equal(status.prospectiveDelivery.coverage.historicalComplete, false);
    assert.equal(status.prospectiveDelivery.coverage.admittedWithoutProspectiveObservation, 1);
    assert.equal(status.settlementUnit.recognizedIncomeAtomic, null);
    const source = readFileSync(new URL("./commerce-settlement-reconciler.mjs", import.meta.url), "utf8");
    assert.match(source, /retainProspectiveDeliveries/);
    assert.match(source, /readProspectiveDeliveryForStatus/);
    const retained = source.slice(source.indexOf("retainProspectiveDeliveries") - 180, source.indexOf("retainProspectiveDeliveries") + 420);
    assert.match(retained, /result\.newRecords\.length > 0/);
    assert.match(retained, /catch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cold fixture packet keeps the parent amount and withholds historical completeness", () => {
  const child = spawnSync(process.execPath, [path.join(ROOT, "commerce-prospective-delivery-cold.mjs"), FIXTURE], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PROSPECTIVE_GENERATED_AT: "2026-10-10T13:00:00.000Z" },
  });
  assert.equal(child.status, 0, child.stderr);
  const packet = JSON.parse(child.stdout);
  assert.equal(packet.schemaVersion, "samedaydesk.commerce-prospective-delivery.v1");
  assert.equal(packet.decision, "prospective");
  assert.equal(packet.comparable, true);
  assert.equal(packet.prospectiveSince, "2026-10-10T12:00:00.000Z");
  assert.equal(packet.sourceVersion, "1.23.51");
  assert.equal(packet.captureVersion, "prospective_delivery_v1");
  assert.equal(packet.technical.validated_response, 1);
  assert.equal(Object.entries(packet.technical).filter(([, value]) => value !== 0).length, 1);
  assert.equal(packet.bindsToParent.reconciledSettlements, 2);
  assert.equal(packet.bindsToParent.amountAtomic, "80000");
  assert.equal(packet.bindsToParent.matchesSuppliedSummary, null);
  assert.equal(packet.coverage.admittedWithoutProspectiveObservation, 1);
  assert.equal(packet.declaredFeedback.absent, 1);
  assert.equal(packet.declaredTaskClass.absent, 1);
  assertHonestCoverage(packet);
  assertPrivacy(child.stdout, [ref("11"), ref("22"), id(1), id(2), "evidenceKey"]);
  const journal = readFileSync(path.join(FIXTURE, PROSPECTIVE_FILENAME), "utf8");
  assert.equal(journal.includes(ref("11")), false);
  assert.equal(journal.includes(id(1)), false);
});
