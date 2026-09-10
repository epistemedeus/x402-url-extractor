/**
 * Changelog-only baseline decisioner (kill harness side A).
 *
 * Sees oldVersion / newVersion and optional changelog text. Does not bind
 * caller usage. Packet-contract rules 1–2 (newer version ≠ break; unused
 * export change ≠ caller defect) are intentionally not applied: over-firing
 * `action` is the naive "registry + changelog skim" this cell exists to lose
 * against the usage binder.
 *
 * Rules this stub does keep:
 *   6. Same-version / no-op ⇒ no_action
 *   Missing / unparseable versions ⇒ unknown, not action
 *
 * Pure. No network, no filesystem, no package scripts, no Date.now().
 */

import { createHash } from "node:crypto";
import { extractChangelogText, scanChangelogSignals } from "./scan.mjs";
import { classifySemverDelta, versionIdentity } from "./semver.mjs";

export const SCHEMA = "s127.upgrade-impact.changelog-stub.v1";
export const PACKET_SCHEMA = "s127.upgrade-impact.packet.v1";
export const BASELINE = "A";
export const DECISIONS = Object.freeze(["action", "unknown", "no_action"]);
export const EVIDENCE_CLASSES = Object.freeze(["fixture", "live-capture", "synthetic"]);

export const RULE_IDS = Object.freeze([
  "missing_version",
  "same_version_noop",
  "unparseable_version",
  "prerelease_identity_unknown",
  "registry_bump_no_changelog",
  "patch_without_changelog",
  "changelog_breaking_keyword",
  "changelog_nonbreaking_patch",
  "semver_minor_or_major_requires_review",
  "changelog_unclassified_patch",
  "hostile_or_invalid_input",
]);

const IGNORED_CALLER_KEYS = Object.freeze([
  "usage",
  "exportDiff",
  "bindings",
  "lockfile",
  "imports",
  "sourceRoots",
  "caller",
]);

const BASE_LIMITATIONS = Object.freeze([
  "changelog-only baseline A; no usage binding; no export-diff",
  "keyword skim is regex, not a changelog parser or TypeScript program",
  "TS/dynamic import surfaces are not inspected and stay unknown to this stub",
  "newer version alone is treated as action for minor/major when notes are missing (weaker than packet-contract rule 1)",
  "breaking changelog keywords become action without checking whether the caller uses those APIs (weaker than packet-contract rule 2)",
  "no runtime execution of package modules or lifecycle scripts",
  "no network; changelog text must already be present on the input",
]);

/**
 * @param {object} input
 * @returns {object} changelog-stub result
 */
export function decideFromChangelog(input) {
  try {
    return decideInner(input);
  } catch (err) {
    const message = err && typeof err.message === "string" ? err.message : "decide error";
    return makeResult({
      decision: "unknown",
      ruleId: "hostile_or_invalid_input",
      rationale: `hostile or invalid input; refused to claim action (${message})`,
      delta: "unknown",
      oldVersion: null,
      newVersion: null,
      changelogView: emptyChangelogView(),
      unknownReasons: ["hostile_or_invalid_input"],
      ignoredCallerSurfaces: false,
      evidenceClass: "synthetic",
      clock: null,
      limitations: [...BASE_LIMITATIONS],
      provenance: [],
    });
  }
}

/** Alias for kill-harness loaders. */
export const decide = decideFromChangelog;

export function applyChangelogStubToPacket(packet) {
  const stub = decideFromChangelog(isPlainObject(packet) ? packet : undefined);
  if (!isPlainObject(packet)) {
    return { changelogBaseline: stub };
  }
  return {
    schema: typeof packet.schema === "string" ? packet.schema : PACKET_SCHEMA,
    createdAt: packet.createdAt ?? stub.createdAt,
    clock: packet.clock ?? stub.clock,
    caller: packet.caller ?? null,
    dependency: packet.dependency ?? null,
    provenance: Array.isArray(packet.provenance)
      ? [...packet.provenance, ...stub.provenance]
      : stub.provenance,
    usage: packet.usage ?? null,
    exportDiff: packet.exportDiff ?? null,
    bindings: packet.bindings ?? [],
    summary: packet.summary ?? null,
    prior: packet.prior ?? null,
    limitations: uniqueStrings([
      ...asStringList(packet.limitations),
      ...stub.limitations,
    ]),
    changelogBaseline: stub,
  };
}

