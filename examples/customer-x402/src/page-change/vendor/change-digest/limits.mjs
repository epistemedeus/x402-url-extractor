export const SCHEMA = "pilot/change-digest/v1";
export const SNAPSHOT_SCHEMA = "pilot/change-digest-snapshot/v1";
export const ECONOMICS_SCHEMA = "pilot/change-digest-economics/v1";

export const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 65_536,
  maxJsonDepth: 12,
  maxJsonNodes: 2_048,
  maxHtmlTokens: 2_048,
  maxSequenceLength: 512,
  maxChanges: 64,
  maxExcerptBytes: 200,
  maxStaleMs: null,
});

export function finiteNonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative integer`);
  }
  return value;
}

export function finiteNonNegativeNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number`);
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
    if (value < 1 && key !== "maxStaleMs") {
      throw new Error(`${key} must be at least 1`);
    }
    next[key] = value;
  }
  return Object.freeze(next);
}

export function excerpt(value, maxExcerptBytes) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return null;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxExcerptBytes) return text;
  let cut = maxExcerptBytes;
  while (cut > 0 && (text.charCodeAt(cut) & 0xc0) === 0x80) cut -= 1;
  return `${Buffer.from(text, "utf8").subarray(0, cut).toString("utf8")}…`;
}

export function jsonPointer(path) {
  if (!path.length) return "";
  return `/${path.map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}
