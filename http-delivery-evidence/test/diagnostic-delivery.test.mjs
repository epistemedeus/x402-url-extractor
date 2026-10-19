import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createCommerceTelemetry } from "../../commerce-events.mjs";
import { setJournalObservationProbe } from "../../commerce-journal-admission.mjs";
import { sellerIntegrityAudit } from "../../seller-integrity-audit.mjs";
import { SCHEMA_VERSION } from "../../commerce-settlement-reconciler.mjs";
import { FILE_CLASSES, receiveOrdinaryDeliveryJoin } from "../../ordinary-delivery-join.mjs";
import { bindMerchantHttpDeliveryContracts } from "../bind-merchant-contracts.mjs";
import { sealStreamedHttpCapture } from "../observation.mjs";
import {
  DELIVERY,
  MAX_RESPONSE_BYTES,
  PAID_DIAGNOSTIC_MEASUREMENT,
  PAID_DIAGNOSTIC_POPULATION,
  RESOURCES,
  SCHEMA_CONFORMANCE,
  SETTLEMENT_CLASS,
  USEFULNESS_UNKNOWN,
  VERDICT,
  checkDeclaredContract,
  digestResponseBytes,
  evaluateResponseBytes,
  isDeliveredSellerDiagnostic,
  openStore,
  recordFromObservedResponse,
} from "../index.mjs";
import { readBoundedDiagnosticReport, receivePaidDiagnostic, receivingExitCode } from "../receive-diagnostic.mjs";
import { historicalV1Row } from "./helpers.mjs";

bindMerchantHttpDeliveryContracts();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CANARY = "raw-report-canary-do-not-publish";
const QUERY_CANARY = "secret-target-query-canary.example";
const CREDENTIAL_CANARY = "credential-canary-do-not-store";
const TASK = "Confirm the paid seller audit names repair_required for this exact route.";
const LATER_TASK = "Confirm a later changed task is not covered by the earlier seller audit.";
const SETTLEMENT = `0x${"a1".repeat(32)}`;
const OLD_SETTLEMENT = `0x${"b2".repeat(32)}`;

const AUDIT_REPORT = {
  schemaVersion: "agent-payment-integrity.audit.v4",
  checkedAt: "2026-08-12T07:50:00.000Z",
  versions: { x402: "1.0.0", mpp: "1.0.0" },
  ok: true,
  machineBuyable: true,
  routes: [{
    status: 402,
    method: "GET",
    runtimeChallengeVerified: true,
    probe: { attempted: true, reason: null },
    protocols: ["x402"],
    valid: true,
    findings: [],
    economics: { x402: { amountAtomic: "10000" } },
    discovery: { bazaar: { present: false, valid: false } },
    responseContract: { decision: "admissible", requiredPaths: ["title"] },
    repairPlan: {
      mode: "advisory_openapi_repair",
      requiredPaths: ["title"],
      guaranteedPaths: ["title"],
      actions: [],
      complete: true,
      boundary: {
        schemaMutationApplied: false,
        propertyTypesInferred: false,
        sellerRuntimeVerified: false,
        statement: "Seller must verify runtime semantics.",
      },
    },
  }],
};

function bytesOf(value) {
  return Buffer.from(JSON.stringify(value));
}

async function completedReport(decision = "repair_required") {
  const source = structuredClone(AUDIT_REPORT);
  if (decision === "repair_required") {
    source.ok = false;
    source.machineBuyable = false;
    source.routes[0].valid = false;
    source.routes[0].findings = ["seller_response_contract_absent", CANARY];
  }
  return sellerIntegrityAudit(
    { origin: "https://seller.example", route: "/paid", method: "GET" },
    { auditImpl: async () => source },
  );
}

function evaluateReport(body, extra = {}) {
  return evaluateResponseBytes({
    method: "GET",
    resource: RESOURCES.SELLER_INTEGRITY,
    responseBytes: bytesOf(body),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.REAL_UNVERIFIED,
    ...extra,
  });
}

function predicate(value, extra = {}) {
  return {
    path: "decision",
    value,
    target: { origin: "https://seller.example", route: "/paid", method: "GET" },
    ...extra,
  };
}

function intakeFor(task) {
  return {
    taskDigest: task,
    declaredSdk: "node-http",
    callerId: "caller-1",
    origin: "https://seller.example",
    method: "GET",
    resource: "/paid",
  };
}

function laterFor(task, callerId = "caller-1") {
  return {
    taskDigest: task,
    sdk: "node-http",
    callerId,
    target: { origin: "https://seller.example", method: "GET", resource: "/paid" },
  };
}

