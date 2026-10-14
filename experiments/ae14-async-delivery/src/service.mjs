import { randomBytes } from "node:crypto";
import { assertPendingJoinPort } from "./adapter.mjs";
import { BoundaryError, id, refusal, requireThat, SHA256 } from "./boundary.mjs";
import { postCallback } from "./callback.mjs";
import { digest } from "./digest.mjs";
import { buildQuote, isLegacyTerms, legacyRefusal } from "./quote.mjs";
import { STAND_IN_LABEL } from "./stand-in-port.mjs";

const SCHEMA = "ae14.async-delivery.v1";

function nid(prefix) {
  return `${prefix}${randomBytes(16).toString("hex")}`;
}

function clone(value) {
  return structuredClone(value);
}

export function parityProjection(view) {
  return {
    qualification: view.qualification,
    canonicalJoin: view.canonicalJoin,
    acceptedSettled: view.acceptedSettled,
    paymentCompleted: view.paymentCompleted,
    fundedAcceptance: view.fundedAcceptance,
    winner: view.winner,
    state: view.state,
    gross: view.gross,
    platformFee: view.platformFee,
    contributorNet: view.contributorNet,
    railCost: view.railCost,
    resultKind: view.resultKind,
    usefulWork: view.usefulWork,
    usefulFailure: view.usefulFailure,
    reservedFunding: view.reservedFunding,
    capturePosted: view.capturePosted,
    captureState: view.captureState,
    incidentCode: view.incident?.code ?? null,
    ambiguousEffect: view.ambiguousEffect,
    secondCapturePost: view.secondCapturePost,
    payoutRequired: view.payoutRequired,
    withdrawalFee: view.withdrawalFee,
    directAuthority: view.directRoute?.authority ?? null,
    callbackAuthority: view.callback?.authority ?? null,
  };
}

export function present(job, extra = {}) {
  const review = job.review ?? null;
  const acceptedReview = review?.decision === "accept";
  const standingAcceptance = acceptedReview && job.state === "approval_pending";
  const kind = job.output?.kind ?? null;
  const incident = job.incident ?? null;
  return {
    ok: true,
    schemaVersion: SCHEMA,
    qualification: "pending-join",
    canonicalJoin: "pending-join",
    railQualification: job.railQualification,
    acceptedSettled: false,
    paymentCompleted: false,
    fundedAcceptance: false,
    winner: winnerOf(job),
    state: job.state,
    statusCode: extra.statusCode ?? statusFor(job.state),
    jobId: job.jobId,
    tenantId: job.tenantId,
    termsVersion: job.quote?.termsVersion ?? null,
    gross: job.quote?.gross ?? null,
    platformFee: job.quote?.platformFee ?? null,
    contributorNet: job.quote?.contributorNet ?? null,
    railCost: job.quote?.rail?.costCap ?? "0",
    feeRecipient: job.quote?.feeRecipient ?? null,
    resultKind: standingAcceptance ? kind : null,
    usefulWork: acceptedReview && job.state === "approval_pending" && job.capture?.state === "captured" && job.capture?.finality === "final" && job.capture?.bound === true && !incident,
    usefulFailure: job.state === "rejected" || job.state === "expired_reclaimed" || job.state === "incident_unreviewed_capture",
    reservedFunding: job.funding?.usable === true,
    fundingStage: job.funding?.stage ?? null,
    fundingState: job.funding?.state ?? null,
    reviewDecision: review?.decision ?? null,
    capturePosted: job.capturePosted === true,
    captureState: job.capture?.state ?? null,
    captureFinality: job.capture?.finality ?? null,
    incident,
    callback: {
      authority: false,
      attempts: job.callback?.attempts ?? 0,
      acked: job.callback?.acked === true,
      operationId: job.callback?.operationId ?? null,
    },
    directRoute: { authority: true, equipped: true },
    replayed: extra.replayed === true,
    ambiguousEffect: job.ambiguous === true,
    secondCapturePost: false,
    secondAcceptancePost: false,
    withdrawalFee: "0",
    secondFeeOnWithdrawal: false,
    payoutRequired: false,
    canonicalSettlement: null,
    artifactRetained: Boolean(job.output),
    rightsWithdrawn: job.rightsWithdrawn === true,
    earnedDebtErased: false,
    legacyRepriced: false,
    walletRequired: false,
    reclaim: job.state === "expired_reclaimed",
    refunded: job.state === "refunded",
    refundDistinctFromReclaim: job.state === "refunded",
    code: extra.code ?? null,
  };
}

