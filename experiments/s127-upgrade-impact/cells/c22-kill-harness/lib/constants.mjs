/** Kill-harness schemas and action-bucket maps. Offline. No payment. */

export const PAIR_SCHEMA = "s127.upgrade-impact.kill-pair.v1";
export const SUITE_SCHEMA = "s127.upgrade-impact.kill-suite.v1";
export const SUITE_RESULT_SCHEMA = "s127.upgrade-impact.kill-suite-result.v1";
export const SKIM_SCHEMA = "s127.upgrade-impact.registry-skim.decision.v1";
export const SKIM_INPUT_SCHEMA = "s127.upgrade-impact.registry-skim.input.v1";
export const PACKET_SCHEMA = "s127.upgrade-impact.packet.v1";

export const VERDICTS = Object.freeze(["keep", "kill", "unknown"]);
export const COARSE_BUCKETS = Object.freeze(["action", "no_action", "unknown"]);
export const EVIDENCE_LABELS = Object.freeze(["fixture", "live-capture", "synthetic"]);

export const KILL_CONDITION =
  "If usage-binding (method B) never changes the coarse nextAction bucket relative to a registry version + changelog skim (method A) on required cases A and B, record negative evidence and stop packaging as a paid job.";

/**
 * Coarse buckets. review_changelog and packet `action` are the same operator
 * move ("do something about this upgrade"). Binding adds value only when the
 * bucket changes (withhold, escalate, or force unknown).
 */
export const ACTION_LIKE = Object.freeze([
  "action",
  "upgrade_with_edits",
  "review_breakages",
  "review_changelog",
  "bump_pin",
  "refresh_agent_tool_notes",
  "upgrade_now",
  "schedule_upgrade",
  "monitor",
]);

export const NO_ACTION_LIKE = Object.freeze(["no_action", "none", "skip", "unchanged"]);

export const UNKNOWN_LIKE = Object.freeze([
  "unknown",
  "partial",
  "missing",
  "error",
  "stale",
  "stale_baseline",
  "timed_out",
]);

export const STUB_LIMITATIONS = Object.freeze([
  "Method A is a registry version + changelog skim stub, not a maintainer-intent parser.",
  "Keyword scan is not full changelog understanding and is not TypeScript analysis.",
  "A newer version alone is not a break; skim review_changelog is not a caller-defect claim.",
  "Unused export change is not a caller defect.",
  "Missing, conflicting, or partial source stays unknown, not action.",
  "No runtime execution of untrusted packages or lifecycle scripts.",
  "Offline default. No payment attempted. A new version is not paid demand.",
]);
