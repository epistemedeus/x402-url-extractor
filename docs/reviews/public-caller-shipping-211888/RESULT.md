# Public caller shipping 211888

One tested two-surface candidate for optional recovery. The merchant combined index advertises the caller archives, and the Neomorphic static feature can materialize the same 0.1.1 bytes during its ordinary build. This is not a hosted acquisition. Root owns the merchant and Hostinger releases and the later anonymous readback. No pull request, default merge, deploy, payment, or wallet action was taken.

The prior loopback package on `codex/public-caller-recovery-211883` (`6ea1294b8693f2c655d239f0870800e93bfff040`, tree `8610d39cca584f176bcc5f9cae24f442a38c6ba9`) and its evidence `bff5fffe455c89f2d1697c6146703c3dd968eb2f` stay unchanged. That loopback is not public acquisition. Root's anonymous 13:14 UTC check still stands until Root publishes: the advertised Neomorphic 0.1.1 archive was HTTP 404, and the live merchant `/.well-known/public-acquisition/index.json` had 21 assets and zero caller assets.

## Merchant

| Fact | Value |
| --- | --- |
| Branch | `codex/public-caller-shipping-211888` |
| Head | `31434c53f1271af94de843368d30fd51fbb62835` |
| Tree | `5cc599727d04af6e7bf91571cd50804fe297072f` |
| Base | `6ea1294b8693f2c655d239f0870800e93bfff040` |
| Base tree | `8610d39cca584f176bcc5f9cae24f442a38c6ba9` |
| Archive source commit | `72ef93bd0350b8bcd67a6ec0f048515d0533f199` |
| Archive source tree | `e2bf0db9e1d1b33d57809a3ec6f1d090a208ac8c` |
| Merchant version | `1.23.52` (unchanged) |
| Caller package | `samedaydesk-caller-result` `0.1.1` |

Commits on this feature, oldest first:

1. `72ef93bd0350b8bcd67a6ec0f048515d0533f199` publishes the regenerated 0.1.1 archive on the combined index.
2. `29a155d3a8d358d43ec352bf2698cf72d11a2875` points discovery at that source commit.
3. `31434c53f1271af94de843368d30fd51fbb62835` adds the two identity cold commands and selects the caller archive by id.

The earlier unreleased 0.1.1 candidate remains on `6ea1294`: sha256 `ed5a00d52e15ccd098a7c054db00b2a929d884df3e926c9437bb3514af5c65fc`, 32489 bytes. This feature does not overwrite it and does not add a 0.1.2.

### Allowlist

