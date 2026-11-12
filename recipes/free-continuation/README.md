# SameDayDesk free page comparison: continue from any runtime

A cold visiting agent compares two page observations it already holds, keeps a continuation, and later continues or recovers the same chain from a fresh process. The task is free: `charged: false`, `paymentRequired: false`, no URL is fetched, nothing is signed or paid.

| Runtime | Recipe | Entry point |
| --- | --- | --- |
| Plain Node CLI, offline | [node-cli.md](node-cli.md) | `examples/customer-x402/bin/page-change.mjs compare --save-continuation / --continue` |
| Node MCP SDK client | [node-mcp-sdk.md](node-mcp-sdk.md) | Streamable HTTP `POST /mcp/page-change`, tool `compare_page_observations`; stdio is tools/list only |
| Python, standard library only | [python.md](python.md) | `free_continuation.py` over Streamable HTTP JSON-RPC |
| curl or any HTTP client | [curl-http.md](curl-http.md) | Streamable HTTP JSON-RPC `tools/call` |
| A2A | [a2a.md](a2a.md) | agent card skill `compare-held-page-observations`, follow-up as a new task in the same contextId |

Every recipe shows three paths: positive (complete the free task and save the continuation), failure (a typed refusal with a `nextMethod` cue and `charged: false`), and recovery (resume from the saved token or record after a lost reply).

## Rules every recipe follows

- No exactly-once delivery. A lost reply can mean the server already answered. Recovery re-reads the saved record and repeats the same step. A repeated continued step maps to one deterministic journal id on the server, so it is counted once, but nothing promises it ran once.
- The `correlationId` (`ae:corr:v1:<22 base64url chars>`) is non-authorizing. It joins measurement records. It never unlocks a continuation on its own; the token does.
- Discovery is sent separately in `_meta["samedaydesk/measurement"]` as `{ "discovery": "<source>" }`, never beside the token. Allowed sources: `a2a`, `mcp`, `cli`, `llms`, `skill`, `registry`, `other`. The server returns it only on the separate `measurement` record, with status `observed`, `declared` or `unknown`.
- The measurement record (only on a success with `_meta["samedaydesk/continuation"]`) is `{ v, kind: "measurement", tool, correlationId, step, discovery: { status, source }, outcome, occurredAt, discoveryBasis, entrySurface }`. The last three are additive and computed by the emitter, never by the caller: `occurredAt` is the emitter clock when the step was handled (a retried step gets a new one), `discoveryBasis` says why discovery has its status (`request_referer` from a same-host discovery page or the MCP registry, `mount_hook`, `caller_meta`, or `null` for unknown), and `entrySurface` is `hosted` or `installed` with its basis (`deployment_marker`, `no_deployment_marker` or `local_cli`) and transport.
- The token is never logged. Keep it in a 0600 file. Print only `correlationId`, `step`, `expiresAt` and whether a token is held.
- Protocol selection is exact: each installed client reads the version the server advertised (MCP `initialize` result, or the A2A card's `supportedInterfaces[].protocolVersion`) and proceeds only when it is in the list in `caller-result-client/src/protocol-selection.mjs` (MCP `2025-11-25`, `2025-06-18`; A2A `1.0`). Otherwise it refuses with `protocol_version_unsupported` naming what was advertised. `2026-07-28` is not implemented by this source and is not assumed.
- A portable non-secret handback (`task-continuation.handback.v1`, `packages/task-continuation/handback.schema.json`) lets another runtime or a fresh process resume a chain's state; the token never rides in it.
- Save the recovery record before any dispatch that could be lost. For a continued step, that record is the file from the previous step: do not overwrite it until the new reply has arrived.

## Endpoint

`SDD_MCP_URL` is the Streamable HTTP endpoint. Local: start the server with `PAGE_CHANGE_HTTP_ENABLED=1 PAGE_CHANGE_CONTINUATION_TEST_KEY=1` (a public test key, never for production) and use `http://127.0.0.1:3000/mcp/page-change`. Hosted: `https://agents.samedaydesk.com/mcp/page-change`. Hosted continuation has two stages. (a) Pending Root release: the native serving build is e90676f4, and `page-change-continuation.mjs` does not exist at that commit, so the hosted endpoint does not read `_meta["samedaydesk/continuation"]` and returns no `continuation` and no `measurement` until Root releases and deploys a build with this feature. (b) Done: the dedicated production continuation keyring is enrolled and its readback matched (Root-owned; no key value appears here). Plain compare calls without `_meta` keep working on hosted. Use a local server for every continuation step in these recipes.

## Request `_meta`

| Step | `_meta["samedaydesk/continuation"]` | Arguments |
| --- | --- | --- |
| save | `{ "save": true }` | `before`, `after`, `fields` |
| continue | `{ "token": "<held token>", "correlationId": "ae:corr:v1:...", "save": true }` | `before` = the `after` you sent last step, a new `after`, the same `fields` |

In the request examples, `"@c1/before.json"` means "the parsed JSON contents of `examples/customer-x402/fixtures/page-change/c1/before.json`", `"@fixtures/next.json"` means the contents of `recipes/free-continuation/fixtures/next.json`, and `$TOKEN` and `$CORRELATION_ID` come from the saved record.

## Drift check

`node --test recipes/free-continuation/recipes.test.mjs` checks every marked request, response, refusal and saved record in these recipes against the real continuation module, CLI, client helpers and, when the repo dependencies are installed, the MCP input and output schemas, the A2A builder, a live Streamable HTTP round trip and the stdio probe. Subtests that need dependencies skip when they are missing and say so.
