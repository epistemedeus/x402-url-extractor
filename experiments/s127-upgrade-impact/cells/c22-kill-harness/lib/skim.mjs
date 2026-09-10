/**
 * Method A stub: registry version + changelog skim.
 *
 * Intentionally naive. Does not bind caller usage. Does not parse TypeScript.
 * Keyword scan is a stub and is labeled as such. Newer version alone is not
 * a break; review_changelog means "look at the changelog", not "caller defect".
 */
import { createHash } from "node:crypto";
import { SKIM_SCHEMA, SKIM_INPUT_SCHEMA, STUB_LIMITATIONS } from "./constants.mjs";
import { isPlainObject, readString } from "./extract.mjs";

export function sha256Hex(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash("sha256").update(input).digest("hex");
}

const EXACT_SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Stub keywords only. Not a changelog grammar. */
const BREAKING_KEYWORD_RE =
  /\bBREAKING CHANGE\b|\bbreaking[- ]changes?\b|\bremoved export\b|\bno longer (?:exported|available)\b|\brenamed export\b/i;

const COVERAGE_COMPLETE = new Set(["complete", "full", "present"]);
const COVERAGE_PARTIAL = new Set(["partial", "incomplete", "limited", "truncated"]);
const COVERAGE_MISSING = new Set(["missing", "none", "absent", "unknown", ""]);

export function parseExactSemver(version) {
  const s = readString(version).trim();
  const m = s.match(EXACT_SEMVER);
  if (!m) return null;
  return {
    raw: s,
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] || null,
  };
}

export function classifySemverDelta(oldVersion, newVersion) {
  const a = parseExactSemver(oldVersion);
  const b = parseExactSemver(newVersion);
  if (!a || !b) return "unknown";
  if (a.major !== b.major) return "major";
  if (a.minor !== b.minor) return "minor";
  if (a.patch !== b.patch) return "patch";
  if (a.prerelease !== b.prerelease) return "prerelease";
  return "same";
}

export function scanChangelogKeywords(text) {
  const s = readString(text);
  if (!s) return { scanned: false, matches: [] };
  const matches = [];
  const patterns = [
    ["BREAKING CHANGE", /\bBREAKING CHANGE\b/i],
    ["breaking-change", /\bbreaking[- ]changes?\b/i],
    ["removed export", /\bremoved export\b/i],
    ["no longer exported", /\bno longer (?:exported|available)\b/i],
    ["renamed export", /\brenamed export\b/i],
  ];
  for (const [id, re] of patterns) {
    if (re.test(s)) matches.push(id);
  }
  return { scanned: true, matches };
}

function normalizeCoverage(value, hasText) {
  const s = readString(value).trim().toLowerCase();
  if (COVERAGE_COMPLETE.has(s)) return "complete";
  if (COVERAGE_PARTIAL.has(s)) return "partial";
  if (COVERAGE_MISSING.has(s) && !s && hasText) return "complete";
  if (COVERAGE_MISSING.has(s) && !s && !hasText) return "missing";
  if (COVERAGE_MISSING.has(s)) return s === "unknown" ? "unknown" : "missing";
  if (!s) return hasText ? "complete" : "missing";
  return "unknown";
}

/**
 * @param {object} input registry-skim input
 * @returns method-A decision JSON
 */
export function skimRegistryChangelog(input) {
  const body = isPlainObject(input) ? input : {};
  const clock = readString(body.clock) || readString(body.createdAt);
  const dep = isPlainObject(body.dependency) ? body.dependency : {};
  const name = readString(dep.name) || readString(body.name);
  const oldVersion = readString(dep.oldVersion) || readString(body.oldVersion);
  const newVersion = readString(dep.newVersion) || readString(body.newVersion);
  const changelogText =
    readString(body.changelogText) ||
    readString(body.changelog?.text) ||
    readString(dep.changelogText);
  const coverageIn =
    body.changelogCoverage ||
    body.changelog?.coverage ||
    dep.changelogCoverage ||
    null;
  const coverage = normalizeCoverage(coverageIn, Boolean(changelogText));
  const label = normalizeLabel(body.label || body.evidenceClass);
  const keywords = coverage === "complete" ? scanChangelogKeywords(changelogText) : { scanned: false, matches: [] };
  const delta = classifySemverDelta(oldVersion, newVersion);

  const limitations = [...STUB_LIMITATIONS];
  if (coverage !== "complete") {
    limitations.push("changelog coverage is not complete; keyword claim is withheld");
  }
  if (!clock) {
    limitations.push("clock missing; skim still reports a decision but does not invent a clock");
  }

  const decided = decideSkim({
    delta,
    coverage,
    keywords,
    oldVersion,
    newVersion,
  });

  return {
    schema: SKIM_SCHEMA,
    inputSchema: SKIM_INPUT_SCHEMA,
    method: "registry_version_changelog_skim",
    createdAt: clock || null,
    clock: clock || null,
    label,
    evidenceClass: label,
    offline: true,
    payment: { attempted: false },
    cost: {
      assignmentSpendUsd: 0,
      note: "offline skim stub; no purchase; do not invent paid demand",
    },
    dependency: {
      name: name || null,
      oldVersion: oldVersion || null,
      newVersion: newVersion || null,
    },
    observation: {
      versionChanged: delta !== "same" && delta !== "unknown",
      semverDelta: delta,
      changelogCoverage: coverage,
      changelogPath: readString(body.changelogPath) || readString(body.changelog?.path) || null,
      breakingKeywords: keywords.matches,
      keywordScan: keywords.scanned ? "stub_regex" : "not_scanned",
      changelogBytes: changelogText ? Buffer.byteLength(changelogText) : 0,
      changelogSha256: changelogText ? sha256Hex(changelogText) : readString(body.changelogSha256) || null,
    },
    summary: {
      nextAction: decided.nextAction,
      ruleId: decided.ruleId,
      rationale: decided.rationale,
      unknownReasons: decided.unknownReasons,
      unusedChanges: [],
      actionableChanges: [],
    },
    limitations,
    provenance: Array.isArray(body.provenance)
      ? body.provenance
      : defaultProvenance(body, label, changelogText),
  };
}

