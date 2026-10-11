# Merchant 202 amendment 211855

Private successor of reviewed candidate `2f175523d0861babdd5735f452bb12fb9c74dc37`. Draft pull request 202 stays on `codex/native-task-recovery-production-211230`. This branch does not merge or deploy.

## Identity

| Item | Value |
| --- | --- |
| Review receipt | Pilot `fbef2dbdbf47ca6588564d9752cd6895bf37bfb8`, `overview/research/phase-20261011/review-receive-211853/` |
| Root readback | Root211853, 2026-10-11T10:43:23.410Z |
| Conversation | `6acb5cc1-df68-83e8-a16f-b303cd661eba` |
| Claim | `4b3ea456-97b8-458a-b2ad-846e368eddca` |
| User | `459c7233-a90d-49d5-9e25-392c8107dc01` |
| Reviewer | `gpt-5-6-pro`, turn `3412a03a-6699-41a9-b0fc-1af9c24e4c38`, final `b6695ea4-62e4-4563-af07-963786d54b8a` |
| Raw final | 54538 bytes, sha256 `588c9b7d86de521abb35e32af42b78b58ba05f0b4cdb80b961beee1835123a42` |
| Return | `pilot/review-input-return@2`, 77 files, source-confirmed, complete, fix-then-merge |
| Bundle | sha256 `e2bcbda6aab4c6c6007a17bf8a917ca7ec111db24aa60def863f67061f8a55c5` |
| Marker | `R0923-MARKER-2f175523d0861bab` |
| Node | v22.23.3 |
| httpx | 0.28.1 |

Reviewer probes are recorded below and are not included in the builder counts. Conversations 132 and 133 are link-only and are not this source.

## Pins

| | Commit | Tree | Parent |
| --- | --- | --- | --- |
| Reviewed candidate | `2f175523d0861babdd5735f452bb12fb9c74dc37` | `ff6c017b1f9505558c5f92e21dc0c64662f434d1` | `9249d42cf1c324dfae969ab1f61c55bea71d4c35` |
| Seam implementation | `45db520ca937abbf432a8a90bd616ab6cf3e196c` | `d0e2f296bee1ab02e7a4f281ef498544feefc5dd` | `2f175523d0861babdd5735f452bb12fb9c74dc37` |
| Amended source | `921725cdd12e8da19f8bcb2eb11551e7cda5914f` | `2a8e8f6972dd0c426bdfed8c4865c660303bcdab` | `45db520ca937abbf432a8a90bd616ab6cf3e196c` |

Branch: `cursor/merchant-202-amendment-211855`. The evidence commit that adds this directory parents `921725c`. Implementation behavior is the amended source pin above.

Reviewed candidate receipt, kept separate from this amendment: 1158 tests, 1154 pass, 4 skips, 194 nonlive, 49 focused.

## Reviewed source to amended delta

`git diff --stat 2f175523..921725c`: 10 files, 538 insertions, 25 deletions.

- `mcp-json-rpc-limit.mjs`
- `mcp-json-rpc-limit.http.test.mjs`
- `server.js`
- `mcp-server.mjs`
- `package.json`
- `caller-result-client/src/mcp-recovery.mjs`
- `caller-result-client/test/recovery.test.mjs`
- `idempotency-replay.mjs`
- `idempotency-replay.test.mjs`
- `caller-result-client.cold.test.mjs`

Caller archive `caller-result-client/export/public/bytes/samedaydesk-caller-result/0.1.0/samedaydesk-caller-result-0.1.0.tar.gz` remains sha256 `3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b`. Loopback fixture restored to sha256 `e9a6d955f9073eb92b3aaf2333a1f3c2f28437d74801f73613479735a48488c8`.

## Authoritative MCP limit

