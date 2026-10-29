H64201 makes the current merchant MCP journey usable by a client that pins protocol `2026-07-28`, and moves the owning axios pin to `1.20.0`. Compatibility implementation commit `424c5fbcda77c8dbbd8fb3f6b669a7c3600e4bf2`, tree `e67f919c3bea8147dc18f6b9f2a8bedc6e7f3b51`, on `codex/root64201-heavy-window-20261029` from base `a1dc09bb076b823fb3492ea79fa10f8602ed01a5`. False-settlement amendment `bdea3f75dfbea51fe10e1f617a2dc758ed124030`, tree `b885a7dfddb896e04269a85432fe26f0478a7427`, parent `2e197da2a3e994417af818e8641fab5bd7079e01`. This report commit is the child of that amendment. Its head and tree are the pushed branch tip recorded by the launcher outside this file.

Claim-less requests, including `initialize`, stay on the existing v1 `McpServer`, `StreamableHTTPServerTransport`, payment wrapper, verifier, settlement, and replay journal. `mountMcp` keeps `modernProtocol` false unless the caller passes true. `server.js` passes true. Explicit `2026-07-28` requests go through official `isLegacyRequest`, `createMcpHandler({ legacy: "reject" })`, and `toNodeHandler`. Those requests call the same prepared tool handlers. There is one `createPaymentWrapper` and one replay journal. Prices, `payTo`, `NETWORK`, package version `1.23.55`, the `qs` override `6.16.0`, and root `zod` `3.25.76` stay as they are. Plugins that pin `2025-11-25` were left unchanged.

## Comparison

Disposable loopback clients, one merchant mount:

| Client | `modernProtocol: true` (production seam) | `modernProtocol` omitted (mount default) |
| --- | --- | --- |
| Legacy SDK 1.30 streamable HTTP | Negotiated `2025-11-25`. Free `local_note` returned structured `{ ok: true, charged: false }`. Unpaid `enrich` returned the existing challenge. `verify` and `handler` stayed 0. | Same legacy success. |
| Current client, `versionNegotiation` automatic | Negotiated `2026-07-28`. Server name stayed `merchant-modern-test`. | Fell back to `2025-11-25` and completed the free call. |
| Current client, pin `2026-07-28` | Negotiated `2026-07-28`. Advertised input schema stayed an object. An empty note came back `isError` from tool validation. | `SdkError` code `ERA_NEGOTIATION_FAILED`. |
| Explicit stdio, pin `2026-07-28` | Official `serveStdio` on the same prepared handlers. Free structured output and unpaid `enrich` challenge, `payTo` unchanged. | Covered by the stdio opt-in test, which always uses the explicit modern server. |

A raw envelope for revision `1999-01-01` returned a protocol error whose code was not `-32603`. A string in `clientCapabilities` returned `-32602`. Header `MCP-Protocol-Version: 2025-11-25` against a `2026-07-28` body returned `-32020`, with `verify` 0 and `handler` 0. A tools/call whose JSON-RPC id was the string `2026-07-28` still challenged. `io.modelcontextprotocol/serverInfo.name` stayed `merchant-modern-test`, and `payTo` stayed the configured address. Unknown tool names returned `-32602` before the era split. `GET /mcp` stayed 405.

Failed verify ran the facilitator once and did not settle or run the handler. A thrown `settle()` stays `isError`, with no `x402/payment-response.success` and no handler note in the body. Explicit `{ success: false }` is covered in the amendment below. The earlier report's acceptance of that return on the handler body is superseded.

Lost response: a loopback proxy destroyed the client socket after the origin finished one priced `enrich` call. `recover_paid_result` with the same payment and arguments returned structured note `kept`. Counts stayed at 1. A new nonce is a new operation: counts became verify 2, settle 2, handler 2. A freshly signed retry is a new credential. Protocol version, request id, output acceptance, and payment authority stay separate fields. `PAYMENT-SIGNATURE` injection writes `x402/payment` and leaves the request legacy, because it does not add the `2026-07-28` envelope key.

## Explicit false settlement

Pilot `dbe233339e155a857d624a12c117f4d59a8bbcf9` recorded the candidate `2e197da2a3e994417af818e8641fab5bd7079e01` in `experiments/oct29-demand/merchant-caller-acceptance/evidence/candidate-join.json` (blob `ea2d06360932c430ea32b22391cf291fced1618a`). Cases `P-settle-false` and `D-settle-false` used the production `modernProtocol: true` mount and the default legacy mount. Facilitator verify was valid, the handler ran, and `settle` returned HTTP 200 `{ success: false }`. Both cases exposed the paid table markdown, `payment-response.success` false, `isError` false, and counts verify 1, settle 1, source 1. Their harness judge class was `settle-returned-false`. That reproduction is the blocker. H64202 was not edited to accept it.

