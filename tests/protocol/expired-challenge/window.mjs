/** x402 v2 exact/EIP-3009 validity window. Merchant exact accepts cap at 300s. */
export const MAX_TIMEOUT_SECONDS = 300;

export const INVALID_EXPIRED = "invalid_exact_evm_payload_authorization_valid_before";
export const INVALID_NOT_YET = "invalid_exact_evm_payload_authorization_valid_after";
export const INVALID_UNBOUNDED = "invalid_exact_evm_payload_authorization_valid_before";

export function unixSeconds(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return Number.NaN;
}

export function isBoundedTimeout(maxTimeoutSeconds, max = MAX_TIMEOUT_SECONDS) {
  const n = unixSeconds(maxTimeoutSeconds);
  return Number.isSafeInteger(n) && n >= 1 && n <= max;
}

/**
 * Classify an EIP-3009 authorization against an observation time.
 * `now >= validBefore` is expired. Remaining window above maxTimeoutSeconds is unbounded.
 */
export function classifyWindow({
  validAfter = "0",
  validBefore,
  observedAtSec,
  maxTimeoutSeconds = MAX_TIMEOUT_SECONDS,
} = {}) {
  const after = unixSeconds(validAfter);
  const before = unixSeconds(validBefore);
  const now = unixSeconds(observedAtSec);
  const timeout = unixSeconds(maxTimeoutSeconds);

  if (!Number.isFinite(before) || !Number.isFinite(now)) {
    return {
      status: "unknown",
      expired: null,
      notYetValid: null,
      unbounded: null,
      remainingSeconds: null,
      invalidReason: null,
    };
  }
  if (Number.isFinite(after) && after >= before) {
    return {
      status: "invalid_window",
      expired: true,
      notYetValid: false,
      unbounded: false,
      remainingSeconds: 0,
      invalidReason: INVALID_EXPIRED,
    };
  }
  if (Number.isFinite(after) && now < after) {
    return {
      status: "not_yet_valid",
      expired: false,
      notYetValid: true,
      unbounded: false,
      remainingSeconds: before - now,
      invalidReason: INVALID_NOT_YET,
    };
  }
  if (now >= before) {
    return {
      status: "expired",
      expired: true,
      notYetValid: false,
      unbounded: false,
      remainingSeconds: 0,
      invalidReason: INVALID_EXPIRED,
    };
  }
  const remaining = before - now;
  const unbounded = Number.isSafeInteger(timeout) && timeout > 0 && remaining > timeout;
  if (unbounded) {
    return {
      status: "unbounded",
      expired: false,
      notYetValid: false,
      unbounded: true,
      remainingSeconds: remaining,
      invalidReason: INVALID_UNBOUNDED,
    };
  }
  return {
    status: "within_window",
    expired: false,
    notYetValid: false,
    unbounded: false,
    remainingSeconds: remaining,
    invalidReason: null,
  };
}

export function facilitatorVerifyFromWindow(window, payer) {
  if (!window || window.status === "unknown") {
    return { isValid: false, invalidReason: "invalid_payload", payer };
  }
  if (window.status === "within_window") {
    return { isValid: true, payer };
  }
  return {
    isValid: false,
    invalidReason: window.invalidReason,
    invalidMessage: window.status === "expired" || window.status === "invalid_window"
      ? "expired"
      : window.status === "not_yet_valid"
        ? "not valid yet"
        : "validity exceeds maxTimeoutSeconds",
    payer,
  };
}
