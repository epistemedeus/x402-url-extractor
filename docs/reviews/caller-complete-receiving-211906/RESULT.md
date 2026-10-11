# Caller complete receiving 211906

Two surfaces were received on this Cursor Cloud VM with Node v22.23.3 and npm 10.9.9. The merchant cold client installed the extracted 0.1.1 archive and resumed with the merchant checkout absent. The Neomorphic checkout ran ordinary `npm ci`, prebuild, an 80-page build, and unmodified `node scripts/normal-release.mjs`. This is not a hosted acquisition and not a joined-site pass. Root owns merges, Railway, Hostinger, and anonymous readback. No pull request, deploy, payment, signing, or new database was used.

`hostedAcquisitionVerified` stays false. `sourceQualification` stays unknown. `paidLaunch` stays false. `recognizedRevenueAtomic` stays `"0"`. Sealed 0.1.0 is unchanged. No 0.1.2 was added. The 29-asset index and the 32421-byte 0.1.1 archive remain candidate facts.

## Merchant

| Fact | Value |
| --- | --- |
| Repository | `epistemedeus/x402-url-extractor` |
| Branch | `codex/public-caller-shipping-211888` (unchanged product) |
| Head | `31434c53f1271af94de843368d30fd51fbb62835` |
| Tree | `5cc599727d04af6e7bf91571cd50804fe297072f` |
| Base | `6ea1294b8693f2c655d239f0870800e93bfff040` |
| Base tree | `8610d39cca584f176bcc5f9cae24f442a38c6ba9` |
| Evidence of 211888 | `c9d5e1aa6fce251d2de432016f257f9bad2c2ed5` in this repository, not Pilot |
| This closure branch | `codex/caller-complete-receiving-211906` |

No merchant product file changed. Authorization, grants, paid execution, cold-command needles, and the combined index stay as `31434c53` left them. The first six failures stay in that history: version-only archive selection, then five lifecycle `partial` results before the two identity cold commands. The retained suite on that head is `npm test` 1171 tests, 1167 pass, 0 fail, 4 skip, exit 0, and `test:nonlive` 194/194. It was not re-run.

### Cold recovery replay

Runtime: Node `v22.23.3` at `/tmp/native-task-recovery-211210-runtime/node-v22.23.3-linux-x64/bin/node`, npm `10.9.9`.

Command: `node --test --test-timeout=240000 caller-result-client.distribution.test.mjs`, filtered to `advertised caller archive installs recovery with the merchant checkout absent`.

Exit 0. 1 pass, 0 fail. The harness installed the extracted 0.1.1 package and called `resume` with the merchant checkout absent. `merchantCheckoutPresent` false. `secondPaidVerify` false. `secondPaidSettle` false. `publishedArchiveCanary` false. `combinedMountedIndex` true.

Receipt archive URL `https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz`, sha256 `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3`.

## Neomorphic source gate

| Fact | Value |
| --- | --- |
| Repository | `epistemedeus/neomorphic-io` |
| Branch | `codex/caller-complete-receiving-211906` |
| Published head | `79190370f56309e2c86b10ca5418b4b92011f78d` |
| Parent | `c0ee80c30b75882f3763b50cbf5654c02f155c30` |
| Static feature | `codex/caller-recovery-static-211888` still at `c0ee80c3` |
| Base | `df2ab3d26b767c3889db219fc2a1003603901e73` |
| Checkout used for gates | `79190370` plus the Hermes cache-reuse bytes below |

`79190370` only changes `scripts/materialize-caller-result-0.1.1.mjs` and adds `tests/caller-result-0.1.1-parts.test.mjs`. The materializer requires exactly parts `00` through `05`, rejects any other directory entry, checks base64 before length, and does not rewrite sealed 0.1.0.

### Allowlisted Hermes delta

The declared Hermes paths in `receiving-inputs.json` are absent on this VM. A pin-matching cache already exists at `/tmp/neomorphic-normal/1000`. The previous planner treated that cache as a cold materialization and then refused to replace the interpreter that was already there. `planHermes` now reuses a cache whose head and `tools/skills_guard.py` blob match pin `2f80ae0a6a91932b1808a53f9c55f8b3f313d6cc` when the cached Python is usable, and it still refuses a cache that exists and does not match the pin.

These three blobs are the checkout delta. They are copied under `shipping-source/`. They are not a new commit on `codex/caller-complete-receiving-211906`. The shell GitHub credential cannot see the private repository, so that branch was left at `79190370` instead of being recreated from `main`.

| File | Blob |
| --- | --- |
| `scripts/normal-release.mjs` | `3d813b6476edf73f058fa260f61cd813255752c0` |
| `scripts/normal-release-lib.mjs` | `50e3ba728a7eb130fbe417ff7334c6b0d993d768` |
| `tests/normal-release.test.mjs` | `d7ece0f8a02f6c094498c764aca0aea5fd8a96fb` |

`package.json` blob stays `b9491c3c80d8db3e26fbf1cdf141dbb8ed424bc2`. The materializer blob stays `c461c2ad66f850d1ee3ea9827a994cc4dc29dfe9`.

### Runtime and commands