test("owning seller schema accepts a completed repair and rejects a copied wrong product", async () => {
  const repair = await completedReport("repair_required");
  const buyable = await completedReport("machine_buyable");
  assert.equal(checkDeclaredContract(RESOURCES.SELLER_INTEGRITY, repair, "GET").ok, true);
  assert.equal(repair.decision, "repair_required");
  assert.equal(repair.report.auditCompleted, true);
  const repairEval = evaluateReport(repair);
  assert.equal(repairEval.validatorVerdict, VERDICT.PASS);
  assert.equal(repairEval.deliveryClass, DELIVERY.FULL_BOUNDED_CAPTURE);
  assert.equal(repairEval.schemaConformance, SCHEMA_CONFORMANCE.HOLDS);
  assert.equal(repairEval.usefulness, USEFULNESS_UNKNOWN);
  assert.equal(isDeliveredSellerDiagnostic(repairEval), true);
  assert.equal(isDeliveredSellerDiagnostic(evaluateReport(buyable)), true);
  const wrongProduct = { ...repair, product: "other-product" };
  const wrong = evaluateReport(wrongProduct);
  assert.equal(wrong.validatorVerdict, VERDICT.INVALID);
  assert.equal(wrong.deliveryClass, DELIVERY.MALFORMED_BODY);
  assert.equal(isDeliveredSellerDiagnostic(wrong), false);
});

test("incomplete, malformed, truncated, and oversized bodies are not delivered diagnostics", async () => {
  const incomplete = await sellerIntegrityAudit(
    { origin: "https://seller.example", route: "/paid" },
    { auditImpl: async () => { throw new Error("exact paid GET route was not declared"); } },
  );
  const incompleteEval = evaluateReport(incomplete);
  assert.equal(incomplete.report.auditCompleted, false);
  assert.equal(incomplete.decision, "repair_required");
  assert.equal(incompleteEval.schemaConformance, SCHEMA_CONFORMANCE.HOLDS);
  assert.equal(incompleteEval.deliveryClass, DELIVERY.INCOMPLETE_REPORT);
  assert.equal(incompleteEval.validatorVerdict, VERDICT.UNKNOWN);
  assert.equal(isDeliveredSellerDiagnostic(incompleteEval), false);

  const malformed = evaluateResponseBytes({
    method: "GET",
    resource: RESOURCES.SELLER_INTEGRITY,
    responseBytes: Buffer.from("{\"decision\":\"repair_required\""),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.REAL_UNVERIFIED,
  });
  assert.equal(malformed.deliveryClass, DELIVERY.MALFORMED_BODY);
  assert.equal(malformed.validatorVerdict, VERDICT.INVALID);

  const repair = await completedReport("repair_required");
  const oversized = evaluateReport(repair, { responseByteLength: MAX_RESPONSE_BYTES + 1 });
  assert.equal(oversized.deliveryClass, DELIVERY.TRUNCATED_PARTIAL);
  assert.equal(oversized.validatorVerdict, VERDICT.UNKNOWN);
  assert.equal(isDeliveredSellerDiagnostic(oversized), false);
  const repairBytes = bytesOf(repair);
  const full = Buffer.concat([repairBytes, Buffer.alloc((MAX_RESPONSE_BYTES + 40) - repairBytes.length, 0x20)]);
  const fullDigest = digestResponseBytes(full);
  const stored = recordFromObservedResponse({
    method: "GET",
    resource: RESOURCES.SELLER_INTEGRITY,
    responseBytes: repairBytes,
    responseByteLength: full.length,
    responseDigest: fullDigest,
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.REAL_UNVERIFIED,
    paidEvidenceId: "11111111-1111-4111-8111-111111111111",
    observation: sealStreamedHttpCapture({
      digest: fullDigest,
      byteLength: full.length,
      bytes: repairBytes,
      method: "GET",
      resource: RESOURCES.SELLER_INTEGRITY,
    }),
  });
  assert.equal(stored.deliveryClass, DELIVERY.TRUNCATED_PARTIAL);
  assert.equal(stored.validatorVerdict, VERDICT.UNKNOWN);
  assert.equal(stored.usefulness, USEFULNESS_UNKNOWN);
  assert.equal(JSON.stringify(stored).includes(CANARY), false);
});

