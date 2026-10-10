export const MAX_SAFE_INTEGER_TEXT = "9007199254740991";

function exceedsSafeInteger(text) {
  if (text.length !== MAX_SAFE_INTEGER_TEXT.length) return text.length > MAX_SAFE_INTEGER_TEXT.length;
  return text > MAX_SAFE_INTEGER_TEXT;
}

export function parseCount(value) {
  if (value === undefined || value === null) return { state: "unknown", value: null, reason: "absent" };
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      return { state: "invalid", value: null, reason: "unsafe-or-negative" };
    }
    return { state: "measured", value, reason: null };
  }
  if (typeof value === "string") {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
      return { state: "invalid", value: null, reason: "not-canonical-integer" };
    }
    if (exceedsSafeInteger(value)) return { state: "invalid", value: null, reason: "overflow" };
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber) || String(asNumber) !== value) {
      return { state: "invalid", value: null, reason: "inexact" };
    }
    return { state: "measured", value: asNumber, reason: null };
  }
  return { state: "invalid", value: null, reason: "unsupported-type" };
}

export function parseAtomicAmount(value) {
  if (typeof value === "string") {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) return { state: "invalid", value: null };
    return { state: "exact", value };
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return { state: "invalid", value: null };
    return { state: "exact", value: String(value) };
  }
  return { state: "invalid", value: null };
}
