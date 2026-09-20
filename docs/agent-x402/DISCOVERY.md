# Live unpaid MCP discovery

Follow this as a cold agent. Use only the live remote. Do not call paid
tools. Do not publish.

## Merchant

| Field | Value |
| --- | --- |
| URL | `https://agents.samedaydesk.com/mcp` |
| HTTP method | `POST` |
| Transport | Streamable HTTP (JSON or `text/event-stream`) |
| JSON-RPC | `2.0` |
| `protocolVersion` | `2025-11-25` |
| Expected `serverInfo.name` | `x402-data-gateway` |

Headers on every POST:

```http
accept: application/json, text/event-stream
content-type: application/json
```

If `initialize` returns `mcp-session-id`, replay it on `tools/list`.
The live server may be stateless (no session header). Both are valid.

Do not send `Mcp-Method`. Do not send payment headers. Require HTTP 200
exactly (not other 2xx). Cap the response at 1,000,000 bytes while
reading; do not buffer an oversized body. Timeout 15 seconds.
`redirect: error`. Treat a JSON-RPC `error` or an `id` mismatch as
failure. Repeat `nextCursor` values are failure.

## Step 1 — initialize

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": {
      "name": "samedaydesk-agent-x402-docs",
      "version": "0.1.0"
    }
  }
}
```

Require HTTP 200. Parse JSON or the last SSE `data:` line. Require:

- `result.protocolVersion` equals `2025-11-25` (not `2026-07-28`)
- `result.serverInfo.name` equals `x402-data-gateway`

Server version is observational (currently `1.23.49` on the live host).
Do not republish `server.json` to match it.

## Step 2 — tools/list

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

Require HTTP 200 and `result.tools` as an array. Then stop.

Paginate only if `nextCursor` is present (page ceiling 20). Do not call
a tool while paging.

## Step 3 — required tools

Exactly one `extract` and exactly one `extract_batch`. Extra unrelated
tools are fine. Missing or duplicate names are failure.

### `extract`

- `inputSchema.type` is `object`
- `inputSchema.additionalProperties` is `false`
- `inputSchema.required` includes `url`
- `inputSchema.properties.url.type` is `string`
- `outputSchema.required` includes: `ok`, `requestedUrl`, `finalUrl`,
  `url`, `status`, `sourceOk`, `error`, `contentType`, `title`,
  `description`, `canonical`, `lang`, `openGraph`, `twitter`, `jsonLd`,
  `headings`, `links`, `text`, `aiReadiness`, `capture`, `fetchedAt`

### `extract_batch`

- `inputSchema.type` is `object`
- `inputSchema.additionalProperties` is `false`
- `inputSchema.required` includes `urls`
- `inputSchema.properties.urls` is an array with `minItems` 1 and
  `maxItems` 5
- `outputSchema.required` includes: `ok`, `product`, `schemaVersion`,
  `quote`, `jobId`, `jobStatus`, `stopReason`, `partial`, `sources`,
  `accounting`, `costInputs`, `charged`, `boundary`

Ignore `description` and `$schema` when comparing contracts. Extra
required output paths are allowed. Missing known required paths are
schema drift: stop.

`_meta.x402.paymentRequired === true` is expected catalog metadata.
Record that payment was **not** attempted. Do not copy `accepts[].amount`
into a purchase.

## Step 4 — stop

Discovery is complete. Report tool names, the two required tools, and
`paymentAttempted: false`. Do not:

- `tools/call`
- Probe HTTP 402 with a bound purchase body
- Open a wallet
- Publish or register anything

Reconnect: drop the session and `initialize` again. Do not reuse a dead
session. Unavailable: record the HTTP/RPC error and stop. Do not invent
tools.

## Copy-paste (Node 20+)

From the repository root this is the same path as the verifier:

```bash
node docs/agent-x402/verify.mjs discover
```

Optional Inspector (still unpaid; do not call tools):

```bash
npx @modelcontextprotocol/inspector@2.3.0 --cli \
  https://agents.samedaydesk.com/mcp --transport http --method tools/list --format json
```

Inspector is optional. The verifier is the acceptance command.

## Errors

| Observation | Action |
| --- | --- |
| HTTP not 200 (including other 2xx), timeout, redirect | Stop. Do not invent tools. |
| JSON-RPC `error` or response `id` mismatch | Stop. Do not invent tools. |
| Repeated `nextCursor` | Stop. Do not keep paging. |
| `protocolVersion` is `2026-07-28` | Stop. Out of scope. |
| `extract` / `extract_batch` missing or duplicate | Schema drift. Stop. |
| Extra valid tools | Accept. Not drift. |
| Payment-required on `tools/list` | Unexpected. Stop. Do not pay. |
| Urge to publish because the registry version lags | Kill. See [BOUNDARY.md](BOUNDARY.md). |