test("predicate, settlement, replay, and later task stay separate from the server contract", async () => {
  const repair = await completedReport("repair_required");
  const reportBytes = bytesOf(repair);
  const eventId = randomUUID();
  const positive = receivePaidDiagnostic({
    reportBytes,
    predicate: predicate("repair_required"),
    settlement: { status: "unknown" },
    intake: intakeFor("task-a"),
    later: laterFor("task-a"),
    causalEventId: eventId,
    paidEvidenceId: eventId,
  });
  assert.equal(positive.accepted, true);
  assert.equal(receivingExitCode(positive), 0);
  assert.equal(positive.serverContract.deliveredDiagnostic, true);
  assert.equal(positive.serverContract.usefulness, USEFULNESS_UNKNOWN);
  assert.equal(positive.callerDeclaration.kind, "useful_negative");
  assert.equal(positive.callerDeclaration.holds, true);
  assert.equal(positive.laterReuse.reused, false);
  assert.equal(positive.laterReuse.reason, "prior_result_not_retested");
  assert.equal(positive.settlement.status, "unknown");
  assert.equal(positive.settlement.verified, false);
  assert.equal(positive.paymentAuthority, false);
  assert.equal(positive.cashAtomic, "0");
  assert.equal(JSON.stringify(positive).includes(CANARY), false);
  assert.deepEqual(positive.join.planes, ["transaction", "transport", "useful_output"]);

  const changed = receivePaidDiagnostic({
    reportBytes,
    predicate: predicate("repair_required"),
    intake: intakeFor("task-a"),
    later: laterFor("task-b"),
  });
  assert.equal(changed.accepted, false);
  assert.equal(changed.laterReuse.reason, "stale_applicability");
  assert.equal(changed.serverContract.deliveredDiagnostic, true);

  const wrongTarget = receivePaidDiagnostic({
    reportBytes,
    predicate: predicate("repair_required", {
      target: { origin: "https://other.example", route: "/other", method: "GET" },
    }),
  });
  assert.equal(wrongTarget.accepted, false);
  assert.equal(wrongTarget.callerDeclaration.reason, "target_mismatch");
  assert.equal(wrongTarget.serverContract.deliveredDiagnostic, true);
  assert.equal(JSON.stringify(wrongTarget).includes("other.example"), false);

  const absent = receivePaidDiagnostic({ reportBytes, predicate: null });
  assert.equal(absent.accepted, false);
  assert.equal(absent.callerDeclaration.reason, "predicate_absent");

  const failed = receivePaidDiagnostic({
    reportBytes,
    predicate: predicate("repair_required"),
    settlement: { status: "failed" },
  });
  assert.equal(failed.accepted, false);
  assert.equal(failed.settlement.status, "failed");
  assert.equal(failed.settlement.paymentAuthority, false);

  const referenced = receivePaidDiagnostic({
    reportBytes,
    predicate: predicate("repair_required"),
    settlement: { status: "referenced", reference: SETTLEMENT },
  });
  assert.equal(referenced.accepted, true);
  assert.equal(referenced.settlement.referencePresent, true);
  assert.equal(referenced.settlement.verified, false);
  assert.equal(JSON.stringify(referenced).includes(SETTLEMENT), false);

  const replayed = receivePaidDiagnostic({
    reportBytes,
    predicate: predicate("repair_required"),
    replayed: true,
  });
  assert.equal(replayed.accepted, false);
  assert.equal(replayed.transport.replayed, true);

  const declared = receivePaidDiagnostic({
    reportBytes,
    predicate: predicate("repair_required"),
    selfDeclaredIndependent: true,
    intake: intakeFor("task-a"),
    later: laterFor("task-a"),
  });
  assert.equal(declared.accepted, false);
  assert.equal(declared.laterReuse.reason, "self_declared_independent_status_refused");
  assert.equal(declared.laterReuse.reused, false);
});

