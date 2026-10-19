import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

import { SELLER_INTEGRITY_AUDIT_EXAMPLE, sellerIntegrityAudit } from "../../seller-integrity-audit.mjs";
import { SCHEMA_VERSION } from "../../commerce-settlement-reconciler.mjs";
import { receiveOrdinaryDeliveryJoin, reportViolations, FILE_CLASSES } from "../../ordinary-delivery-join.mjs";
import { bindMerchantHttpDeliveryContracts, resetMerchantHttpDeliveryContracts } from "../bind-merchant-contracts.mjs";
import { MAX_RESPONSE_BYTES, RESOURCES } from "../contract.mjs";
import { digestResponseBytes } from "../digest.mjs";
import { recordObservation, sealStreamedHttpCapture } from "../observation.mjs";
import { MAX_OUTCOME_BYTES, SELLER_OUTCOME_SCHEMA } from "../seller-outcome.mjs";
import { canonicalizeValidationRecord, openStore, recordFromObservedResponse } from "../store.mjs";
import { historicalV1Row } from "./helpers.mjs";

bindMerchantHttpDeliveryContracts();
const CANARY = "payload-secret-property-wallet-query-canary";
const ID = "11111111-1111-4111-8111-111111111111";
const REF = `0x${"a".repeat(64)}`;
const AT = "2026-10-19T17:00:00.000Z";
const WINDOW = { windowStart: "2026-10-19T16:00:00.000Z", windowEnd: "2026-10-19T18:00:00.000Z" };
const bytes = (body) => Buffer.from(JSON.stringify(body));
const clone = (body) => JSON.parse(JSON.stringify(body));

async function audit(decision = "machine_buyable", findings = []) {
  const r = clone(SELLER_INTEGRITY_AUDIT_EXAMPLE.report);
  if (decision === "contract_ready") {
    r.status = null;
    r.runtimeChallengeVerified = false;
    r.probe = { attempted: false, reason: "post_requires_explicit_non_secret_fixture" };
  }
  r.valid = decision !== "repair_required";
  r.findings = findings;
  return sellerIntegrityAudit({ origin: `https://${CANARY}.example`, route: `/${CANARY}`, method: decision === "contract_ready" ? "POST" : "GET", requiredPaths: [CANARY] }, {
    auditImpl: async () => ({
      ok: r.valid, machineBuyable: decision === "machine_buyable", schemaVersion: r.schemaVersion,
      checkedAt: AT, versions: r.sellerVersions, routes: [r],
    }),
  });
}

function observed(body, extra = {}) {
  return recordFromObservedResponse({
    method: "GET", resource: RESOURCES.SELLER_INTEGRITY, responseBytes: bytes(body),
    merchantHttpStatus: 200, settlementClass: "simulated", paidEvidenceId: ID,
    requestDigest: "b".repeat(64), settlementReference: REF, capturedAt: AT, ...extra,
  });
}

async function seedJoin(dir, record) {
  const paid = historicalV1Row({ id: ID, method: record.method, route: record.resource,
    requestDigest: record.requestDigest, responseDigest: record.responseDigest,
    settlementReference: REF, responseFinishedAt: AT, requestStartedAt: AT });
  const settlement = { schemaVersion: SCHEMA_VERSION, state: "reconciled", sourceEventId: ID,
    sourceEventTimestamp: AT, route: record.resource, protocol: paid.paymentProtocol,
    paymentClass: "unclassified", settlementReference: REF, amountAtomic: "10000" };
  await writeFile(path.join(dir, FILE_CLASSES.paidSuccessEvidence), `${JSON.stringify(paid)}\n`);
  await writeFile(path.join(dir, FILE_CLASSES.settlementLedger), `${JSON.stringify(settlement)}\n`);
}

