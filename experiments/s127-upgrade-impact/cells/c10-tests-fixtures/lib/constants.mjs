export const PACKET_SCHEMA = "s127.upgrade-impact.packet.v1";
export const PRIOR_SCHEMA = "s127.upgrade-impact.prior.v1";
export const SYNTHETIC_MANIFEST_SCHEMA = "s127.upgrade-impact.synthetic-manifest.v1";
export const FIXTURE_CLOCK = "2026-09-10T12:00:00.000Z";

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
export const EXPORT_DIFF_COVERAGE = Object.freeze(["full", "partial", "unknown"]);

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

export const BASELINE_LIMITATIONS = Object.freeze([
  "no full TypeScript program analysis",
  "no runtime execution of caller or package code",
  "export scan covers static ESM named/default/namespace and CJS exports.X; re-export graphs and computed specifiers are unknown",
]);
