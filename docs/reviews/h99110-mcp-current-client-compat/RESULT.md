# H99110 RESULT

Official MCP clients can discover and call the existing free comparison. The merchant mechanism is unchanged. Writer base `2c284a4de5707979af916d88e79b9c10251d7914`. Branch `codex/h99110-mcp-current-client-compat-20261101`. HEAD is the commit that contains this file. No merge and no deploy.

## Decision

`POST /mcp/page-change` already serves the legacy SDK client and the current official client in its default mode and in auto mode. Both negotiate protocol `2025-11-25` and receive a useful free comparison. An explicit pin of `2026-07-28` is refused on that profile with the client's documented pin error. Paid `POST /mcp` already accepts that pin. The page-compare plugin test rejects the token `2026-07-28`, so the free profile does not advertise that revision.

## Source identities

- Repository: `https://github.com/epistemedeus/x402-url-extractor.git`. Default branch is `master`.
- Writer base: `2c284a4de5707979af916d88e79b9c10251d7914`.
- Node `v22.23.4`. Installed and locked, with no upgrade: `@modelcontextprotocol/sdk` `1.30.0`, `@modelcontextprotocol/client` `2.4.0`, `@modelcontextprotocol/server` `2.4.0`, `@modelcontextprotocol/core` `2.4.0`, `@modelcontextprotocol/node` `2.1.2`, `@x402/mcp` `2.16.0`.
- SDK `1.30.0` `dist/esm/types.js` sets `LATEST_PROTOCOL_VERSION` to `2025-11-25` and also lists `2025-06-18`, `2025-03-26`, `2024-11-05`, and `2024-10-07`. Its `dist/esm/spec.types.js` exports an internal `LATEST_PROTOCOL_VERSION` of `DRAFT-2026-v1`, generated from `schema/draft` at `35fa160caf287a9c48696e3ae452c0645c713669`. That draft constant is not the client default and was not exercised.
- Client `2.4.0` sets `DEFAULT_VERSION_NEGOTIATION_MODE` to `"legacy"`. Its modern wire revision, and its only supported modern version, is `2026-07-28`. Pin mode has no fallback. Failure is `SdkError` code `ERA_NEGOTIATION_FAILED`.
- Protocol release authority: GitHub `modelcontextprotocol/modelcontextprotocol` release `2026-07-28`, commit `5f5440bb26a62e2cf3440b92da5a667efa03b267`, marked Latest and the stable release of that revision. The versioning page at `https://modelcontextprotocol.io/specification/versioning` names `2026-07-28` as the current protocol. The assignment's spec file is `docs/specification/2026-07-28/server/tools.mdx` at `d0e246ea3c69eafaa2806bc4cd28025703ba2c2b`.

## Wire and parsed results

One loopback `server.js`, `PAGE_CHANGE_HTTP_ENABLED=1`, `MPP_SECRET_KEY` empty, synthetic facilitator on `127.0.0.1`, `NETWORK` `eip155:8453`. `PUBLIC_URL` `https://agents.samedaydesk.com` is the configured identity string. Startup matched `protocols:   x402 + MPP (disabled)`.

Free `POST /mcp/page-change`:

- Legacy SDK `1.30.0` negotiated `2025-11-25`. `tools/list` was exactly `compare_page_observations`. `_meta.samedaydesk.charged` was false and `paymentRequired` was false. `pageChangeRequestExample()` returned `isError` not true, `ok` true, `charged` false, and `report.verdict` `changed`.
- Current client `2.4.0` with no `versionNegotiation` negotiated `2025-11-25`. `getServerVersion()` was `{ name: "samedaydesk-page-compare", version: "1.23.55" }`. The same call returned the useful result.
- A fresh current client, opened after the invalid call, returned `changed` and `charged` false again.
- Mode `auto` negotiated `2025-11-25` and returned the same useful result. Its first `server/discover` requested `2026-07-28`. The free profile answered HTTP 400, JSON-RPC `-32000`, with `Unsupported protocol version: 2026-07-28` and `2025-11-25` in the message. The client then completed the legacy handshake.
- Mode `{ pin: "2026-07-28" }` failed connect with `SdkError` code `ERA_NEGOTIATION_FAILED`.
- Tool name `not_a_tool` threw code `-32602`. The message matched `Unknown tool` and did not contain `not_a_tool`.
- Arguments `{ before: {}, after: {}, fields: ["title"], clock: "yesterday" }` returned `isError` true, `charged` false, `code` `invalid_page_change_input`, and `ok` false.