test("an uncaptured settlement is not backfilled from a present-day report", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "diagnostic-historical-"));
  try {
    const repair = await completedReport("repair_required");
    const store = openStore(dir);
    await writeFile(store.historicalPath, `${JSON.stringify(historicalV1Row({
      route: RESOURCES.SELLER_INTEGRITY,
      settlementReference: OLD_SETTLEMENT,
    }))}\n`);
    await store.appendValidation(recordFromObservedResponse({
      method: "GET",
      resource: RESOURCES.SELLER_INTEGRITY,
      responseBytes: bytesOf(repair),
      merchantHttpStatus: 200,
      settlementClass: SETTLEMENT_CLASS.REAL_UNVERIFIED,
      settlementReference: null,
      paidEvidenceId: randomUUID(),
    }));
    const joined = await store.join();
    assert.equal(joined.length, 1);
    assert.equal(joined[0].historical.validatorVerdict, "not_checked");
    assert.equal(joined[0].historical.settlementReference, OLD_SETTLEMENT);
    assert.deepEqual(joined[0].validations, []);
    const serialized = await readFile(store.validationPath, "utf8");
    assert.equal(serialized.includes(CANARY), false);
    assert.equal(serialized.includes(OLD_SETTLEMENT), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function responseDouble() {
  const listeners = new Map();
  const output = [];
  const headers = {};
  return {
    statusCode: 200,
    locals: { samedaydeskPayment: { protocol: "x402" } },
    output,
    once(name, listener) { listeners.set(name, listener); },
    getHeader(name) { return headers[String(name).toLowerCase()]; },
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    write(chunk, encoding, callback) {
      if (chunk != null) output.push(Buffer.from(chunk));
      const done = typeof encoding === "function" ? encoding : callback;
      done?.();
      return true;
    },
    end(chunk, encoding, callback) {
      if (chunk != null && typeof chunk !== "function") output.push(Buffer.from(chunk));
      const done = typeof encoding === "function" ? encoding : typeof callback === "function" ? callback : null;
      done?.();
      return this;
    },
    finish() { listeners.get("finish")?.(); },
  };
}

function emitPaid(telemetry, {
  body,
  statusCode = 200,
  settlement = null,
  replayed = false,
  query = { origin: "https://seller.example", route: "/paid" },
  finishWithoutEnd = false,
  doubleFinish = false,
} = {}) {
  const req = {
    path: RESOURCES.SELLER_INTEGRITY,
    url: `${RESOURCES.SELLER_INTEGRITY}?origin=https%3A%2F%2F${QUERY_CANARY}&route=%2Fpaid`,
    originalUrl: `${RESOURCES.SELLER_INTEGRITY}?origin=https%3A%2F%2F${QUERY_CANARY}&route=%2Fpaid`,
    method: "GET",
    headers: { "payment-signature": CREDENTIAL_CANARY, "user-agent": "diagnostic-delivery-test" },
    query,
    rawBody: Buffer.alloc(0),
    ip: "203.0.113.50",
    socket: {},
  };
  const res = responseDouble();
  res.statusCode = statusCode;
  if (settlement) {
    res.setHeader("payment-response", Buffer.from(JSON.stringify({
      success: true,
      transaction: settlement,
    })).toString("base64url"));
  }
  if (replayed) res.setHeader("x-payment-replay", "hit");
  telemetry.middleware(req, res, () => {});
  if (!finishWithoutEnd) {
    const payload = Buffer.from(body);
    res.write(payload.subarray(0, Math.min(8, payload.length)));
    res.end(payload.subarray(Math.min(8, payload.length)));
  }
  res.finish();
  if (doubleFinish) res.finish();
}

test("ordinary paid seller responses join contract, causal event, and settlement without publishing the report", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "diagnostic-paid-"));
  try {
    const telemetry = createCommerceTelemetry({
      dataDir: dir,
      secret: "diagnostic-delivery-secret",
      settlementEvidenceSince: "2020-01-01T00:00:00.000Z",
    });
    const repair = await completedReport("repair_required");
    const incomplete = await sellerIntegrityAudit(
      { origin: "https://seller.example", route: "/paid" },
      { auditImpl: async () => { throw new Error("openapi document returned HTTP 404"); } },
    );
    emitPaid(telemetry, { body: JSON.stringify(repair), settlement: SETTLEMENT });
    emitPaid(telemetry, { body: JSON.stringify(repair), replayed: true, settlement: SETTLEMENT });
    emitPaid(telemetry, { body: JSON.stringify(repair), statusCode: 400 });
    emitPaid(telemetry, { body: JSON.stringify(repair) });
    emitPaid(telemetry, { body: JSON.stringify(incomplete) });
    emitPaid(telemetry, { body: "{\"decision\":" });
    emitPaid(telemetry, { body: JSON.stringify(repair), doubleFinish: true });
    const quiet = createCommerceTelemetry({ dataDir: path.join(dir, "quiet"), secret: "diagnostic-quiet-secret" });
    emitPaid(quiet, { body: JSON.stringify(repair), finishWithoutEnd: true });
    await telemetry.flush();
    await quiet.flush();

    const validations = await openStore(dir).readValidations();
    const evidence = (await readFile(telemetry.paths.paidEvidencePath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(validations.length, 5);
    assert.equal(evidence.length, 5);
    assert.deepEqual(validations.map((row) => row.paidEvidenceId), evidence.map((row) => row.id));
    assert.equal(validations.filter((row) => row.deliveryClass === DELIVERY.FULL_BOUNDED_CAPTURE).length, 3);
    assert.equal(validations.filter((row) => row.deliveryClass === DELIVERY.INCOMPLETE_REPORT).length, 1);
    assert.equal(validations.filter((row) => row.deliveryClass === DELIVERY.MALFORMED_BODY).length, 1);
    for (const row of validations) {
      assert.equal(row.usefulness, USEFULNESS_UNKNOWN);
      assert.equal(row.resource, RESOURCES.SELLER_INTEGRITY);
    }
    assert.equal(validations.filter((row) => row.outcomeSummaryStatus === "available").length, 4);
    assert.equal(validations[0].outcomeSummary.decision, "repair_required");
    assert.equal(validations[0].outcomeSummary.responseDigest, digestResponseBytes(bytesOf(repair)));
    assert.equal(validations[0].outcomeSummary.unknownFindings, 1);
    assert.equal(validations.find((row) => row.deliveryClass === DELIVERY.INCOMPLETE_REPORT).outcomeSummary.failureCategory, "openapi_unavailable");
    // Fixture-only canonical settlement exercises the normal restarted operator receiver.
    await writeFile(path.join(dir, FILE_CLASSES.settlementLedger), `${JSON.stringify({
      schemaVersion: SCHEMA_VERSION, state: "reconciled", sourceEventId: evidence[0].id,
      sourceEventTimestamp: evidence[0].responseFinishedAt, route: evidence[0].route,
      protocol: evidence[0].paymentProtocol, paymentClass: "unclassified", settlementReference: SETTLEMENT, amountAtomic: "10000",
    })}\n`);
    const joined = await receiveOrdinaryDeliveryJoin({ dataDir: dir, windowStart: "2020-01-01T00:00:00.000Z", windowEnd: "2100-01-01T00:00:00.000Z" });
    assert.equal(joined.rows.find((row) => row.disposition === "exact_join").outcomeSummary.decision, "repair_required");
    assert.equal(joined.sellerAuditOutcomes.counts.available, 1);
    assert.equal(joined.sellerAuditOutcomes.decisions.repair_required, 1);
    assert.equal(joined.callerResultFeedback.suppliedUseful, 0);
    assert.equal(JSON.stringify(joined).includes(CANARY), false);
    const quietValidations = await openStore(path.join(dir, "quiet")).readValidations();
    assert.deepEqual(quietValidations, []);

    const snapshot = await telemetry.snapshot({ days: 1 });
    const measurement = snapshot.paidDiagnosticReportContract;
    assert.equal(measurement.measurement, PAID_DIAGNOSTIC_MEASUREMENT);
    assert.equal(measurement.population, PAID_DIAGNOSTIC_POPULATION);
    assert.equal(measurement.populationUnit, "paid_http_response");
    assert.equal(measurement.populationIsCustomers, false);
    assert.equal(measurement.deliveredDiagnostics, 3);
    assert.equal(measurement.incompleteAudits, 1);
    assert.equal(measurement.malformedReports, 1);
    assert.equal(measurement.settlementReferenced, 1);
    assert.equal(measurement.settlementUnknown, 4);
    assert.equal(measurement.usefulness, "unknown");
    assert.equal(measurement.schemaConformanceIsBuyerUsefulness, false);
    assert.equal(measurement.cashAtomic, "0");
    assert.equal(measurement.recognizedRevenueAtomic, "0");
    assert.equal(measurement.backfill, false);
    assert.equal(measurement.historicalUncapturedRemainUnknown, true);
    assert.equal(measurement.transactionPlane.paidSuccess, 5);
    assert.equal(measurement.transactionPlane.replayNotPromoted, 1);
    assert.equal(measurement.transactionPlane.failedOrRejected, 1);
    assert.equal(measurement.transactionPlane.settlementReferencePresent, 1);
    assert.equal(measurement.transactionPlane.settlementReferenceAbsent, 4);
    const published = JSON.stringify(snapshot);
    for (const secret of [CANARY, QUERY_CANARY, CREDENTIAL_CANARY, SETTLEMENT, "seller.example/paid"]) {
      assert.equal(published.includes(secret), false, `public aggregate leaked ${secret}`);
    }
    const privateValidation = await readFile(telemetry.paths.httpDeliveryEvidencePath, "utf8");
    assert.equal(privateValidation.includes(CANARY), false);
    assert.equal(privateValidation.includes(QUERY_CANARY), false);
    assert.equal(privateValidation.includes(CREDENTIAL_CANARY), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a lost summary append preserves the paid event and never retries delivery", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "diagnostic-lost-write-"));
  try {
    const store = openStore(dir);
    await mkdir(store.validationPath);
    const telemetry = createCommerceTelemetry({ dataDir: dir, secret: "lost-summary-secret" });
    const repair = await completedReport("repair_required");
    emitPaid(telemetry, { body: JSON.stringify(repair), settlement: SETTLEMENT, doubleFinish: true });
    await telemetry.flush();
    const evidence = (await readFile(telemetry.paths.paidEvidencePath, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].responseDigest, digestResponseBytes(bytesOf(repair)));
    await rm(store.validationPath, { recursive: true });
    assert.deepEqual(await openStore(dir).readValidations(), []);
    assert.equal((await openStore(dir).join())[0].validations.length, 0);
    await telemetry.flush();
    assert.deepEqual(await openStore(dir).readValidations(), []);
    assert.equal((await readFile(telemetry.paths.paidEvidencePath, "utf8")).trim().split("\n").length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function waitForText(file, predicate) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const watcher = watch(path.dirname(file), () => { check(); });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      watcher.close();
      if (error) reject(error);
      else resolve(value);
    };
    const check = () => {
      readFile(file, "utf8").then((text) => {
        if (predicate(text)) finish(null, text);
      }).catch((error) => {
        if (error?.code !== "ENOENT") finish(error);
      });
    };
    watcher.on("error", finish);
    check();
  });
}

function continuationRows(text) {
  return text.trim().split("\n").filter((line) => line.includes("\"continuationTransmission\""));
}

test("a delayed continuation observation is drained before teardown", { timeout: 5_000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "diagnostic-delayed-observation-"));
  let release = () => {};
  const hold = new Promise((resolve) => { release = resolve; });
  let entered = false;
  let pending = Promise.resolve();
  const previous = setJournalObservationProbe(() => {
    entered = true;
    return hold;
  });
  t.after(() => {
    release();
    setJournalObservationProbe(previous);
  });
  try {
    const store = openStore(dir);
    await mkdir(store.validationPath);
    const telemetry = createCommerceTelemetry({ dataDir: dir, secret: "delayed-observation-secret" });
    const repair = await completedReport("repair_required");
    emitPaid(telemetry, { body: JSON.stringify(repair), settlement: SETTLEMENT, doubleFinish: true });
    let settled = false;
    pending = telemetry.flush().then(() => { settled = true; });
    const evidenceText = await waitForText(telemetry.paths.paidEvidencePath, (text) => text.trim().length > 0);
    assert.equal(entered, true);
    assert.equal(settled, false);
    assert.equal(evidenceText.trim().split("\n").length, 1);
    release();
    await pending;
    assert.equal(settled, true);
    const evidence = evidenceText.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(evidence[0].responseDigest, digestResponseBytes(bytesOf(repair)));
    await rm(store.validationPath, { recursive: true });
    assert.deepEqual(await openStore(dir).readValidations(), []);
    await telemetry.flush();
    assert.deepEqual(await openStore(dir).readValidations(), []);
    assert.equal((await readFile(telemetry.paths.paidEvidencePath, "utf8")).trim().split("\n").length, 1);
    const journal = await readFile(path.join(dir, "commerce-prospective-delivery.ndjson"), "utf8");
    assert.equal(continuationRows(journal).length, 1);
    assert.equal(journal.includes("\"continuationTransmission\":\"not_transmitted\""), true);
    for (const secret of [CANARY, QUERY_CANARY, CREDENTIAL_CANARY, SETTLEMENT]) {
      assert.equal(journal.includes(secret), false, `continuation journal leaked ${secret}`);
    }
  } finally {
    release();
    setJournalObservationProbe(previous);
    await pending.catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test("a rejected continuation observation does not retry or charge the paid event", { timeout: 5_000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "diagnostic-rejected-observation-"));
  const blocked = await mkdtemp(path.join(tmpdir(), "diagnostic-blocked-observation-"));
  const previous = setJournalObservationProbe(() => {
    throw new Error("observation rejected");
  });
  t.after(() => {
    setJournalObservationProbe(previous);
  });
  try {
    const telemetry = createCommerceTelemetry({ dataDir: dir, secret: "rejected-observation-secret" });
    const repair = await completedReport("repair_required");
    emitPaid(telemetry, { body: JSON.stringify(repair), settlement: SETTLEMENT, doubleFinish: true });
    await telemetry.flush();
    const paid = telemetry.paths.paidEvidencePath;
    assert.equal((await readFile(paid, "utf8")).trim().split("\n").length, 1);
    assert.equal((await openStore(dir).readValidations()).length, 1);
    await assert.rejects(readFile(path.join(dir, "commerce-prospective-delivery.ndjson"), "utf8"), { code: "ENOENT" });
    await telemetry.flush();
    assert.equal((await readFile(paid, "utf8")).trim().split("\n").length, 1);
    assert.equal((await openStore(dir).readValidations()).length, 1);

    setJournalObservationProbe(previous);
    await mkdir(path.join(blocked, "commerce-prospective-delivery.ndjson"));
    const writer = createCommerceTelemetry({ dataDir: blocked, secret: "blocked-observation-secret" });
    emitPaid(writer, { body: JSON.stringify(repair), settlement: OLD_SETTLEMENT, doubleFinish: true });
    await writer.flush();
    assert.equal((await readFile(writer.paths.paidEvidencePath, "utf8")).trim().split("\n").length, 1);
    await writer.flush();
    assert.equal((await readFile(writer.paths.paidEvidencePath, "utf8")).trim().split("\n").length, 1);
    const blockedStat = await stat(path.join(blocked, "commerce-prospective-delivery.ndjson"));
    assert.equal(blockedStat.isDirectory(), true);
  } finally {
    setJournalObservationProbe(previous);
    await rm(dir, { recursive: true, force: true });
    await rm(blocked, { recursive: true, force: true });
  }
});

test("commerce writes proceed while a continuation observation is delayed", { timeout: 5_000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "diagnostic-concurrent-observation-"));
  const second = `0x${"c3".repeat(32)}`;
  let release = () => {};
  const hold = new Promise((resolve) => { release = resolve; });
  let held = 0;
  let pending = Promise.resolve();
  const previous = setJournalObservationProbe(() => {
    held += 1;
    return hold;
  });
  t.after(() => {
    release();
    setJournalObservationProbe(previous);
  });
  try {
    const telemetry = createCommerceTelemetry({ dataDir: dir, secret: "concurrent-observation-secret" });
    const repair = await completedReport("repair_required");
    const body = JSON.stringify(repair);
    emitPaid(telemetry, { body, settlement: SETTLEMENT });
    let settled = false;
    pending = telemetry.flush().then(() => { settled = true; });
    await waitForText(telemetry.paths.paidEvidencePath, (text) => text.trim().split("\n").length === 1);
    emitPaid(telemetry, { body, settlement: second });
    const both = await waitForText(
      telemetry.paths.paidEvidencePath,
      (text) => text.trim().split("\n").length === 2,
    );
    assert.equal(held >= 1, true);
    assert.equal(settled, false);
    assert.equal(both.trim().split("\n").length, 2);
    release();
    await pending;
    assert.equal(held, 2);
    const journal = await readFile(path.join(dir, "commerce-prospective-delivery.ndjson"), "utf8");
    assert.equal(continuationRows(journal).length, 2);
    assert.equal(journal.includes(SETTLEMENT), false);
    assert.equal(journal.includes(second), false);
    await telemetry.flush();
    assert.equal((await readFile(telemetry.paths.paidEvidencePath, "utf8")).trim().split("\n").length, 2);
  } finally {
    release();
    setJournalObservationProbe(previous);
    await pending.catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test("a later paid success recovers after a rejected continuation observation", { timeout: 5_000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "diagnostic-recovered-observation-"));
  const second = `0x${"d4".repeat(32)}`;
  const previous = setJournalObservationProbe(() => {
    throw new Error("observation rejected");
  });
  t.after(() => {
    setJournalObservationProbe(previous);
  });
  try {
    const telemetry = createCommerceTelemetry({ dataDir: dir, secret: "recovered-observation-secret" });
    const repair = await completedReport("repair_required");
    const body = JSON.stringify(repair);
    emitPaid(telemetry, { body, settlement: SETTLEMENT });
    await telemetry.flush();
    assert.equal((await readFile(telemetry.paths.paidEvidencePath, "utf8")).trim().split("\n").length, 1);
    await assert.rejects(readFile(path.join(dir, "commerce-prospective-delivery.ndjson"), "utf8"), { code: "ENOENT" });
    setJournalObservationProbe(previous);
    emitPaid(telemetry, { body, settlement: second });
    await telemetry.flush();
    const journal = await readFile(path.join(dir, "commerce-prospective-delivery.ndjson"), "utf8");
    assert.equal(continuationRows(journal).length, 1);
    assert.equal(journal.includes(SETTLEMENT), false);
    assert.equal(journal.includes(second), false);
    assert.equal((await readFile(telemetry.paths.paidEvidencePath, "utf8")).trim().split("\n").length, 2);
    await telemetry.flush();
    assert.equal((await readFile(telemetry.paths.paidEvidencePath, "utf8")).trim().split("\n").length, 2);
    assert.equal(continuationRows(await readFile(path.join(dir, "commerce-prospective-delivery.ndjson"), "utf8")).length, 1);
  } finally {
    setJournalObservationProbe(previous);
    await rm(dir, { recursive: true, force: true });
  }
});

test("cold receiver accepts a matching repair and rejects the changed later task", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "diagnostic-cold-"));
  const reportPath = path.join(dir, "report.json");
  try {
    const repair = await completedReport("repair_required");
    await writeFile(reportPath, `${JSON.stringify(repair)}\n`);
    const args = [
      path.join(ROOT, "http-delivery-evidence/receive-diagnostic.mjs"),
      "--report", reportPath,
      "--expect", "decision=repair_required",
      "--target-origin", "https://seller.example",
      "--target-route", "/paid",
      "--target-method", "GET",
      "--task", TASK,
      "--caller", "caller-1",
      "--sdk", "node-http",
    ];
    const positive = await runNode([...args, "--later-task", TASK]);
    assert.equal(positive.code, 0, positive.stderr);
    assert.equal(positive.json.accepted, true);
    assert.equal(positive.json.callerDeclaration.kind, "useful_negative");
    assert.equal(positive.json.laterReuse.reason, "prior_result_not_retested");
    assert.equal(positive.json.settlement.status, "unknown");
    assert.equal(positive.stdout.includes(CANARY), false);

    const negative = await runNode([...args, "--later-task", LATER_TASK]);
    assert.equal(negative.code, 2);
    assert.equal(negative.json.accepted, false);
    assert.equal(negative.json.laterReuse.reason, "stale_applicability");
    assert.equal(negative.json.serverContract.deliveredDiagnostic, true);

    const seeded = await runNode([...args, "--later-task", TASK, "--independent"]);
    assert.equal(seeded.code, 2);
    assert.equal(seeded.json.laterReuse.reason, "self_declared_independent_status_refused");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      let json = null;
      try { json = JSON.parse(stdout); } catch { json = null; }
      resolve({ code, stdout, stderr, json });
    });
  });
}

