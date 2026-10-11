# Caller automation interop 211965

No product source change. The official MCP SDK over Streamable HTTP already keeps a mixed structured/text result, a tool refusal, and its evidence object through one JSON file. The installed caller helper keeps `isError` and the text content, and it does not carry `structuredContent` or `_meta`. That projection matches the pinned `@x402/mcp` 2.16.0 unpaid return. Caller 0.1.0 and 0.1.1 archives are unchanged. This is owner QA of a public contract, not independent demand, a payment, or a hosted acquisition.

The 18:41 UTC inquiry supplied no failing schema, workflow, or evidence. The 0.10 USDC request is declined. The two paid slots in `portable-caller-useful-evaluation-2026-10-10` stay closed. No account was inspected and no requester was contacted.

## Source

| Fact | Value |
| --- | --- |
| Repository | `epistemedeus/x402-url-extractor` |
| Branch | `codex/caller-automation-interop-211965` |
| Base | `31434c53f1271af94de843368d30fd51fbb62835` |
| Base tree | `5cc599727d04af6e7bf91571cd50804fe297072f` |
| Comparison commit | `678e6c9f347b66bdfdab4a6289d894a0b7a06dbc` |
| Comparison tree | `5118d4cdc3ceea29d38b84cee6f3eeb621e07981` |
| Changed paths | `caller-result-client/test/automation-json-boundary.mjs`, `caller-result-client/test/automation-json-boundary.test.mjs`, `docs/reviews/caller-automation-interop-211965/RESULT.md`, `docs/reviews/caller-automation-interop-211965/ECOSYSTEM-MAP.md` |
| Package sources | unchanged. `src/`, bins, README, `package.json`, and `PIN.json` are the base bytes |
| Archives | 0.1.0 is 24149 bytes, sha256 `3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b`. 0.1.1 is 32421 bytes, sha256 `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3` |

The comparison commit is the parent that contains the tests and the first receipt. The child commit only names those two ids. That child's tree is the branch tip from `git rev-parse HEAD^{tree}` and is left out of this file, because writing it would change the tree.

## Pins read before the run

| Source | Pin |
| --- | --- |
| Caller package | `samedaydesk-caller-result` 0.1.1, engines `>=22.12.0`, license MIT |
| `@modelcontextprotocol/sdk` | 1.30.0, MIT, `LATEST_PROTOCOL_VERSION` `2025-11-25` |
| `@x402/mcp` | 2.16.0, Apache-2.0. Unpaid `callTool` returns `content`, `isError`, and `paymentMade` |
| MCP tools spec | <https://modelcontextprotocol.io/specification/2025-11-25/server/tools>, read 2026-10-11. `structuredContent` is a JSON object. A tool that returns it SHOULD also return the same JSON as text. Unknown tools are protocol errors. `isError: true` is a tool execution error |
| Node 22.23.3 | `/tmp/native-task-recovery-211210-runtime/node-v22.23.3-linux-x64`, npm 10.9.9 |
| Node 24.19.0 | official `https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz`, index date 2026-08-03, sha256 `14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647`, npm 11.17.0 |
| Make data structures | <https://help.make.com/data-structures>, read 2026-10-11. A data structure is the document Make uses to map a payload. The generator builds it from a sample. The page does not say an MCP `structuredContent` object survives a scenario |
| Make flow control | <https://help.make.com/flow-control>, read 2026-10-11. A JSON Parse JSON module can omit fields from the next mapping until one scenario run teaches them |
| Supabase JSON | <https://supabase.com/docs/guides/database/json>, read 2026-10-11. `json` stores the input text. `jsonb` stores decomposed binary. Inserted values must be valid JSON. `jsonb` is the recommended column type |
| Postgres JSON | <https://www.postgresql.org/docs/current/datatype-json.html>, read 2026-10-11. `jsonb` does not preserve whitespace, object key order, or duplicate keys. `json` keeps the input text |

No Make scenario and no Supabase or Postgres database was opened. Those pages do not identify a live workflow.

## Prior 0.1.0 records in this checkout

`overview/research/phase-20261010/commission-report-verification-184000/RESULT.md` replays slot `UE-163000-01`. Direct `echo_probe` kept `_meta`. The unpaid `@x402/mcp` 2.16.0 return omitted `_meta`. The helper's unpaid capability was absent. No product patch was exported. The contributor harness and `results_official.json` are not in this checkout.