Paid `POST /mcp` with the current client pinned to `2026-07-28`:

- Negotiated protocol `2026-07-28`. Server name `x402-data-gateway`. `compare_page_observations` was absent.
- `careers_board_cold` had `_meta.samedaydesk.charged` false. The call returned `charged` false. A fresh pinned client returned `charged` false again.
- `enrich` had `_meta.x402.paymentRequired` true. Its accepts had no `mpp` scheme or protocol. The unpaid call was `isError` true, `x402Version` 2, every accept `scheme` `exact`, and the JSON contained no `"mpp"`.
- Unknown tool was `-32602` and the message did not contain the attempted name.
- Paid `server/discover` was HTTP 200 with `resultType` `complete`. `tools/call` for `careers_board_cold` at requested protocol `2026-07-28` had wire `resultType` `complete`.
- No recorded request carried `payment-signature`. Facilitator calls included `GET /supported` and no path matching verify or settle.

`ownedPageChangeWorkerCount()` in the parent was 0 after close.

`parser.unknown_tool` stays the existing finite journal label. This run does not assign a caller, tool, task, referral, or protocol to that aggregate.

## Tests

Serial `node --test --test-concurrency=1 --max-old-space-size=512`. Full `npm test` was not run.

- `mcp-current-client-compat.test.mjs`: 1 pass. Test `duration_ms` 2593.066718. File `duration_ms` 2963.8754. Exit 0.
- `test/mcp-unknown-tool.test.mjs`: 2 pass. Exit 0.
- `page-change-mcp.http.test.mjs`: 10 pass. File `duration_ms` 11348.17229. Exit 0.
- `experiments/oct29-merchant-compatibility/merchant-compatibility.test.mjs`: 17 tests, 14 pass, 3 fail. The failures are the three Python client cases. Each actual error was `ModuleNotFoundError: No module named 'mcp'`, before any merchant assertion. The TypeScript cases in that file passed, including legacy, automatic, pinned, and stdio. The Python package was not installed.

## Files

New: `mcp-current-client-compat.test.mjs`, this result, and `NEXT.md` in this directory.

Edited: `package.json` scripts only. `test:mcp-current-client-compat` runs the new file. The main `test` script lists it immediately after `page-change-mcp.http.test.mjs`.

Unchanged: `page-change-mcp.mjs`, `mcp-server.mjs`, `server.js`, payment authority, registry, and plugins.

## Limits

The synthetic facilitator returns `{ isValid: false, success: false }` except `GET /supported`, which returns kind `eip155:8453`, scheme `exact`, `x402Version` 2. The test process and the merchant child use a 512 MiB heap. No production configuration, credential, signer, paid call, or live site was used.

## Independent receiving

The original missing-Python observation above is preserved. A separate clean source checkout now uses isolated Python mcp 2.3.0 and runs the affected serial gates: mcp-current-client-compat.test.mjs (1pass/0fail/0skip); test/mcp-unknown-tool.test.mjs (2pass/0fail/0skip); page-change-mcp.http.test.mjs (10pass/0fail/0skip); experiments/oct29-merchant-compatibility/merchant-compatibility.test.mjs (17pass/0fail/0skip). All exit0. Source protocol/payment files and dependency pins are unchanged. The source qualification does not establish an outside user or production deployment.
