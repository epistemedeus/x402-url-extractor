/**
 * Local c05 exportDiff stub.
 *
 * Mirrors s127.upgrade-impact.export-diff.v1 (c05) inner `exportDiff` object
 * (`coverage: "full"` is accepted as complete). All objects are synthetic.
 */

export const EXPORT_DIFF_SHAPE_ID = "s127.c05.exportDiff.stub.v1";

export function makeExportDiff(overrides = {}) {
  return {
    coverage: "complete",
    added: [],
    removed: [],
    renamed: [],
    signatureChanged: [],
    missingEvidence: false,
    conflicting: false,
    limitations: [],
    ...overrides,
  };
}

export function sym(symbol, extra = {}) {
  return { symbol, ...extra };
}

export function rename(from, to) {
  return { from, to };
}
