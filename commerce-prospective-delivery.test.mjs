import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { appendFile, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbiItem } from "viem";

import {
  CALLER_RESULT_FEEDBACK_TTL_MS,
  createCallerResultFeedbackService,
  issueCallerResultFeedbackToken,
} from "./caller-result-feedback.mjs";
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
  PROSPECTIVE_RESPONSE_BOUNDARY_MS,
  PROSPECTIVE_SOURCE_VERSION,
  appendProspectiveObservations,
  applyDeclaredFeedback,
  bindStoredCallerResultFeedback,
  classifyProspectiveObservation,
  commerceProspectiveDeliveryOutputSchema,
  observationFromJoin,
  projectProspectiveDelivery,
  prospectiveEvidenceKey,
  readProspectiveDelivery,
  recordProspectiveFeedback,
  retainProspectiveDeliveries,
  unavailableProspectiveDelivery,
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
  assert.equal(packet.boundaries.callerTechnicalClaimIsNotAuthority, true);
  assert.equal(packet.boundaries.technicalRevisionAuthority, "ordinary_delivery_join");
  assert.equal(packet.boundaries.technicalRevisionClock, "first_observed_at");
  assert.equal(packet.boundaries.lateTechnicalRevisionIsNotLastWriteWins, true);
  assert.equal(packet.boundaries.noResponseRequiresResponseBoundary, true);
  assert.equal(packet.coverage.evidenceUnavailable, false);
  assert.equal(packet.coverage.responseBoundaryMs, PROSPECTIVE_RESPONSE_BOUNDARY_MS);
  assert.equal(Number.isInteger(packet.coverage.unadmittedRecords), true);
  assert.equal(Number.isInteger(packet.technicalRevisions), true);
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
  assert.equal(classifyProspectiveObservation({
    disposition: "missing_capture",
    reasons: ["capture_absent"],
  }, { responsePending: true }), "unknown");
  assert.equal(classifyProspectiveObservation({
    disposition: "missing_capture",
    reasons: ["capture_absent"],
  }, { responsePending: false }), "no_response");
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
    assert.equal(early.ok, false);
    assert.equal(early.reason, "caller_claim_refused");
    assert.equal(early.record, null);
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
    const filled = { ...dropped, feedback: "declared_useful", feedbackSeal: "binds_declaration" };
    const beforeClaim = (await stat(path.join(dir, PROSPECTIVE_FILENAME))).size;
    await appendProspectiveObservations(dir, [filled], { now: NOW });
    assert.equal((await stat(path.join(dir, PROSPECTIVE_FILENAME))).size, beforeClaim);
    await appendFile(path.join(dir, PROSPECTIVE_FILENAME), `${JSON.stringify(filled)}\n`, { mode: 0o600 });
    const afterFill = await readProspectiveDelivery({
      dataDir: dir,
      ledger: ndjson(ledger),
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(afterFill.technical.dropped_connection, 1);
    assert.equal(afterFill.declaredFeedback.declared_useful, 1);
    assert.equal(afterFill.usefulness, "unknown");
    const fillSize = (await stat(path.join(dir, PROSPECTIVE_FILENAME))).size;
    await appendProspectiveObservations(dir, [{ ...filled, feedback: "declared_not_useful" }], { now: NOW });
    assert.equal((await stat(path.join(dir, PROSPECTIVE_FILENAME))).size, fillSize);
    const forged = applyDeclaredFeedback(filled, {
      evidenceKey: key,
      disposition: "not_useful",
      seal: "binds_declaration",
      late: true,
      expired: true,
      taskClass: "owner_qa",
    });
    assert.equal(forged.reason, "caller_claim_refused");
    assert.equal(forged.record.technical, "dropped_connection");
    assert.equal(forged.record.feedback, "declared_useful");
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
    const retainAt = source.indexOf("await retainProspectiveDeliveries");
    const retained = source.slice(retainAt - 320, retainAt + 420);
    assert.match(retained, /settlementReferences: result\.newRecords\.map/);
    assert.equal(/if \(result\.newRecords\.length > 0\)/.test(retained), false);
    assert.match(retained, /catch/);
    assert.match(source, /unavailableProspectiveDelivery/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function observedStamps(journalText, reference) {
  const key = prospectiveEvidenceKey(reference);
  return journalText.split("\n").flatMap((line) => {
    if (!line) return [];
    try {
      const row = JSON.parse(line);
      return row.evidenceKey === key ? [row.observedAt] : [];
    } catch {
      return [];
    }
  });
}

test("a later ordinary-join capture advances unknown and no_response without rewriting the first clock", async () => {
  const dir = await tempDir();
  const pending = ref("b1");
  const aged = ref("b2");
  const historical = ref("b3");
  const partialRef = ref("b4");
  const eventAt = Date.parse("2026-10-10T12:00:00.000Z");
  const inside = eventAt + 60_000;
  const outside = eventAt + PROSPECTIVE_RESPONSE_BOUNDARY_MS + 1_000;
  const pendingRow = settled({ eventId: id(61), reference: pending, timestamp: new Date(eventAt).toISOString(), amount: "5000" });
  const agedRow = settled({ eventId: id(62), reference: aged, timestamp: new Date(eventAt - PROSPECTIVE_RESPONSE_BOUNDARY_MS - 60_000).toISOString(), amount: "7000" });
  const historicalRow = settled({ eventId: id(63), reference: historical, timestamp: at(3), amount: "9000" });
  const partialRow = settled({ eventId: id(64), reference: partialRef, timestamp: new Date(eventAt).toISOString(), amount: "4000" });
  const pendingHttp = observeHttp({
    paidEvidenceId: pendingRow.sourceEventId,
    resource: "/extract",
    body: validExtractBody(),
    settlementReference: pending,
    requestDigest: fingerprint(1),
    capturedAt: pendingRow.sourceEventTimestamp,
  });
  const partialHttp = observeHttp({
    paidEvidenceId: partialRow.sourceEventId,
    resource: "/extract",
    body: validExtractBody({ capture: extractCapture({ textTruncated: true }) }),
    settlementReference: partialRef,
    requestDigest: fingerprint(3),
    capturedAt: partialRow.sourceEventTimestamp,
  });
  const agedPaid = historicalV1Row({
    id: agedRow.sourceEventId,
    requestStartedAt: agedRow.sourceEventTimestamp,
    responseFinishedAt: agedRow.sourceEventTimestamp,
    settlementReference: aged,
    requestDigest: fingerprint(2),
    credentialFingerprint: fingerprint(7),
  });
  try {
    await writeStores(dir, {
      [FILE_CLASSES.settlementLedger]: [pendingRow, agedRow, historicalRow, partialRow],
      [FILE_CLASSES.paidSuccessEvidence]: [
        paidFrom(pendingHttp, { timestamp: pendingRow.sourceEventTimestamp, fingerprint: fingerprint(7), settlementReference: pending }),
        agedPaid,
        paidFrom(partialHttp, { timestamp: partialRow.sourceEventTimestamp, fingerprint: fingerprint(7), settlementReference: partialRef }),
      ],
    });
    await retainProspectiveDeliveries({
      dataDir: dir,
      settlementReferences: [pending, aged, partialRef],
      now: inside,
    });
    const opened = await readProspectiveDelivery({
      dataDir: dir,
      ledger: ndjson([pendingRow, agedRow, historicalRow, partialRow]),
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(opened.technical.unknown, 2);
    assert.equal(opened.technical.no_response, 1);
    assert.equal(opened.coverage.admittedWithoutProspectiveObservation, 1);
    assert.equal(opened.bindsToParent.amountAtomic, "25000");
    assert.equal(opened.technicalRevisions, 0);
    const journalBeforeClaim = await readFile(path.join(dir, PROSPECTIVE_FILENAME), "utf8");
    const firstClock = observedStamps(journalBeforeClaim, pending)[0];
    await appendProspectiveObservations(dir, [observation(pending, "validated_response", { observedAt: firstClock })], { now: inside });
    assert.equal(await readFile(path.join(dir, PROSPECTIVE_FILENAME), "utf8"), journalBeforeClaim);
    await retainProspectiveDeliveries({
      dataDir: dir,
      settlementReferences: [],
      now: outside,
    });
    const agedOut = await readFile(path.join(dir, PROSPECTIVE_FILENAME), "utf8");
    const pendingPacket = await readProspectiveDelivery({
      dataDir: dir,
      ledger: ndjson([pendingRow, agedRow, historicalRow, partialRow]),
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(pendingPacket.technical.unknown, 0);
    assert.equal(pendingPacket.technical.no_response, 3);
    assert.equal(observedStamps(agedOut, pending).every((stamp) => stamp === firstClock), true);
    assert.equal(agedOut.includes(historical), false);
    assert.equal(pendingHttp.validatorVerdict, "pass");
    assert.equal(partialHttp.deliveryClass, "truncated_partial");
    await writeFile(path.join(dir, FILE_CLASSES.httpValidation), ndjson([pendingHttp, partialHttp]), { mode: 0o600 });
    const beforeAdvance = await stat(path.join(dir, PROSPECTIVE_FILENAME));
    await retainProspectiveDeliveries({ dataDir: dir, settlementReferences: [], now: outside + 5_000 });
    await retainProspectiveDeliveries({ dataDir: dir, settlementReferences: [pending, partialRef], now: outside + 5_000 });
    const advancedText = await readFile(path.join(dir, PROSPECTIVE_FILENAME), "utf8");
    const advanced = await readProspectiveDelivery({
      dataDir: dir,
      ledger: ndjson([pendingRow, agedRow, historicalRow, partialRow]),
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(advanced.technical.validated_response, 1);
    assert.equal(advanced.technical.partial, 1);
    assert.equal(advanced.technical.no_response, 1);
    assert.equal(advanced.technical.unknown, 0);
    assert.equal(advanced.technicalRevisions, 4);
    assert.equal(advanced.coverage.admittedWithoutProspectiveObservation, 1);
    assert.equal(advanced.bindsToParent.amountAtomic, "25000");
    assert.equal(advanced.comparable, true);
    assert.equal(observedStamps(advancedText, pending).every((stamp) => stamp === firstClock), true);
    assert.equal(observedStamps(advancedText, partialRef).every((stamp) => stamp === observedStamps(journalBeforeClaim, partialRef)[0]), true);
    assert.equal(advancedText.includes(pending), false);
    assert.equal(advancedText.includes("https://"), false);
    const replaySize = (await stat(path.join(dir, PROSPECTIVE_FILENAME))).size;
    assert.equal(replaySize > beforeAdvance.size, true);
    await retainProspectiveDeliveries({ dataDir: dir, settlementReferences: [], now: outside + 9_000 });
    assert.equal((await stat(path.join(dir, PROSPECTIVE_FILENAME))).size, replaySize);
    const replaced = observeHttp({
      paidEvidenceId: pendingRow.sourceEventId,
      resource: "/extract",
      body: { nope: true },
      settlementReference: pending,
      requestDigest: fingerprint(1),
      capturedAt: pendingRow.sourceEventTimestamp,
    });
    await writeFile(path.join(dir, FILE_CLASSES.httpValidation), ndjson([replaced, partialHttp]), { mode: 0o600 });
    await retainProspectiveDeliveries({ dataDir: dir, settlementReferences: [pending], now: eventAt - 60_000 });
    const held = await readProspectiveDelivery({
      dataDir: dir,
      ledger: ndjson([pendingRow, agedRow, historicalRow, partialRow]),
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(held.technical.validated_response, 1);
    assert.equal(held.technical.partial, 1);
    assert.equal(held.technical.no_response, 1);
    assert.equal(held.technical.unknown, 0);
    assert.equal((await stat(path.join(dir, PROSPECTIVE_FILENAME))).size, replaySize);
    assertHonestCoverage(held);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("technical counts follow the admitted identity set across a mixed and lagging cut", async () => {
  const dir = await tempDir();
  const admitted = ref("c1");
  const orphan = ref("c2");
  const missing = ref("c3");
  const rows = [
    settled({ eventId: id(65), reference: admitted, timestamp: at(1), amount: "4000" }),
    settled({ eventId: id(66), reference: missing, timestamp: at(2), amount: "6000" }),
  ];
  const lagging = [rows[0]];
  try {
    await Promise.all([
      appendProspectiveObservations(dir, [observation(admitted, "validated_response")], { now: NOW }),
      appendProspectiveObservations(dir, [observation(orphan, "failure_after_settlement", { technical: "failure_after_settlement" })], { now: NOW }),
    ]);
    const admission = readCommerceSettlementAdmission(ndjson(rows));
    const mixed = await readProspectiveDelivery({
      dataDir: dir,
      admission,
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(mixed.technical.validated_response, 1);
    assert.equal(mixed.technical.failure_after_settlement, 0);
    assert.equal(Object.values(mixed.technical).reduce((sum, value) => sum + value, 0), 1);
    assert.equal(mixed.coverage.unadmittedRecords, 1);
    assert.equal(mixed.coverage.admittedWithoutProspectiveObservation, 1);
    assert.equal(mixed.comparable, false);
    assert.equal(mixed.coverage.historicalComplete, false);
    assert.equal(mixed.bindsToParent.amountAtomic, "10000");
    assert.equal(mixed.bindsToParent.admissionCutId, admission.admissionCutId);
    const behind = await readProspectiveDelivery({
      dataDir: dir,
      admission: readCommerceSettlementAdmission(ndjson(lagging)),
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(behind.technical.validated_response, 1);
    assert.equal(behind.technical.failure_after_settlement, 0);
    assert.equal(behind.coverage.unadmittedRecords, 1);
    assert.equal(behind.coverage.admittedWithoutProspectiveObservation, 0);
    assert.equal(behind.comparable, false);
    assert.equal(behind.bindsToParent.amountAtomic, "4000");
    assert.equal(behind.bindsToParent.reconciledSettlements, 1);
    const source = readFileSync(new URL("./commerce-prospective-delivery.mjs", import.meta.url), "utf8");
    assert.equal(source.includes("amountAtomic +="), false);
    assertHonestCoverage(mixed);
    assertHonestCoverage(behind);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("caller feedback binds from the stored statement, then survives raw deletion", async () => {
  const dir = await tempDir();
  const reference = ref("d5");
  const mismatched = ref("d6");
  const eventId = id(71);
  const otherId = id(72);
  const secret = "p".repeat(32);
  const issuedAt = Date.parse("2026-10-10T12:00:00.000Z");
  const http = observeHttp({
    paidEvidenceId: eventId,
    resource: "/extract",
    body: validExtractBody(),
    settlementReference: reference,
    requestDigest: fingerprint(4),
    capturedAt: at(1),
  });
  const otherHttp = observeHttp({
    paidEvidenceId: otherId,
    resource: "/extract",
    body: validExtractBody(),
    settlementReference: mismatched,
    requestDigest: fingerprint(5),
    capturedAt: at(2),
  });
  const paid = paidFrom(http, { timestamp: at(1), fingerprint: fingerprint(6), settlementReference: reference });
  const otherPaid = paidFrom(otherHttp, { timestamp: at(2), fingerprint: fingerprint(8), settlementReference: mismatched });
  const rows = [
    settled({ eventId, reference, timestamp: at(1), amount: "5000" }),
    settled({ eventId: otherId, reference: mismatched, timestamp: at(2), amount: "5000" }),
  ];
  const task = taskFor(eventId, "external_unknown", "op-prospective-feedback");
  const otherTask = taskFor(otherId, "external_unknown", "op-prospective-other");
  const service = createCallerResultFeedbackService({ dataDir: dir, key: secret, now: () => issuedAt });
  const submit = (token, body) => service.submit({ token, body, rawBody: Buffer.from(JSON.stringify(body)), query: {} });
  const tokenFor = (row, digestRow, when = issuedAt) => issueCallerResultFeedbackToken({
    key: secret,
    eventId: row.id,
    method: "GET",
    route: "/extract",
    requestDigest: row.requestDigest,
    responseDigest: digestRow.responseDigest,
    now: when,
  });
  try {
    const earlyDir = await tempDir();
    const earlyHttp = observeHttp({
      paidEvidenceId: id(73),
      resource: "/extract",
      body: validExtractBody(),
      settlementReference: ref("d7"),
      requestDigest: fingerprint(9),
      capturedAt: at(4),
    });
    const earlyPaid = paidFrom(earlyHttp, { id: id(73), timestamp: at(4), fingerprint: fingerprint("b"), settlementReference: ref("d7") });
    await writeStores(earlyDir, {
      [FILE_CLASSES.paidSuccessEvidence]: [earlyPaid],
      [FILE_CLASSES.httpValidation]: [JSON.parse(JSON.stringify(earlyHttp))],
    });
    const earlyService = createCallerResultFeedbackService({ dataDir: earlyDir, key: secret, now: () => issuedAt });
    const earlyToken = issueCallerResultFeedbackToken({
      key: secret,
      eventId: earlyPaid.id,
      method: "GET",
      route: "/extract",
      requestDigest: earlyPaid.requestDigest,
      responseDigest: earlyPaid.responseDigest,
      now: issuedAt,
    });
    const early = await earlyService.submit({
      token: earlyToken,
      body: { disposition: "useful" },
      rawBody: Buffer.from(JSON.stringify({ disposition: "useful" })),
      query: {},
    });
    assert.equal(early.statusCode, 200);
    await assert.rejects(stat(path.join(earlyDir, PROSPECTIVE_FILENAME)));
    await rm(earlyDir, { recursive: true, force: true });

    await writeStores(dir, {
      [FILE_CLASSES.settlementLedger]: rows,
      [FILE_CLASSES.paidSuccessEvidence]: [paid, otherPaid],
      [FILE_CLASSES.httpValidation]: [http, otherHttp].map((row) => JSON.parse(JSON.stringify(row))),
      [FILE_CLASSES.taskRef]: [task, otherTask],
    });
    await retainProspectiveDeliveries({
      dataDir: dir,
      settlementReferences: [reference, mismatched],
      now: Date.parse(at(1)) + 60_000,
    });
    const before = await readProspectiveDelivery({
      dataDir: dir,
      ledger: ndjson(rows),
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(before.technical.validated_response, 2);
    assert.equal(before.declaredFeedback.absent, 2);
    const unsigned = await submit("not-a-token", { disposition: "useful" });
    assert.equal(unsigned.statusCode, 401);
    const expiredService = createCallerResultFeedbackService({
      dataDir: dir,
      key: secret,
      now: () => issuedAt + CALLER_RESULT_FEEDBACK_TTL_MS,
    });
    const expired = await expiredService.submit({
      token: tokenFor(paid, http),
      body: { disposition: "useful" },
      rawBody: Buffer.from(JSON.stringify({ disposition: "useful" })),
      query: {},
    });
    assert.equal(expired.statusCode, 401);
    const foreign = await submit(tokenFor({ id: id(99), requestDigest: paid.requestDigest }, http), { disposition: "useful" });
    assert.equal(foreign.statusCode, 409);
    await writeFile(path.join(dir, FILE_CLASSES.taskRef), ndjson([
      task,
      taskFor(otherId, "owner_qa", "op-prospective-shifted"),
    ]), { mode: 0o600 });
    const shifted = await submit(tokenFor(otherPaid, otherHttp), { disposition: "useful" });
    assert.equal(shifted.statusCode, 200);
    const shiftedBind = await bindStoredCallerResultFeedback(dir);
    assert.equal(shiftedBind.reason, "cross_task");
    const accepted = await submit(tokenFor(paid, http), { disposition: "useful", reasonCategory: "matched_task" });
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.body.usefulness, "unknown");
    assert.equal(accepted.body.idempotentReplay, false);
    const conflict = await submit(tokenFor(paid, http), { disposition: "not_useful" });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.retainedDisposition, "useful");
    const replay = await submit(tokenFor(paid, http), { disposition: "useful", reasonCategory: "matched_task" });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.idempotentReplay, true);
    const bound = await readProspectiveDelivery({
      dataDir: dir,
      ledger: ndjson(rows),
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(bound.declaredFeedback.declared_useful, 1);
    assert.equal(bound.declaredFeedback.absent, 1);
    assert.equal(bound.technical.validated_response, 2);
    assert.equal(bound.usefulness, "unknown");
    assert.equal(bound.declaredTaskClass.external_unknown, 2);
    await rm(path.join(dir, FILE_CLASSES.paidSuccessEvidence));
    await rm(path.join(dir, FILE_CLASSES.httpValidation));
    await rm(path.join(dir, FILE_CLASSES.taskRef));
    await rm(path.join(dir, FILE_CLASSES.callerResultFeedback));
    const retained = await readProspectiveDelivery({
      dataDir: dir,
      ledger: ndjson(rows),
      generatedAt: "2026-10-10T13:00:00.000Z",
    });
    assert.equal(retained.declaredFeedback.declared_useful, 1);
    assert.equal(retained.technical.validated_response, 2);
    assert.equal(retained.usefulness, "unknown");
    assertHonestCoverage(retained);
    const journal = await readFile(path.join(dir, PROSPECTIVE_FILENAME), "utf8");
    assertPrivacy(journal, [reference, eventId, task.taskRef, secret, "https://", "matched_task"]);
    const child = spawnSync(process.execPath, [path.join(ROOT, "commerce-prospective-delivery-cold.mjs"), dir], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PROSPECTIVE_GENERATED_AT: "2026-10-10T13:00:00.000Z" },
    });
    assert.equal(child.status, 0, child.stderr);
    const cold = JSON.parse(child.stdout);
    assert.equal(cold.declaredFeedback.declared_useful, 1);
    assert.equal(cold.technical.validated_response, 2);
    assert.equal(cold.usefulness, "unknown");
    assert.equal(cold.coverage.historicalComplete, false);
    const feedbackSource = readFileSync(new URL("./caller-result-feedback.mjs", import.meta.url), "utf8");
    assert.match(feedbackSource, /bindStoredCallerResultFeedback/);
    assert.equal(feedbackSource.includes("binds_declaration"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reconcile admits payment before response evidence and a later pass advances it", async () => {
  const dir = await tempDir();
  const recent = ref("e5");
  const aged = ref("e6");
  const historical = ref("e7");
  const recentId = id(81);
  const agedId = id(82);
  const treasury = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
  const payer = "0x1111111111111111111111111111111111111111";
  const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
  const recentAt = new Date(Date.now() - 60_000).toISOString();
  const agedAt = new Date(Date.now() - PROSPECTIVE_RESPONSE_BOUNDARY_MS - 120_000).toISOString();
  const receiptFor = (amount) => ({
    status: "success",
    blockNumber: 123n,
    logs: [{
      address: getAddress(BASE_USDC),
      topics: encodeEventTopics({
        abi: [transfer],
        eventName: "Transfer",
        args: { from: getAddress(payer), to: getAddress(treasury) },
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    }],
  });
  const client = {
    async getTransactionReceipt({ hash }) {
      if (hash === recent) return receiptFor(5000n);
      if (hash === aged) return receiptFor(7000n);
      throw new Error("receipt unavailable");
    },
    async getBlock() {
      return { timestamp: 1_760_000_000n };
    },
  };
  const eventFor = (eventId, reference, timestamp, amount) => ({
    v: 1,
    id: eventId,
    ts: timestamp,
    route: "/extract",
    result: "paid_success",
    paymentProtocol: "x402",
    settlementReference: reference,
    settlementAmountAtomic: amount,
    settlementNetwork: "eip155:8453",
    settlementCurrency: BASE_USDC,
  });
  const recentHttp = observeHttp({
    paidEvidenceId: recentId,
    resource: "/extract",
    body: validExtractBody(),
    settlementReference: recent,
    requestDigest: fingerprint(1),
    capturedAt: recentAt,
  });
  const agedPaid = historicalV1Row({
    id: agedId,
    requestStartedAt: agedAt,
    responseFinishedAt: agedAt,
    settlementReference: aged,
    requestDigest: fingerprint(2),
    credentialFingerprint: fingerprint(4),
  });
  try {
    await writeStores(dir, {
      [FILE_CLASSES.settlementLedger]: [
        settled({ eventId: id(80), reference: historical, timestamp: at(1), amount: "9000" }),
      ],
      [FILE_CLASSES.commerceEvents]: [
        eventFor(recentId, recent, recentAt, "5000"),
        eventFor(agedId, aged, agedAt, "7000"),
      ],
      [FILE_CLASSES.paidSuccessEvidence]: [
        paidFrom(recentHttp, { timestamp: recentAt, fingerprint: fingerprint(4), settlementReference: recent }),
        agedPaid,
      ],
    });
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: "prospective-reconcile-secret",
      asset: BASE_USDC,
      client,
      dataDir: dir,
      network: "eip155:8453",
      settlementEvidenceSince: "2026-10-01T00:00:00.000Z",
      treasury,
    });
    const first = await reconciler.reconcile();
    assert.equal(first.lastError, null);
    assert.equal(first.ledger.amountAtomic, "21000");
    assert.equal(first.prospectiveDelivery.technical.unknown, 1);
    assert.equal(first.prospectiveDelivery.technical.no_response, 1);
    assert.equal(first.prospectiveDelivery.technical.validated_response, 0);
    assert.equal(first.prospectiveDelivery.coverage.admittedWithoutProspectiveObservation, 1);
    assert.equal(first.prospectiveDelivery.coverage.historicalComplete, false);
    const ledgerBefore = await readFile(reconciler.ledgerPath, "utf8");
    const admittedRecord = ledgerBefore.trim().split("\n").map((line) => JSON.parse(line)).find((row) => row.sourceEventId === recentId);
    const firstIdentity = admittedRecord.reconciliationId;
    assert.equal(typeof firstIdentity, "string");
    const journal = await readFile(path.join(dir, PROSPECTIVE_FILENAME), "utf8");
    const firstClock = observedStamps(journal, recent);
    assert.equal(firstClock.length, 1);
    assert.equal(journal.includes(recent), false);
    assert.equal(journal.includes(recentId), false);
    await writeFile(path.join(dir, FILE_CLASSES.httpValidation), ndjson([JSON.parse(JSON.stringify(recentHttp))]), { mode: 0o600 });
    const second = await reconciler.reconcile();
    assert.equal(second.lastError, null);
    assert.equal(second.ledger.amountAtomic, "21000");
    assert.equal(second.prospectiveDelivery.technical.validated_response, 1);
    assert.equal(second.prospectiveDelivery.technical.no_response, 1);
    assert.equal(second.prospectiveDelivery.technical.unknown, 0);
    assert.equal(second.prospectiveDelivery.technicalRevisions, 1);
    assert.equal(second.prospectiveDelivery.bindsToParent.amountAtomic, second.ledger.amountAtomic);
    assert.equal(second.prospectiveDelivery.bindsToParent.admissionCutId, first.prospectiveDelivery.bindsToParent.admissionCutId);
    const advanced = await readFile(path.join(dir, PROSPECTIVE_FILENAME), "utf8");
    assert.equal(observedStamps(advanced, recent).every((stamp) => stamp === firstClock[0]), true);
    const ledgerMid = await readFile(reconciler.ledgerPath, "utf8");
    assert.equal(ledgerMid.trim().split("\n").map((line) => JSON.parse(line)).find((row) => row.sourceEventId === recentId).reconciliationId, firstIdentity);
    await rm(path.join(dir, FILE_CLASSES.commerceEvents));
    await rm(path.join(dir, FILE_CLASSES.paidSuccessEvidence));
    await rm(path.join(dir, FILE_CLASSES.httpValidation));
    const child = spawnSync(process.execPath, [path.join(ROOT, "commerce-prospective-delivery-cold.mjs"), dir], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PROSPECTIVE_GENERATED_AT: "2026-10-10T13:00:00.000Z" },
    });
    assert.equal(child.status, 0, child.stderr);
    const cold = JSON.parse(child.stdout);
    assert.equal(cold.technical.validated_response, 1);
    assert.equal(cold.technical.no_response, 1);
    assert.equal(cold.bindsToParent.amountAtomic, "21000");
    assert.equal(cold.coverage.historicalComplete, false);
    assert.equal(cold.coverage.admittedWithoutProspectiveObservation, 1);
    assertPrivacy(child.stdout, [recent, aged, historical, recentId, agedId]);
    await rm(path.join(dir, PROSPECTIVE_FILENAME));
    await symlink(PROSPECTIVE_FILENAME, path.join(dir, PROSPECTIVE_FILENAME));
    await writeFile(path.join(dir, FILE_CLASSES.commerceEvents), ndjson([
      eventFor(id(83), ref("e8"), recentAt, "3000"),
    ]), { mode: 0o600 });
    client.getTransactionReceipt = async ({ hash }) => {
      if (hash === ref("e8")) return receiptFor(3000n);
      throw new Error("receipt unavailable");
    };
    const failedRetain = await reconciler.reconcile();
    const ledgerAfter = await readFile(reconciler.ledgerPath, "utf8");
    assert.equal(failedRetain.lastError, null);
    assert.equal(failedRetain.ledger.amountAtomic, "24000");
    assert.equal(failedRetain.prospectiveDelivery.decision, "unreadable");
    assert.equal(failedRetain.prospectiveDelivery.comparable, false);
    assert.equal(failedRetain.prospectiveDelivery.coverage.evidenceUnavailable, true);
    assert.equal(failedRetain.prospectiveDelivery.coverage.historicalComplete, false);
    assert.equal(failedRetain.prospectiveDelivery.bindsToParent.amountAtomic, "24000");
    assert.equal(validatePacket(failedRetain.prospectiveDelivery), true, JSON.stringify(validatePacket.errors));
    const parsedLedger = ledgerAfter.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(parsedLedger.find((row) => row.sourceEventId === recentId).reconciliationId, firstIdentity);
    assert.equal(parsedLedger.some((row) => row.sourceEventId === id(83)), true);
    assert.equal(ledgerAfter.includes(ref("e8")), true);
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
  assert.equal(packet.coverage.unadmittedRecords, 0);
  assert.equal(packet.technicalRevisions, 0);
  assert.equal(packet.declaredFeedback.absent, 1);
  assert.equal(packet.declaredTaskClass.absent, 1);
  assertHonestCoverage(packet);
  assertPrivacy(child.stdout, [ref("11"), ref("22"), id(1), id(2), "evidenceKey"]);
  const journal = readFileSync(path.join(FIXTURE, PROSPECTIVE_FILENAME), "utf8");
  assert.equal(journal.includes(ref("11")), false);
  assert.equal(journal.includes(id(1)), false);
});
