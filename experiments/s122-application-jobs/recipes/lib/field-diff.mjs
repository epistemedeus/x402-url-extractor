import { stableStringify } from "./hash.mjs";

const NULLABLE_FIELDS = new Set(["deprecated"]);

function hasValue(obj, field) {
  if (!obj || !Object.prototype.hasOwnProperty.call(obj, field)) return false;
  if (NULLABLE_FIELDS.has(field)) return true;
  return obj[field] != null;
}

export function diffFields(before, after, fields) {
  const changed = [];
  const unchanged = [];
  const missing = [];
  for (const field of fields) {
    const hasBefore = hasValue(before, field);
    const hasAfter = hasValue(after, field);
    const left = hasBefore ? before[field] : null;
    const right = hasAfter ? after[field] : null;
    if (!hasAfter) {
      missing.push({ field, before: left, after: right });
      continue;
    }
    if (stableStringify(left) === stableStringify(right)) {
      unchanged.push({ field, value: right });
    } else {
      changed.push({ field, before: left, after: right });
    }
  }
  return { changed, unchanged, missing };
}