function statusFor(state) {
  if (state === "approval_pending" || state === "funding_unusable") return 202;
  return 200;
}

function winnerOf(job) {
  if (job.state === "expired_reclaimed") return "expiry";
  if (job.state === "rejected") return "rejection";
  if (job.state === "refunded") return "refund";
  if (job.state === "incident_unreviewed_capture") return "incident";
  if (job.state === "approval_pending" && job.review?.decision === "accept" && job.capture?.state === "captured") return "acceptance";
  return null;
}

function approvalFor(job) {
  return {
    operationId: job.captureOperationId,
    reservationId: job.reservationId,
    verdictId: `ver${job.jobId}`,
    artifactDigestSha256: job.output.digest,
  };
}

function sameActor(actor, tenantId) {
  requireThat(actor && actor.tenantId === tenantId, "forbidden");
}

export class AsyncDeliveryService {
  constructor({ journal, port, now = () => new Date(), callbackCa = null, crashAfter = null }) {
    this.journal = journal;
    this.port = port;
    this.now = now;
    this.callbackCa = callbackCa;
    this.crashAfter = crashAfter;
    assertPendingJoinPort(port);
    this.railQualification = portLabel(port);
    if (typeof port.setApprove === "function") {
      port.setApprove((request) => this.approveCapture(request));
    }
  }

  async approveCapture(request) {
    const job = await this.journal.read(request.allocationId);
    requireThat(job?.review?.decision === "accept" && job.captureRequest, "review_authority_required");
    requireThat(digest(job.captureRequest) === digest(request), "review_authority_required");
  }

  async openJob(actor, input) {
    requireThat(actor?.role === "requester" && actor.actorId === input.requesterId, "forbidden");
    requireThat(actor.tenantId === input.tenantId, "forbidden");
    if (isLegacyTerms(input.termsVersion)) return legacyRefusal(input);
    const jobId = nid("j");
    const built = buildQuote({
      ...input,
      quoteId: nid("q"),
      taskId: nid("t"),
      canonicalTaskId: jobId,
    }, this.now());
    const job = {
      jobId,
      tenantId: built.quote.tenantId,
      quote: built.quote,
      quoteDigest: built.quoteDigest,
      state: "quoted",
      railQualification: this.railQualification,
      funding: null,
      output: null,
      review: null,
      approval: null,
      captureRequest: null,
      captureOperationId: `cap${jobId}`,
      reservationId: `res${jobId}`,
      capturePosted: false,
      capture: null,
      incident: null,
      ambiguous: false,
      callback: input.callbackUrl ? { url: String(input.callbackUrl), operationId: `cb${jobId}`, attempts: 0, acked: false, digest: null } : null,
      rightsWithdrawn: false,
      captureInvocationsSeen: 0,
    };
    await this.journal.insert(job);
    return present(job, { statusCode: 201 });
  }

