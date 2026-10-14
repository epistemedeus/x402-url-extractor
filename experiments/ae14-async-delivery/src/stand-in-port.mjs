import { requireThat } from "./boundary.mjs";
import { COMMERCE_PIN } from "./adapter.mjs";
import { digest } from "./digest.mjs";

/**
 * Disposable stand-in for CommercePaymentsRail's readProof/stage/readback/capture
 * at pilot af5773e1. Provenance is always fake. This is not the selected rail,
 * not a local-chain qualification, and not an amended A/B export.
 */
export const STAND_IN_LABEL = "stand-in-not-rail";

export class StandInPort {
  constructor(pool, { authorityId = null } = {}) {
    this.pool = pool;
    this.authorityId = authorityId;
    this.approve = null;
    this.qualification = STAND_IN_LABEL;
    this.protocol = COMMERCE_PIN;
  }

  setApprove(approve) {
    this.approve = approve;
  }

  async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ae14_async_standin (
        proof_id text PRIMARY KEY,
        record jsonb NOT NULL
      )
    `);
  }

  async put(record) {
    requireThat(record && record.proofId && record.qualification === STAND_IN_LABEL, "stand_in_label");
    requireThat(record.provenance === "fake", "stand_in_provenance");
    await this.pool.query(
      `INSERT INTO ae14_async_standin (proof_id, record) VALUES ($1, $2::jsonb)
       ON CONFLICT (proof_id) DO UPDATE SET record = EXCLUDED.record`,
      [record.proofId, JSON.stringify(record)],
    );
  }

  async load(proofId) {
    const { rows } = await this.pool.query(`SELECT record FROM ae14_async_standin WHERE proof_id = $1`, [proofId]);
    return rows[0]?.record ?? null;
  }

  async save(record) {
    await this.pool.query(`UPDATE ae14_async_standin SET record = $2::jsonb WHERE proof_id = $1`, [record.proofId, JSON.stringify(record)]);
  }

  async stage(proofId) {
    const row = await this.load(proofId);
    requireThat(row, "funding_absent");
    return row.stage;
  }

  async readProof(proofId) {
    const row = await this.load(proofId);
    if (!row) return null;
    let state = "pending";
    let finalityRef = null;
    if (row.stage === "signature" || row.stage === "submitted") {
      state = "pending";
    } else if (row.stage === "confirmed_usable") {
      state = "confirmed";
      finalityRef = row.finalityRef;
    } else if (row.stage === "quarantined") {
      state = "unknown";
    } else if (row.stage === "closed") {
      state = "failed";
    }
    return {
      schemaVersion: "pilot.agent-economy.v2",
      proofId: row.proofId,
      tenantId: row.tenantId,
      allocationId: row.allocationId,
      quoteId: row.quoteId,
      taskId: row.taskId,
      requesterId: row.requesterId,
      fundingAuthorityId: row.fundingAuthorityId,
      asset: row.asset,
      recipient: row.recipient,
      amount: row.amount,
      state,
      finalityRef,
      backing: "escrowed",
      quoteDigest: row.quoteDigest,
    };
  }

  common(request) {
    return {
      schemaVersion: "pilot.agent-economy.v2",
      requestDigest: digest(request),
      provenance: "fake",
    };
  }

  outcomeFor(row, request) {
    const common = this.common(request);
    // A amend f89939a0: an unjournaled operator capture is not a captured receipt.
    // The rail readback is unknown. A clock expiry that is not a mined reclaim is also unknown.
    if (row.operatorCaptured === true || row.effect === "clock_expired") {
      return { ...common, state: "unknown" };
    }
    if (row.effect === "refunded") {
      return { ...common, state: "refunded", txRef: `fake:refunded:${request.allocationId}` };
    }
    if (row.effect === "expired_reclaimed") {
      return { ...common, state: "expired_reclaimed", txRef: `fake:expired:${request.allocationId}` };
    }
    if (row.effect === "captured") {
      return {
        ...common,
        state: "captured",
        amount: request.amount,
        feeAmount: request.feeAmount,
        feeRecipient: request.feeRecipient,
        txRef: `fake:capture:${request.allocationId}`,
        finality: row.finality === "pending" ? "pending" : "final",
        finalityRef: row.finality === "pending" ? null : "fake:final-block",
      };
    }
    if (row.stage !== "confirmed_usable") {
      return { ...common, state: "unknown" };
    }
    return {
      ...common,
      state: "authorized",
      backing: "escrowed",
      authorizationRef: row.proofId,
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
  }

  async readback(request) {
    const row = await this.load(request.fundingProofId);
    requireThat(row, "funding_absent");
    return this.outcomeFor(row, request);
  }

  async captureOutcome(request) {
    return this.readback(request);
  }

  async expire(proofId) {
    const row = await this.load(proofId);
    requireThat(row, "funding_absent");
    if (row.effect === "captured") return row;
    row.effect = "expired_reclaimed";
    await this.save(row);
    return row;
  }

  /** Expiry timestamp alone. Not a mined void/reclaim, so readback stays unknown. */
  async markClockExpired(proofId) {
    const row = await this.load(proofId);
    requireThat(row, "funding_absent");
    if (row.effect === "captured" || row.effect === "expired_reclaimed") return row;
    row.effect = "clock_expired";
    await this.save(row);
    return row;
  }

  async refund(proofId) {
    const row = await this.load(proofId);
    requireThat(row, "funding_absent");
    requireThat(row.effect === "captured", "refund_requires_capture");
    row.effect = "refunded";
    await this.save(row);
    return row;
  }

  async capture(request) {
    if (this.approve) await this.approve(request);
    const row = await this.load(request.fundingProofId);
    requireThat(row, "funding_absent");
    const before = this.outcomeFor(row, request);
    if (before.state !== "authorized") return before;
    row.invocations = (row.invocations || 0) + 1;
    row.lastFeeAmount = request.feeAmount;
    row.lastFeeRecipient = request.feeRecipient;
    if (row.lose === "before") {
      await this.save(row);
      throw new Error("capture_response_lost");
    }
    row.effect = "captured";
    row.lose = row.lose === "after" ? "after" : null;
    await this.save(row);
    if (row.lose === "after") throw new Error("capture_response_lost");
    return this.outcomeFor(row, request);
  }
}
