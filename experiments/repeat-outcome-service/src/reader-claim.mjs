import { compareVersions } from "./osv-pin.mjs";

const RANGE_RE = /affected versions\s+>=\s*([0-9][0-9A-Za-z.+-]*)\s*,\s*<\s*([0-9][0-9A-Za-z.+-]*)/gi;
const PATCHED_RE = /patched versions\s+([0-9][0-9A-Za-z.+-]*)/gi;
const GHSA_RE = /\bGHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}\b/gi;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inHalfOpen(version, introduced, fixed) {
  const lower = compareVersions(version, introduced);
  const upper = compareVersions(version, fixed);
  if (lower === null || upper === null) return null;
  return lower >= 0 && upper < 0;
}

export function claimsFromText(text, pin) {
  const source = typeof text === "string" ? text : "";
  const ranges = [...source.matchAll(RANGE_RE)].map((match) => ({ introduced: match[1], fixed: match[2] }));
  const patchedVersions = [...source.matchAll(PATCHED_RE)].map((match) => match[1]);
  const advisoryIds = [...new Set([...source.matchAll(GHSA_RE)].map((match) => match[0].toLowerCase()))].sort();
  const clearance = pin
    ? new RegExp(`\\b(?:${escapeRegExp(pin.name)}\\s*@\\s*|${escapeRegExp(pin.name)}\\s+)?${escapeRegExp(pin.version)}\\s+is not affected\\b`, "i")
    : null;
  const explicitPinClearance = clearance ? clearance.test(source) : false;
  const rangeVerdicts = ranges.map((range) => ({
    ...range,
    includesPin: pin ? inHalfOpen(pin.version, range.introduced, range.fixed) : null,
  }));
  return {
    ranges: rangeVerdicts,
    patchedVersions,
    advisoryIds,
    explicitPinClearance,
    hasRange: rangeVerdicts.length > 0,
  };
}

// A patched-version label alone is not a clearance. OSV "fixed" is exclusive,
// and the page line names the fix version rather than saying the pin is outside it.
export function agreeClaims(claims, direct, pin) {
  const reasons = [];
  const known = claims.ranges.filter((range) => range.includesPin !== null);
  const unparsed = claims.ranges.some((range) => range.includesPin === null);
  const pageSaysAffected = known.length ? known.some((range) => range.includesPin === true) : null;
  if (claims.explicitPinClearance && direct.decision === "affected") reasons.push("explicit_pin_clearance");
  if (pageSaysAffected === false && direct.decision === "affected") reasons.push("stated_range_excludes_pin");
  if (pageSaysAffected === true && direct.decision === "not_affected") reasons.push("stated_range_includes_pin");
  if (unparsed && reasons.length === 0 && pageSaysAffected === null) reasons.push("stated_range_unparsed");
  let state = "no_explicit_claim";
  if (reasons.some((reason) => reason !== "stated_range_unparsed")) state = "contradicts";
  else if (reasons.includes("stated_range_unparsed")) state = "unparsed";
  else if (claims.explicitPinClearance || pageSaysAffected !== null) state = "agrees";
  const affecting = new Set(direct.affectingIds.map((id) => id.toLowerCase()));
  const seen = claims.advisoryIds.filter((id) => affecting.has(id));
  return {
    state,
    reasons,
    pageSaysAffected,
    statedRanges: claims.ranges,
    statedPatchedVersions: claims.patchedVersions,
    explicitPinClearance: claims.explicitPinClearance,
    readerAdvisoryIds: claims.advisoryIds,
    readerAffectingIdsSeen: seen,
    readerCoversEveryAffectingAdvisory: affecting.size > 0 && seen.length === affecting.size && [...affecting].every((id) => seen.includes(id)),
    pin,
  };
}
