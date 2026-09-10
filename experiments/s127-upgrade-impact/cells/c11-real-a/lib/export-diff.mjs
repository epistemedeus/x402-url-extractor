/**
 * Presence diff of named exports plus optional JS-evident signature claims.
 * Does not infer renames. A new version with only added unused names is
 * not treated as a break by the binder (see bind.mjs).
 */
export function diffNamedExports({ oldNames, newNames, signatureChanged = [] }) {
  const oldSet = new Set(oldNames);
  const newSet = new Set(newNames);
  const added = [...newSet].filter((n) => !oldSet.has(n)).sort();
  const removed = [...oldSet].filter((n) => !newSet.has(n)).sort();
  const kept = [...oldSet].filter((n) => newSet.has(n)).sort();
  const sig = signatureChanged.filter((n) => kept.includes(n)).sort();
  return {
    added,
    removed,
    renamed: [],
    signatureChanged: sig,
    kept,
    coverage:
      "named-export-presence; signatureChanged only when JS function-head/return evidence is supplied; no rename inference",
  };
}

export function changeKindFor(symbol, diff) {
  if (diff.removed.includes(symbol)) return "removed";
  if (diff.added.includes(symbol)) return "added";
  if (diff.signatureChanged.includes(symbol)) return "signatureChanged";
  if (diff.kept.includes(symbol)) return "unchanged";
  return null;
}