```
caller-result-client-entry.mjs
caller-result-client.discovery.test.mjs
caller-result-client.distribution.test.mjs
caller-result-client/README.md
caller-result-client/SOURCE-NOTICE.txt
caller-result-client/export/pack.mjs
caller-result-client/export/public/bytes/samedaydesk-caller-result/0.1.1/SOURCE-NOTICE.txt
caller-result-client/export/public/bytes/samedaydesk-caller-result/0.1.1/provenance.json
caller-result-client/export/public/bytes/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz
caller-result-client/export/public/inventories/samedaydesk-caller-result-0.1.1.json
caller-result-client/export/public/manifest.json
caller-result-client/export/publish-combined.mjs
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

`public-acquisition/loopback-profile.json` is unchanged from `6ea1294` (blob `1e96c3ac46c7420991809181c3d5635ec292a0ca`, sha256 `e9a6d955f9073eb92b3aaf2333a1f3c2f28437d74801f73613479735a48488c8`). The suite rewrote it and it was restored. It is not part of the feature diff.

## Neomorphic

| Fact | Value |
| --- | --- |
| Repository | `epistemedeus/neomorphic-io` |
| Branch | `codex/caller-recovery-static-211888` |
| Head | `c0ee80c30b75882f3763b50cbf5654c02f155c30` |
| Base | `df2ab3d26b767c3889db219fc2a1003603901e73` |
| Main at recording | `df2ab3d26b767c3889db219fc2a1003603901e73` |

Main had not moved. The first feature commit's parent is that main commit. The contents API did not return a commit tree id for this private repository. Directory trees that were returned:

- `public/downloads/samedaydesk-caller-result/0.1.0` is `1cef088dcd023a95296a727ab9a4186da4940502` on both main and this feature.
- `public/downloads/samedaydesk-caller-result/0.1.1` sidecar tree is `bc35ff44f7b9bb41185b867d0fbc2a1c891f1676`.

`package.json` on main is blob `85792298e84c1495ae7543d38a506791d4f11b92`. On this feature it is blob `b9491c3c80d8db3e26fbf1cdf141dbb8ed424bc2`. The prebuild script is the same chain with `node scripts/materialize-caller-result-0.1.1.mjs && ` prepended.

### Allowlist

```
package.json
scripts/materialize-caller-result-0.1.1.mjs
scripts/fixtures/samedaydesk-caller-result-0.1.1.tar.gz.b64.d/00
scripts/fixtures/samedaydesk-caller-result-0.1.1.tar.gz.b64.d/01
scripts/fixtures/samedaydesk-caller-result-0.1.1.tar.gz.b64.d/02
scripts/fixtures/samedaydesk-caller-result-0.1.1.tar.gz.b64.d/03
scripts/fixtures/samedaydesk-caller-result-0.1.1.tar.gz.b64.d/04
scripts/fixtures/samedaydesk-caller-result-0.1.1.tar.gz.b64.d/05
tests/caller-result-0.1.1-static.test.mjs
public/downloads/samedaydesk-caller-result/0.1.1/INSTALL.md
public/downloads/samedaydesk-caller-result/0.1.1/LICENSE
public/downloads/samedaydesk-caller-result/0.1.1/SOURCE-NOTICE.txt
public/downloads/samedaydesk-caller-result/0.1.1/descriptor.json
public/downloads/samedaydesk-caller-result/0.1.1/provenance.json
```

The 0.1.1 gzip is not a git blob. `npm run build` runs the materializer before Astro copies `public/` into `dist/`. The materializer concatenates the numeric part files, strips whitespace, checks length 32421 and sha256, and writes the tar. Parts 00, 01, 02, 04, and 05 are single-line base64. Part 03 is wrapped at 80 columns (blob `271bfa467f401d3be77f9f3f3fc9040536a1966b`, 7296 bytes) because a single-line upload of that part dropped two bytes. A local materialize of the wrapped part plus the other exact parts produced the merchant archive.

Feature history also contains encoding-probe commits (`c6ad261`, `76e5248`, `a392efc`, `1ef98d8`, `f082c48`, `16966bb`, `f54e066`, `6ae2e28`). Each probe was removed by the following commit. Those commits are history only.

Sidecar blobs:

| Path | Blob | Bytes |
| --- | --- | --- |
| INSTALL.md | `dd706ede36328281e8964a400b3e912b208c203a` | 973 |
| LICENSE | `34e784554d75f424552ad2198708c8d99c5b4b67` | 1068 |
| SOURCE-NOTICE.txt | `87a79dfe9a6a9cbb5785a4579bbfcdfc9650c986` | 557 |
| descriptor.json | `c453641f515120eeec850dd499dbdf6816ae001a` | 1422 |
| provenance.json | `56efb38a64fd76f89a621c816f2278f4b2341465` | 1569 |
| materializer | `ef73d3db5e47968a9b54811f09300ea26fa7bb3b` | 2240 |
| static test | `ce12d00a6db546aa198fe926b55ab574824e5e14` | 5741 |

LICENSE matches the published 0.1.0 LICENSE blob.

## Frozen archive

Final 0.1.1, regenerated on this merchant feature only:

- URL: `https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz`
- sha256: `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3`
- bytes: 32421
- inventory: `public-acquisition/inventories/samedaydesk-caller-result-0.1.1.json`
- inventory sha256: `2072942b7baf1916ac11c77ef906647df9e3057d62706aa14215157327fdfd06`
- members: 15
- source URL: `https://github.com/epistemedeus/x402-url-extractor/tree/72ef93bd0350b8bcd67a6ec0f048515d0533f199/caller-result-client`

