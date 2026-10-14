import assert from "node:assert/strict";
import test from "node:test";
import { BoundaryError } from "../src/boundary.mjs";
import { COMMERCE_PIN, RAIL_INTERFACE_COMMIT } from "../src/adapter.mjs";
import { actors, fund, parties, setupService } from "./helpers.mjs";

test("the stand-in matches the A amend port and stays pending-join", async () => {
  const ctx = await setupService();
  try {
    assert.equal(RAIL_INTERFACE_COMMIT, "f89939a09feaf6b710d04abf8109c4a0b790f05c");
    assert.equal(ctx.port.protocol.kind, "commerce_payments");
    assert.deepEqual(ctx.port.protocol, COMMERCE_PIN);
    assert.equal(ctx.port.authorityId, parties.fundingAuthorityId);
    assert.equal(ctx.port.qualification, "stand-in-not-rail");
    assert.equal(ctx.service.railQualification, "stand-in-not-rail");
    const funded = await fund(ctx, { gross: "20" });
    const proof = await ctx.port.readProof(funded.proofId);
    assert.equal(proof.state, "confirmed");
    assert.equal(proof.backing, "escrowed");
    await ctx.service.deliverOutput(actors().worker, funded.opened.jobId, { kind: "repair", body: "shape" });
    const job = await ctx.journal.read(funded.opened.jobId);
    const request = {
      schemaVersion: "pilot.agent-economy.v2",
      operationId: job.captureOperationId,
      tenantId: job.quote.tenantId,
      actorId: job.quote.evaluatorId,
      authorityId: job.quote.settlementAuthorityId,
      quoteId: job.quote.quoteId,
      quoteDigest: job.quoteDigest,
      approvalDigest: "0".repeat(64),
      allocationId: job.quote.canonicalTaskId,
      asset: job.quote.asset,
      amount: job.quote.gross,
      feeAmount: job.quote.platformFee,
      feeRecipient: job.quote.feeRecipient,
      payoutDestination: job.quote.payoutDestination,
      fundingProofId: funded.proofId,
      escrowTarget: job.quote.fundingTarget,
    };
    const readback = await ctx.port.readback(request);
    assert.equal(readback.state, "authorized");
    assert.equal(readback.provenance, "fake");
    assert.equal(funded.opened.qualification, "pending-join");
    assert.equal(funded.opened.asset === undefined, true);
    assert.equal(job.quote.asset.symbol, "USDC");
    assert.equal(job.quote.asset.chain, "eip155:31337");
  } finally {
    await ctx.close();
  }
});

test("a clock expiry is unknown and a mined reclaim is the expiry winner", async () => {
  const ctx = await setupService();
  try {
    const clock = await fund(ctx);
    await ctx.service.deliverOutput(actors().worker, clock.opened.jobId, { kind: "repair", body: "clock" });
    await ctx.port.markClockExpired(clock.proofId);
    await assert.rejects(() => ctx.service.accept(actors().reviewer, clock.opened.jobId), (error) => error.code === "capture_evidence_unknown");
    const waiting = await ctx.journal.read(clock.opened.jobId);
    assert.equal(waiting.state, "output_ready");
    assert.equal(waiting.review, null);
    assert.equal((await ctx.port.load(clock.proofId)).invocations || 0, 0);

    const mined = await fund(ctx);
    await ctx.service.deliverOutput(actors().worker, mined.opened.jobId, { kind: "repair", body: "mined" });
    await ctx.port.expire(mined.proofId);
    const lost = await ctx.service.accept(actors().reviewer, mined.opened.jobId);
    assert.equal(lost.winner, "expiry");
    assert.equal(lost.state, "expired_reclaimed");
    assert.equal(lost.usefulWork, false);
    assert.equal((await ctx.port.load(mined.proofId)).invocations || 0, 0);
  } finally {
    await ctx.close();
  }
});

test("a leaked captured receipt without the consumer post stays an incident", async () => {
  const ctx = await setupService();
  try {
    const funded = await fund(ctx);
    await ctx.service.deliverOutput(actors().worker, funded.opened.jobId, { kind: "repair", body: "leak" });
    const real = ctx.port.readback.bind(ctx.port);
    ctx.port.readback = async (request) => {
      const outcome = await real(request);
      return {
        ...outcome,
        state: "captured",
        amount: request.amount,
        feeAmount: "9",
        feeRecipient: "0xabcabcabcabcabcabcabcabcabcabcabcabcabca",
        txRef: "fake:leak",
        finality: "final",
        finalityRef: "fake:leak-final",
        provenance: "fake",
      };
    };
    const bad = await ctx.service.accept(actors().reviewer, funded.opened.jobId);
    assert.equal(bad.state, "incident_unreviewed_capture");
    assert.equal(bad.incident.code, "capture_amount_fee_binding");
    assert.equal(bad.usefulWork, false);
    assert.equal(bad.acceptedSettled, false);
    assert.equal(bad.fundedAcceptance, false);
  } finally {
    await ctx.close();
  }
});

test("a port authority that is not the quote authority cannot fund the job", async () => {
  const ctx = await setupService({ authorityId: "other-auth" });
  try {
    const opened = await ctx.service.openJob(actors().requester, {
      ...parties,
      gross: "20",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const record = await ctx.journal.read(opened.jobId);
    await ctx.port.put({
      proofId: "proof-other-auth",
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
    await assert.rejects(
      () => ctx.service.observeFunding(actors().requester, opened.jobId, "proof-other-auth"),
      (error) => error instanceof BoundaryError && error.code === "funding_binding",
    );
    const job = await ctx.journal.read(opened.jobId);
    assert.equal(job.state, "quoted");
    assert.equal(job.funding, null);
  } finally {
    await ctx.close();
  }
});
