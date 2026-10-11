# Caller complete receiving 211906

Cold receiving was replayed on the frozen merchant feature, and the Neomorphic materializer now rejects absent, extra, empty, and malformed archive parts before it writes. This is not a hosted acquisition and not a joined-site pass. Root owns merges, Railway, Hostinger, and anonymous readback. No pull request, deploy, payment, signing, or new database was used.

`hostedAcquisitionVerified` stays false. `sourceQualification` stays unknown. `paidLaunch` stays false. `recognizedRevenueAtomic` stays `"0"`. Sealed 0.1.0 is unchanged. No 0.1.2 was added.

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

No merchant product file changed. Authorization, grants, paid execution, cold-command needles, and the combined index stay as `31434c53` left them. The first six failures stay in that history: version-only archive selection, then five lifecycle `partial` results before the two identity cold commands. The retained suite on that head is `npm test` 1171 tests, 1167 pass, 0 fail, 4 skip, exit 0, and `test:nonlive` 194/194. It was not re-run, and it was not edited to look greener.

### Cold recovery replay

Runtime: Node `v22.23.3` (`/tmp/native-task-recovery-211210-runtime/node-v22.23.3-linux-x64/bin/node`), npm `10.9.9`.

Command: `node --test --test-timeout=240000 caller-result-client.distribution.test.mjs` filtered to `advertised caller archive installs recovery with the merchant checkout absent`.

Exit 0. 1 pass, 0 fail, `duration_ms` 5336.948436. The harness installed the extracted 0.1.1 package and called `resume` with the merchant checkout absent. `secondPaidVerify` false. `secondPaidSettle` false. The same test still covers tenant, grant, origin, expired, revoked, and budget refusals without a second paid verify or settle. Identity `node -e` cold commands were left in place so lifecycle disposition stays `received`.

Receipt fields: archive URL `https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz`, sha256 `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3`, version `0.1.1`, `publishedArchiveCanary` false, `combinedMountedIndex` true, `merchantCheckoutPresent` false.

## Neomorphic source gate

| Fact | Value |
| --- | --- |
| Repository | `epistemedeus/neomorphic-io` |
| Branch | `codex/caller-complete-receiving-211906` |
| Head | `79190370f56309e2c86b10ca5418b4b92011f78d` |
| Previous commit on that branch | `c0ee80c30b75882f3763b50cbf5654c02f155c30` |
| Static feature | `codex/caller-recovery-static-211888` still at `c0ee80c30b75882f3763b50cbf5654c02f155c30` |
| Base | `df2ab3d26b767c3889db219fc2a1003603901e73` |
| Materializer blob | `c461c2ad66f850d1ee3ea9827a994cc4dc29dfe9` (was `ef73d3db5e47968a9b54811f09300ea26fa7bb3b`) |
| Parts test blob | `32d859836ddb1be3b10066fc91bed79649285c93` |
| `package.json` | unchanged blob `b9491c3c80d8db3e26fbf1cdf141dbb8ed424bc2` |

Allowlisted delta versus `c0ee80c3`:

```
scripts/materialize-caller-result-0.1.1.mjs
tests/caller-result-0.1.1-parts.test.mjs
```

The contents API did not return a commit tree id. `c0ee80c3` and `3c37bbee` tree ids were also not returned.

### Source-only gate

Runtime: Node `v22.23.3`, npm `10.9.9`.

Command: `node --test tests/caller-result-0.1.1-static.test.mjs tests/caller-result-0.1.1-parts.test.mjs`

Exit 0. 5 pass, 0 fail, `duration_ms` 304.860202. Cases: wrapped part 03 materializes sha `69365256…` and 32421 bytes; a sibling 0.1.0 sentinel is not rewritten; a second run is idempotent; a different existing tar is refused; unexpected `0300`, whitespace-only `06`, and `notes.txt` are refused; missing part 03 is refused; `!!!!not-base64!!!!` and a whitespace-only part 02 are refused before a length check.