Ordinary HTTP JSON stays 16384 bytes. The raw `POST /mcp` ceiling is 294912 bytes: the 262144-byte lockfile tool-argument budget plus a 32768-byte envelope allowance. The continuation operation record stays 65536 bytes, named in the merchant module and as a local constant in the caller package. The caller package does not import merchant source.

`POST /mcp` skips the global parser. Over-limit is HTTP 200 JSON-RPC `{"jsonrpc":"2.0","error":{"code":-32600,"message":"mcp_json_rpc_too_large","data":{"maxBytes":294912}},"id":null}` with `Cache-Control: no-store`. Invalid JSON on `/mcp` stays HTTP 400 `{ok:false,error:"invalid_json",charged:false}`.

`GET /mcp` machine descriptor adds `jsonRpc.maxBytes`, `toolArgumentMaxBytes`, `ordinaryHttpJsonMaxBytes`, and `overLimit`. Lockfile MCP `paidHttp.maxRequestBytes` is 262144. Extract-batch MCP `paidHttp.maxRequestBytes` is 16384. The HTTP lockfile route stays 256 KiB. Human pages, offers, and design are unchanged.

## Accounting binding

`mcpResultDigest` still hashes `{content, structuredContent, isError}`. `mcpAccountingDigest` hashes `{paymentResponseSuccess: proof.success === true}` for `_meta["x402/payment-response"]`. Completed checkpoints store that digest. Load rejects `checkpoint_result_integrity` when the field is present and does not match. A checkpoint without the field still loads. Exposure drops to `"0"` only when the digest is present, matches, and success is true. Otherwise `possibleAtomic` stays the reserved amount, `reportedSettledAtomic` is null, and `settlementSource` is `"unknown"`. No signer, new charge, or speculative replay.

## Bounded failed persistence

`retainMcpResult` checks payload size before the memory map. An oversized completed body is delivered once with `retention:"unrecoverable"` and `usefulness:"unknown"`, then later recovery returns `mcp_result_exceeds_replay_bounds` and does not execute. Retryable disk failures stay in a map bounded by TTL, entry count, and bytes. Prune runs before recovery and flush. Eviction and expiry use `mcp_result_retention_evicted` and `mcp_result_retention_expired`. A missing record stays `recovery_not_found_or_expired`. Storage repair does not re-execute paid work.

## Red witnesses

Pre-fix, saved in `gates/red-witness.json` against `2f175523`:

- SDK initialize, 154 bytes: HTTP 200 JSON-RPC. SDK `tools/call`, 20480 bytes: HTTP 413 HTML `PayloadTooLargeError`. Ordinary `POST /extract`, 20490 bytes: HTTP 413.
- Mode 0600 checkpoint. Load accepted. `resultDigest` stayed `18a6c750e0ad0f772160914c37a4fd978b43fb561d525dc0c67bc03c927c1e48`. `possibleAtomic` moved from `"50000"` to `"0"`. `reportedSettledAtomic` `"50000"`. `settlementSource` `stored_provider_response_unverified`.
- One execution, persisted false, recovered text length 4000 over `maxResponseBytes` 1024, disk body absent, second replay true from memory, `pendingPersistence` 1.

## Reviewer probes, separate from builder counts

Syntax, `node --check` on the amended files, all pass. Log: `gates/reviewer-syntax.txt`.

The reviewer's own probe, command `node /tmp/probe-unbound-payment-meta.mjs`, result pass on the reviewed source: changing only `result._meta["x402/payment-response"].success` from false to true was accepted by `mcpRecoveryFileStore.load` with unchanged `resultDigest`, and `mcpRecoveryBudget` changed `possibleAtomic` from `"50000"` to `"0"`. Seventeen syntax checks passed on that reviewed tree. Those two reviewer executions are not part of the 1160 or 63 counts.

## Green builder gates

Node v22.23.3. `npm test` uses the package script with default concurrency (`availableParallelism() - 1` on this 4-CPU host). Raw TAP is in `gates/`.

