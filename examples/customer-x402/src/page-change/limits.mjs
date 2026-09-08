import { DEFAULT_LIMITS } from "./constants.mjs";

export function finiteNonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative integer`);
  }
  return value;
}

export function normalizeLimits(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("limits must be a plain object");
  }
  const next = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    if (input[key] === undefined || input[key] === null) continue;
    if (key === "maxStaleMs") {
      next.maxStaleMs = finiteNonNegativeInteger(input[key], key);
      continue;
    }
    const value = finiteNonNegativeInteger(input[key], key);
    if (value < 1) throw new Error(`${key} must be at least 1`);
    next[key] = value;
  }
  return Object.freeze(next);
}

export function c2LimitSlice(limits) {
  return {
    maxBytes: limits.maxBytes,
    maxJsonDepth: limits.maxJsonDepth,
    maxJsonNodes: limits.maxJsonNodes,
    maxHtmlTokens: limits.maxHtmlTokens,
    maxSequenceLength: limits.maxSequenceLength,
    maxChanges: limits.maxChanges,
    maxExcerptBytes: limits.maxExcerptBytes,
    maxStaleMs: limits.maxStaleMs,
  };
}

export function excerpt(value, maxExcerptBytes) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return null;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxExcerptBytes) return text;
  const buffer = Buffer.from(text, "utf8");
  let cut = maxExcerptBytes;
  while (cut > 0 && (buffer[cut] & 0xc0) === 0x80) cut -= 1;
  return `${buffer.subarray(0, cut).toString("utf8")}…`;
}