  async observeFunding(actor, jobId, proofId) {
    id(proofId, "proof");
    const job = await this.must(actor, jobId, ["requester"]);
    requireThat(job.state === "quoted" || job.state === "funding_unusable" || job.state === "funded", "funding_closed");
    if (this.now().getTime() >= Date.parse(job.quote.expiresAt) && job.state !== "funded") {
      throw new BoundaryError("quote_expired");
    }
    const proof = await this.port.readProof(proofId);
    requireThat(proof, "proof_absent");
    const stage = await this.port.stage(proofId);
    this.bindProof(job, proof);
    const usable = stage === "confirmed_usable" && proof.state === "confirmed" && Boolean(proof.finalityRef) && proof.backing === "escrowed";
    const next = await this.journal.update(jobId, async (current, client) => {
      requireThat(current.state === "quoted" || current.state === "funding_unusable" || current.state === "funded", "funding_closed");
      if (usable) await this.journal.bindReceipt(client, proofId, jobId);
      return {
        ...current,
        state: usable ? "funded" : "funding_unusable",
        funding: { proofId, stage, state: proof.state, finalityRef: proof.finalityRef, usable },
      };
    });
    return present(next);
  }

  bindProof(job, proof) {
    requireThat(proof.schemaVersion === "pilot.agent-economy.v2", "funding_binding");
    requireThat(proof.backing === "escrowed", "funding_binding");
    requireThat(proof.tenantId === job.quote.tenantId, "funding_binding");
    requireThat(proof.allocationId === job.quote.canonicalTaskId, "funding_binding");
    requireThat(proof.quoteId === job.quote.quoteId, "funding_binding");
    requireThat(proof.quoteDigest === job.quoteDigest, "funding_binding");
    requireThat(proof.amount === job.quote.gross, "funding_binding");
    requireThat(proof.recipient === job.quote.fundingTarget, "funding_binding");
    requireThat(proof.requesterId === job.quote.requesterId, "funding_binding");
    requireThat(proof.fundingAuthorityId === job.quote.fundingAuthorityId, "funding_binding");
    if (this.port.authorityId) requireThat(proof.fundingAuthorityId === this.port.authorityId, "funding_binding");
    requireThat(digest(proof.asset) === digest(job.quote.asset), "funding_binding");
    requireThat(proof.state !== "confirmed" || Boolean(proof.finalityRef), "missing_finality");
  }

  async deliverOutput(actor, jobId, input) {
    const job = await this.must(actor, jobId, ["contributor"]);
    requireThat(actor.actorId === job.quote.contributorId, "forbidden");
    requireThat(job.funding?.usable === true, "funding_not_usable");
    requireThat(input && (input.kind === "repair" || input.kind === "no_fit"), "output_kind");
    requireThat(typeof input.body === "string" && input.body.length > 0 && input.body.length <= 4000, "output_body");
    const bodyDigest = digest({ kind: input.kind, body: input.body });
    if (input.digest) requireThat(input.digest === bodyDigest, "output_digest");
    const next = await this.journal.update(jobId, async (current) => {
      requireThat(current.funding?.usable === true, "funding_not_usable");
      if (current.output) {
        requireThat(current.output.digest === bodyDigest, "output_conflict");
        return current;
      }
      requireThat(current.state === "funded", "output_closed");
      return {
        ...current,
        state: "output_ready",
        output: { kind: input.kind, body: input.body, digest: bodyDigest, annotationIgnored: input.assent === true },
      };
    });
    if (next.output && job.output) return present(next, { replayed: true, statusCode: 200 });
    const notified = await this.notify(next);
    return present(notified, { statusCode: 200 });
  }

