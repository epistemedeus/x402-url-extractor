# Caller public merchant release 211973

One product commit on current merchant master publishes the already built caller download. Caller 0.1.0 and 0.1.1 archive bytes are unchanged. `hostedAcquisitionVerified` stays false. This is owner QA, not a merge, a deploy, a purchase, or independent demand.

## Source

| Fact | Value |
| --- | --- |
| Repository | `epistemedeus/x402-url-extractor` |
| Branch | `codex/caller-public-merchant-release-211973` |
| Default | `master` |
| Base | `c65fe578145bb6a21d001805e6b8b541e8dde58e` |
| Base tree | `bfb7e79acbcca4fe158c83a6c7d8cc88ab6ea03c` |
| Base parents | `32267493d29ff1339c5199185d8231012daf0acd` `94e45050e9d992ca2eb613cfb3850676217b9fb1` |
| Product commit | `30839ea2826be8df969e7a6901d4908151007de1` |
| Product tree | `72bccafb6ff02274b3ce40ac6c9035520261e297` |
| Shipping candidate consumed | `31434c53f1271af94de843368d30fd51fbb62835` tree `5cc599727d04af6e7bf91571cd50804fe297072f` |
| JSON-boundary comparison consumed | `678e6c9f347b66bdfdab4a6289d894a0b7a06dbc` tree `5118d4cdc3ceea29d38b84cee6f3eeb621e07981`, receipt `c4dac2f8a1c9dd5b2a9fd99c72343b8be084f314` tree `5a7391506e5370ab849902163b23908dfa354494` |

The product commit is the parent of this receipt. Its tree is the release package. This file names those ids and does not embed its own commit.

Master and `94e45050` share tree `bfb7e79`. The merge commit does not reverse PR 202. The 33 distribution paths were copied from `31434c53`. `git apply` of a non-binary diff failed on the three tar paths and changed nothing. `git checkout 31434c53 -- <paths>` wrote those paths. The predecessor 21 assets in `public-acquisition/manifest.json` still deep-equal the master assets. Caller assets make 29. That count is the loaded manifest, not a hardcoded target.

The 211965 review docs were not copied. The two boundary tests were. They are not members of either archive.

## Allowlist

```
caller-result-client-entry.mjs
caller-result-client.cold.test.mjs
caller-result-client.discovery.test.mjs
caller-result-client.distribution.test.mjs
caller-result-client/PIN.json
caller-result-client/README.md
caller-result-client/SOURCE-NOTICE.txt
caller-result-client/export/pack.mjs
caller-result-client/export/public/bytes/samedaydesk-caller-result/0.1.1/LICENSE
caller-result-client/export/public/bytes/samedaydesk-caller-result/0.1.1/SOURCE-NOTICE.txt
caller-result-client/export/public/bytes/samedaydesk-caller-result/0.1.1/provenance.json
caller-result-client/export/public/bytes/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz
caller-result-client/export/public/inventories/samedaydesk-caller-result-0.1.1.json
caller-result-client/export/public/manifest.json
caller-result-client/export/publish-combined.mjs
caller-result-client/package-lock.json
caller-result-client/package.json
caller-result-client/test/automation-json-boundary.mjs
caller-result-client/test/automation-json-boundary.test.mjs
caller-result-client/test/client.test.mjs
mcp-caller-result.md
mcp-task-recovery.test.mjs
package.json
public-acquisition/bytes/samedaydesk-caller-result/0.1.0/LICENSE
public-acquisition/bytes/samedaydesk-caller-result/0.1.0/SOURCE-NOTICE.txt
public-acquisition/bytes/samedaydesk-caller-result/0.1.0/provenance.json
public-acquisition/bytes/samedaydesk-caller-result/0.1.0/samedaydesk-caller-result-0.1.0.tar.gz
public-acquisition/bytes/samedaydesk-caller-result/0.1.1/LICENSE
public-acquisition/bytes/samedaydesk-caller-result/0.1.1/SOURCE-NOTICE.txt
public-acquisition/bytes/samedaydesk-caller-result/0.1.1/provenance.json
public-acquisition/bytes/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz
public-acquisition/cold-commands.json
public-acquisition/inventories/samedaydesk-caller-result-0.1.0.json
public-acquisition/inventories/samedaydesk-caller-result-0.1.1.json
public-acquisition/manifest.json
```

No `server.js`, homepage, offer, price, settlement, or credential path is in that list.

## Archives

| Version | Bytes | sha256 |
| --- | --- | --- |
| 0.1.0 | 24149 | `3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b` |
| 0.1.1 | 32421 | `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3` |

Both copies of each tar match those values after the gates. `node caller-result-client/export/pack.mjs` into an empty directory regenerated the 0.1.1 tar with the same sha256 and the same provenance bytes. There is no 0.1.2.

The 0.1.0 provenance sidecar is unchanged, sha256 `c00436d373f25c071e14bcd48f575982ee2dead8e7ae35b5e9cbe6c2888cda2c`, 1228 bytes. Its note still says the URL is not a hosted acquisition. Pack refuses to rewrite that sealed descriptor.

