import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { BoundaryError } from "../src/boundary.mjs";
import { parityProjection } from "../src/service.mjs";
import { actors, fund, parties, setupService } from "./helpers.mjs";

let ctx;

before(async () => {
  ctx = await setupService();
});

after(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await ctx.reset();
});

test("signature and submitted funding are not reserved", async () => {
  const who = actors();
  const signed = await fund(ctx, { stage: "signature" });
  assert.equal(signed.funding.state, "funding_unusable");
  assert.equal(signed.funding.reservedFunding, false);
  assert.equal(signed.funding.fundingStage, "signature");
  assert.equal(signed.funding.statusCode, 202);
  const submitted = await fund(ctx, { stage: "submitted" });
  assert.equal(submitted.funding.reservedFunding, false);
  assert.equal(submitted.funding.fundingState, "pending");
  const confirmed = await fund(ctx, { stage: "confirmed_usable" });
  assert.equal(confirmed.funding.reservedFunding, true);
  assert.equal(confirmed.funding.state, "funded");
  const receipts = await ctx.pool.query("SELECT job_id FROM ae14_async_receipt");
  assert.deepEqual(receipts.rows.map((row) => row.job_id), [confirmed.opened.jobId]);
  await assert.rejects(() => ctx.service.observeFunding(who.other, confirmed.opened.jobId, confirmed.proofId), (error) => error.code === "forbidden");
});

test("one receipt cannot fund a second job and one job cannot take a second proof", async () => {
  const first = await fund(ctx);
  const second = await fund(ctx, { stage: "signature" });
  const secondRecord = await ctx.journal.read(second.opened.jobId);
  await ctx.port.put({
    ...(await ctx.port.load(second.proofId)),
    proofId: first.proofId,
    stage: "confirmed_usable",
    finalityRef: "local:final:1",
    tenantId: secondRecord.quote.tenantId,
    allocationId: secondRecord.quote.canonicalTaskId,
    quoteId: secondRecord.quote.quoteId,
    taskId: secondRecord.quote.taskId,
    requesterId: secondRecord.quote.requesterId,
    fundingAuthorityId: secondRecord.quote.fundingAuthorityId,
    asset: secondRecord.quote.asset,
    recipient: secondRecord.quote.fundingTarget,
    amount: secondRecord.quote.gross,
    quoteDigest: secondRecord.quoteDigest,
  });
  await assert.rejects(
    () => ctx.service.observeFunding(actors().requester, second.opened.jobId, first.proofId),
    (error) => error.code === "receipt_already_bound",
  );
  const otherProof = `other${first.opened.jobId}`;
  const firstRecord = await ctx.journal.read(first.opened.jobId);
  await ctx.port.put({
    proofId: otherProof,
    qualification: "stand-in-not-rail",
    provenance: "fake",
    stage: "confirmed_usable",
    finalityRef: "local:final:2",
    tenantId: firstRecord.quote.tenantId,
    allocationId: firstRecord.quote.canonicalTaskId,
    quoteId: firstRecord.quote.quoteId,
    taskId: firstRecord.quote.taskId,
    requesterId: firstRecord.quote.requesterId,
    fundingAuthorityId: firstRecord.quote.fundingAuthorityId,
    asset: firstRecord.quote.asset,
    recipient: firstRecord.quote.fundingTarget,
    amount: firstRecord.quote.gross,
    quoteDigest: firstRecord.quoteDigest,
    effect: null,
    invocations: 0,
  });
  await assert.rejects(
    () => ctx.service.observeFunding(actors().requester, first.opened.jobId, otherProof),
    (error) => error.code === "allocation_already_funded",
  );
});

test("output HTTP-equivalent 200 is not acceptance and a client assent annotation is ignored", async () => {
  const funded = await fund(ctx);
  const delivered = await ctx.service.deliverOutput(actors().worker, funded.opened.jobId, {
    kind: "repair",
    body: "repaired the consumer join",
    assent: true,
  });
  assert.equal(delivered.statusCode, 200);
  assert.equal(delivered.usefulWork, false);
  assert.equal(delivered.paymentCompleted, false);
  assert.equal(delivered.reviewDecision, null);
  assert.equal(delivered.capturePosted, false);
  assert.equal(delivered.state, "output_ready");
  const stored = await ctx.journal.read(funded.opened.jobId);
  assert.equal(stored.output.annotationIgnored, true);
});

