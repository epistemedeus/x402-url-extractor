export const OUTCOMES = Object.freeze({
  UNPAID_CALL_IS_ERROR: "unpaid_call_is_error",
  REJECTED: "rejected",
});

export const REJECTION_KINDS = Object.freeze({
  IS_ERROR_NOT_TRUE: "is_error_not_true",
  IS_ERROR_NOT_PRESERVED: "is_error_not_preserved",
  PROTOCOL_ERROR: "protocol_error",
  MISSING_PAYMENT_REQUIRED: "missing_payment_required",
  EMPTY_ACCEPTS: "empty_accepts",
  PAYMENT_ATTACHED: "payment_attached",
  SETTLEMENT_EVIDENCE: "settlement_evidence",
  INVALID_SHAPE: "invalid_shape",
  FORBIDDEN_FLAG: "forbidden_flag",
  FORBIDDEN_URL: "forbidden_url",
  FORBIDDEN_META: "forbidden_meta",
});

export const FORBIDDEN_FLAGS = Object.freeze([
  "--live",
  "--pay",
  "--approve",
  "--payment",
  "--neo",
  "--publish",
  "--private-key",
  "--private-key-env",
  "--wallet",
]);

export const PAYMENT_META_KEYS = Object.freeze([
  "x402/payment",
  "x402/payment-response",
]);

export const BOUNDARY = Object.freeze({
  paid: false,
  charged: false,
  liveMerchantCall: false,
  autoPay: false,
  statement:
    "An unpaid OpenAI Agents MCP tools/call is a JSON-RPC result with isError:true and PaymentRequired structuredContent. That is not paid_success, not a protocol error, and not authorization to sign, retry with payment, or call a live merchant.",
});
