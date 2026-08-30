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
      qualifiesOn: { type: "string", const: "two_distinct_seller_signed_settlement_receipts" },
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
    qualifiesOn: "two_distinct_seller_signed_settlement_receipts",
    broadcastRequired: false,
    attributionOnly: true,
    instructions: `Result ${decision}. Hash the complete seller-signed x402 receipt with RFC 8785 JSON plus SHA-256 and prefix r1_. Sharing or broadcasting the ID is optional. One free recheck can be claimed at POST /commerce/referral-recheck with that receipt and a downstream seller-signed settlement receipt from a distinct payer and transaction. The official extension issues a receipt when settlement succeeds; receipts do not prove an application HTTP 200 response, output delivery, or buyer-owned output validity. The paid call's price, authorization, and delivery never change.`,
  };
}
