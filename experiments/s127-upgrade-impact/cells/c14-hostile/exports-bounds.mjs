/**
 * Bound untrusted `exports` / `imports` maps.
 * Oversize ⇒ unknown with partial coverage; do not open one file per entry.
 */

export const EXPORT_ENTRY_CAP = 1024;
export const EXPORT_TARGET_CAP = 4096;
export const EXPORT_DEPTH_CAP = 8;

export function countExportTree(exportsField, { depth = 0 } = {}) {
  const stats = { entries: 0, targets: 0, depth: depth, truncated: false };
  walk(exportsField, 0, stats);
  return stats;
}

function walk(node, depth, stats) {
  if (stats.truncated) return;
  if (depth > EXPORT_DEPTH_CAP) {
    stats.truncated = true;
    return;
  }
  if (typeof node === "string") {
    stats.targets += 1;
    if (stats.targets > EXPORT_TARGET_CAP) stats.truncated = true;
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) walk(item, depth + 1, stats);
    return;
  }
  if (node && typeof node === "object") {
    const keys = Object.keys(node);
    stats.entries += keys.length;
    if (stats.entries > EXPORT_ENTRY_CAP) {
      stats.truncated = true;
      return;
    }
    for (const key of keys) walk(node[key], depth + 1, stats);
  }
}

export function isOversizeExports(stats) {
  return (
    stats.truncated ||
    stats.entries > EXPORT_ENTRY_CAP ||
    stats.targets > EXPORT_TARGET_CAP
  );
}