test("accepted repair stays approval_pending until the canonical join and does not capture twice", async () => {
  const funded = await fund(ctx, { gross: "20" });
  await ctx.service.deliverOutput(actors().worker, funded.opened.jobId, { kind: "repair", body: "repair-20" });
  const accepted = await ctx.service.accept(actors().reviewer, funded.opened.jobId, { feeAmount: "0", artifactDigest: (await ctx.journal.read(funded.opened.jobId)).output.digest });
  assert.equal(accepted.state, "approval_pending");
  assert.equal(accepted.acceptedSettled, false);
  assert.equal(accepted.canonicalJoin, "pending-join");
  assert.equal(accepted.paymentCompleted, false);
  assert.equal(accepted.fundedAcceptance, false);
  assert.equal(accepted.usefulWork, true);
  assert.equal(accepted.resultKind, "repair");
  assert.equal(accepted.platformFee, "1");
  assert.equal(accepted.contributorNet, "19");
  assert.equal(accepted.railCost, "0");
  assert.equal(accepted.statusCode, 202);
  const row = await ctx.port.load(funded.proofId);
  assert.equal(row.invocations, 1);
  assert.equal(row.lastFeeAmount, "1");
  assert.equal(row.lastFeeRecipient, partiesFee());
  const again = await ctx.service.accept(actors().reviewer, funded.opened.jobId);
  assert.equal(again.replayed, true);
  assert.equal((await ctx.port.load(funded.proofId)).invocations, 1);
  assert.equal(again.secondCapturePost, false);
  const payout = await ctx.service.proposal(actors().requester, funded.opened.jobId);
  assert.equal(payout.payoutRequired, false);
  assert.equal(payout.withdrawalFee, "0");
  assert.equal((await ctx.port.load(funded.proofId)).invocations, 1);
});

test("accepted no-fit stays distinct from a repair and can be reused without a new payment", async () => {
  const funded = await fund(ctx, { gross: "21" });
  await ctx.service.deliverOutput(actors().worker, funded.opened.jobId, { kind: "no_fit", body: "no compatible route" });
  const accepted = await ctx.service.accept(actors().reviewer, funded.opened.jobId);
  assert.equal(accepted.resultKind, "no_fit");
  assert.equal(accepted.usefulWork, true);
  assert.equal(accepted.platformFee, "1");
  assert.equal(accepted.contributorNet, "20");
  const reused = await ctx.service.reuse(actors().later, funded.opened.jobId);
  assert.equal(reused.newPayment, false);
  assert.equal(reused.paidTaskCountDelta, 0);
  assert.equal(reused.artifact.body, "no compatible route");
  assert.equal(reused.acceptedSettled, false);
  await ctx.service.withdrawRights(actors().requester, funded.opened.jobId);
  await assert.rejects(() => ctx.service.reuse(actors().later, funded.opened.jobId), (error) => error.code === "rights_withdrawn");
  const kept = await ctx.journal.read(funded.opened.jobId);
  assert.equal(kept.state, "approval_pending");
  assert.equal(kept.output.body, "no compatible route");
  assert.equal(kept.quote.contributorNet, "20");
  const view = await ctx.service.observe(actors().requester, funded.opened.jobId);
  assert.equal(view.earnedDebtErased, false);
  assert.equal(view.rightsWithdrawn, true);
});

test("rejection does not capture", async () => {
  const funded = await fund(ctx);
  await ctx.service.deliverOutput(actors().worker, funded.opened.jobId, { kind: "repair", body: "not useful" });
  const rejected = await ctx.service.reject(actors().reviewer, funded.opened.jobId);
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.usefulWork, false);
  assert.equal(rejected.usefulFailure, true);
  assert.equal(rejected.capturePosted, false);
  assert.equal((await ctx.port.load(funded.proofId)).invocations, 0);
  await assert.rejects(() => ctx.service.reuse(actors().later, funded.opened.jobId), (error) => error.code === "reuse_not_granted");
});