| Gate | When | Exit | Tests | Pass | Fail | Skip |
| --- | --- | --- | --- | --- | --- | --- |
| `npm test` on `45db520` | 2026-10-11T11:16:17Z to 11:18:14Z | 1 | 1164 | 1159 | 1 | 4 |
| `npm run test:nonlive` on `45db520` | 11:18:14Z to 11:18:22Z | 0 | 194 | 194 | 0 | 0 |
| focused on `45db520` | 11:18:22Z to 11:18:45Z | 0 | 63 | 63 | 0 | 0 |
| isolated cold caller on `921725c` | after the signal fix | 0 | 1 | 1 | 0 | 0 |
| `npm test` on `921725c` | 2026-10-11T11:28:07Z to 11:30:07Z | 0 | 1164 | 1160 | 0 | 4 |
| `npm run test:nonlive` on `921725c` | 11:30:07Z to 11:30:16Z | 0 | 194 | 194 | 0 | 0 |
| focused on `921725c` | 11:30:16Z to 11:30:39Z | 0 | 63 | 63 | 0 | 0 |

The single failure on `45db520` was `installed caller consumer reaches the mounted parent without merchant source`: consumer exit 1, stderr `fetch failed`, while the restarted merchant had already logged `MCP server: POST /mcp`. Excerpt: `gates/first-npm-test-failure.txt`. The frozen consumer treats an empty or partial `restart-ready` as the stopped URL. The test now writes the JSON to a temporary file and renames it into place. Isolated replay then passed in 5287 ms. The receipt suite is the `921725c` run.

Historical skips, same four names, counted apart from the 1160 passes:

- deployed extract advertises machine documentation
- official offline validator accepts exact commit package when pin is supplied
- sidecar detects a skip-worktree modification to the official validator
- unpaid initialize-era initialize and tools/list require extract and extract_batch

Focused command: `node --test idempotency-replay.test.mjs caller-result-client/test/recovery.test.mjs mcp-task-recovery.test.mjs replay-boundary.http.test.mjs mcp-json-rpc-limit.http.test.mjs`.

Green seam tests inside that focused run:

- the MCP JSON-RPC ceiling is the advertised argument budget plus one envelope allowance
- mounted SDK requests accept the MCP byte ceiling and refuse one byte past it as JSON-RPC
- unbound payment-response success cannot zero possible exposure, and a bound flip fails integrity
- oversized completed MCP output is unrecoverable and is not executed again
- retryable MCP persistence stays bounded by expiry and entry pressure without a second settlement
- ephemeral MCP bytes above the cap drop the older body and do not settle it again

## Loopback process exits

From the passing cold CLI test on the mounted loopback merchant:

- lost paid response, `recover-mcp.mjs start`: exit 2, checkpoint `unresolved`, settle 1, verify path recorded before the lost response
- provider and client restarted, `resume`: exit 0, new pid, same output, `reportedSettledAtomic` `"50000"`, `newPaymentPermitted` false, `usefulness` `"unknown"`, settle stays 1, verify stays 1, restarted provider handler counts stay 0
- completed client with the provider stopped, `resume`: exit 0, new pid, local output, no further request, settle stays 1
- `SIGKILL` during the receipt task: exit `null`, checkpoint still `pending`; later `resume` exit 0, settle stays 1
- diagnostic line: `{"coldRecovery":true,"synthetic":true,"settle":1,"usefulAcceptance":"unknown","paidLiveCalls":0}`

The suite rewrote `public-acquisition/loopback-profile.json` and the gate restored the original bytes. Archive sha256 matched before and after.

## Next command and remaining limits

After Root deploys this successor, the next check is unpaid `tools/list`. Rollback is a revert of this branch. This agent did not merge, deploy, send a new Chat, or start a funded or live paid run.

No new agent machine-exposure version was cut. The frozen 0.1.0 archive bytes were not regenerated. Settlement counts in these gates are facilitator attempts on loopback, not chain transfers.
