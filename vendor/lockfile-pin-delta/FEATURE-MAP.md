# Lockfile pin-delta feature map

Offline SameDayDesk job. Compares two npm `package-lock.json` files (lockfileVersion 2 or 3) and emits added, removed, and changed name+version+integrity+resolved pins. Equality uses those lockfile fields. `termsHash` is an annotation. Vendor-budget-impact remains curated pricing rows; this job is lockfile pins only.

Current contract export (W5-M03 on this branch). Consumers bind this CLI and `lib/index.mjs`. Do not inject I01 `hashRequest` as pin equality. That hasher covers a different document.

| Goal | Entrypoint | Command | State | Tests | Prerequisite |
| --- | --- | --- | --- | --- | --- |
| Caller pin brief | `bin/lockfile-delta.mjs` | `node bin/lockfile-delta.mjs --before <lock> --after <lock> [--out-dir <dir>]` | Writes `pin-delta.json` and `pin-delta.md`. Status `actionable` when a pin field changes. CLI `digest` is SHA-256 of the written `pin-delta.json` bytes. Unchanged packages omitted. `purchaseAuthority` always false. | `test/cli.test.mjs` journey | Node >= 22. Local files only. |
| Labeled example | same | `--example` | Loads `fixtures/journey/`. `sampleLabel=explicit-example`. Not a customer delta. | `--example` CLI test | none |
| Integrity-only edit | `lib/compare.mjs` + `lib/hash-terms.mjs` | same CLI | Same version, different integrity is a change. | integrity-only test | none |
| Git / resolved edit | `lib/parse-lockfile.mjs` | same CLI | Same name+version+integrity with a different `resolved` (including git `#commit`) is a change. `changeKinds` includes `resolved`. | git-resolved CLI; v2-git-deps CLI; SDS resolved-only CLI | none |
| HTML / package.json refuse | `lib/parse-lockfile.mjs` | same CLI | Exit 2, `html-input` or `package-json-only`. Analysis refusal, not a crash. | seeded CLI tests | none |
| Missing integrity | compare | same CLI | Status `partial`, still lists known deltas including resolved-only git pins | missing-integrity fixture; v2-git-deps | none |
| SAMPLE as customer | `lib/sample.mjs` | caller `--before/--after` on SAMPLE fixtures, or `--example --as-customer` | Refuses `sample-as-customer-delta` | seeded CLI test | none |
| Constant / unlike hasher | `compareLockfileTexts` `hashPinTerms` option | library / process import | Injected constant or unstable hasher cannot erase or invent pin-field differences. I01 whole-terms hashes stay a different schema. | process constant-hasher test; unstable hasher self-compare | none |
| SDS local lock | parse of repo `package-lock.json` | tests only; do not modify that file | lockfileVersion 3, `packages` map | `test/local-runtime.test.mjs` | SDS checkout with root lockfile |
| Later wrapper bind | W5-M01 | not in this package | PR52 `aeef964fa188443078958d9d6d393afae1d542ee` wrapper/catalog does not list this job. Bind `bin/lockfile-delta.mjs` when that owner adds it. | none here | W5-M01 |

Outputs are a nonsettling prototype. They are not an npm install, audit, purchase, or settlement.