test("expiry wins without a funded acceptance and a later expiry cannot undo capture", async () => {
  const expired = await fund(ctx);
  await ctx.service.deliverOutput(actors().worker, expired.opened.jobId, { kind: "repair", body: "late" });
  await ctx.port.expire(expired.proofId);
  const lost = await ctx.service.accept(actors().reviewer, expired.opened.jobId);
  assert.equal(lost.state, "expired_reclaimed");
  assert.equal(lost.winner, "expiry");
  assert.equal(lost.reviewDecision, null);
  assert.equal(lost.resultKind, null);
  assert.equal(lost.fundedAcceptance, false);
  assert.equal(lost.acceptedSettled, false);
  assert.equal(lost.usefulWork, false);
  assert.equal(lost.usefulFailure, true);
  assert.equal(lost.artifactRetained, true);
  assert.equal(lost.reclaim, true);
  assert.equal(lost.refunded, false);
  assert.equal(lost.capturePosted, false);
  assert.equal((await ctx.port.load(expired.proofId)).invocations, 0);
  await assert.rejects(() => ctx.service.reuse(actors().later, expired.opened.jobId), (error) => error.code === "reuse_not_granted");

  const captured = await fund(ctx);
  await ctx.service.deliverOutput(actors().worker, captured.opened.jobId, { kind: "repair", body: "on time" });
  const won = await ctx.service.accept(actors().reviewer, captured.opened.jobId);
  await ctx.port.expire(captured.proofId);
  const still = await ctx.service.observe(actors().reviewer, captured.opened.jobId);
  assert.equal(won.captureState, "captured");
  assert.equal(won.winner, "acceptance");
  assert.equal(still.state, "approval_pending");
  assert.equal(still.winner, "acceptance");
  assert.equal(still.captureState, "captured");
  assert.equal(still.reclaim, false);
  assert.equal((await ctx.port.load(captured.proofId)).invocations, 1);
});

test("a lost capture response is resolved by readback and is not posted again", async () => {
  const after = await fund(ctx, { proofExtras: { lose: "after" } });
  await ctx.service.deliverOutput(actors().worker, after.opened.jobId, { kind: "repair", body: "lost-after" });
  const pending = await ctx.service.accept(actors().reviewer, after.opened.jobId);
  assert.equal(pending.ambiguousEffect, true);
  assert.equal(pending.capturePosted, true);
  assert.equal((await ctx.port.load(after.proofId)).invocations, 1);
  const resolved = await ctx.service.observe(actors().requester, after.opened.jobId);
  assert.equal(resolved.captureState, "captured");
  assert.equal(resolved.state, "approval_pending");
  assert.equal(resolved.acceptedSettled, false);
  assert.equal(resolved.secondCapturePost, false);
  assert.equal((await ctx.port.load(after.proofId)).invocations, 1);

  const before = await fund(ctx, { proofExtras: { lose: "before" } });
  await ctx.service.deliverOutput(actors().worker, before.opened.jobId, { kind: "repair", body: "lost-before" });
  const ambiguous = await ctx.service.accept(actors().reviewer, before.opened.jobId);
  assert.equal(ambiguous.ambiguousEffect, true);
  assert.equal(ambiguous.captureState, null);
  const still = await ctx.service.accept(actors().reviewer, before.opened.jobId);
  assert.equal(still.secondCapturePost, false);
  assert.equal((await ctx.port.load(before.proofId)).invocations, 1);
  assert.equal(still.acceptedSettled, false);
});

test("an unjournaled operator capture is unknown and is not accepted", async () => {
  const rogue = await fund(ctx, { proofExtras: { operatorCaptured: true } });
  await ctx.service.deliverOutput(actors().worker, rogue.opened.jobId, { kind: "repair", body: "rogue" });
  const seen = await ctx.service.observe(actors().reviewer, rogue.opened.jobId);
  assert.equal(seen.state, "output_ready");
  assert.equal(seen.usefulWork, false);
  assert.equal(seen.acceptedSettled, false);
  assert.equal(seen.capturePosted, false);
  await assert.rejects(() => ctx.service.accept(actors().reviewer, rogue.opened.jobId), (error) => error.code === "capture_evidence_unknown");
  const job = await ctx.journal.read(rogue.opened.jobId);
  assert.equal(job.review, null);
  assert.equal((await ctx.port.load(rogue.proofId)).invocations, 0);
});

