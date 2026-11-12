# Recipe: curl over Streamable HTTP JSON-RPC

Runtime: any shell with `curl`, `jq` and `sha256sum`. The endpoint is stateless: every `POST` is a complete JSON-RPC request, no session and no `initialize` are needed for `tools/call`. Send `content-type: application/json` and `accept: application/json, text/event-stream`. The reply is usually an SSE stream (`event: message` then `data: {...}`); take the last `data:` line.

Hosted status: two separate gaps. The hosted serving build (e90676f4) does not include `page-change-continuation.mjs`, so the hosted endpoint returns no `continuation` and no `measurement`; and after a build with the feature is deployed, it still answers `continuation_unavailable` until the production `PAGE_CHANGE_CONTINUATION_KEYS` is configured. Run these steps against a local server started with `PAGE_CHANGE_CONTINUATION_TEST_KEY=1`.

Rules: no exactly-once delivery; the `correlationId` (`ae:corr:v1:`) is non-authorizing; discovery is sent separately in `_meta["samedaydesk/measurement"]`, never beside the token; the token is never logged (it only ever goes to a 0600 file, never to stdout).

```sh
C1=examples/customer-x402/fixtures/page-change/c1
NEXT=recipes/free-continuation/fixtures/next.json
post() { curl -sS -X POST "$SDD_MCP_URL" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' --data @"$1" -o reply.txt && { grep -q '^data: ' reply.txt && sed -n 's/^data: //p' reply.txt || cat reply.txt; } | tail -n 1 > reply.json; }
digest() { jq -cj . "$1" | sha256sum | cut -d' ' -f1; }
```

## Positive path

Build the save request:

<!-- check: jq-build save -->
```sh
jq -n --slurpfile b "$C1/before.json" --slurpfile a "$C1/after.json" '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"compare_page_observations",arguments:{before:$b[0],after:$a[0],fields:["title","description"]},_meta:{"samedaydesk/continuation":{save:true},"samedaydesk/measurement":{discovery:"llms"}}}}' > save.json
```

It is exactly:

<!-- check: mcp-request save -->
```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"compare_page_observations","arguments":{"before":"@c1/before.json","after":"@c1/after.json","fields":["title","description"]},"_meta":{"samedaydesk/continuation":{"save":true},"samedaydesk/measurement":{"discovery":"llms"}}}}
```

Send it and keep the continuation in a 0600 file in the shared record shape. Print only the token-free view:

<!-- check: jq-save -->
```sh
post save.json
(umask 077; jq --arg url "$SDD_MCP_URL" --arg path "$(realpath "$C1/after.json")" --arg sha "$(digest "$C1/after.json")" '.result.structuredContent.continuation | {schema:"samedaydesk.free-page-change-continuation.v1",tool,endpointUrl:$url,fields:["title","description"],observationPath:$path,observationSha256:$sha,token,correlationId,step,expiresAt}' reply.json > chain.json)
jq '{correlationId, step, expiresAt, tokenHeld: (.token|type=="string")}' chain.json
jq -c '.result.structuredContent.measurement' reply.json
```

Build and send the continue request from a fresh shell. Write the reply to a new file; replace `chain.json` only after it arrives:

<!-- check: jq-build continue -->
```sh
jq -n --slurpfile b "$(jq -r .observationPath chain.json)" --slurpfile a "$NEXT" --slurpfile c chain.json '{jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"compare_page_observations",arguments:{before:$b[0],after:$a[0],fields:$c[0].fields},_meta:{"samedaydesk/continuation":{token:$c[0].token,correlationId:$c[0].correlationId,save:true}}}}' > continue.json
```

<!-- check: mcp-request continue -->
```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"compare_page_observations","arguments":{"before":"@c1/after.json","after":"@fixtures/next.json","fields":["title","description"]},"_meta":{"samedaydesk/continuation":{"token":"$TOKEN","correlationId":"$CORRELATION_ID","save":true}}}}
```

`.result.structuredContent.continuation.step` is 1 and the `correlationId` is unchanged.

## Failure path

Send the old `before` instead of the held observation:

<!-- check: mcp-request refuse -->
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"compare_page_observations","arguments":{"before":"@c1/before.json","after":"@fixtures/next.json","fields":["title","description"]},"_meta":{"samedaydesk/continuation":{"token":"$TOKEN","correlationId":"$CORRELATION_ID","save":true}}}}
```

The reply is a JSON-RPC result with `isError: true`. `jq -r '.result.content[0].text' reply.json` gives:

<!-- check: mcp-refusal continuation_observation_mismatch -->
```json
{"ok":false,"product":"samedaydesk-page-change-http","schemaVersion":"samedaydesk.page-change-http.v0","charged":false,"paymentRequired":false,"error":"continuation_observation_mismatch","code":"continuation_observation_mismatch","message":"before observation is not the held observation of the saved step","nextMethod":"tools/call","nextTool":"compare_page_observations","nextStep":"Send the held after observation of the saved step as before, the same fields, and a new after for the same sources."}
```

## Recovery path

If `post continue.json` fails or `reply.json` holds no result (timeout, reset, killed shell), the reply is lost. `chain.json` was not touched, so rebuild `continue.json` from it and post again. The token is not single use: the server verifies it again and returns step 1 with the same `correlationId`, and a repeated step maps to one journal id. That is not exactly-once delivery: the first attempt may have been answered too. A lost reply on the save request cannot be resumed, because no token was held yet; send the save request again, which starts a new chain.