test("receiver does not relabel unsupported HTTP methods as GET", async () => {
  const repair = await completedReport("repair_required");
  for (const method of ["PUT", "DELETE", "PATCH", "", null]) {
    const received = receivePaidDiagnostic({
      method,
      reportBytes: bytesOf(repair),
      predicate: predicate("repair_required"),
    });
    assert.equal(received.accepted, false);
    assert.equal(received.serverContract.deliveredDiagnostic, false);
    assert.equal(received.serverContract.deliveryClass, DELIVERY.UNSUPPORTED_TARGET);
  }
});

test("diagnostic file receiving reads only the retained byte budget", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "diagnostic-file-bounds-"));
  const file = path.join(dir, "large.json");
  const fullLength = 128 * 1024 * 1024;
  try {
    const handle = await open(file, "w");
    try {
      await handle.write(bytesOf(await completedReport("repair_required")));
      await handle.truncate(fullLength);
    } finally {
      await handle.close();
    }
    const loaded = await readBoundedDiagnosticReport(file);
    assert.equal(loaded.bytes.length, MAX_RESPONSE_BYTES);
    assert.equal(loaded.byteLength, fullLength);
    const received = receivePaidDiagnostic({
      reportBytes: loaded.bytes,
      responseByteLength: loaded.byteLength,
      predicate: predicate("repair_required"),
    });
    assert.equal(received.accepted, false);
    assert.equal(received.serverContract.deliveredDiagnostic, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cold diagnostic CLI preserves an unsupported method declaration", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "diagnostic-cold-method-"));
  const file = path.join(dir, "report.json");
  try {
    await writeFile(file, JSON.stringify(await completedReport("repair_required")));
    const received = await runNode([
      path.join(ROOT, "http-delivery-evidence/receive-diagnostic.mjs"),
      "--report", file,
      "--expect", "decision=repair_required",
      "--target-method", "PUT",
    ]);
    assert.equal(received.code, 2);
    assert.equal(received.json.accepted, false);
    assert.equal(received.json.serverContract.deliveryClass, DELIVERY.UNSUPPORTED_TARGET);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