`@x402/mcp` `settlePaymentResult` attaches a returned settle object onto the handler result. It builds the `isError` challenge only when `settle` throws. `idempotency-replay.mjs` `runMcpTool` retains a result when `x402/payment-response.success === true`. Boolean false is not retained, and the pending credential stays quarantined. The paid body was still returned to the client.

`withholdExplicitFalseSettlement` runs on the one paid callback shared by both eras, before that journal sees the result and before the client does. Boolean `success: false` on a non-error result becomes `isError` text `{ ok: false, error: "settlement_unsuccessful", settlementSuccess: false }` and `_meta["x402/payment-response"]` of `{ success: false }`. The handler body, transaction, payer, and caller receipt fields are not copied. The handler is not described as a no-effect and is not rolled back. `success: true`, a missing `success`, a non-boolean `success`, and a result that is already `isError` pass through.

Corrected loopback clients, same verify-then-handler-then-settle sequence, counts verify 1, settle 1, handler 1:

| Client | Mount | Result |
| --- | --- | --- |
| TypeScript client 2.4.0, pin `2026-07-28` | `modernProtocol: true` | `isError`, no paid note, `payment-response.success` false. Typed result `settlement_failure`, `handlerInvoked` true, `applicationOutcome` `success`. |
| SDK 1.30.0 legacy | `modernProtocol` omitted | Same withheld result and the same typed classification. |
| Python `mcp` 2.3.0, mode pin | `modernProtocol: true` | `settlement_unsuccessful`, `paymentSuccess` false, paid note absent. |
| Python `mcp` 2.3.0, mode legacy | `modernProtocol` omitted | Same withheld result. |

A forged request field `x402/payment-response.success: true` did not become the settlement. The direct function leaves `success: true` untouched, leaves `{ transaction, network }` without `success` untouched, leaves `success: "false"` untouched, and leaves an already `isError` result untouched. On both mounts, that missing-success settle stays typed `telemetry_incomplete` with `settlementState` `unknown`, and it is not `paid_success`.

With the replay journal enabled, the same credential and arguments do not run the handler again. Changed arguments do not run it again. `recover_paid_result` does not return the paid note. A new nonce is a new operation: counts become verify 2, settle 2, handler 2, and the body is withheld again. A successful settle still recovers the retained note `kept` with counts held at 1.

Amendment command, exit 0: `node --test --test-concurrency=1` on `axios-transport.test.mjs`, `schema-catalog.test.mjs`, and `merchant-compatibility.test.mjs`. 16 pass, 0 fail, `duration_ms` 5410.367007. Node `v22.23.4`. Python `mcp` 2.3.0 was imported from `/tmp/oct29-mcp-py-site`. Per-file node processes still appeared under `--test-concurrency=1`. Peak `VmHWM`: parent 55292 KiB, axios file 74100 KiB, merchant file 208968 KiB, schema file 166060 KiB. Two `stdio-merchant.mjs` processes, 179428 KiB and 184204 KiB. Two `python3` clients, 68180 KiB and 68248 KiB. Highest simultaneous tree `VmRSS` 447080 KiB: parent 55160, merchant file 207716, one stdio child 184204. `getrusage(RUSAGE_CHILDREN).ru_maxrss` 208500 KiB, the largest waited child. One negative-review model child, `01a18934-57c1-7bc3-84d9-f6099e82c3ad`, completed with exit 0 after 94 tool calls, 1 turn, and 674071 ms. Its verdict was accept: explicit boolean false does not reach the client or the replay store, and `idempotency-replay.mjs` needs no edit. Its process RSS was not sampled.

A separate serial command also exited 0, 12 pass, `duration_ms` 9590.066657. The name pattern selected `M06 settlement failed and unknown never paid_success`, the payment-header bridge, the readable payment challenge, and the cold recovery tests. `M06` still records `settlement_failure` for boolean false and `telemetry_incomplete` for a settle object with no `success`.

## Axios advisory

GHSA-3pq3-5fj3-cg6v covers the Node HTTP adapter when `httpVersion` is 2, for axios `1.13.0` through versions before `1.20.0`. Configured lookup and proxy controls can be bypassed on that path. The patched release is `1.20.0`. The previous override resolved `1.19.0`, inside that range. The override is now exact `1.20.0`, and the installed package is `1.20.0`.