  async accept(actor, jobId, input = {}) {
    const job = await this.must(actor, jobId, ["evaluator"]);
    requireThat(actor.actorId === job.quote.evaluatorId, "forbidden");
    requireThat(job.output, "output_absent");
    if (input.artifactDigest) requireThat(input.artifactDigest === job.output.digest, "artifact_digest");
    if (job.state === "rejected" || job.state === "expired_reclaimed" || job.state === "refunded" || job.state === "incident_unreviewed_capture") {
      return present(job, { replayed: true });
    }
    if (!job.review && !job.capturePosted) {
      const preview = await this.safeReadback(captureRequest(job, approvalFor(job)));
      if (preview.state === "expired_reclaimed") {
        const expired = await this.journal.update(jobId, async (current) => {
          if (current.review || current.capturePosted || current.capture?.state === "captured" || current.incident) return current;
          return {
            ...current,
            state: "expired_reclaimed",
            capture: publicCapture(preview, true),
            ambiguous: false,
            incident: null,
          };
        });
        if (expired.state === "expired_reclaimed" && !expired.review) return present(expired);
      }
      if (preview.state === "unknown") throw new BoundaryError("capture_evidence_unknown");
    }
    if (!job.review) {
      await this.journal.update(jobId, async (current) => {
        requireThat(current.output, "output_absent");
        requireThat(!current.review, "approval_conflict");
        if (current.state === "expired_reclaimed" || current.capture?.state === "captured") return current;
        const approval = approvalFor(current);
        const request = captureRequest(current, approval);
        return {
          ...current,
          state: "approval_pending",
          review: { decision: "accept", actorId: actor.actorId, at: this.now().toISOString(), resultKind: current.output.kind },
          approval,
          captureRequest: request,
        };
      });
    }
    const committed = await this.journal.read(jobId);
    if (committed.state === "expired_reclaimed" && committed.capture?.state !== "captured") return present(committed);
    await this.advance(jobId, { allowCapture: true });
    const after = await this.journal.read(jobId);
    return present(after, { replayed: Boolean(job.review) });
  }

  async reject(actor, jobId, input = {}) {
    const job = await this.must(actor, jobId, ["evaluator"]);
    requireThat(actor.actorId === job.quote.evaluatorId, "forbidden");
    requireThat(job.output, "output_absent");
    if (input.artifactDigest) requireThat(input.artifactDigest === job.output.digest, "artifact_digest");
    if (job.review?.decision === "reject") return present(job, { replayed: true });
    requireThat(!job.capturePosted && !job.review, "capture_already_posted");
    const probed = await this.probe(job);
    if (probed.state === "incident_unreviewed_capture") return present(probed);
    const next = await this.journal.update(jobId, async (current) => {
      requireThat(!current.capturePosted && !current.review, "capture_already_posted");
      requireThat(current.state === "output_ready" || current.state === "funded", "reject_closed");
      return {
        ...current,
        state: "rejected",
        review: { decision: "reject", actorId: actor.actorId, at: this.now().toISOString(), reason: input.reason || "rejected" },
      };
    });
    return present(next);
  }

  async observe(actor, jobId) {
    const job = await this.must(actor, jobId, ["requester", "evaluator", "contributor", "later-consumer"]);
    if (job.review?.decision === "accept") {
      await this.advance(jobId, { allowCapture: false });
    } else if (job.output && job.funding?.usable) {
      await this.probe(job);
    }
    return present(await this.journal.read(jobId), { replayed: true });
  }

  async reuse(actor, jobId) {
    const job = await this.must(actor, jobId, ["requester", "evaluator", "later-consumer"]);
    requireThat(job.rightsWithdrawn !== true, "rights_withdrawn");
    requireThat(job.review?.decision === "accept" && job.output, "reuse_not_granted");
    requireThat(job.state === "approval_pending" && job.capture?.state === "captured" && job.capture?.finality === "final" && job.capture?.bound === true && !job.incident, "reuse_not_granted");
    return {
      ...present(job),
      statusCode: 200,
      reused: true,
      newPayment: false,
      paidTaskCountDelta: 0,
      artifact: { kind: job.output.kind, digest: job.output.digest, body: job.output.body },
    };
  }

  async withdrawRights(actor, jobId) {
    const job = await this.must(actor, jobId, ["requester"]);
    requireThat(actor.actorId === job.quote.requesterId, "forbidden");
    const next = await this.journal.update(jobId, async (current) => ({ ...current, rightsWithdrawn: true }));
    return present(next);
  }

  async proposal(actor, jobId) {
    const view = await this.observe(actor, jobId);
    return { ...view, payoutRequired: false, withdrawalFee: "0", operation: null, secondFeeOnWithdrawal: false };
  }

