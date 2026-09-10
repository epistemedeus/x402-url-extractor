# Contrast with S122 registry/changelog follow-up

S122 `npm-cli-release-followup` maps a semver delta plus operator policy
to `review_changelog | bump_pin | refresh_agent_tool_notes | no_action`.

On this pair (`path-to-regexp` 6.3.0 → 8.4.2) that recipe would match
**major** → `review_changelog`. It would not name `tokensToFunction` or
distinguish unused `regexpToFunction`.

SameDayDesk `source-change-alert` diffs selected fields (e.g. `version`)
on a page/JSON document. It would report `changed` for the version string
and stop there.

This packet's `summary.nextAction` is `action` with
`actionableChanges: ["pathToRegexp", "tokensToFunction"]`.
That is a different decision than changelog skim.
