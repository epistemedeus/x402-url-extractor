/**
 * Compare method A (registry+changelog skim) vs method B (usage-binding packet).
 *
 * Pair verdict:
 *   keep    — coarse buckets differ (binding changed the decision)
 *   kill    — coarse buckets match (binding did not change the decision)
 *   unknown — either side could not be read
 *
 * Product kill is the suite over required cases A and B, not a single pair.
 */
import { KILL_CONDITION, PAIR_SCHEMA, STUB_LIMITATIONS } from "./constants.mjs";
import { extractDecision } from "./extract.mjs";

export function compareDecisions(methodABody, methodBBody, extra = {}) {
  const a = extra.aExtract || extractDecision(methodABody, { path: extra.aPath || null, method: extra.aMethod || "registry_version_changelog_skim" });
  const b = extra.bExtract || extractDecision(methodBBody, { path: extra.bPath || null, method: extra.bMethod || "usage_binding_packet" });
  return compareExtracts(a, b, extra);
}

export function compareExtracts(a, b, extra = {}) {
  const mode = extra.mode === "exact" ? "exact" : "coarse";
  const clock = extra.clock || a.clock || b.clock || null;

  if (!a.ok || !b.ok) {
    const reasons = [];
    if (!a.ok) reasons.push(`method_a:${a.code || "unreadable"}`);
    if (!b.ok) reasons.push(`method_b:${b.code || "unreadable"}`);
    return makePair({
      verdict: "unknown",
      changed: false,
      mode,
      clock,
      a,
      b,
      extra,
      rationale: `cannot compare: ${reasons.join("; ")}. Missing or conflicting source stays unknown, not a kill.`,
      unknownReasons: reasons,
    });
  }

  const changed = mode === "exact" ? a.raw !== b.raw : a.coarse !== b.coarse;
  const verdict = changed ? "keep" : "kill";
  const rationale = changed
    ? `binding changed the ${mode} decision vs registry+changelog skim (${fmt(a)} -> ${fmt(b)}). Keep: mapping added a different operator move.`
    : `binding did not change the ${mode} decision vs registry+changelog skim (both ${fmt(a)}). Kill-signal for this pair: mapping added no different operator move.`;

  return makePair({
    verdict,
    changed,
    mode,
    clock,
    a,
    b,
    extra,
    rationale,
    unknownReasons: [],
  });
}

function fmt(side) {
  const raw = side.raw == null ? "null" : String(side.raw);
  return `${side.coarse} [raw=${raw}]`;
}

function makePair({ verdict, changed, mode, clock, a, b, extra, rationale, unknownReasons }) {
  return {
    schema: PAIR_SCHEMA,
    scope: extra.scope || "pair",
    caseId: extra.caseId || null,
    role: extra.role || null,
    clock,
    label: extra.label || b.label || a.label || "synthetic",
    mode,
    verdict,
    changed,
    rationale,
    killCondition: KILL_CONDITION,
    payment: { attempted: false },
    cost: {
      assignmentSpendUsd: 0,
      note: "offline compare; no purchase; do not invent paid demand",
    },
    a: summarizeSide(a, "A"),
    b: summarizeSide(b, "B"),
    unknownReasons,
    limitations: [...STUB_LIMITATIONS, ...(extra.limitations || [])],
  };
}

function summarizeSide(side, letter) {
  return {
    letter,
    ok: side.ok,
    method: side.method,
    path: side.path,
    schema: side.schema,
    label: side.label,
    raw: side.raw,
    coarse: side.coarse,
    source: side.source,
    clock: side.clock,
    ruleId: side.ruleId,
    rationale: side.rationale,
    dependency: side.dependency,
    code: side.code,
    message: side.message,
  };
}