Sealed 0.1.0, unchanged:

- sha256: `3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b`
- bytes: 24149

0.1.1 sidecars on the merchant index:

| Role | sha256 | Bytes |
| --- | --- | --- |
| LICENSE | `c9e2795d29bf1008cbd36ac045bd3c77d537438a51d8dda34e158f4e82a6a27c` | 1068 |
| provenance.json | `f41891ae7d926971eb5ec597af375f30028d1ee5a4c6e30f40157e67697f69ce` | 1569 |
| SOURCE-NOTICE.txt | `45b2b240d5bbd8412a399b3bd5e93f38c3d30a8496e71693ab58a2177170e850` | 557 |

Provenance stays unpromoted: `sourceQualification` `unknown`, `hostedAcquisitionVerified` false, `paidLaunch` false, `recognizedRevenueAtomic` `"0"`. The note says the original URL is a path convention, this draft is not a hosted acquisition and not an npm publication, and optional recovery is included.

The removed internal sentences are absent from the 0.1.1 guide, README, and SOURCE-NOTICE. The guide still says payment authorization is explicit, 0.1.0 is feedback only, and the supported install is the archive command below. The sealed 0.1.0 SOURCE-NOTICE still contains its original recognized-revenue sentence and was not edited.

0.1.1 members:

| bytes | sha256 | path |
| --- | --- | --- |
| 1068 | `c9e2795d29bf1008cbd36ac045bd3c77d537438a51d8dda34e158f4e82a6a27c` | LICENSE |
| 1190 | `a2efcd34564b3553c0265ce83403a35ea6943a2561508aba5eef5eb0ff23b234` | PIN.json |
| 3264 | `14a4b3c1e360bd7a04df518f4d6c9f008c4f6805fb8c521f16c487c365be6619` | README.md |
| 557 | `45b2b240d5bbd8412a399b3bd5e93f38c3d30a8496e71693ab58a2177170e850` | SOURCE-NOTICE.txt |
| 14650 | `fec6953687d43443d37c0769ffdc600c67d8a84da9e83db4a22e6dac13478ca1` | bin/cold-consumer.mjs |
| 2767 | `02d6da2ff46f5d81bcd2a2df5815db657b1f437b831cd430ad7a2eded70ea2ee` | bin/recover-mcp.mjs |
| 44557 | `502cd589d8d45658678771aa36c5c7482d78b7bef3cbdce08d80ac2388f1c9f8` | package-lock.json |
| 696 | `8da772ada757e9fe1084ac862aa2c833077bbd665a1157b6e00f9d0ab622c79c` | package.json |
| 1953 | `59c40aafbcac837a99081c9345c84019807edfb3affe83ee2c1dc2e6960e96bc` | src/contract.mjs |
| 12703 | `8fe3eee467a3326696d8a1bb7e52d16fe393fb536973e5378f5a6333aef5ee94` | src/http-caller-result.mjs |
| 703 | `2a4fc79cc999410c1f16b471c64a58e2f924cf74c53eeafeaa2f89c1e099325c` | src/index.mjs |
| 7664 | `286ef8adf64e089b8eb18930a1872c81cbb1d9155cd6add17aeeaa3ee89cef4b` | src/mcp-caller-result.mjs |
| 14274 | `749e5b3e9d904887cb4e77893fba6f8630b569b647a41527c35b339e96f00035` | src/mcp-recovery.mjs |
| 5456 | `ccc6bc49f847f38d35e49749ef1282811dfdffce860cc22e161348f1ebfb4cb1` | test/client.test.mjs |
| 15436 | `230e4815cd1ae23829c69e380ac92589b81bca89f99a057b1a8e92ff8690bbf3` | test/recovery.test.mjs |

## Combined index

`server.js` mounts `mountPublicAcquisitionIfPresent` from `public-acquisition/engine.mjs` with the default manifest and bytes directory. The committed manifest has 29 assets: the original 21, plus caller 0.1.0 and 0.1.1 archive, provenance, license, and source-notice. No duplicate id, version, and role. Selecting an archive by version alone still returns `l09-next-action` 0.1.0. Caller selection filters `id === "samedaydesk-caller-result"`.

