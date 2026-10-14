import { createHash } from "node:crypto";

/** Same canonical digest as pilot agent-economy-foundation operations.ts at af5773e1. */
export function digest(value) {
  function sort(v) {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    }
    return v;
  }
  return createHash("sha256").update(JSON.stringify(sort(value))).digest("hex");
}
