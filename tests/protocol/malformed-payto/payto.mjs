/** x402 v2 exact accept payTo is a 0x-prefixed 40-hex EVM address. */

export const EVM_PAYTO = /^0x[0-9a-fA-F]{40}$/;

export const INVALID_PAYTO = "invalid_pay_to";
export const INVALID_PAYTO_MISMATCH = "invalid_pay_to_mismatch";

function result(status, extra = {}) {
  return {
    status,
    wellFormed: false,
    reason: status,
    address: null,
    ...extra,
  };
}

/**
 * Classify a quoted accept payTo or EIP-3009 authorization.to.
 * Well-formed means 0x + exactly 40 hex digits. Checksum is not required.
 */
export function classifyPayTo(value) {
  if (value === undefined) return result("missing");
  if (value === null) return result("null");
  if (typeof value !== "string") return result("not_string");
  if (value.length === 0) return result("empty");
  if (/\s/.test(value)) return result("whitespace");
  const lower = value.toLowerCase();
  if (lower.startsWith("payto:")) return result("payto_uri");
  if (lower.startsWith("http:") || lower.startsWith("https:")) return result("url");
  if (EVM_PAYTO.test(value)) {
    return {
      status: "well_formed",
      wellFormed: true,
      reason: null,
      address: value.toLowerCase(),
    };
  }
  if (/^0x/i.test(value)) {
    const hex = value.slice(2);
    if (!/^[0-9a-fA-F]*$/.test(hex)) return result("non_hex");
    return result("wrong_length", { length: hex.length });
  }
  if (value.includes(".")) return result("ens");
  return result("no_prefix");
}

export function isWellFormedPayTo(value) {
  return classifyPayTo(value).wellFormed === true;
}

export function canonicalPayTo(value) {
  const classified = classifyPayTo(value);
  return classified.wellFormed ? classified.address : null;
}

export function samePayTo(left, right) {
  const a = canonicalPayTo(left);
  const b = canonicalPayTo(right);
  return Boolean(a && b && a === b);
}

export function facilitatorVerifyFromPayTo({ quoted, authorizationTo, payer } = {}) {
  const quotedClass = classifyPayTo(quoted);
  const toClass = classifyPayTo(authorizationTo);
  if (!quotedClass.wellFormed || !toClass.wellFormed) {
    return {
      isValid: false,
      invalidReason: INVALID_PAYTO,
      invalidMessage: "payTo must be a 0x-prefixed 40-hex EVM address",
      payer,
    };
  }
  if (quotedClass.address !== toClass.address) {
    return {
      isValid: false,
      invalidReason: INVALID_PAYTO_MISMATCH,
      invalidMessage: "authorization.to does not match quoted payTo",
      payer,
    };
  }
  return { isValid: true, payer };
}
