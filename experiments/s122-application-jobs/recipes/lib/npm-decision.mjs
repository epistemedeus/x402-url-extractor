import { classifySemverDelta } from "./semver.mjs";

export const NPM_NEXT_ACTIONS = Object.freeze([
  "refresh_agent_tool_notes",
  "bump_pin",
  "review_changelog",
  "no_action",
]);

export const DEFAULT_VERCEL_POLICY = Object.freeze({
  changelogOnMinorOrMajor: true,
  ignorePatch: false,
  preferNotesRefreshOnPatch: false,
});

export const DEFAULT_AGENT_CLI_POLICY = Object.freeze({
  changelogOnMinorOrMajor: true,
  ignorePatch: false,
  preferNotesRefreshOnPatch: true,
});

export function mergePolicy(base, override) {
  return {
    changelogOnMinorOrMajor: override?.changelogOnMinorOrMajor ?? base.changelogOnMinorOrMajor,
    ignorePatch: override?.ignorePatch ?? base.ignorePatch,
    preferNotesRefreshOnPatch: override?.preferNotesRefreshOnPatch ?? base.preferNotesRefreshOnPatch,
  };
}

/**
 * First matching rule. nextAction is null when the outcome cannot justify a decision.
 */
export function selectNpmNextAction({
  outcome,
  priorVersion,
  currentVersion,
  pinVersion,
  notesLastReviewedVersion,
  policy,
  deprecatedNow,
} = {}) {
  if (outcome !== "changed" && outcome !== "unchanged") {
    return {
      nextAction: null,
      ruleId: `no_decision_on_${outcome || "unknown"}`,
      because: `outcome ${outcome} does not justify a next-action claim`,
    };
  }

  const delta = classifySemverDelta(priorVersion, currentVersion);
  const pin = pinVersion || priorVersion;
  const notes = notesLastReviewedVersion || null;

  if (deprecatedNow) {
    return {
      nextAction: "review_changelog",
      ruleId: "deprecated_requires_review",
      because: `${currentVersion} is marked deprecated on the registry observation`,
      delta,
    };
  }

  if (outcome === "unchanged") {
    if (notes && currentVersion && notes !== currentVersion) {
      return {
        nextAction: "refresh_agent_tool_notes",
        ruleId: "notes_lag_current_on_unchanged_registry",
        because: `registry version ${currentVersion} is unchanged vs prior, but agent tool notes still cite ${notes}`,
        delta,
      };
    }
    return {
      nextAction: "no_action",
      ruleId: "unchanged_and_notes_current",
      because: `registry observation matches the immutable prior${notes ? ` and notes already cite ${notes}` : ""}`,
      delta,
    };
  }

  if (delta === "major" || delta === "minor") {
    if (policy.changelogOnMinorOrMajor !== false) {
      return {
        nextAction: "review_changelog",
        ruleId: "minor_or_major_requires_changelog",
        because: `semver delta ${delta} (${priorVersion} -> ${currentVersion}); changelog review is required before bumping the pin`,
        delta,
      };
    }
  }

  if (delta === "unknown") {
    return {
      nextAction: "review_changelog",
      ruleId: "unknown_delta_requires_changelog",
      because: `cannot classify semver delta (${priorVersion} -> ${currentVersion})`,
      delta,
    };
  }

  if (delta === "patch" && policy.ignorePatch === true) {
    return {
      nextAction: "no_action",
      ruleId: "operator_ignore_patch",
      because: `operator policy ignorePatch=true for patch ${priorVersion} -> ${currentVersion}`,
      delta,
    };
  }

  if (delta === "patch" && policy.preferNotesRefreshOnPatch === true) {
    if (!notes || notes !== currentVersion) {
      return {
        nextAction: "refresh_agent_tool_notes",
        ruleId: "patch_refresh_agent_notes",
        because: `patch ${priorVersion} -> ${currentVersion} on a flag-sensitive agent CLI; refresh runbook/notes before or with the pin bump`,
        delta,
        followUp: pin !== currentVersion ? "bump_pin" : null,
      };
    }
  }

  if (pin && currentVersion && pin !== currentVersion) {
    return {
      nextAction: "bump_pin",
      ruleId: "pin_lags_current",
      because: `operator pin ${pin} lags registry current ${currentVersion}`,
      delta,
    };
  }

  if (currentVersion && notes !== currentVersion) {
    return {
      nextAction: "refresh_agent_tool_notes",
      ruleId: "notes_lag_current",
      because: `pin matches ${currentVersion} but agent tool notes cite ${notes || "nothing"}`,
      delta,
    };
  }

  return {
    nextAction: "no_action",
    ruleId: "changed_but_pin_and_notes_match_current",
    because: "fields changed but pin and notes already match the current version",
    delta,
  };
}
