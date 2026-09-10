# Why this is not changelog text

S122 `npm-cli-release-followup` on the same pair would see a **major**
(`6.3.0` → `8.4.2`) and emit `review_changelog`. That is a version-document
decision. It does not name a caller symbol.

SameDayDesk `source-change-alert` can diff a named field such as `version`
on a page or JSON document. It will not say which export the caller uses.

This case binds official **published JS**:

| Symbol | Old public? | New public? | Caller | Decision |
| --- | --- | --- | --- | --- |
| `tokensToFunction` | yes (`exports.tokensToFunction = tokensToFunction`) | no (internal only) | used | **action** |
| `pathToRegexp` | yes, arity 3, returns `RegExp` | yes, arity 2, returns `{ regexp, keys }` | used | **action** |
| `regexpToFunction` | yes | no | imported, unused | **no_action** |
| `tokensToRegexp` | yes | no | not imported | **no_action** |
| `stringify` | no | yes | not imported | **no_action** |

The 8.4.2 README does not mention `tokensToFunction` at all. Reading the
new changelog/README is not sufficient to recover the old public name.
The load-bearing fact is the old `exports.tokensToFunction` assignment
versus its absence on the new `exports.*` bag — plus the leftover internal
`function tokensToFunction` in 8.4.2, which proves this is an export-surface
change, not a total deletion of the identifier.

Packet `summary.nextAction` is `action`, not `review_changelog`.
That is the kill-condition contrast: binding changes the decision relative
to registry + changelog skim.
