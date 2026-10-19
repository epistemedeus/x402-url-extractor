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
| Package identity | `lib/parse-lockfile.mjs` | same CLI and library compare | Whole `node_modules` path segments name a packages entry when `entry.name` is absent. A locked legacy `npm:<name>@<strict-semver>` value exports that target name and version. The install key stays `id`. Ranges, tags, git, file, remote, nested `npm:`, and other non-locked specifiers stay on the install key and the original version text. Reordered integrity text remains a field change. Missing integrity, `link: true`, and bundled children keep their previous inclusion rules. | `test/identity.test.mjs` | none |
| Later wrapper bind | W5-M01 | not in this package | PR52 `aeef964fa188443078958d9d6d393afae1d542ee` wrapper/catalog does not list this job. Bind `bin/lockfile-delta.mjs` when that owner adds it. | none here | W5-M01 |

Outputs are a nonsettling prototype. They are not an npm install, audit, purchase, or settlement.

## Identity contract

The packages map and the legacy dependencies fallback export the same package name and version when both describe one locked install. `entry.name`, when present, is the package name. Otherwise the name is the path after the last whole `node_modules` segment, or the decoded target of a locked `npm:` alias. `id` remains the install location, including an alias key such as `node_modules/renamed`.

Locked alias grammar is `npm:` plus a package name plus `@` plus a strict semver version (`1.2.3`, `1.2.3-rc.1`, `1.2.3+build.1`). Scoped targets use `npm:@scope/name@1.2.3`. The decoder does not fetch metadata, install a dependency, or treat equal integrity as proof of identity.

ROOT678 recorded the pre-repair behavior of source `fba9d148` separately from this contract. A scope containing the text `node_modules` was truncated to the text after that substring. A legacy alias kept the install key as `name` and the whole `npm:` specifier as `version`. Those observations belong to that frozen export. Current behavior is the contract above. Contributor-minimized issue bodies are qualification inputs, not this package's fixtures. Optional-peer absence remains unproved for the supplied issue 124 record, so incomplete, optional, dev, and peer pins stay in the delta.
