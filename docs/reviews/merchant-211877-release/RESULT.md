# Merchant 211877 release receipt

Release-ready product only. Root merges and deploys. This agent did not merge, deploy, or move draft 202.

SolPro131's original assessment still refuses one incorrect byte witness even where hashes match. This receipt does not call that review fully source-qualified. The gates below are an independent reproduction.

## Product

| Pin | Value |
| --- | --- |
| Branch | `codex/merchant-task-recovery-release-211877` |
| Head | `94e45050e9d992ca2eb613cfb3850676217b9fb1` |
| Tree | `bfb7e79acbcca4fe158c83a6c7d8cc88ab6ea03c` |
| Parent | `6620f32c5c0d4c950234119e4cdcadc15d066bf4` |
| Parent tree | `8cfeb1b602f498fafd64d5fd37b06b58440893f9` |
| Runtime parent | `921725cdd12e8da19f8bcb2eb11551e7cda5914f` |
| Runtime parent tree | `2a8e8f6972dd0c426bdfed8c4865c660303bcdab` |
| Version | `1.23.52` |
| Master, unchanged | `32267493d29ff1339c5199185d8231012daf0acd` at `1.23.51` |
| Draft 202, unchanged | `2f175523d0861babdd5735f452bb12fb9c74dc37` on `codex/native-task-recovery-production-211230` |
| Immutable 211855 evidence | `5530eb1176d4ad4793a767d7924a1a491acb0c07` on `cursor/merchant-202-amendment-211855` |

`6620f32` advertises declared HTTP methods and cuts `1.23.52`. `94e4505` adds the feature-source consumer proof. Version files are `package.json`, both root `package-lock.json` versions, `server.json`, and `plugins/samedaydesk-x402/plugin.json`. The stored prospective cold packet still asserts `1.23.51` and `test:nonlive` passed.

Changed paths from `921725c`:

- `a2a-storefront.mjs`
- `a2a-storefront.test.mjs`
- `discovery-method-parity.http.test.mjs` (added)
- `machine-surface-parity.http.test.mjs`
- `mcp-server.mjs`
- `mcp-task-recovery.test.mjs`
- `mcp-tool-metadata.mjs`
- `mcp-tool-metadata.test.mjs`
- `package-lock.json`
- `package.json`
- `plugins/samedaydesk-x402/plugin.json`
- `server.js`
- `server.json`

Product commits contain no `docs/reviews` logs. Human pages, prices, and payment terms were not edited. Frozen archive `samedaydesk-caller-result-0.1.0.tar.gz` remains `3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b`. Loopback profile `public-acquisition/loopback-profile.json` was restored to `e9a6d955f9073eb92b3aaf2333a1f3c2f28437d74801f73613479735a48488c8` after the suite rewrote it.

## What the product now does

Catalog, OpenAPI, and `skill.md` already declared the methods. MCP tool text and A2A skill text now take the same declaration:

- `GET /extract` unpaid `402`, amount `5000`, asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, network `eip155:8453`, scheme `exact`
- `POST /extract/batch` unpaid `402`, amount `10000`, same asset and network
- `POST /lockfile-pin-delta` unpaid `402`, amount `5000`, same asset and network

The other method on each path returns `404` and no `payment-required` header. Free tools `careers_board_cold`, `report_caller_result`, and `recover_paid_result` stay unpaid and do not gain the payment-binding sentence. `page_change` stays flag-off.

## Supported recovery install

The helper is feature source, not the frozen feedback archive. Archive members do not include `mcp-recovery.mjs` or `recover-mcp.mjs`. Package exports still point `./mcp` at `./src/mcp-caller-result.mjs`.

Direct install from this feature source:

1. Copy `caller-result-client/src/mcp-recovery.mjs`, `caller-result-client/bin/recover-mcp.mjs`, `caller-result-client/package.json`, and `caller-result-client/package-lock.json`.
2. Run `npm ci --ignore-scripts` in that directory.
3. Import `./src/mcp-recovery.mjs` or run `bin/recover-mcp.mjs`.

That copy is not a published archive canary. The fresh consumer had no `server.js`. Accounting-meta mutation of a completed checkpoint was refused as `checkpoint_result_integrity`. A legacy checkpoint without `accountingDigest` kept `possibleAtomic` `50000`, `reportedSettledAtomic` null, and `settlementSource` `unknown`. After a lost paid response, mounted parent restart, and resume, exit was `0`, verify stayed `1`, and settle stayed `1`.

## Gates

Runtime `node v22.23.3`. Default concurrency (`nproc` 4, no `--test-concurrency=1`). `PYTHONPATH=/tmp/native-task-recovery-211210-runtime/python-deps` with `httpx 0.28.1`.

| Gate | Result |
| --- | --- |
| Pretest `construction-surface` and `machine-surface-parity` | 19 pass, 0 fail |
| `npm test` | 1167 tests, 1163 pass, 0 fail, 4 skip, exit 0 |
| `npm run test:nonlive` | 194 pass, 0 fail, exit 0 |
| Focused `mcp-json-rpc-limit.http.test.mjs` | 2 pass, exit 0 |
| Focused `mcp-task-recovery.test.mjs` | 9 pass, including the fresh consumer, exit 0 |
| Focused `discovery-method-parity.http.test.mjs` plus metadata and A2A units | 10 pass, exit 0 |

The four skips, unchanged and separate:

- `deployed extract advertises machine documentation`
- `official offline validator accepts exact commit package when pin is supplied` (`Set XAGT_PLUGIN_ROOT to the clean official pin for this gate`)
- `sidecar detects a skip-worktree modification to the official validator` (`Official validator checkout not supplied`)
- `unpaid initialize-era initialize and tools/list require extract and extract_batch`

The first `npm test` invocation exited 1 because `httpx` was not on `PYTHONPATH`. See `first-run-httpx-miss.txt`. The rerun above is the release gate. Raw TAP is `gates-rerun.log`.

## Public distribution proposal

Not part of this release, and not a reason to regenerate `0.1.0`.

A later public archive, with a new version and a new sha256, would need to add `caller-result-client/src/mcp-recovery.mjs` and `caller-result-client/bin/recover-mcp.mjs`, keep the feedback exports truthful, and publish a descriptor. Until that archive exists, the supported distribution is the feature-source copy above. Downloading `samedaydesk-caller-result-0.1.0.tar.gz` does not install recovery.

## Root receiving action

Use `codex/merchant-task-recovery-release-211877` at `94e45050e9d992ca2eb613cfb3850676217b9fb1`. This agent does not own `codex/native-task-recovery-production-211230`, so draft 202 stays at `2f175523`. Root can fast-forward or merge. After deploy, an unpaid `tools/list` should show `GET /extract`, `POST /extract/batch`, and `POST /lockfile-pin-delta` in the tool text. Rollback is reverting `6620f32` and `94e4505`. No live paid QA, wallet, or new hosting was done here.