The 0.1.1 provenance sidecar note now says to download `originalUrl` and verify sha256. npm publication stays separate. Optional recovery stays included. Bytes 1552, sha256 `fdcc880b190848385156b92625d0b93f12959d21317654e63a13646ef6e68dca`. The previous sidecar was 1569 bytes, sha256 `f41891ae7d926971eb5ec597af375f30028d1ee5a4c6e30f40157e67697f69ce`. `draft`, `hostedAcquisitionVerified`, `productionHosted`, `privateGit`, `sourceQualification`, `paidLaunch`, `measuredSavings`, `independentDemand`, and `recognizedRevenueAtomic` are unchanged. The acquisition engine rejects a true `hostedAcquisitionVerified`. The Neo GET is not the merchant production readback in `public-acquisition/ROOT-READBACK.md`.

`SOURCE-NOTICE.txt` inside both archives still says the package is not a hosted acquisition. That sentence stays because changing it would change the sealed tar.

## Compatibility

SDK 1.30.0 keeps `structuredContent`, `_meta`, and `isError` through one JSON file and a second process. Unpaid `@x402/mcp` 2.16.0 returns `content`, `isError`, and `paymentMade`. The skill, `llms.txt`, and `mcp-caller-result.md` say to store the SDK tool result when a later JSON file must keep the useful result, the refusal, and the evidence association. A refused report leaves that stored result. No Make or Supabase connector was added. No workflow was supplied, so that loss remains unknown.

## Gates

Node `v22.23.3`, npm `10.9.9`, from `/tmp/native-task-recovery-211210-runtime/node-v22.23.3-linux-x64`. `PYTHONPATH=/tmp/native-task-recovery-211210-runtime/python-deps`.

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts` at the merchant root | exit 0, 244 packages, wall 3.846 s |
| `npm ci --ignore-scripts` in `caller-result-client` | exit 0, 99 packages, wall 0.918 s |
| `node --test --test-concurrency=1 test/automation-json-boundary.test.mjs test/client.test.mjs test/recovery.test.mjs` | exit 0, 31 tests, 31 pass, 0 fail, `duration_ms` 453.625345, wall 0.482 s |
| `npm test` | exit 0, 1171 tests, 1167 pass, 0 fail, 4 skip, `duration_ms` 122153.2827, wall 122.370 s |
| `npm run test:nonlive` | exit 0, 194 tests, 194 pass, 0 fail, 0 skip, `duration_ms` 8567.155729, wall 8.694 s |

The four skips, unchanged:

- `deployed extract advertises machine documentation`
- `official offline validator accepts exact commit package when pin is supplied` (`Set XAGT_PLUGIN_ROOT to the clean official pin for this gate`)
- `sidecar detects a skip-worktree modification to the official validator` (`Official validator checkout not supplied`)
- `unpaid initialize-era initialize and tools/list require extract and extract_batch`

1167 is the pass count. 1171 is the test count. The skips are not passes.

`npm test` rewrote `public-acquisition/loopback-profile.json` with this VM's Node path and an ephemeral port. That file was restored and is not in the product commit.

The passing distribution test unpacked 0.1.1 with the merchant checkout absent, resumed after a lost paid response, and kept verify at 1 and settle at 1. Its diagnostic: `merchantCheckoutPresent` false, `secondPaidVerify` false, `secondPaidSettle` false. Grant mismatches exited 2 and did not add a payment call. The boundary test stored a useful result, then a refused report, and the stored bytes stayed the same. Payment-client reads were 0.

## Observed hosted scope

Anonymous GET on 2026-10-11, after the stated Hostinger build `01a12c73-60ee-7232-a03c-a5c145352e41`:

| URL | Status | Type | Bytes | sha256 |
| --- | --- | --- | --- | --- |
| `https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.0/samedaydesk-caller-result-0.1.0.tar.gz` | 200 | `application/gzip` | 24149 | `3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b` |
| `https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz` | 200 | `application/gzip` | 32421 | `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3` |
| `https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.0/descriptor.json` | 200 | JSON | 1227 | archive sha matches 0.1.0 |
| `https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.1/descriptor.json` | 200 | JSON | 1422 | archive sha matches 0.1.1, modules include `recovery`, `npmPublished` false |
| `https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.1/provenance.json` | 200 | JSON | 1569 | still the old note, sha256 `f41891ae7d926971eb5ec597af375f30028d1ee5a4c6e30f40157e67697f69ce` |
| `https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.0/provenance.json` | 404 | HTML |  | not a published sidecar |
| `https://agents.samedaydesk.com/.well-known/public-acquisition/index.json` | 200 | JSON | 20495 | 21 assets, no caller id, `hostedAcquisitionVerified` false, schema `samedaydesk.public-acquisition.document.v1` |

The merchant origin does not yet serve this commit. Neo git `2a96095b05badf45307c337de6eb6fa8e3ed8107` returned 404 to this token, so this checkout was not edited and nothing was pushed there. `neo-0.1.1-provenance-note.patch` is the one-file note change for `public/downloads/samedaydesk-caller-result/0.1.1/provenance.json`, against the live file that matches the pre-change sidecar. The descriptor already names the archive and does not need a second hunk. `SOURCE-NOTICE.txt` is served and still denies a hosted acquisition, and it is also a member of the sealed tar, so it is not in the patch. Root can apply the note after 211971. This run did not.

## Next receiving decision

Root can merge `30839ea` onto master and deploy the merchant index. Until that deploy, agents.samedaydesk.com still shows 21 assets. The Neo archive URLs already return the sealed bytes. The provenance note on Neo stays the old sentence until the patch is applied and rebuilt. No npm publication, paid recovery, purchase, or income is established.