Supported runtime: Node `v22.23.3`, npm `10.9.9`, Python `3.14.8` at `/tmp/neomorphic-normal/1000/hermes-venv/bin/python`, Hermes pin `2f80ae0a6a91932b1808a53f9c55f8b3f313d6cc`, scanner `skills-guard-v8`.

| Command | Exit | Result |
| --- | --- | --- |
| `npm ci` | 0 | 206 packages |
| `npm run build` (prebuild, then Astro, `build.js`, lab licenses) | 0 | 80 pages. Prebuild rewrote nothing: 0.1.1 stayed 32421 bytes, sha256 `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3` |
| `node scripts/normal-release.mjs` | 1 | Prefix suites 20, 12, 9, 26, 9, and 3 tests, all pass. `tests/*.test.mjs`: 501 tests, 500 pass, 1 fail, 0 skip, `duration_ms` 124328.34697. The one failure is `tests/product-purity.test.mjs`: `git ls-files` exits 128, `fatal: not a git repository`. `npm run test:regression-corpus` was not reached |

`NORMAL_INPUTS` on that run reused Node v22.23.3 and the Hermes cache above. It did not reinstall Hermes.

Public cold workflow in the same suite: `anonymous HTTP acquires both executables and exercises the cold workflow` passed. Caller file `tests/received-useful-work-caller.test.mjs`: 3 pass, 0 fail, exit 0, `duration_ms` 17396.168005. The five-library stripped run passed in 15658.505341 ms. Receipt: `trial=legacy_projection_refusal`, `retained=useful_read`, `compose=admissible`, `conflict=enrollment_conflict`, `mismatch=mismatch`, `stale=source_not_current`. No new payment.

### Archive identities

| Archive | Bytes | sha256 | Git blob |
| --- | --- | --- | --- |
| `samedaydesk-caller-result-0.1.0.tar.gz` | 24149 | `3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b` | `4a7a485258ff344db8a8cc881e6596725e5d2fe1` |
| `samedaydesk-caller-result-0.1.1.tar.gz` | 32421 | `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3` | candidate, not hosted |

Both public and `dist` copies matched after `npm run build`. Route-lock and release-gate packs match their frozen archives when the bin files are mode `0755`, which is the mode already in those frozen tarballs. npm 10.9.9 copies the filesystem mode.

## Shadow integration

Candidate `3c37bbee5c2c6d4196175b5cebb70321ae3d2533`, tree `881cd5997aa4134718926eda91520b4a81a0788c`, same base `df2ab3d`. It only adds `deploy/service-launch-211863/` (27 files). No path overlaps the caller materializer, prebuild, or the public packers. The `3c` branch, `main`, and the Astra review were not modified. The overlay was copied onto a disposable tree of the source checkout.

| Command on the shadow | Exit | Result |
| --- | --- | --- |
| `npm ci` | 0 | 206 packages |
| `npm run build` | 0 | 80 pages. 0.1.0 and 0.1.1 identities unchanged |
| `node scripts/normal-release.mjs` | 1 | Same shape as the source gate: prefix suites green, 501 tests, 500 pass, 1 fail (`product-purity`, not a git repository), `duration_ms` 123120.704746. Regression corpus not reached |
| `npm ci --prefix services/correspondence && npm run build --prefix services/correspondence` | 0 | `tsc` only. No database |
| `node --test` on `deploy/service-launch-211863/tests/manifest.test.mjs` and `gates.test.mjs` | 1 | 9 tests, 7 pass, 2 fail |

The two remaining deploy failures are environmental. `stale stop refuses an unrelated live process` stops because `/usr/local/lib/node-v22.23.2-linux-x64/bin/node` is absent. `help and source closure check exit 0` runs `git diff --name-only 659c0392ee5b4f768318de9cbd8a446ebedde995` and the shadow is not a git repository. Passing tests cover the engine pin `22.23.2`, wrong-node refusal before a runtime directory, invalid-origin refusal, compose manifest, secret checker, role-script refusal, and the unaccepted 22.14 rate-10000 receipt.

`launch-readiness.test.mjs` and `rate-limit.test.mjs` were not run. Both cold-bootstrap Postgres. No new database was created.

The source-only gate and this shadow stay separate. A passing isolated package is not this joined-site result, and this result is not a hosted daemon.

## Root release order

1. Keep merchant `31434c53` frozen. Do not drop the first six failures or the four historical skips.
2. Review Neomorphic `79190370` and the three Hermes blobs in `shipping-source/` before any merge.
3. A byte-exact git checkout is still required before `product-purity` and the regression corpus can run. Do not invent an index.
4. Anonymous readback of the 0.1.1 archive and the 29-asset index is still required before `hostedAcquisitionVerified` can become true.
5. The 22.23.2 binary and a real git worktree are still required before the two remaining deploy checks can pass. Do not start the Postgres launch tests as a substitute.

## Observations

The public-delivery cold path needed `packs/bounty-discovery/src/five-source/` and `packs/bounty-discovery/vendor-readonly/h02-five-source/src/`, plus `packages/retained-task/test/support.mjs`. Those files were fetched from `79190370` and checked with `git hash-object` before use. The checkout is still not the full git tree, which is why `product-purity` fails closed.