Applicability is a separate fact from the pin. Merchant source does not import axios or set `httpVersion: 2`. The only direct lockfile edge to axios is `@coinbase/cdp-sdk` `1.16.0`, whose `cdpApiClient.ts` calls `Axios.create({ baseURL })` and does not mention `httpVersion`. The previous resolved version being inside the affected range is not proof this deployment was exploitable. No vulnerable-version bypass was executed, and nothing was aimed at a public host.

The installed regression listens on `127.0.0.1` only. Hostname `merchant-loopback.test` is not a public name. An async `lookup` that returns `127.0.0.1` reaches the loopback HTTP/2 origin once. An async `lookup` that rejects with `EPOLICY` does not increment HTTP/2 or HTTP/1 origin hits. Axios treats only an `async function` as promise-returning in this adapter, so the regression uses that form.

Lockfile movement required by those pins: `@hono/node-server` `2.1.0` to `2.1.5`, because `@modelcontextprotocol/node` `2.1.2` depends on `@hono/node-server` `^1.19.9 || ^2.1.3`. Top-level `@modelcontextprotocol/server` is now the direct `2.4.0`. `incur` `0.4.26` still has nested `@modelcontextprotocol/server` `2.0.0-alpha.4`. Nested `zod` `4.6.7` is under `@modelcontextprotocol/client` and `@modelcontextprotocol/core`. Root `zod` stays `3.25.76`. The local adapter in `mcp-zod3-json-schema.mjs` projects Zod 3 for the v2 registrar and keeps Zod 3 `safeParse` as the validator. A guarded HTTP tool uses a loose JSON Schema input only for that `tools/call`. `tools/list` keeps the projected schema.

## Tests and footprint

Focused command, serial, exit 0: `node --test --test-concurrency=1` on `axios-transport.test.mjs`, `schema-catalog.test.mjs`, and `merchant-compatibility.test.mjs`. 12 pass, 0 fail, `duration_ms` 4077.095819. Node `v22.23.4`.

`node --test` spawned one node process per file even with `--test-concurrency=1`. Observed peak `VmHWM`: parent runner 55148 KiB, axios file 77564 KiB, merchant file 207552 KiB, schema file 165348 KiB. The stdio test spawned two `stdio-merchant.mjs` processes, high-water 184568 KiB and 180952 KiB. The highest simultaneous tree `VmRSS` was 447032 KiB: parent 55024, merchant file 207440, and one stdio child 184568. `getrusage(RUSAGE_CHILDREN).ru_maxrss` was 206992 KiB, the largest waited child, not the sum of the tree. Zero model children. No extra CLI was added.

Earlier in this same foreground, `startup-smoke.test.mjs`, `mcp-payment-header.test.mjs`, and `mcp-payment-challenge-contract.test.mjs` passed 11/11 in 3423 ms. Startup smoke still logged `MCP server: POST /mcp (23 paid tools)`, so the production catalog compiled with `modernProtocol: true`. Those three files were not re-run after the later whitespace-only edit in `stdio-merchant.mjs`.

## Bounds

No live account, provider, payment, signer, public contact, merge, or deploy. Synthetic facilitator and signer material stayed inside the tests. The compatibility clocks `2026-10-29T17:10:00.000Z` and `2026-10-29T17:25:00.000Z` stayed frozen. This amendment uses checkpoint `2026-10-29T20:35:00.000Z` and receiving tail `2026-10-29T20:50:00.000Z`. Model `grok-4.7`, effort `xhigh`, session `0bd1eb6c-5b57-43a7-a305-765230c19f6b`, host `cloud-n`. The compatibility measurement had zero model children. This amendment started one negative-review child, `01a18934-57c1-7bc3-84d9-f6099e82c3ad`. Root owns merge, installed release, customer communication, and human preview. `server.js`, `package.json`, and `package-lock.json` were not edited in the amendment.

## File inventory

- `mcp-server.mjs`
- `mcp-zod3-json-schema.mjs`
- `server.js` (the `modernProtocol: true` mount argument only)
- `package.json`
- `package-lock.json`
- `experiments/oct29-merchant-compatibility/axios-transport.test.mjs`
- `experiments/oct29-merchant-compatibility/schema-catalog.test.mjs`
- `experiments/oct29-merchant-compatibility/merchant-compatibility.test.mjs`
- `experiments/oct29-merchant-compatibility/stdio-merchant.mjs`
- `experiments/oct29-merchant-compatibility/python-false-settlement.py`
- `experiments/oct29-merchant-compatibility/RESULT.md`
- `experiments/oct29-merchant-compatibility/NEXT.md`