function decideSkim({ delta, coverage, keywords, oldVersion, newVersion }) {
  if (!oldVersion || !newVersion) {
    return {
      nextAction: "unknown",
      ruleId: "missing_versions",
      rationale: "oldVersion or newVersion missing; skim cannot compare registry versions",
      unknownReasons: ["missing_versions"],
    };
  }

  if (delta === "unknown") {
    return {
      nextAction: "unknown",
      ruleId: "unclassified_semver_delta",
      rationale: `cannot classify semver delta (${oldVersion} -> ${newVersion}); not exact X.Y.Z`,
      unknownReasons: ["unclassified_semver_delta"],
    };
  }

  if (delta === "same") {
    return {
      nextAction: "no_action",
      ruleId: "same_version_noop",
      rationale: `same registry version ${oldVersion}; same-version/no-op is not an upgrade impact`,
      unknownReasons: [],
    };
  }

  if (coverage === "partial") {
    return {
      nextAction: "unknown",
      ruleId: "partial_changelog",
      rationale: `registry ${oldVersion} -> ${newVersion} (${delta}) but changelog coverage is partial; skim stays unknown, not action`,
      unknownReasons: ["partial_changelog"],
    };
  }

  const breaking = keywords.matches.length > 0;

  if (delta === "major" || delta === "minor") {
    return {
      nextAction: "review_changelog",
      ruleId: "minor_or_major_requires_changelog",
      rationale: `semver delta ${delta} (${oldVersion} -> ${newVersion}); changelog review is required before bumping a pin. This is not a caller-defect claim and does not bind usage.${breaking ? ` Stub keywords: ${keywords.matches.join(", ")}.` : ""}`,
      unknownReasons: [],
    };
  }

  if (delta === "prerelease") {
    return {
      nextAction: "unknown",
      ruleId: "prerelease_delta_unknown",
      rationale: `prerelease delta (${oldVersion} -> ${newVersion}); skim does not treat prerelease as a pin bump`,
      unknownReasons: ["prerelease_delta"],
    };
  }

  // patch
  if (coverage === "missing" || coverage === "unknown") {
    return {
      nextAction: "unknown",
      ruleId: "patch_without_changelog",
      rationale: `patch ${oldVersion} -> ${newVersion} with no complete changelog to skim; unknown, not action`,
      unknownReasons: ["missing_changelog"],
    };
  }

  if (breaking) {
    return {
      nextAction: "review_changelog",
      ruleId: "patch_changelog_keywords",
      rationale: `patch ${oldVersion} -> ${newVersion}; stub keyword scan matched ${keywords.matches.join(", ")}. Not usage-bound; not a caller-defect claim.`,
      unknownReasons: [],
    };
  }

  return {
    nextAction: "no_action",
    ruleId: "patch_changelog_silent",
    rationale: `patch ${oldVersion} -> ${newVersion}; complete changelog skim found no stub breaking keywords. Newer version alone is not a break.`,
    unknownReasons: [],
  };
}

function normalizeLabel(value) {
  const s = readString(value);
  if (s === "fixture" || s === "live-capture" || s === "synthetic") return s;
  return "synthetic";
}

function defaultProvenance(body, label, changelogText) {
  const path = readString(body.changelogPath) || readString(body.changelog?.path);
  if (!path && !changelogText) return [];
  return [
    {
      path: path || null,
      retrievedAt: readString(body.clock) || null,
      contentSha256: changelogText ? sha256Hex(changelogText) : readString(body.changelogSha256) || null,
      coverage: readString(body.changelogCoverage) || "unknown",
      label,
    },
  ];
}

// Keep the regex referenced so a future exact-match test can import it.
export const BREAKING_KEYWORD_RE_EXPORT = BREAKING_KEYWORD_RE;
