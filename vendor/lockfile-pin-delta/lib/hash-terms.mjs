import { createHash } from "node:crypto";

/**
 * Pin-triple hasher. I01 hashes whole earned-work terms; that document is
 * not this triple and must not be injected as pin equality.
 */
export const PIN_IDENTITY_FIELDS = Object.freeze(["name", "version", "integrity", "resolved"]);

export function canonicalPinTerms(triple = {}) {
  return {
    name: normalizeTerm(triple.name),
    version: normalizeTerm(triple.version),
    integrity: normalizeIntegrity(triple.integrity),
    resolved: normalizeTerm(triple.resolved),
  };
}

export function defaultHashPinTerms(triple) {
  return createHash("sha256").update(stableStringify(canonicalPinTerms(triple)), "utf8").digest("hex");
}

export function createHashTermsAdapter(hashPinTerms = defaultHashPinTerms) {
  if (typeof hashPinTerms !== "function") {
    throw new TypeError("hashPinTerms adapter must be a function");
  }
  return {
    hashPinTerms(triple) {
      return String(hashPinTerms(canonicalPinTerms(triple)));
    },
  };
}

export function pinFieldsEqual(before, after) {
  const a = canonicalPinTerms(before);
  const b = canonicalPinTerms(after);
  return PIN_IDENTITY_FIELDS.every((field) => a[field] === b[field]);
}

export function pinChangeKinds(before, after) {
  const a = canonicalPinTerms(before);
  const b = canonicalPinTerms(after);
  return PIN_IDENTITY_FIELDS.filter((field) => a[field] !== b[field]);
}

export function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function normalizeTerm(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function normalizeIntegrity(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}