function decideInner(input) {
  const ctx = isPlainObject(input) ? input : {};
  const ignoredCallerSurfaces = IGNORED_CALLER_KEYS.some((key) => key in ctx);
  const dependency = isPlainObject(ctx.dependency) ? ctx.dependency : {};
  const oldVersion = firstString(
    ctx.oldVersion,
    dependency.oldVersion,
    ctx.old,
    dependency.old,
  );
  const newVersion = firstString(
    ctx.newVersion,
    dependency.newVersion,
    ctx.new,
    dependency.new,
  );
  const clock = firstString(ctx.clock, ctx.createdAt) || null;
  const evidenceClass = normalizeEvidenceClass(
    ctx.evidenceClass || ctx.label || changelogHint(ctx).label,
  );

  const changelogView = normalizeChangelog(ctx);
  const identity = versionIdentity(oldVersion, newVersion);
  const delta = classifySemverDelta(oldVersion, newVersion);
  const limitations = [...BASE_LIMITATIONS];
  if (ignoredCallerSurfaces) {
    limitations.push("usage, exportDiff, bindings, lockfile, and caller fields were present and ignored");
  }
  if (changelogView.truncated) {
    limitations.push("changelog text truncated at 256KiB; coverage partial");
  }

  if (!oldVersion || !newVersion) {
    return makeResult({
      decision: "unknown",
      ruleId: "missing_version",
      rationale: "oldVersion and/or newVersion missing; cannot claim action",
      delta: "unknown",
      oldVersion: oldVersion || null,
      newVersion: newVersion || null,
      changelogView,
      unknownReasons: ["missing_version"],
      ignoredCallerSurfaces,
      evidenceClass,
      clock,
      limitations,
      provenance: provenanceFrom(changelogView, evidenceClass, clock),
    });
  }

  if (identity === "same") {
    return makeResult({
      decision: "no_action",
      ruleId: "same_version_noop",
      rationale: `same version ${oldVersion}; changelog text is not a caller-usage signal`,
      delta: "none",
      oldVersion,
      newVersion,
      changelogView,
      unknownReasons: [],
      ignoredCallerSurfaces,
      evidenceClass,
      clock,
      limitations,
      provenance: provenanceFrom(changelogView, evidenceClass, clock),
    });
  }

  if (identity === "prerelease_or_build_diff") {
    return makeResult({
      decision: "unknown",
      ruleId: "prerelease_identity_unknown",
      rationale: `core version equal but prerelease/build differs (${oldVersion} → ${newVersion}); stub does not order prereleases`,
      delta: "unknown",
      oldVersion,
      newVersion,
      changelogView,
      unknownReasons: ["prerelease_identity_unknown"],
      ignoredCallerSurfaces,
      evidenceClass,
      clock,
      limitations,
      provenance: provenanceFrom(changelogView, evidenceClass, clock),
    });
  }

  if (identity === "unknown") {
    if (changelogView.present && changelogView.signals.breakingLike) {
      return makeResult({
        decision: "action",
        ruleId: "changelog_breaking_keyword",
        rationale: `versions unparseable (${oldVersion} → ${newVersion}) but changelog keywords look breaking; no usage check`,
        delta: "unknown",
        oldVersion,
        newVersion,
        changelogView,
        unknownReasons: [],
        ignoredCallerSurfaces,
        evidenceClass,
        clock,
        limitations,
        provenance: provenanceFrom(changelogView, evidenceClass, clock),
      });
    }
    return makeResult({
      decision: "unknown",
      ruleId: "unparseable_version",
      rationale: `cannot classify semver delta (${oldVersion} → ${newVersion})`,
      delta: "unknown",
      oldVersion,
      newVersion,
      changelogView,
      unknownReasons: ["unparseable_version"],
      ignoredCallerSurfaces,
      evidenceClass,
      clock,
      limitations,
      provenance: provenanceFrom(changelogView, evidenceClass, clock),
    });
  }

  if (changelogView.present && changelogView.signals.breakingLike) {
    return makeResult({
      decision: "action",
      ruleId: "changelog_breaking_keyword",
      rationale: `changelog keyword skim flags breaking/removed/renamed for ${oldVersion} → ${newVersion}; unused vs used is not considered`,
      delta,
      oldVersion,
      newVersion,
      changelogView,
      unknownReasons: [],
      ignoredCallerSurfaces,
      evidenceClass,
      clock,
      limitations,
      provenance: provenanceFrom(changelogView, evidenceClass, clock),
    });
  }

  if (!changelogView.present) {
    if (delta === "major" || delta === "minor") {
      return makeResult({
        decision: "action",
        ruleId: "registry_bump_no_changelog",
        rationale: `semver ${delta} ${oldVersion} → ${newVersion} with no changelog text; naive registry skim treats this as action`,
        delta,
        oldVersion,
        newVersion,
        changelogView,
        unknownReasons: [],
        ignoredCallerSurfaces,
        evidenceClass,
        clock,
        limitations,
        provenance: provenanceFrom(changelogView, evidenceClass, clock),
      });
    }
    return makeResult({
      decision: "unknown",
      ruleId: "patch_without_changelog",
      rationale: `semver ${delta} ${oldVersion} → ${newVersion} with no changelog text; cannot claim action or no_action`,
      delta,
      oldVersion,
      newVersion,
      changelogView,
      unknownReasons: ["patch_without_changelog"],
      ignoredCallerSurfaces,
      evidenceClass,
      clock,
      limitations,
      provenance: provenanceFrom(changelogView, evidenceClass, clock),
    });
  }

  if (delta === "patch" && changelogView.signals.classified && !changelogView.signals.breakingLike) {
    return makeResult({
      decision: "no_action",
      ruleId: "changelog_nonbreaking_patch",
      rationale: `patch ${oldVersion} → ${newVersion} and changelog skim is fix/docs/perf/added only`,
      delta,
      oldVersion,
      newVersion,
      changelogView,
      unknownReasons: [],
      ignoredCallerSurfaces,
      evidenceClass,
      clock,
      limitations,
      provenance: provenanceFrom(changelogView, evidenceClass, clock),
    });
  }

  if (delta === "major" || delta === "minor") {
    return makeResult({
      decision: "action",
      ruleId: "semver_minor_or_major_requires_review",
      rationale: `semver ${delta} ${oldVersion} → ${newVersion}; S122-style registry skim requires changelog review, mapped to coarse action`,
      delta,
      oldVersion,
      newVersion,
      changelogView,
      unknownReasons: [],
      ignoredCallerSurfaces,
      evidenceClass,
      clock,
      limitations,
      provenance: provenanceFrom(changelogView, evidenceClass, clock),
    });
  }

  return makeResult({
    decision: "unknown",
    ruleId: "changelog_unclassified_patch",
    rationale: `patch ${oldVersion} → ${newVersion} with changelog text but no classified keywords`,
    delta,
    oldVersion,
    newVersion,
    changelogView,
    unknownReasons: ["changelog_unclassified_patch"],
    ignoredCallerSurfaces,
    evidenceClass,
    clock,
    limitations,
    provenance: provenanceFrom(changelogView, evidenceClass, clock),
  });
}

