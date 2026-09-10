/**
 * Name-level export diff. A newer version is not itself a change.
 * Dual CJS/ESM packaging is recorded by packaging.mjs, not as removed symbols.
 */

export function diffExportNames(oldScan, newScan) {
  const oldNames = new Set(oldScan?.names || []);
  const newNames = new Set(newScan?.names || []);
  const added = [...newNames].filter((n) => !oldNames.has(n)).sort();
  const removed = [...oldNames].filter((n) => !newNames.has(n)).sort();
  const kept = [...oldNames].filter((n) => newNames.has(n)).sort();
  return {
    added,
    removed,
    renamed: [],
    signatureChanged: [],
    kept,
    coverage: "js-default-and-named-static; dual-entry unioned on new side; no-full-ts; no-rename-inference",
  };
}

export function changeKindFor(symbol, exportDiff) {
  if ((exportDiff.removed || []).includes(symbol)) return "removed";
  if ((exportDiff.added || []).includes(symbol)) return "added";
  if ((exportDiff.signatureChanged || []).some((s) => (typeof s === "string" ? s : s.symbol) === symbol)) {
    return "signatureChanged";
  }
  return "unchanged";
}

/**
 * Union ESM+CJS scans on the new dual package so a missing condition
 * cannot silently drop a used default.
 */
export function unionDualScans(esmScan, cjsScan) {
  if (!esmScan && !cjsScan) return null;
  if (!esmScan) return cjsScan;
  if (!cjsScan) return esmScan;
  const named = [...new Set([...(esmScan.named || []), ...(cjsScan.named || [])])].sort();
  const hasDefault = Boolean(esmScan.default && cjsScan.default);
  const conflict =
    Boolean(esmScan.default) !== Boolean(cjsScan.default) ||
    JSON.stringify(esmScan.named || []) !== JSON.stringify(cjsScan.named || []);
  return {
    default: hasDefault || Boolean(esmScan.default) || Boolean(cjsScan.default),
    named,
    names: (hasDefault || esmScan.default || cjsScan.default) ? ["default", ...named] : named,
    dualConflict: conflict && Boolean(esmScan.default) !== Boolean(cjsScan.default),
    coverage: "union of exports.import and exports.require compiled JS",
  };
}