  async resumeCallbacks() {
    const jobs = await this.journal.unackedCallbacks();
    for (const job of jobs) await this.notify(job);
  }

  async notify(job) {
    if (!job.callback || job.callback.acked === true || !job.output) return job;
    const body = JSON.stringify({
      schemaVersion: "ae14.async-delivery.callback.v1",
      jobId: job.jobId,
      outputDigest: job.output.digest,
      state: "output_ready",
      acceptance: false,
      captured: false,
      usefulWork: false,
      authority: "notification-only",
      operationId: job.callback.operationId,
    });
    const result = await postCallback({ url: job.callback.url, ca: this.callbackCa, body });
    return this.journal.update(job.jobId, async (current) => {
      if (!current.callback || current.callback.acked === true) return current;
      return {
        ...current,
        callback: {
          ...current.callback,
          attempts: (current.callback.attempts || 0) + 1,
          acked: result.acked === true,
          digest: digest(body),
          lastReason: result.acked ? null : (result.reason || "callback_not_acked"),
        },
      };
    });
  }

  async probe(job) {
    if (!job.funding?.usable || job.review) return job;
    const approval = {
      operationId: job.captureOperationId,
      reservationId: job.reservationId,
      verdictId: `probe${job.jobId}`,
      artifactDigestSha256: job.output?.digest || "0".repeat(64),
    };
    const request = captureRequest(job, approval);
    let outcome;
    try {
      outcome = await this.port.readback(request);
    } catch {
      return job;
    }
    if (outcome?.state !== "captured") return job;
    return this.journal.update(job.jobId, async (current) => {
      if (current.review || current.capturePosted) return current;
      return {
        ...current,
        state: "incident_unreviewed_capture",
        incident: { code: "rail_receipt_without_review", captureState: outcome.state },
        capture: { state: outcome.state, provenance: outcome.provenance, qualified: false },
      };
    });
  }

  async advance(jobId, { allowCapture }) {
    const job = await this.journal.read(jobId);
    requireThat(job?.review?.decision === "accept" && job.captureRequest, "review_authority_required");
    if (["expired_reclaimed", "refunded", "incident_unreviewed_capture"].includes(job.state) && job.capture) return job;
    let outcome = await this.safeReadback(job.captureRequest);
    if (outcome.state === "captured" && !captureAgrees(job, outcome)) {
      return this.journal.update(jobId, async (current) => ({
        ...current,
        state: "incident_unreviewed_capture",
        incident: { code: "capture_amount_fee_binding" },
        capture: publicCapture(outcome, false),
        ambiguous: false,
      }));
    }
    if (outcome.state === "captured" && job.capturePosted !== true) {
      return this.journal.update(jobId, async (current) => ({
        ...current,
        state: "incident_unreviewed_capture",
        incident: { code: "rail_receipt_without_authorized_capture_post", captureState: "captured" },
        capture: publicCapture(outcome, false),
        ambiguous: false,
      }));
    }
    if (outcome.state === "authorized" && allowCapture && job.capturePosted !== true) {
      const armed = await this.journal.update(jobId, async (current) => {
        requireThat(current.capturePosted !== true, "capture_already_posted");
        return { ...current, capturePosted: true, state: "approval_pending" };
      });
      if (this.crashAfter === "capture-commit") process.exit(97);
      try {
        outcome = normalize(await this.port.capture(armed.captureRequest), armed.captureRequest);
      } catch {
        return this.journal.update(jobId, async (current) => ({ ...current, ambiguous: true, capture: null, state: "approval_pending" }));
      }
    } else if (outcome.state === "authorized" && job.capturePosted === true) {
      return this.journal.update(jobId, async (current) => ({ ...current, ambiguous: true, state: "approval_pending" }));
    }
    return this.journal.update(jobId, async (current) => applyOutcome(current, outcome));
  }

  async safeReadback(request) {
    try {
      return normalize(await this.port.readback(request), request);
    } catch {
      return { schemaVersion: "pilot.agent-economy.v2", state: "unknown", provenance: "unknown", requestDigest: digest(request) };
    }
  }

