# Recipe: Python (standard library only)

Runtime: Python 3.9 or later, no packages. Script: [free_continuation.py](free_continuation.py). It posts Streamable HTTP JSON-RPC `tools/call` requests to `$SDD_MCP_URL` with `accept: application/json, text/event-stream` and reads the last SSE `data:` line or a plain JSON reply. The continuation file uses the same record shape as the Node client (`samedaydesk.free-page-change-continuation.v1`), so either runtime can continue a chain the other started.

Rules: no exactly-once delivery; the `correlationId` (`ae:corr:v1:`) is non-authorizing; discovery is sent separately in `_meta["samedaydesk/measurement"]`, never beside the token; the token is never logged (it lives only in the 0600 chain file, and `--dry-run` shows it as `$TOKEN`).

`observationSha256` is the sha256 of the observation as JavaScript `JSON.stringify` writes it. Python matches that byte for byte for strings, integers, booleans and null. An observation with non-integer numbers can hash differently between runtimes; the script then refuses with `held_observation_changed` rather than send a mismatched `before`.

```sh
C1=examples/customer-x402/fixtures/page-change/c1
PY=recipes/free-continuation/free_continuation.py
```

Hosted status: two stages. (a) Pending Root release: the hosted serving build (e90676f4) does not include `page-change-continuation.mjs`, so the hosted endpoint returns no `continuation` and no `measurement` until Root releases and deploys a build with this feature. (b) Done: the dedicated production continuation keyring is enrolled and its readback matched; Root owns it, and no key value appears in any recipe. Until (a) lands, run these steps against a local server started with `PAGE_CHANGE_CONTINUATION_TEST_KEY=1`.

## Protocol selection

Protocol selection: the client reads the `protocolVersion` the server advertised in its `initialize` result and proceeds only on an exact match with `["2025-11-25","2025-06-18"]`. Anything else, including `2026-07-28`, is refused with `protocol_version_unsupported` naming what was advertised. The list comes from the repo source (`caller-result-client/src/protocol-selection.mjs`: the server's pinned `@modelcontextprotocol/sdk` 1.32.2 lists 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 and 2024-10-07, and these recipes need `structuredContent`, which starts at 2025-06-18). There is no silent upgrade. Compatibility Knowledge owns the protocol corpus (`docs/reviews/h99110-mcp-current-client-compat/RESULT.md`). `start` and `continue` send `initialize` first and stop with exit 2 and `{"state":"refused","refusal":{"code":"protocol_version_unsupported",...}}` before any `tools/call` when the advertised version is not listed. After a match every request carries `mcp-protocol-version`. Check one advertised value offline:

<!-- check: python-args protocol -->
```sh
python3 $PY protocol-check 2026-07-28
```

<!-- check: python-protocol-refusal -->
```json
{"ok": false, "charged": false, "code": "protocol_version_unsupported", "advertised": ["2026-07-28"], "supported": ["2025-11-25", "2025-06-18"], "nextStep": "The server advertised no protocol version this client implements. Use a client release that lists the advertised version; do not force a version."}
```

## Portable handback

`python3 $PY handback-check handback.json` validates a `task-continuation.handback.v1` file exported by any runtime (`exportHandback` in `packages/task-continuation`) with the same rules as the Node module and prints it as canonical JSON, byte for byte what Node writes. A handback holds no token, key or raw input: the token stays in the caller's own 0600 file and is passed separately.

## Positive path

<!-- check: python-args start -->
```sh
python3 $PY start "$SDD_MCP_URL" $C1/before.json $C1/after.json title,description chain.json --discovery other
```

It sends:

<!-- check: mcp-request save-python -->
```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"compare_page_observations","arguments":{"before":"@c1/before.json","after":"@c1/after.json","fields":["title","description"]},"_meta":{"samedaydesk/continuation":{"save":true},"samedaydesk/measurement":{"discovery":"other"}}}}
```

Stdout (exit 0) is token-free: `{"state": "completed", "ok": true, "charged": false, "continuation": {"correlationId": "ae:corr:v1:...", "step": 0, "expiresAt": "...", "tokenHeld": true}, "measurement": {...}}`.

Continue from a fresh process:

<!-- check: python-args continue -->
```sh
python3 $PY continue chain.json recipes/free-continuation/fixtures/next.json
```

<!-- check: mcp-request continue-python -->
```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"compare_page_observations","arguments":{"before":"@c1/after.json","after":"@fixtures/next.json","fields":["title","description"]},"_meta":{"samedaydesk/continuation":{"token":"$TOKEN","correlationId":"$CORRELATION_ID","save":true}}}}
```

## Failure path

Continue with an observation of different sources:

<!-- check: python-args refuse -->
```sh
python3 $PY continue chain.json recipes/free-continuation/fixtures/other-sources.json
```

Exit 2. Stdout is `{"state": "refused", "refusal": {"code": "continuation_subject_mismatch", "nextMethod": "tools/call", "nextStep": "...", "charged": false}}`, read from this server body:

<!-- check: mcp-refusal continuation_subject_mismatch -->
```json
{"ok":false,"product":"samedaydesk-page-change-http","schemaVersion":"samedaydesk.page-change-http.v0","charged":false,"paymentRequired":false,"error":"continuation_subject_mismatch","code":"continuation_subject_mismatch","message":"after observation is not for the same sources","nextMethod":"tools/call","nextTool":"compare_page_observations","nextStep":"Send the held after observation of the saved step as before, the same fields, and a new after for the same sources."}
```

`chain.json` is unchanged.

## Recovery path

Exit 3 (`transport_failed` on stderr) means the reply may be lost. The script writes `chain.json` only after a reply, atomically, so it still holds the previous step. Run the same `continue` command again: the token is not single use, the server returns the same next step with the same `correlationId`, and a repeated step maps to one journal id. That is not exactly-once delivery; the first attempt may have been answered too. A lost reply on `start` starts over with `start`, which begins a new chain.