function normalizeChangelog(ctx) {
  const raw =
    typeof ctx.changelogText === "string"
      ? ctx.changelogText
      : ctx.changelog != null
        ? ctx.changelog
        : ctx.releaseNotes != null
          ? ctx.releaseNotes
          : null;
  const extracted = extractChangelogText(raw);
  const signals = scanChangelogSignals(extracted.text);
  const sha = extracted.present ? sha256Hex(extracted.text) : null;
  const label = extracted.label || normalizeEvidenceClass(ctx.evidenceClass || ctx.label);
  return {
    present: extracted.present,
    coverage: extracted.coverage,
    truncated: extracted.truncated,
    label,
    contentSha256: sha,
    path: extracted.path,
    url: extracted.url,
    retrievedAt: extracted.retrievedAt,
    signals,
  };
}

function emptyChangelogView() {
  return {
    present: false,
    coverage: "unknown",
    truncated: false,
    label: "synthetic",
    contentSha256: null,
    path: null,
    url: null,
    retrievedAt: null,
    signals: scanChangelogSignals(""),
  };
}

function changelogHint(ctx) {
  return isPlainObject(ctx.changelog) ? ctx.changelog : {};
}

function makeResult({
  decision,
  ruleId,
  rationale,
  delta,
  oldVersion,
  newVersion,
  changelogView,
  unknownReasons,
  ignoredCallerSurfaces,
  evidenceClass,
  clock,
  limitations,
  provenance,
}) {
  return {
    schema: SCHEMA,
    baseline: BASELINE,
    usageBinding: false,
    decision,
    ruleId,
    rationale,
    delta,
    versions: { oldVersion, newVersion },
    changelog: changelogView,
    summary: {
      nextAction: decision,
      unknownReasons: [...unknownReasons],
      unusedChanges: [],
      actionableChanges: [],
    },
    bindings: [],
    ignoredCallerSurfaces: Boolean(ignoredCallerSurfaces),
    evidenceClass,
    clock,
    createdAt: clock,
    limitations: uniqueStrings(limitations),
    provenance,
    execute: false,
    paidDemand: false,
  };
}

function provenanceFrom(changelogView, evidenceClass, clock) {
  return [
    {
      kind: "changelog",
      url: changelogView.url,
      path: changelogView.path,
      retrievedAt: changelogView.retrievedAt || clock,
      contentSha256: changelogView.contentSha256,
      coverage: changelogView.coverage,
      label: changelogView.label || evidenceClass,
    },
  ];
}

function normalizeEvidenceClass(value) {
  if (value === "fixture" || value === "live-capture" || value === "synthetic") return value;
  return "synthetic";
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function asStringList(value) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((row) => typeof row === "string" && row.trim());
}

function uniqueStrings(items) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    if (typeof item !== "string") continue;
    const s = item.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
