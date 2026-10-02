import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { executeDelivery, evaluateReceipt, validateLater, publicSummary, verifyReceipt } from "../src/consumer.mjs";
import { criteria } from "../src/contract.mjs";
import { digest } from "../src/value.mjs";
import { contract, danger, retained } from "./caller.mjs";
import { startMounted, ownerModule, createTestRetained } from "./mounted-owner.mjs";

const options = { allowLoopback: true };
test("actual received mount executes two caller inputs and matches the direct owner's equal-task decisions", async () => {
  const f = await startMounted();
  const { runScan } = await ownerModule("experiments/scoped-surface-delivery-100312/src/adapter.mjs");
  const { resolveHostedScanner } = await ownerModule("experiments/scoped-surface-delivery-100312/deploy/hosted-scanner.mjs");
  const cases = [];
  try {
    for (const c of [contract(), danger()]) {
      const received = await executeDelivery(c, f.origin, options);
      const e = evaluateReceipt(received);
      assert.equal(e.verdict, "fulfilled");
      assert.equal(e.settlement.state, "not_attempted");
      assert.equal(e.release.deployment, "unknown");
      const started = performance.now();
      const direct = await runScan(c.request.input, resolveHostedScanner({}));
      const directElapsedMs = performance.now() - started;
      assert.ok(directElapsedMs > 0 && e.latency.elapsedMs > 0);
      assert.deepEqual(criteria(c, { report: direct }), e.predicates);
      assert.equal(direct.concern.result, received.observations.execution.body.report.concern.result);
      assert.equal(e.requesterAttestedUsefulness, "unknown");
      cases.push({ contractDigest: received.contractDigest, operation: c.request.route,
        expectedConcern: c.expectations.usefulOutput[1].value, receivedConcern: direct.concern.result,
        equalInput: true, equalPredicates: true, directOwnerPredicates: criteria(c, { report: direct }),
        receivedPredicates: e.predicates, directElapsedMs, receivedHttpValidationMs: e.latency.elapsedMs,
        receivedServiceResponseMs: e.latency.serviceResponseMs, scannerCommit: direct.scanner.commit,
        settlement: "not_attempted", reviewAndAdaptationMs: "unknown", cost: "unknown", savings: "unknown" });
    }
    await writeFile(new URL("../receipts/equal-task-comparison.json", import.meta.url), JSON.stringify({
      schema: "samedaydesk.service-delivery.equal-task-comparison.v1", observedAt: new Date().toISOString(),
      base: "015f07d5a75d02a4e74709b17b2b1176501e92a5", execution: "actual Cursor Cloud VM",
      comparison: "existing runScan versus received mounted HTTP using the same packaged scanner and caller bytes",
      observations: "two QA cases; sequential measurements, no performance or savings claim", cases,
      customerCount: "unknown", revenue: "unknown", externalUse: "unknown", production: false,
    }, null, 2) + "\n");
  } finally { await f.close(); }
});
test("changed later input and predicates get new execution and preserve the old historical result", async () => {
  const f = await startMounted();
  try {
    const old = await executeDelivery(contract(), f.origin, options);
    const next = danger(); next.expectations.usefulOutput[1].value = "no_match";
    const changed = await validateLater(old, next, f.origin, options);
    assert.equal(changed.historical.verdict, "fulfilled");
    assert.equal(changed.currentEvaluation.usefulOutput, "partial");
    assert.equal(changed.relation.input, "changed");
    assert.equal(changed.priorMayApply, false);
    assert.equal(changed.currentEvaluation.makeGood.financialAction, "none");
    const other = danger(); other.taskId = "different-task"; other.request.input.taskId = other.taskId;
    const independent = await validateLater(old, other, f.origin, options);
    assert.equal(independent.relation.task, "different_task");
    assert.equal(independent.currentEvaluation.verdict, "fulfilled");
    assert.equal(independent.settlementInherited, false);
    assert.equal(independent.rightsInherited, false);
  } finally { await f.close(); }
});
test("received retest uses the existing two-scan owner and refuses a saved report as repair authority", async () => {
  const f = await startMounted();
  const { rerun } = await ownerModule("experiments/scoped-surface-delivery-100312/src/retest.mjs");
  const { resolveHostedScanner } = await ownerModule("experiments/scoped-surface-delivery-100312/deploy/hosted-scanner.mjs");
  try {
    const c = contract(); const original = danger().request.input; const repair = structuredClone(original);
    repair.files = c.request.input.files;
    c.request = { method: "POST", route: "/commerce/scoped-surface-retest", input: { original, request: repair } };
    c.expectations.usefulOutput = [
      { id: "scanned", pointer: "/retest/current/scanPerformed", op: "equals", value: true },
      { id: "fixed", pointer: "/retest/comparison", op: "equals", value: "fixed" },
      { id: "cleared", pointer: "/retest/current/concern/result", op: "equals", value: "no_match" },
    ];
    const received = await executeDelivery(c, f.origin, options);
    assert.equal(evaluateReceipt(received).verdict, "fulfilled");
    const direct = await rerun(c.request.input, resolveHostedScanner({}));
    assert.deepEqual(criteria(c, { retest: direct }), evaluateReceipt(received).predicates);
    assert.equal(received.observations.execution.body.retest.operation.spawns, 2);
    const forged = structuredClone(c);
    forged.request.input = { previous: received.observations.execution.body.retest.current, request: repair };
    const later = await validateLater(received, forged, f.origin, options);
    assert.equal(later.current.observations.execution.body.retest.reason, "unverified_prior");
    assert.equal(later.currentEvaluation.delivery, "partial");
    assert.equal(later.currentEvaluation.makeGood.requestDigest, digest(forged.request));
    assert.equal(later.currentEvaluation.makeGood.automaticallyExecuted, false);
    assert.equal(later.priorMayApply, false);
  } finally { await f.close(); }
});
test("release changes and unavailable source leave useful output and current validation separate", async () => {
  const f = await startMounted();
  try {
    const old = await executeDelivery(contract(), f.origin, options);
    f.state.version = "1.23.50";
    const later = await validateLater(old, contract(), f.origin, options);
    assert.equal(later.currentEvaluation.usefulOutput, "met");
    assert.equal(later.currentEvaluation.release.state, "unmet");
    assert.equal(later.currentEvaluation.verdict, "partial");
    assert.equal(later.relation.descriptor, "changed_or_unknown");
    assert.equal(later.historical.release.state, "met");
  } finally { await f.close(); }
});
test("missing fields, partial scanner decisions, age and caller retention expiry remain meaningful", async () => {
  const f = await startMounted();
  try {
    const c = contract(); c.expectations.usefulOutput.push({ id: "missing", pointer: "/absent", op: "exists" });
    const receipt = await executeDelivery(c, f.origin, options);
    assert.equal(evaluateReceipt(receipt).usefulOutput, "partial");
    const expiry = Date.parse(receipt.observations.execution.observedAt) + c.expectations.freshness.maxAgeMs + 1;
    assert.equal(evaluateReceipt(receipt, { now: expiry }).freshness.state, "expired");
    assert.equal(evaluateReceipt(receipt, { now: Date.parse(c.retainUntil) }).verdict, "expired");
    const unknown = contract(); unknown.request.input.concern.id = "scanner-cannot-decide";
    const incomplete = evaluateReceipt(await executeDelivery(unknown, f.origin, options));
    assert.equal(incomplete.delivery, "partial");
    assert.equal(incomplete.makeGood.automaticallyExecuted, false);
  } finally { await f.close(); }
});
test("existing retained owner survives restart, refuses another grant and revocation; no paid result grants current execution", async () => {
  let f = await startMounted();
  try {
    const { result } = await createTestRetained(f);
    const c = retained();
    const first = await executeDelivery(c, f.origin, { ...options, resultGrant: result.grant });
    assert.equal(evaluateReceipt(first).verdict, "fulfilled");
    assert.equal(evaluateReceipt(first).settlement.state, "unknown");
    assert.equal(evaluateReceipt(first).freshness.currentExecution, "historical_only");
    const requiredCurrent = retained(); requiredCurrent.expectations.freshness.requireCurrentExecution = true;
    assert.equal(evaluateReceipt(await executeDelivery(requiredCurrent, f.origin, { ...options, resultGrant: result.grant })).freshness.state, "unknown");
    const directory = f.directory; const clock = f.clock;
    await f.close({ remove: false }); f = await startMounted({ directory, clock });
    const restarted = await validateLater(first, c, f.origin, { ...options, resultGrant: result.grant });
    assert.equal(restarted.currentEvaluation.verdict, "fulfilled");
    const wrong = await executeDelivery(c, f.origin, { ...options, resultGrant: "ef".repeat(32) });
    assert.equal(wrong.observations.execution.status, 403);
    assert.equal(evaluateReceipt(wrong).delivery, "failed");
    await f.customer.revokeDeliveredReceipt({ token: result.grant });
    const revoked = await validateLater(first, c, f.origin, { ...options, resultGrant: result.grant });
    assert.equal(revoked.current.observations.execution.body.error, "revoked");
    assert.equal(revoked.currentEvaluation.continuation.state, "unavailable");
    assert.equal(revoked.currentEvaluation.usefulOutput, "unknown");
    assert.equal(publicSummary(first).makeGood, null);
    assert.equal(JSON.stringify(publicSummary(first)).includes(result.grant), false);
  } finally { await f.close(); }
});
test("current retained expiry and unenrolled sharing cannot be repaired by payment or caller labels", async () => {
  const f = await startMounted();
  try {
    const { result } = await createTestRetained(f, { retainUntil: new Date(f.clock.value + 1000).toISOString() });
    f.clock.value += 1001;
    const stale = await executeDelivery(retained(), f.origin, { ...options, resultGrant: result.grant });
    assert.equal(stale.observations.execution.body.error, "expired");
    const c = contract(); c.expectations.rights = { purpose: "shared-reuse", regressionId: "not-enrolled", contextId: "private-one", required: true };
    const noRights = await executeDelivery(c, f.origin, options);
    assert.equal(evaluateReceipt(noRights).rights.state, "unmet");
    assert.equal(evaluateReceipt(noRights).rights.sharingPermitted, false);
  } finally { await f.close(); }
});
test("edited unsigned receipt fails integrity; recomputing its hash does not acquire merchant authority", async () => {
  const f = await startMounted();
  try {
    const r = await executeDelivery(contract(), f.origin, options);
    const forged = structuredClone(r); forged.observations.execution.body.paidValidDelivery = true;
    assert.throws(() => verifyReceipt(forged), /receipt_integrity/);
    forged.observations.execution.bodyDigest = digest(forged.observations.execution.body);
    const { integrity, ...material } = forged; forged.integrity = digest(material);
    const e = evaluateReceipt(forged);
    assert.equal(e.captureAuthority, "requester_capture_unsigned");
    assert.equal(e.settlement.paidValidDeliveryClaimIgnored, true);
    assert.equal(e.paymentPermitted, false);
  } finally { await f.close(); }
});
