# c27-changelog-stub DONE

Kill-harness **baseline A**: a changelog/registry skim that emits coarse `action | no_action | unknown` from `oldVersion` / `newVersion` and optional changelog text. **No usage binding.**

## Outputs

- `decideFromChangelog(input)` / `decide(input)` → schema `s127.upgrade-impact.changelog-stub.v1`
- `compareBaselineToBinder(stub, bindResult)` maps c06 `review_breakages` / `upgrade_with_edits` → packet `action` and reports `decisionChangedRelativeToChangelog`
- `applyChangelogStubToPacket(packet)` attaches `changelogBaseline` without rewriting caller `bindings`
- 20 fixtures (17 synthetic, 3 sibling-derived **fixture**). **No live-capture in this cell.**
- Offline tests: 15/15 pass. `node run-fixtures.mjs`: 20/20 match.

Kill-harness load:

```js
import { decideFromChangelog, compareBaselineToBinder } from "./changelog.mjs";
// compare.mjs exported from index.mjs as well
```

```bash
node --test cells/c27-changelog-stub/test/changelog.test.mjs
node cells/c27-changelog-stub/run-fixtures.mjs
```

No `npm install`. Node 20+. No network.

## Weaker than usage binder (required)

| Case | Stub A | Binder (canned coarse) | Decision changed? |
| --- | --- | --- | --- |
| unused removed + breaking notes | action | no_action | yes |
| added-only minor | action | no_action | yes |
| used-removed on a patch, notes missing | unknown | action | yes |
| cookie 1.1.1→2.0.1 rename notes, parseCookie-only caller | action | no_action | yes |
| path-to-regexp 6.3.0→8.4.2, no changelog, unused-removal caller | action | no_action | yes |
| same version | no_action | no_action | no (rule 6 shared) |

Packet-contract rules 1–2 are **not** applied here on purpose: minor/major with no notes is `action`; breaking keywords are `action` without checking whether the caller uses those APIs. `bindings` / `unusedChanges` / `actionableChanges` stay empty.

## Labels

| Label | What |
| --- | --- |
| **synthetic** | `fixtures/synthetic/*` hand-written versions and notes |
| **fixture** | `fixtures/from-sibling/*` copied from c11/c12 captures already on disk |
| **live-capture** | not produced; this cell did not GET |

Sibling fixture clocks/URLs (copied, not re-fetched):

- path-to-regexp 6.3.0→8.4.2, clock `2026-09-10T10:48:00Z`, npm tarball URLs in PROVENANCE
- cookie GitHub releases `https://api.github.com/repos/jshttp/cookie/releases?per_page=10`, clock `2026-09-10T10:50:00Z`, sibling slim sha256 `69f65d12c5a0df6e0d6c8c741c2bc89c9e1b8b783b711ae37c42eb433ee39b24`

## Limitations

- Regex keyword skim, not a Keep-a-Changelog parser, markdown AST, or TypeScript program.
- Does not read files or URLs; `changelog.path` / `changelog.url` without text is missing coverage.
- Semver is major.minor.patch identity only; prerelease/build differences are `unknown`, not ordered.
- Changelog misses (cookie `serialize` runtime alias) are not corrected here — that is the binder’s job via compiled exports.
- Dynamic import, lockfile alias, and partial source are not inspected.
- Clock is never invented (`Date.now()` unused).
- Not a paid job. `execute: false`. `paidDemand: false`.

## Exact files written

All under `experiments/s127-upgrade-impact/cells/c27-changelog-stub/`:

- `changelog.mjs`
- `compare.mjs`
- `scan.mjs`
- `semver.mjs`
- `index.mjs`
- `load-fixtures.mjs`
- `run-fixtures.mjs`
- `package.json`
- `CONTRACT.md`
- `DONE.md`
- `test/changelog.test.mjs`
- `fixtures/PROVENANCE.json`
- `fixtures/synthetic/same-version.json`
- `fixtures/synthetic/same-version-breaking-text.json`
- `fixtures/synthetic/major-no-changelog.json`
- `fixtures/synthetic/minor-no-changelog.json`
- `fixtures/synthetic/patch-no-changelog.json`
- `fixtures/synthetic/patch-docs-only.json`
- `fixtures/synthetic/breaking-removed-unused.json`
- `fixtures/synthetic/added-only-minor.json`
- `fixtures/synthetic/rename-keyword.json`
- `fixtures/synthetic/missing-versions.json`
- `fixtures/synthetic/unparseable-version.json`
- `fixtures/synthetic/unparseable-with-breaking-notes.json`
- `fixtures/synthetic/empty-changelog.json`
- `fixtures/synthetic/usage-must-be-ignored.json`
- `fixtures/synthetic/prerelease-unknown.json`
- `fixtures/synthetic/v-prefix-same.json`
- `fixtures/synthetic/unclassified-patch.json`
- `fixtures/from-sibling/real-a-path-to-regexp.json`
- `fixtures/from-sibling/real-b-cookie.json`
- `fixtures/from-sibling/real-b-cookie-patch-notes.json`
