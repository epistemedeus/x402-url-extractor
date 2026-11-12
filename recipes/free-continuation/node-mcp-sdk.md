# Recipe: Node MCP SDK client

Runtime: Node 20.19 or later with `@modelcontextprotocol/sdk` (the repo's pinned version). Transport: Streamable HTTP to `$SDD_MCP_URL` (`POST /mcp/page-change`, stateless). Tool: `compare_page_observations`.

Hosted status: two stages. (a) Pending Root release: the hosted serving build (e90676f4) does not include `page-change-continuation.mjs`, so the hosted endpoint returns no `continuation` and no `measurement` until Root releases and deploys a build with this feature. (b) Done: the dedicated production continuation keyring is enrolled and its readback matched; Root owns it, and no key value appears in any recipe. Until (a) lands, run these steps against a local server started with `PAGE_CHANGE_CONTINUATION_TEST_KEY=1`.

Protocol selection: the client reads the `protocolVersion` the server advertised in its `initialize` result and proceeds only on an exact match with `["2025-11-25","2025-06-18"]`. Anything else, including `2026-07-28`, is refused with `protocol_version_unsupported` naming what was advertised. The list comes from the repo source (`caller-result-client/src/protocol-selection.mjs`: the server's pinned `@modelcontextprotocol/sdk` 1.32.2 lists 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 and 2024-10-07, and these recipes need `structuredContent`, which starts at 2025-06-18). There is no silent upgrade. Compatibility Knowledge owns the protocol corpus (`docs/reviews/h99110-mcp-current-client-compat/RESULT.md`). The shipped client checks the version the SDK negotiated (`transport.protocolVersion`) after `connect`, and maps the SDK's own unsupported-version error to the same refusal:

<!-- check: protocol-refusal node -->
```json
{"state":"refused","refusal":{"ok":false,"charged":false,"code":"protocol_version_unsupported","advertised":["2025-03-26"],"supported":["2025-11-25","2025-06-18"],"nextStep":"The server advertised no protocol version this client implements. Use a client release that lists the advertised version; do not force a version."}}
```

Rules: no exactly-once delivery; the `correlationId` (`ae:corr:v1:`) is non-authorizing; discovery is sent separately in `_meta["samedaydesk/measurement"]`, never beside the token; the token is never logged (the client keeps it in a 0600 file and prints only a token-free view).

## stdio

`page-change-mcp-stdio-probe.mjs` serves the same `compare_page_observations` descriptor over stdio for `tools/list` only. A `tools/call` there returns `isError: true` with `error: "stdio_probe_does_not_compare"` and `charged: false`. There is no stdio compare server, so a stdio-only host uses the offline [CLI recipe](node-cli.md) or a client that speaks Streamable HTTP. Listing over stdio:

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const client = new Client({ name: "samedaydesk-stdio-list", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: ["page-change-mcp-stdio-probe.mjs"] }));
const { tools } = await client.listTools(); // [{ name: "compare_page_observations", ... }]
await client.close();
```

## Positive path

From a fresh process, with the shipped client (`caller-result-client/bin/continue-free.mjs`):

<!-- check: continue-free-args start -->
```sh
node caller-result-client/bin/continue-free.mjs start "$SDD_MCP_URL" examples/customer-x402/fixtures/page-change/c1/before.json examples/customer-x402/fixtures/page-change/c1/after.json title,description chain.json --discovery mcp
```

It sends these `tools/call` params (the SDK adds `jsonrpc` and `id`):

<!-- check: mcp-params save -->
```json
{"name":"compare_page_observations","arguments":{"before":"@c1/before.json","after":"@c1/after.json","fields":["title","description"]},"_meta":{"samedaydesk/continuation":{"save":true},"samedaydesk/measurement":{"discovery":"mcp"}}}
```

The success `structuredContent` carries the comparison plus two separate objects:

<!-- check: success-shape -->
```json
{"ok":true,"charged":false,"continuation":{"v":1,"tool":"compare_page_observations","token":"$TOKEN","kid":"test","correlationId":"$CORRELATION_ID","step":0,"expiresAt":"2026-11-19T11:47:18.000Z","next":{"method":"tools/call","tool":"compare_page_observations","meta":"samedaydesk/continuation","send":"before is the after observation you sent in this call, after is your new observation, fields stay the same, _meta carries {token}."}},"measurement":{"v":1,"kind":"measurement","tool":"compare_page_observations","correlationId":"$CORRELATION_ID","step":0,"discovery":{"status":"declared","source":"mcp"},"outcome":"changed","occurredAt":"2026-11-12T11:47:18.000Z","discoveryBasis":{"kind":"caller_meta","matched":null},"entrySurface":{"surface":"installed","basis":"no_deployment_marker","transport":"mcp_streamable_http"}}}
```

`chain.json` (mode 0600) holds the token; stdout shows only `{"state":"completed","output":{...},"continuation":{"correlationId":"...","step":0,"expiresAt":"...","tokenHeld":true},"measurement":{...}}`.

<!-- check: saved-file -->
```json
{"schema":"samedaydesk.free-page-change-continuation.v1","tool":"compare_page_observations","endpointUrl":"http://127.0.0.1:3000/mcp/page-change","fields":["title","description"],"observationPath":"/abs/path/c1/after.json","observationSha256":"<64 hex>","token":"$TOKEN","correlationId":"$CORRELATION_ID","step":0,"expiresAt":"2026-11-19T11:47:18.000Z"}
```

Continue from another fresh process:

<!-- check: continue-free-args continue -->
```sh
node caller-result-client/bin/continue-free.mjs continue chain.json recipes/free-continuation/fixtures/next.json
```

<!-- check: mcp-params continue -->
```json
{"name":"compare_page_observations","arguments":{"before":"@c1/after.json","after":"@fixtures/next.json","fields":["title","description"]},"_meta":{"samedaydesk/continuation":{"token":"$TOKEN","correlationId":"$CORRELATION_ID","save":true}}}
```

The reply has the same `correlationId` and `step: 1`. `chain.json` is replaced only after that reply arrives.

## Failure path

Inline, with the helper from `caller-result-client/src/free-continuation.mjs`, send a `before` that is not the held observation:

```js
import { callFreeCompare, readFreeRefusal } from "./caller-result-client/src/free-continuation.mjs";
const result = await callFreeCompare(client, { before: c1Before, after: next, fields: ["title", "description"], token, correlationId });
readFreeRefusal(result); // { code: "continuation_observation_mismatch", nextMethod: "tools/call", nextStep: "...", charged: false }
```

<!-- check: mcp-params refuse -->
```json
{"name":"compare_page_observations","arguments":{"before":"@c1/before.json","after":"@fixtures/next.json","fields":["title","description"]},"_meta":{"samedaydesk/continuation":{"token":"$TOKEN","correlationId":"$CORRELATION_ID","save":true}}}
```

The result is `isError: true` and its text is this body. No input is echoed and there is no paid fallback:

<!-- check: mcp-refusal continuation_observation_mismatch -->
```json
{"ok":false,"product":"samedaydesk-page-change-http","schemaVersion":"samedaydesk.page-change-http.v0","charged":false,"paymentRequired":false,"error":"continuation_observation_mismatch","code":"continuation_observation_mismatch","message":"before observation is not the held observation of the saved step","nextMethod":"tools/call","nextTool":"compare_page_observations","nextStep":"Send the held after observation of the saved step as before, the same fields, and a new after for the same sources."}
```

## Recovery path

The continue call's reply is lost (timeout, closed socket, killed process). `continue-free.mjs` saves only after a reply, so `chain.json` still holds the step 0 token. Run the same `continue` command again. The server stores nothing and the token is not single use, so it verifies the same token again and returns step 1 with the same `correlationId`. Both attempts carry the same deterministic journal id for that step, so a repeated step is counted once. There is no exactly-once promise: the first attempt may also have been answered. A lost reply on `start` cannot be resumed, because no token was ever held; run `start` again, which begins a new chain with a new `correlationId`.