Two cold commands identify the unpacked package and print `paymentSent: false` and `charged: false`. They do not import the SDK, run `npm ci`, pay, or call `recover-mcp.mjs`. 0.1.0 expects recovery false. 0.1.1 expects recovery true.

## First consumer command

```bash
mkdir samedaydesk-caller-result
tar -xzf samedaydesk-caller-result-0.1.1.tar.gz -C samedaydesk-caller-result
cd samedaydesk-caller-result
npm ci --ignore-scripts
node bin/recover-mcp.mjs resume checkpoint.json grant.json
```

## Gates

Node `v22.23.3`, npm `10.9.9`. PATH prefixed with `/tmp/native-task-recovery-211210-runtime/node-v22.23.3-linux-x64/bin`. `PYTHONPATH=/tmp/native-task-recovery-211210-runtime/python-deps`.

```bash
npm test
npm run test:nonlive
```

| Command | Result |
| --- | --- |
| `npm test` first run | 1171 tests, 1161 pass, 6 fail, 4 skip, exit 1 |
| `npm test` rerun | 1171 tests, 1167 pass, 0 fail, 4 skip, exit 0 |
| `npm run test:nonlive` | 194 tests, 194 pass, 0 fail, exit 0 |

The four skips, on the passing rerun, are: deployed extract advertises machine documentation; official offline validator accepts exact commit package when pin is supplied; sidecar detects a skip-worktree modification to the official validator; unpaid initialize-era initialize and tools/list require extract and extract_batch.

The first failure is `first-failure.log`. Distribution test "advertised caller archive installs recovery with the merchant checkout absent" expected caller 0.1.0 sha256 `3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b` and received `l09-next-action` 0.1.0 sha256 `23bf8574b37c485b4b99f2e15f9b77a3239d0b2308a9048c25e118425a7f63d0`, because the combined index was filtered by version alone. Five receiving-lifecycle tests expected `received` and got `partial`, because the new caller archives had no cold command. The rerun filters caller id and adds the two identity commands. Lifecycle assertions were not weakened. Passing output is `gates.log` and `nonlive.log`.

Neomorphic checks that ran:

- `node --test tests/caller-result-0.1.1-static.test.mjs` on the local payload: 1 pass, 0 fail. It materializes the parts, checks descriptor and provenance flags, rejects the internal-note sentences, and serves the archive as `application/gzip` with the merchant sha. A missing tar returns 404.
- Wrapped part 03 plus the other parts materialized to 32421 bytes and sha256 `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3`.
- A one-page Astro 7.2.9 project using the site's static config copied that tar into `dist/downloads/samedaydesk-caller-result/0.1.1/` unchanged and served it. This was not the full Neomorphic site build and not `npm test` / `scripts/normal-release.mjs`.

Recovery tests did not create a second payment and did not re-execute a paid tool.

## Root release order

1. Keep `codex/public-caller-recovery-211883` and `bff5fffe` as history. Do not describe that loopback as public acquisition.
2. Publish merchant `31434c53f1271af94de843368d30fd51fbb62835` so the live combined index is this manifest. The original 21 assets stay. Caller 0.1.0 and 0.1.1 are the eight added assets.
3. Publish Neomorphic `c0ee80c30b75882f3763b50cbf5654c02f155c30` through the existing Hostinger build (`npm ci`, `npm run build`). Prebuild writes the tar before Astro copies `public/`.
4. Anonymous readback after both are live: the 0.1.1 archive URL returns 200, `application/gzip`, 32421 bytes, sha256 `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3`. The live index has 29 assets, caller 0.1.1 is the latest caller archive, and 0.1.0 bytes stay `3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b`.
5. Leave `hostedAcquisitionVerified` false until that readback. Do not publish the package to npm. Do not replace hosted 0.1.0.

```bash
node scripts/materialize-caller-result-0.1.1.mjs
node --test tests/caller-result-0.1.1-static.test.mjs
npm test
npm run test:nonlive
```