test("real audit outputs persist fixed summaries, exact digest, static coverage and repair counts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "seller-outcome-"));
  try {
    for (const decision of ["machine_buyable", "contract_ready", "repair_required"]) {
      const findings = decision === "repair_required" ? ["seller_response_contract_partial", `seller_response_required_path_missing:${CANARY}`, `target_invalid:${CANARY}`, CANARY] : [];
      const body = await audit(decision, findings);
      const record = observed(body, { outcomeSummary: { decision: "caller_injected" } });
      assert.equal(record.outcomeSummaryStatus, "available");
      const s = record.outcomeSummary;
      assert.equal(s.schemaVersion, SELLER_OUTCOME_SCHEMA);
      assert.equal(s.responseDigest, digestResponseBytes(bytes(body)));
      assert.equal(s.decision, decision);
      assert.equal(s.auditCompleted, true);
      assert.equal(s.repairMode, "advisory");
      assert.equal(s.runtimeCoverage, decision === "contract_ready" ? "static_post" : "verified");
      assert.ok(Buffer.byteLength(JSON.stringify(s)) <= MAX_OUTCOME_BYTES);
      assert.ok(Object.values(s).every((value) => value === null || ["string", "boolean", "number"].includes(typeof value)));
      assert.equal(JSON.stringify(s).includes(CANARY), false);
      if (decision === "repair_required") {
        assert.equal(s.contractPartial, 1);
        assert.equal(s.requiredPathMissing, 1);
        assert.equal(s.targetInvalid, 1);
        assert.equal(s.unknownFindings, 1);
      }
      await openStore(dir).appendValidation(record);
      const restarted = await openStore(dir).readValidations();
      assert.deepEqual(restarted.at(-1).outcomeSummary, s);
      assert.equal(recordObservation(restarted.at(-1)), null);
    }
    const text = await readFile(openStore(dir).validationPath, "utf8");
    for (const needle of [CANARY, "caller_injected", "requiredPaths", "nextActions", "sellerVersions", "origin"]) assert.equal(text.includes(needle), false, needle);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("valid incomplete reports and unknown codes retain explicit limitations; overflow is explicit", async () => {
  const incomplete = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, {
    auditImpl: async () => { throw new Error("document returned HTTP 404"); },
  });
  const record = observed(incomplete);
  assert.equal(record.validatorVerdict, "unknown");
  assert.equal(record.deliveryClass, "incomplete_report");
  assert.equal(record.outcomeSummaryStatus, "available");
  assert.equal(record.outcomeSummary.auditCompleted, false);
  assert.equal(record.outcomeSummary.failureCategory, "openapi_unavailable");
  assert.equal(record.outcomeSummary.runtimeCoverage, "incomplete");
  assert.equal(record.outcomeSummary.repairMode, "absent");
  incomplete.report.failureCode = CANARY;
  incomplete.report.findings = [CANARY];
  assert.equal(observed(incomplete).outcomeSummary.failureCategory, "unknown");
  const future = await audit();
  future.report.schemaVersion = CANARY;
  assert.equal(observed(future).outcomeSummaryStatus, "unsupported");
  const partial = await audit("repair_required", ["seller_response_contract_partial"]);
  partial.report.responseContract.decision = "partial";
  partial.report.repairPlan.complete = false;
  partial.report.runtimeChallengeVerified = false;
  partial.report.status = 503;
  const partialSummary = observed(partial).outcomeSummary;
  assert.equal(partialSummary.contractCoverage, "partial");
  assert.equal(partialSummary.runtimeCoverage, "challenge_unverified");
  assert.equal(partialSummary.repairComplete, false);
  const overflow = observed(await audit("repair_required", Array(120).fill("seller_response_contract_absent")));
  assert.equal(overflow.outcomeSummary.contractAbsent, 99);
  assert.equal(overflow.outcomeSummary.findingOverflow, true);
});

test("bad, unvalidated, incomplete, oversize and foreign bytes cannot produce outcomes", async () => {
  const body = await audit();
  const payload = bytes(body);
  for (const extra of [
    { responseBytes: Buffer.from("{") }, { merchantHttpStatus: 500 },
    { responseBytes: bytes({ ...body, product: CANARY }) },
    { responseBytes: bytes({ ...body, version: "2.0.0" }) },
    { responseBytes: bytes({ ...body, report: {} }) },
    { responseBytes: Buffer.concat([payload, Buffer.alloc(MAX_RESPONSE_BYTES, 0x20)]) },
    { responseBytes: payload, observation: sealStreamedHttpCapture({ digest: "c".repeat(64), byteLength: payload.length + 1, bytes: payload, method: "GET", resource: RESOURCES.SELLER_INTEGRITY }) },
  ]) {
    const r = observed(body, extra);
    assert.notEqual(r.outcomeSummaryStatus, "available");
    assert.equal(r.outcomeSummary, null);
  }
  assert.throws(() => observed(body, { responseDigest: "c".repeat(64) }), /retained output/);
  const foreign = observed(body, { observation: sealStreamedHttpCapture({ digest: digestResponseBytes(payload), byteLength: payload.length, bytes: payload, method: "GET", resource: "/extract" }) });
  assert.equal(foreign.outcomeSummaryStatus, "invalid");
  resetMerchantHttpDeliveryContracts();
  try { assert.equal(observed(body).outcomeSummaryStatus, "unavailable"); }
  finally { bindMerchantHttpDeliveryContracts(); }
});

test("contradictory body and persisted metadata fail only the semantic measurement", async () => {
  const body = await audit();
  for (const change of [
    (b) => { b.ok = false; },
    (b) => { b.report.valid = false; },
    (b) => { b.report.failureCode = CANARY; },
    (b) => { b.report.probe.attempted = false; },
    (b) => { b.report.findings = [CANARY]; },
  ]) {
    const b = clone(body); change(b);
    const r = observed(b);
    assert.equal(r.validatorVerdict, "pass");
    assert.equal(r.outcomeSummaryStatus, "invalid");
    assert.equal(r.outcomeSummary, null);
  }
  const good = observed(body);
  for (const change of [
    { outcomeSummary: { ...good.outcomeSummary, responseDigest: "c".repeat(64) } },
    { outcomeSummary: { ...good.outcomeSummary, auditCompleted: false } },
    { outcomeSummary: { ...good.outcomeSummary, unknownFindings: 100 } },
    { outcomeSummary: { ...good.outcomeSummary, [CANARY]: CANARY } },
    { outcomeSummary: { ...good.outcomeSummary, repairMode: CANARY } },
    { outcomeSummary: { ...good.outcomeSummary, decision: [CANARY] } },
    { contractName: "other.validator.contract" }, { resource: "/extract" },
    { validatorVerdict: "invalid" },
    { counters: { ...good.counters, sourceRefusalMarks: 1 } },
  ]) {
    const r = canonicalizeValidationRecord({ ...good, ...change });
    assert.equal(r.outcomeSummaryStatus, "invalid");
    assert.equal(r.outcomeSummary, null);
  }
  assert.throws(() => canonicalizeValidationRecord({ ...good, validatorAuthority: "caller" }));
  assert.throws(() => canonicalizeValidationRecord({ ...good, validatorSource: "caller" }));
  const future = canonicalizeValidationRecord({ ...good, outcomeSummary: { schemaVersion: CANARY, secret: CANARY } });
  assert.equal(future.outcomeSummaryStatus, "unsupported");
  assert.equal(JSON.stringify(future).includes(CANARY), false);
  const old = clone(good); delete old.outcomeSummary; delete old.outcomeSummaryStatus;
  assert.deepEqual(canonicalizeValidationRecord(old), old);
});

test("restart, duplicate append, old/missing/conflicting metadata and CLI keep one exact result", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "seller-outcome-join-"));
  try {
    const good = observed(await audit("repair_required", ["seller_response_contract_absent", CANARY]));
    await seedJoin(dir, good);
    const store = openStore(dir);
    await store.appendValidation(good);
    await store.appendValidation(good);
    const report = await receiveOrdinaryDeliveryJoin({ dataDir: dir, ...WINDOW });
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].disposition, "exact_join");
    assert.equal(report.rows[0].outcomeSummaryStatus, "available");
    assert.equal(report.sellerAuditOutcomes.decisions.repair_required, 1);
    assert.equal(report.callerResultFeedback.absent, 1);
    assert.equal(report.rows[0].usefulness, "unknown");
    assert.deepEqual(reportViolations(report), []);
    const injectedExport = clone(report);
    injectedExport.rows[0].outcomeSummary[CANARY] = CANARY;
    assert.ok(reportViolations(injectedExport).includes("seller_outcome_unbound"));
    const cli = spawnSync(process.execPath, ["ordinary-delivery-join-cli.mjs", "--data-dir", dir, "--window-start", WINDOW.windowStart, "--window-end", WINDOW.windowEnd, "--source-sha", "b309c6e2a1e1794a324c1c422c1c841a76038686"], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).sellerAuditOutcomes.counts.available, 1);
    for (const secret of [CANARY, REF, good.responseDigest, "requiredPaths", "nextActions"]) assert.equal(cli.stdout.includes(secret), false, secret);
    for (const change of [
      { responseDigest: "c".repeat(64) }, { resource: "/extract" },
      { validatorAuthority: "caller" }, { validatorSource: "caller" },
      { contractName: "other.validator.contract" },
      { settlementReference: `0x${"d".repeat(64)}` },
      { paidEvidenceId: "22222222-2222-4222-8222-222222222222" },
    ]) {
      await writeFile(store.validationPath, `${JSON.stringify({ ...good, ...change })}\n`);
      const r = await receiveOrdinaryDeliveryJoin({ dataDir: dir, ...WINDOW });
      assert.notEqual(r.rows[0].outcomeSummaryStatus, "available");
      assert.equal(r.sellerAuditOutcomes.decisions.repair_required, 0);
    }
    for (const [change, status] of [
      [{ outcomeSummary: null, outcomeSummaryStatus: "invalid" }, "invalid"],
      [{ outcomeSummary: { schemaVersion: "future" }, outcomeSummaryStatus: "available" }, "unsupported"],
      [{ outcomeSummary: { ...good.outcomeSummary, responseDigest: "c".repeat(64) } }, "invalid"],
    ]) {
      await writeFile(store.validationPath, `${JSON.stringify({ ...good, ...change })}\n`);
      const r = await receiveOrdinaryDeliveryJoin({ dataDir: dir, ...WINDOW });
      assert.equal(r.rows[0].disposition, "exact_join");
      assert.equal(r.rows[0].outcomeSummaryStatus, status);
      assert.equal(r.sellerAuditOutcomes.decisions.repair_required, 0);
      assert.equal(r.callerResultFeedback.absent, 1);
    }
    const old = clone(good); delete old.outcomeSummary; delete old.outcomeSummaryStatus;
    await writeFile(store.validationPath, `${JSON.stringify(old)}\n`);
    assert.equal((await receiveOrdinaryDeliveryJoin({ dataDir: dir, ...WINDOW })).sellerAuditOutcomes.counts.missing, 1);
    await writeFile(store.validationPath, "");
    const missing = await receiveOrdinaryDeliveryJoin({ dataDir: dir, ...WINDOW });
    assert.equal(missing.rows[0].disposition, "missing_capture");
    assert.equal(missing.sellerAuditOutcomes.decisions.repair_required, 0);
    // Two otherwise valid summaries for the same bytes cannot choose a semantic winner.
    const other = clone(good); other.outcomeSummary.unknownFindings += 1;
    await writeFile(store.validationPath, `${JSON.stringify(good)}\n${JSON.stringify(other)}\n`);
    assert.equal((await receiveOrdinaryDeliveryJoin({ dataDir: dir, ...WINDOW })).rows[0].outcomeSummaryStatus, "invalid");
    // Post-capture mutation cannot use a live observation to persist an injected summary.
    const mutated = observed(await audit()); mutated.outcomeSummary.contractCoverage = "unknown";
    await writeFile(store.validationPath, "");
    await store.appendValidation(mutated);
    assert.equal((await store.readValidations())[0].outcomeSummaryStatus, "invalid");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
