// The admitted domain is finite JSON numbers whose exact decimal value equals
// Number's canonical decimal serialization. Equivalent spellings and +/-0 are
// accepted. Compare decimal coefficients/exponents, never two parsed Numbers.
export function decimalIdentity(token) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) throw new Error("invalid JSON number");
  let digits = (match[2] + (match[3] || "")).replace(/^0+/, "");
  if (!digits) return "0";
  let exponent = BigInt(match[4] || "0") - BigInt((match[3] || "").length);
  const zeros = /0+$/.exec(digits)?.[0].length || 0;
  if (zeros) { digits = digits.slice(0, -zeros); exponent += BigInt(zeros); }
  return `${match[1]}${digits}e${exponent}`;
}
export function parseLosslessNumericJson(raw) {
  const parsed = JSON.parse(raw);
  // JSON syntax is already checked. Strings are consumed whole, including escapes.
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  for (const match of raw.matchAll(tokens)) {
    if (!match[1]) continue;
    const number = Number(match[1]);
    if (!Number.isFinite(number) || decimalIdentity(match[1]) !== decimalIdentity(String(number))) {
      throw new Error("number outside lossless canonical-decimal domain");
    }
  }
  return parsed;
}