Before that edit, the unmodified `c0ee80c3` materializer exited 0 for an extra `notes.txt`, and it reported only a length mismatch for extra numeric `0300`, a missing part 03, and malformed part 00.

### Install and build on the partial checkout

`npm ci --ignore-scripts` added 206 packages, exit 0. Ordinary `npm ci` without `--ignore-scripts` was not run. `npm run prebuild` on that checkout exited 0 and wrote the 32421-byte archive at sha256 `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3`.

`npm run build` is not a full-site pass. An earlier run, before the nested pages were present, built 16 pages and exited 0 through `astro build`, `build.js`, and `record-lab-licenses.mjs`. After the nested pages were added, the same command exited 1. The current stop is Vite `UNRESOLVED_IMPORT` of `src/lib/reward-receiving/publish.mjs` from `src/pages/api/bounties.json.ts`. Further page imports are still absent, including several browser UI scripts and `src/lib/effort-workflow/assemble.ts`. About 200 repository files are in the local checkout. That is not the site.

`node scripts/normal-release.mjs` was not run. `normal-release.mjs` is not in the partial checkout. This VM has Python 3.12.3. `python3.14` and `uv` are absent, so the Hermes step in that gate would fail closed. It was not stubbed.

## Archives

| Archive | Bytes | sha256 |
| --- | --- | --- |
| Sealed 0.1.0 | 24149 | `3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b` |
| 0.1.0 git blob | | `4a7a485258ff344db8a8cc881e6596725e5d2fe1` |
| Final 0.1.1 | 32421 | `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3` |
| Earlier unreleased 0.1.1 on `6ea1294` | 32489 | `ed5a00d52e15ccd098a7c054db00b2a929d884df3e926c9437bb3514af5c65fc` |

Both sealed and final archives were hash-checked on disk in the partial checkout after prebuild. The 29-asset index and the 32421-byte archive remain candidate facts until Root's anonymous readback.

## Shadow versus 3c

Recorded separately from the c0 source-only gate. `3c37bbee5c2c6d4196175b5cebb70321ae3d2533` was not modified. `main` at `df2ab3d26b767c3889db219fc2a1003603901e73` was not modified. The Astra review queue was not touched.

`3c37bbee` only adds `deploy/service-launch-211863/**`. Its parent `659c0392ee5b4f768318de9cbd8a446ebedde995` changes correspondence continuation sources, `scripts/pack-correspondence-mcp.mjs`, `scripts/test-pack-correspondence-mcp.mjs`, and the 211870/211881 continuation archives. None of those paths are in the `79190370` delta, and that commit does not change root `package.json`. The caller prebuild prefix and the correspondence packer are additive. No shadow tree was checked out, and the combined prebuild, build, and normal-release were not run. A passing caller package is not that joined-site result.

## Root release order

1. Keep merchant `31434c53` frozen. Do not drop the original 21 assets or the first six failures.
2. Review Neomorphic `79190370` on top of `c0ee80c3`. The only product change is the stricter materializer and its regression test.
3. Finish a byte-exact checkout of that head, then run unmodified `npm ci`, `npm run prebuild`, `npm run build`, and `node scripts/normal-release.mjs` with Python 3.14. Do not treat the partial build as the site.
4. Overlay the 3c continuation files onto a disposable copy of that same tree and repeat those gates. Leave the 3c branch alone.
5. Anonymous readback of the 0.1.1 URL and the live 29-asset index. Until that readback, hosted acquisition stays false.

## Remaining

- The private site is not attached to this VM. File-scoped contents downloads were the authenticated path. They are not a complete checkout.
- Joined `npm run build` and `normal-release` have not passed.
- The shadow integration has not been built.
- Plain `npm ci` without `--ignore-scripts` was not recorded.
- Python 3.14, uv, and Hermes are not on this VM.
