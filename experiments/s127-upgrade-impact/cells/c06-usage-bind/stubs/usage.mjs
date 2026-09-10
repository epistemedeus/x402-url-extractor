/**
 * Local c03 usage-list stub.
 *
 * Mirrors s127.upgrade-impact.usage.v1 (c03) plus a compact references[] form.
 * All objects produced here are synthetic.
 */

export const USAGE_SHAPE_ID = "s127.c03.usage.stub.v1";

export function makeUsage(overrides = {}) {
  return {
    coverage: "complete",
    dynamicImport: false,
    missingEvidence: false,
    conflicting: false,
    references: [],
    limitations: [],
    ...overrides,
  };
}

export function namedRefs(...symbols) {
  return symbols.map((symbol) => ({
    symbol,
    kind: "named",
    dynamicImport: false,
    used: true,
  }));
}

export function defaultRef(file) {
  return { symbol: "default", kind: "default", dynamicImport: false, used: true, file };
}

export function namespaceRef(file) {
  return { symbol: "*", kind: "namespace", dynamicImport: false, used: true, file };
}

export function dynamicRef(symbol = "*") {
  return { symbol, kind: symbol === "*" ? "namespace" : "named", dynamicImport: true };
}
