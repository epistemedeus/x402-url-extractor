import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, readFile, rename, writeFile, unlink, symlink } from "node:fs/promises";
import path from "node:path";
import { contract } from "./caller.mjs";
import { startMounted, ownerModule, TEST_TOKEN } from "./mounted-owner.mjs";
import { consumeJournalEvidence, journalTarget } from "../src/journal-consumer.mjs";
import { executeDelivery } from "../src/consumer.mjs";
import { composeDelivery } from "../src/compose.mjs";
import { digestResponseBytes } from "../upstream/digest.mjs";

test("actual free mount task reference alone does not invent its absent forward delivery side", async () => {
  const c = contract(); const f = await startMounted({ initialState: { admission: { taskId: c.taskId, operationId: c.operationId } } });
  try {
    const r = await executeDelivery(c, f.origin, { allowLoopback: true }); await f.telemetry.flush();
    const proof = f.state.proofs.find(p => p.route === c.request.route)?.proof;
    assert.ok(proof);
    const owner = { dataDir: path.join(f.directory, "commerce"), causalEventProof: proof, internalToken: TEST_TOKEN };
    const combined = await composeDelivery(r, { journalOwner: owner });
    assert.equal(combined.delivery.verdict, "fulfilled");
    assert.equal(combined.transactionSettlement.state, "unknown");
    assert.equal(combined.journalApplicable, false);
    assert.equal(combined.revenue, "unknown");
    const e = await consumeJournalEvidence(journalTarget(r), owner);
    assert.equal(e.reason, "forward_side_absent");
    await assert.rejects(() => composeDelivery(r, { journalEvidence: { binding: "bound", settlement: "reconciled" } }), /unknown_field/);
    assert.equal((await composeDelivery(r)).transactionSettlement.state, "unknown");
  } finally { await f.close(); }
});

test("real existing producer and schema writer join a disposable mocked response; restart, missing/torn/foreign sides stay bounded", async () => {
  const old = process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS;
  process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS = "simulated";
  const taskId = "causal-task"; const operationId = "causal-operation";
  const { validExtractBody } = await ownerModule("http-delivery-evidence/test/helpers.mjs");
  const body = validExtractBody();
  let f = await startMounted({ initialState: { admission: { taskId, operationId, route: "/extract" } }, intercept(req, res, next) {
    if (req.path !== "/extract") return next();
    res.locals.samedaydeskPayment = { protocol: "x402" };
    res.json(body);
  } });
  try {
    // Disposable capture boundary only; there is no payment middleware or signer.
    const response = await fetch(`${f.origin}/extract`, { headers: { "payment-signature": "simulated-test-only-boundary" } });
    const bytes = Buffer.from(await response.arrayBuffer()); await f.telemetry.flush();
    const target = { taskId, operationId, method: "GET", route: "/extract", wireDigest: digestResponseBytes(bytes), cohort: "owner_qa" };
    const proof = f.state.proofs.find(p => p.route === "/extract")?.proof;
    const owner = { dataDir: path.join(f.directory, "commerce"), causalEventProof: proof, internalToken: TEST_TOKEN };
    const first = await consumeJournalEvidence(target, owner);
    assert.equal(first.binding, "bound", first.reason || "unexpected_unbound");
    assert.equal(first.schemaDelivery, "schema_valid"); assert.equal(first.settlement, "unknown");
    assert.equal(first.usefulDeliveryFromJournal, "unknown");
    assert.equal((await consumeJournalEvidence(target, { ...owner, causalEventProof: null })).binding, "unknown");
    assert.equal((await consumeJournalEvidence(target, { ...owner, internalToken: "different-test-owner-key-with-32-bytes" })).binding, "unknown");
    assert.equal((await consumeJournalEvidence({ ...target, taskId: "another-task" }, owner)).binding, "unknown");
    assert.equal((await consumeJournalEvidence({ ...target, wireDigest: "bb".repeat(32) }, owner)).binding, "unknown");
    const acknowledged = await f.telemetry.observeMockedSettlementBoundary({ internalToken: TEST_TOKEN, operationId, receiptDigest: target.wireDigest });
    assert.equal(acknowledged.accepted, true);
    const mocked = await consumeJournalEvidence(target, owner);
    assert.equal(mocked.settlement, "simulated"); assert.equal(mocked.recognizedRevenue, "unknown");
    const correction = await f.telemetry.observeRetainedUse({ internalToken: TEST_TOKEN, operationId,
      receiptDigest: target.wireDigest, correctionOf: operationId });
    assert.equal(correction.accepted, true); await f.telemetry.flush();
    const corrected = await consumeJournalEvidence(target, owner);
    assert.equal(corrected.correctionObserved, true);
    assert.equal(corrected.usefulDeliveryFromJournal, "unknown");
    assert.equal(corrected.settlement, "simulated");
    const directory = f.directory; await f.close({ remove: false }); f = await startMounted({ directory });
    assert.equal((await consumeJournalEvidence(target, owner)).settlement, "simulated");
    const file = f.telemetry.paths.outcomeBindingPath;
    const held = `${file}.test-held`; await rename(file, held);
    assert.equal((await consumeJournalEvidence(target, owner)).reason, "forward_side_absent");
    await rename(held, file);
    await appendFile(file, "{torn-response");
    const incomplete = await consumeJournalEvidence(target, owner);
    assert.equal(incomplete.coverage, "partial_retained_generations"); assert.equal(incomplete.settlement, "unknown");
    const original = await readFile(file, "utf8");
    const row = JSON.parse(original.split("\n").find(line => line.includes('"stage":"call"')));
    await writeFile(f.telemetry.paths.outcomeBindingRotatedPath, JSON.stringify({ ...row, route: "/read" }) + "\n");
    assert.equal((await consumeJournalEvidence(target, owner)).binding, "conflicting");
    await unlink(file); await symlink(f.telemetry.paths.outcomeBindingRotatedPath, file);
    assert.equal((await consumeJournalEvidence(target, owner)).binding, "unknown");
  } finally {
    await f.close();
    if (old === undefined) delete process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS;
    else process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS = old;
  }
});

test("exact existing digest helper is preserved for binary and text response capture", async () => {
  const { digestResponseBytes: ownerDigest } = await ownerModule("http-delivery-evidence/digest.mjs");
  for (const bytes of [Buffer.from('{"result":"ready"}\n'), Buffer.from([0, 255, 1, 13])]) assert.equal(digestResponseBytes(bytes), ownerDigest(bytes));
});