  async must(actor, jobId, roles) {
    id(jobId, "job");
    const job = await this.journal.read(jobId);
    requireThat(job, "job_absent");
    sameActor(actor, job.tenantId);
    requireThat(roles.includes(actor.role), "forbidden");
    if (actor.role === "requester") requireThat(actor.actorId === job.quote.requesterId, "forbidden");
    if (actor.role === "evaluator") requireThat(actor.actorId === job.quote.evaluatorId, "forbidden");
    if (actor.role === "contributor") requireThat(actor.actorId === job.quote.contributorId, "forbidden");
    return job;
  }
}

function portLabel(port) {
  if (port && port.constructor?.name === "StandInPort") return STAND_IN_LABEL;
  return "pending-join";
}

function captureRequest(job, approval) {
  const quote = job.quote;
  return {
    schemaVersion: "pilot.agent-economy.v2",
    operationId: job.captureOperationId,
    tenantId: quote.tenantId,
    actorId: quote.evaluatorId,
    authorityId: quote.settlementAuthorityId,
    quoteId: quote.quoteId,
    quoteDigest: job.quoteDigest,
    approvalDigest: digest(approval),
    allocationId: quote.canonicalTaskId,
    asset: quote.asset,
    amount: quote.gross,
    feeAmount: quote.platformFee,
    feeRecipient: quote.feeRecipient,
    payoutDestination: quote.payoutDestination,
    fundingProofId: job.funding.proofId,
    escrowTarget: quote.fundingTarget,
  };
}

function normalize(outcome, request) {
  if (!outcome || outcome.requestDigest !== digest(request)) {
    return { schemaVersion: "pilot.agent-economy.v2", state: "unknown", provenance: outcome?.provenance || "unknown", requestDigest: digest(request) };
  }
  if (outcome.provenance === "production") {
    return { schemaVersion: "pilot.agent-economy.v2", state: "unknown", provenance: "unknown", requestDigest: digest(request) };
  }
  return outcome;
}

function captureAgrees(job, outcome) {
  if (outcome.state !== "captured") return true;
  return outcome.amount === job.quote.gross
    && outcome.feeAmount === job.quote.platformFee
    && outcome.feeRecipient === job.quote.feeRecipient;
}

function publicCapture(outcome, bound) {
  return {
    state: outcome.state,
    finality: outcome.finality ?? null,
    provenance: outcome.provenance,
    qualified: false,
    bound,
  };
}

function applyOutcome(current, outcome) {
  if (outcome.state === "expired_reclaimed") {
    if (current.incident || current.capture?.state === "captured") return current;
    return { ...current, state: "expired_reclaimed", capture: publicCapture(outcome, true), ambiguous: false, incident: null };
  }
  if (outcome.state === "refunded") {
    return {
      ...current,
      state: "refunded",
      capture: publicCapture(outcome, true),
      ambiguous: false,
      incident: current.incident,
      refundDistinctFromReclaim: true,
    };
  }
  if (outcome.state === "captured") {
    if (!captureAgrees(current, outcome)) {
      return {
        ...current,
        state: "incident_unreviewed_capture",
        incident: { code: "capture_amount_fee_binding" },
        capture: publicCapture(outcome, false),
        ambiguous: false,
      };
    }
    return {
      ...current,
      state: "approval_pending",
      capture: publicCapture(outcome, true),
      ambiguous: outcome.finality !== "final",
      incident: null,
    };
  }
  if (outcome.state === "unknown") {
    return { ...current, state: "approval_pending", ambiguous: true, capture: publicCapture(outcome, false) };
  }
  return { ...current, state: "approval_pending", ambiguous: current.capturePosted === true && outcome.state === "authorized" };
}

export function caught(error) {
  if (error instanceof BoundaryError) return refusal(error.code);
  throw error;
}

export { clone, SHA256 };
