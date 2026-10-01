export class DeliveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeliveryError";
    this.code = code;
  }
}

export const MESSAGES = Object.freeze({
  invalid_snapshot: "snapshot is not a delivery-outcome document",
  restricted_fields: "restricted source fields were not projected",
  revenue_claim: "a source presented a settlement or a balance difference as recognized revenue",
  relabel_refused: "unknown settlement actors were not relabeled as independent customers",
  exit0_directive_refused: "a native CLI exit code was not counted as an install",
  http200_directive_refused: "HTTP 200 was not counted as a useful task result",
  synthetic_mixed_into_real: "a real snapshot cannot carry synthetic task events",
  source_digest_mismatch: "a pinned source digest does not match the bytes on disk",
  public_aggregate_rejected: "the public commerce-demand document is outside the read-only contract",
});

export function fail(code) {
  throw new DeliveryError(code, MESSAGES[code] || MESSAGES.invalid_snapshot);
}
