const RECEIPT_REFERRAL_PATTERN = /^r1_[0-9a-f]{64}$/;

export function normalizeReceiptReferralId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !RECEIPT_REFERRAL_PATTERN.test(value)) {
    throw new Error("referral must be r1_ followed by the lowercase SHA-256 hex digest of one complete signed x402 offer-receipt envelope");
  }
  return value;
}

export function isReceiptReferralId(value) {
  return typeof value === "string" && RECEIPT_REFERRAL_PATTERN.test(value);
}

export function receiptReferralOfferSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      v: { type: "string", const: "1" },
      status: { type: "string", enum: ["available", "declared"] },
      id: { type: ["string", "null"], pattern: "^r1_[0-9a-f]{64}$" },
      proof: { type: "string", const: "x402-offer-receipt-jcs-sha256-v1" },
      reward: { type: "string", const: "one_free_changed_state_recheck" },
      qualifiesOn: { type: "string", const: "distinct_payer_settlement_plus_buyer_valid_delivery" },
      broadcastRequired: { type: "boolean", const: false },
      attributionOnly: { type: "boolean", const: true },
      instructions: { type: "string" },
    },
    required: ["v", "status", "id", "proof", "reward", "qualifiesOn", "broadcastRequired", "attributionOnly", "instructions"],
  };
}

export function createReceiptReferralOffer({ referralId = null, decision = "repair_required" } = {}) {
  const normalized = normalizeReceiptReferralId(referralId);
  return {
    v: "1",
    status: normalized ? "declared" : "available",
    id: normalized,
    proof: "x402-offer-receipt-jcs-sha256-v1",
    reward: "one_free_changed_state_recheck",
    qualifiesOn: "distinct_payer_settlement_plus_buyer_valid_delivery",
    broadcastRequired: false,
    attributionOnly: true,
    instructions: `Result ${decision}. Hash the complete seller-signed x402 receipt with RFC 8785 JSON plus SHA-256, prefix r1_, and share it as referral. The ID is declared, not verified; reward requires the full signed receipt, a distinct payer, and buyer-valid delivery. Price, authorization, and delivery never change.`,
  };
}
