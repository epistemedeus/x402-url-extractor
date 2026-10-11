# Public caller recovery 211883

One tested public-shape distribution package for optional paid-result recovery. Root owns merge and deploy. This branch does not publish to an external registry, does not overwrite the sealed 0.1.0 archive, and does not change the payment or recovery kernels.

## Product

| Fact | Value |
| --- | --- |
| Branch | `codex/public-caller-recovery-211883` |
| Head | `6ea1294b8693f2c655d239f0870800e93bfff040` |
| Tree | `8610d39cca584f176bcc5f9cae24f442a38c6ba9` |
| Base | `94e45050e9d992ca2eb613cfb3850676217b9fb1` |
| Base tree | `bfb7e79acbcca4fe158c83a6c7d8cc88ab6ea03c` |
| Archive source commit | `a1ff92e1d0f3c44b396b9baed3d48cb6654d616f` |
| Archive source tree | `57219be06baeb7116a0cac9d63dcae3a586a3cd9` |
| Merchant version | `1.23.52` (unchanged) |
| Caller package | `samedaydesk-caller-result` `0.1.1` |

Head's parent is the archive source commit. Head only records the discovery source URL for that commit. The packed `caller-result-client/` bytes are the same in both.

Preserved tips: `codex/merchant-task-recovery-release-211877` at `94e45050e9d992ca2eb613cfb3850676217b9fb1`, and `cursor/merchant-211877-release-evidence` at `2a70b17582821446e517faa4ac75693236d8d7ad`.

## Archives

Sealed feedback archive, unchanged:

- URL: `https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.0/samedaydesk-caller-result-0.1.0.tar.gz`
- sha256: `3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b`
- bytes: 24149
- members: 12
- Does not contain `src/mcp-recovery.mjs` or `bin/recover-mcp.mjs`

Current archive:

- URL: `https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz`
- sha256: `ed5a00d52e15ccd098a7c054db00b2a929d884df3e926c9437bb3514af5c65fc`
- bytes: 32489
- inventory: `inventories/samedaydesk-caller-result-0.1.1.json`
- inventory sha256: `5347c8a715c105eb232702287402272d2bf21f09bb8f5c87f10d031203f07158`
- members: 15
- provenance sha256: `f7b501b7f0d125f0e4a69ce73513beb1afe3716b8b8fa3da4091647cc8aea8fe`
- provenance bytes: 1653

Feedback exports stay `.`, `./contract`, `./http`, and `./mcp`. Optional recovery is `./recovery` to `./src/mcp-recovery.mjs`. The bin entry is `recover-mcp` to `bin/recover-mcp.mjs`. Provenance keeps `sourceQualification` unknown, `hostedAcquisitionVerified` false, `paidLaunch` false, and `recognizedRevenueAtomic` `"0"`. Installation is not customer acceptance.

0.1.1 members:

| bytes | sha256 | path |
| --- | --- | --- |
| 1068 | `c9e2795d29bf1008cbd36ac045bd3c77d537438a51d8dda34e158f4e82a6a27c` | LICENSE |
| 1190 | `a2efcd34564b3553c0265ce83403a35ea6943a2561508aba5eef5eb0ff23b234` | PIN.json |
| 3327 | `1d4ff968afdad39845ca435c2f43d802f757600aeeba2901623e6f1f14899cf2` | README.md |
| 655 | `8c13b5a8d005d38b706ebf5aa696f1016c85f1dbb41967d305ae45219f7b64e8` | SOURCE-NOTICE.txt |
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

## First consumer command

Discover the current archive from the machine caller-result client entry (catalog, `skill.md`, and `llms.txt`). Acquire it from the published index `/.well-known/public-acquisition/index.json` by `originalUrl`, version, and sha256. Download `alternateUrl`. Do not execute catalog prose.

```bash
mkdir samedaydesk-caller-result
tar -xzf samedaydesk-caller-result-0.1.1.tar.gz -C samedaydesk-caller-result
cd samedaydesk-caller-result
npm ci --ignore-scripts
node bin/recover-mcp.mjs resume checkpoint.json grant.json
```

A new operation uses `node bin/recover-mcp.mjs start operation.json checkpoint.json grant.json`. Exit 0 is the retained result. Exit 2 is unresolved or denied. The command does not sign or settle. The 0.1.0 archive cannot run this command.

## Proof

The distribution test mounts the committed caller manifest on loopback, selects both versions from the index fields, and downloads `alternateUrl`. It installs with `entry.install`, imports `samedaydesk-caller-result/recovery`, `samedaydesk-caller-result/mcp`, and `samedaydesk-caller-result/http`, and runs `node bin/recover-mcp.mjs`. The unpacked directory has no `server.js` and no merchant feedback module. A lost paid reply, merchant restart, and cold resume in a second process returns the original useful output with verify 1 and settle 1. Accounting-meta tamper is `checkpoint_result_integrity`. A legacy checkpoint without `accountingDigest` keeps `possibleAtomic` `"50000"`, `reportedSettledAtomic` null, and `settlementSource` `"unknown"`. Wrong tenant, grant, origin, expired grant, revoked grant, and a wider budget refuse before another provider request. Missing, changed, and oversize artifacts refuse as `missing_asset`, `changed_bytes`, and `wrong_byte_length`. Fresh generation matches the committed 0.1.1 digest, and member hashes match the source files. The frozen 0.1.0 descriptors equal the `94e4505` manifest assets.

## Gates

Node `v22.23.3`, npm `10.9.9`, nproc 4, httpx `0.28.1` via `PYTHONPATH=/tmp/native-task-recovery-211210-runtime/python-deps`. PATH prefixed with `/tmp/native-task-recovery-211210-runtime/node-v22.23.3-linux-x64/bin`.

```bash
npm test
npm run test:nonlive
```

| Command | Result |
| --- | --- |
| pretest | 19 tests, 19 pass, 0 fail, exit 0 |
| `npm test` | 1170 tests, 1166 pass, 0 fail, 4 skip, exit 0 |
| `npm run test:nonlive` | 194 tests, 194 pass, 0 fail, exit 0 |

The four skips are the historical ones: deployed extract machine documentation, official offline validator pin, sidecar skip-worktree validator, and unpaid initialize-era initialize/tools/list. `PYTHONPATH` was set before the suite, so this run has no httpx environment miss. The suite rewrote `public-acquisition/loopback-profile.json`; it was restored to sha256 `e9a6d955f9073eb92b3aaf2333a1f3c2f28437d74801f73613479735a48488c8` and is not part of the product commit. Raw output is `gates.log`.

## Root release action

Merge and any deploy stay with Root. Leave `hostedAcquisitionVerified` false. Do not publish this package to npm. Do not replace the 0.1.0 bytes. Draft 202 on `codex/native-task-recovery-production-211230` was already `94e45050e9d992ca2eb613cfb3850676217b9fb1` when this package was cut.