`overview/research/phase-20261010/commission-report-verification-189000/RESULT.md` replays `FreeZ-UE-163000-02-20261010-A`. Direct and helper row counts were both 3. The sealed capability was absent, and the absent token was a local refusal. The useful count and the unpaid no-fit stayed side by side.

Those records stay as written. This run does not relabel either one as a caller advantage.

## Commands

Install, from `caller-result-client`, Node v22.23.3:

`npm ci --ignore-scripts`

Exit 0. 99 packages added. Wall 1.387 seconds.

Supported runtime:

`node --test --test-concurrency=1 test/automation-json-boundary.test.mjs test/client.test.mjs test/recovery.test.mjs`

Exit 0. 31 tests, 31 pass, 0 fail. `duration_ms` 457.525728. Wall 0.489 seconds.

Node v24.19.0, same files, same `node_modules`:

Exit 0. 31 tests, 31 pass, 0 fail. `duration_ms` 448.151255. Wall 0.486 seconds.

Loopback timings from the comparison test:

| Runtime | SDK calls | Caller `pay` | Closed-port fetch | Child reread | Payment-client reads | Observe calls | Report calls |
| --- | --- | --- | --- | --- | --- | --- | --- |
| v22.23.3 | 61.037 ms | 7.054 ms | 0.698 ms, `TypeError` | 34.004 ms | 0 | 6 | 1 |
| v24.19.0 | 64.804 ms | 6.515 ms | 0.457 ms, `TypeError` | 30.203 ms | 0 | 6 | 1 |

The existing recovery tests are the package's synthetic in-process fixtures. This run did not call `recover-mcp`, settle, or open a payment client method.

## Comparison

The same loopback tool returned four observations. The direct path is `Client` plus `StreamableHTTPClientTransport` from SDK 1.30.0. The caller path is `x402MCPClient` with `autoPayment: false` and `bindPaidMcpCallerResult(...).pay`. Both use one session. The stored file is ordinary JSON, then a second Node process reads it.

| Case | Direct SDK after `JSON.parse(JSON.stringify(...))` | Caller `pay` return |
| --- | --- | --- |
| Mixed text plus structured object | Text `retained text`, `structuredContent` `amount` `"0"`, `count` `0`, `note` `""`, `label` `null`, `ok` `true`, `isError` false, evidence `call-mixed` / `task-a` | Same text, `isError` false, `paymentMade` false, `capability.present` false. No `structuredContent` key and no evidence object |
| Tool refusal whose text says `ok: true` | Class `tool_refusal`. `isError` true. Structured `ok` false | Class `tool_refusal`. `isError` true. Text still says `ok: true` |
| Absent optional `note` | Key stays absent. `amount` stays `"1"` | Content only |
| Second task | Evidence `call-other` / `task-b` stays distinct after restart | Not stored. The helper return has no evidence id, so the store answers `evidence_absent` |
| Unknown tool name | SDK server returns `isError` true and text naming `missing_tool`. Class `tool_refusal`. It does not surface JSON-RPC `-32602` from this `McpServer` | Not a second protocol |
| Closed `127.0.0.1` port | Class `transport_failure` | Distinct from `tool_refusal` |
| Malformed, truncated, oversized, array, null | Store codes `malformed_json`, `oversized`, `unsupported_shape` | Same store |
| `__proto__` and `constructor` keys | Store code `unsafe_key`. `Object.prototype.polluted` stays absent | Same store |
| Duplicate `call-mixed` | Code `duplicate_receipt`. The first useful record stays | |
| Local disposition `maybe` | Code `disposition_rejected`. Report calls stay 0. Stored file bytes stay the same | |
| Remote `not_useful` after that useful record | `accepted` false, code `not_actionable`, token absent from the body. One report call. Stored bytes stay the same | |

A child process printed the same classes as the parent reread: `call-mixed` useful and associated with `task-a`, `call-refuse` tool refusal and associated with `task-a`, `call-absent` and `call-other` useful and associated with `task-b`.

## Decision

Keep the direct SDK result as the JSON archive for a downstream automation consumer. Use the caller helper for the optional free statement. Do not add a Make module, a Supabase client, a second archive format, or a wrapper patch. The public proof shows what SDK 1.30.0 and caller 0.1.1 do with this fixture. What an unseen Make data structure or `jsonb` column does with that fixture remains unknown until the workflow is supplied.
