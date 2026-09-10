/** PACKET-CONTRACT constants for the c21 golden packet. Does not import the CLI. */

export const PACKET_SCHEMA = "s127.upgrade-impact.packet.v1";
export const PRIOR_SCHEMA = "s127.upgrade-impact.prior.v1";
export const ASSERTIONS_SCHEMA = "s127.upgrade-impact.golden-assertions.v1";
export const FIXTURE_CLOCK = "2026-09-10T12:00:00.000Z";
export const PACKAGE_NAME = "s127-golden-kit";
export const OLD_VERSION = "1.0.0";
export const NEW_VERSION = "2.0.0";

export const EVIDENCE_LABELS = Object.freeze(["fixture", "live-capture", "synthetic"]);
export const DECISIONS = Object.freeze(["action", "unknown", "no_action"]);
export const CHANGE_KINDS = Object.freeze([
  "added",
  "removed",
  "renamed",
  "signatureChanged",
  "unchanged",
  "unknown",
]);

export const REQUIRED_PACKET_FIELDS = Object.freeze([
  "schema",
  "createdAt",
  "clock",
  "caller",
  "dependency",
  "provenance",
  "usage",
  "exportDiff",
  "bindings",
  "summary",
  "prior",
  "limitations",
]);

export const REQUIRED_CALLER_FIELDS = Object.freeze([
  "manifestPath",
  "sourceRoots",
  "evidenceClass",
]);

export const REQUIRED_DEPENDENCY_FIELDS = Object.freeze([
  "name",
  "oldVersion",
  "newVersion",
  "resolvedOld",
  "resolvedNew",
]);

export const REQUIRED_BINDING_FIELDS = Object.freeze([
  "symbol",
  "used",
  "changeKind",
  "decision",
  "rationale",
]);

export const REQUIRED_SUMMARY_FIELDS = Object.freeze([
  "nextAction",
  "unknownReasons",
  "unusedChanges",
  "actionableChanges",
]);

export const REQUIRED_PROVENANCE_FIELDS = Object.freeze([
  "retrievedAt",
  "contentSha256",
  "coverage",
  "label",
]);

/** Binding triples this golden must exhibit. */
export const GOLDEN_BINDINGS = Object.freeze([
  Object.freeze({
    symbol: "usedRemoved",
    used: true,
    changeKind: "removed",
    decision: "action",
    ruleId: "used_removed",
    surface: ".",
    dynamicImport: false,
  }),
  Object.freeze({
    symbol: "unusedRemoved",
    used: false,
    changeKind: "removed",
    decision: "no_action",
    ruleId: "unused_change_not_caller_defect",
    surface: ".",
    dynamicImport: false,
  }),
  Object.freeze({
    symbol: "dynamicRemoved",
    used: false,
    changeKind: "removed",
    decision: "unknown",
    ruleId: "dynamic_import",
    surface: "./plugin",
    dynamicImport: true,
  }),
]);

/** summary.nextAction aliases: bind.mjs may emit review_breakages for a used removal. */
export const NEXT_ACTION_ALIASES = Object.freeze({
  action: Object.freeze(["action", "review_breakages"]),
});

export const UNKNOWN_REASON_NEEDLES = Object.freeze([
  "dynamic_import",
  "dynamic_import:dynamicRemoved",
  "dynamic_import_unknown_surface",
  "dynamic import",
]);

export const BASE_LIMITATIONS = Object.freeze([
  "synthetic fixture; not live-capture; not paid demand",
  "no full TypeScript program analysis; type-only imports are not runtime use",
  "no runtime execution of caller or package code; no package lifecycle scripts",
  "dynamic import() of s127-golden-kit/plugin ⇒ unknown contribution for that surface",
  "export scan covers static ESM named exports in these fixture files only",
  "a newer version alone is not a break",
  "unused export change is not a caller defect",
]);

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function symbolOf(row) {
  if (typeof row === "string") return row;
  if (!isPlainObject(row)) return "";
  return String(row.symbol || row.name || row.export || "");
}

export function asSymbolList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(symbolOf).filter(Boolean);
}

export function nextActionMatches(actual, golden) {
  const want = String(golden || "action");
  const got = String(actual || "");
  const aliases = NEXT_ACTION_ALIASES[want] || [want];
  return aliases.includes(got);
}