test("the wrong tenant, reviewer or contributor cannot move the job", async () => {
  const funded = await fund(ctx);
  await ctx.service.deliverOutput(actors().worker, funded.opened.jobId, { kind: "repair", body: "scoped" });
  await assert.rejects(() => ctx.service.accept(actors().worker, funded.opened.jobId), (error) => error instanceof BoundaryError && error.code === "forbidden");
  await assert.rejects(() => ctx.service.accept({ ...actors().reviewer, actorId: "other-reviewer" }, funded.opened.jobId), (error) => error.code === "forbidden");
  await assert.rejects(() => ctx.service.observe(actors().other, funded.opened.jobId), (error) => error.code === "forbidden");
  const untouched = await ctx.journal.read(funded.opened.jobId);
  assert.equal(untouched.review, null);
  assert.equal(untouched.capturePosted, false);
});

test("legacy terms open nothing and a direct route matches the callback route", async () => {
  for (const termsVersion of ["221400", "234100"]) {
    const refused = await ctx.service.openJob(actors().requester, { ...fundedInput(), termsVersion, earnedNet: "100000" });
    assert.equal(refused.code, "legacy_terms_unchanged");
    assert.equal(refused.feeApplied, false);
    assert.equal(refused.earnedNet, "100000");
    assert.equal(refused.walletRequired, false);
  }
  const count = await ctx.pool.query("SELECT count(*)::int AS n FROM ae14_async_job");
  assert.equal(count.rows[0].n, 0);

  const quiet = await fund(ctx);
  await ctx.service.deliverOutput(actors().worker, quiet.opened.jobId, { kind: "repair", body: "direct" });
  const direct = await ctx.service.accept(actors().reviewer, quiet.opened.jobId);
  const noisy = await fund(ctx, { jobExtras: { callbackUrl: "https://127.0.0.1:9/callback" } });
  await ctx.service.deliverOutput(actors().worker, noisy.opened.jobId, { kind: "repair", body: "direct" });
  const callback = await ctx.service.accept(actors().reviewer, noisy.opened.jobId);
  assert.equal(callback.callback.authority, false);
  assert.equal(callback.callback.acked, false);
  assert.equal(direct.directRoute.authority, true);
  assert.deepEqual(parityProjection(direct), parityProjection(callback));
});

test("a post-capture refund is not a reclaim and charges no second fee", async () => {
  const funded = await fund(ctx);
  await ctx.service.deliverOutput(actors().worker, funded.opened.jobId, { kind: "repair", body: "refund me" });
  await ctx.service.accept(actors().reviewer, funded.opened.jobId);
  await ctx.port.refund(funded.proofId);
  const refunded = await ctx.service.observe(actors().requester, funded.opened.jobId);
  assert.equal(refunded.state, "refunded");
  assert.equal(refunded.refundDistinctFromReclaim, true);
  assert.equal(refunded.reclaim, false);
  assert.equal(refunded.withdrawalFee, "0");
  assert.equal(refunded.secondFeeOnWithdrawal, false);
  assert.equal(refunded.earnedDebtErased, false);
  assert.equal(refunded.acceptedSettled, false);
  assert.equal((await ctx.port.load(funded.proofId)).invocations, 1);
});

test("a quote that is already expired cannot be funded", async () => {
  let now = Date.now();
  const local = await setupService({ now: () => new Date(now) });
  try {
    const opened = await local.service.openJob(actors().requester, { ...fundedInput(), expiresAt: new Date(now + 1_000).toISOString() });
    const record = await local.journal.read(opened.jobId);
    await local.port.put({
      proofId: "late-proof",
      qualification: "stand-in-not-rail",
      provenance: "fake",
      stage: "confirmed_usable",
      finalityRef: "local:final:1",
      tenantId: record.quote.tenantId,
      allocationId: record.quote.canonicalTaskId,
      quoteId: record.quote.quoteId,
      taskId: record.quote.taskId,
      requesterId: record.quote.requesterId,
      fundingAuthorityId: record.quote.fundingAuthorityId,
      asset: record.quote.asset,
      recipient: record.quote.fundingTarget,
      amount: record.quote.gross,
      quoteDigest: record.quoteDigest,
      effect: null,
      invocations: 0,
    });
    now += 5_000;
    await assert.rejects(() => local.service.observeFunding(actors().requester, opened.jobId, "late-proof"), (error) => error.code === "quote_expired");
    const job = await local.journal.read(opened.jobId);
    assert.equal(job.state, "quoted");
    assert.equal(job.funding, null);
  } finally {
    await local.close();
  }
});

function partiesFee() {
  return "0x1111111111111111111111111111111111111111";
}

function fundedInput() {
  return { ...parties, gross: "20", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
}
