# Free page comparison continuation (machine usage)

This file is outside the sealed 0.1.2 archive. `README.md`, `src/continuation.mjs` and `bin/recover-mcp.mjs` are archive members pinned by sha256, so this path lives in new files until Root repacks a release.

Tool: `compare_page_observations` on `POST /mcp/page-change`. charged: false. paymentRequired: false. No URL is fetched.

Opt in with request `_meta`. A call without it is unchanged.

| Step | `_meta["samedaydesk/continuation"]` | Arguments |
| --- | --- | --- |
| save | `{ "save": true, "discovery": "a2a" }` (discovery optional) | `before`, `after`, `fields` |
| continue | `{ "token": "<held token>", "correlationId": "ae:corr:v1:..." }` | `before` = the `after` you sent last step, a new `after`, the same `fields` |

A success carries two separate objects:

- `structuredContent.continuation`: `token` (bearer capability bound to the tool, the source identities, the fields and a digest of the held observation; keep it private and never log it), `correlationId`, `step`, `expiresAt`, `kid`, `next`. It has no discovery field.
- `structuredContent.measurement`: `{ v, kind: "measurement", tool, correlationId, step, discovery: { status: observed | declared | unknown, source }, outcome, occurredAt, discoveryBasis, entrySurface }`. It has no token, no kid and no token-derived field. Measurement counts discovery only from this record. The last three fields are additive (see below).

`correlationId` is `ae:corr:v1:<22 base64url chars>`, non-authorizing, and stays the same across steps. Discovery is never read from the token.

A refusal is `isError: true` with `code`, `nextMethod: "tools/call"` and `nextStep`. It repeats no input and offers no paid fallback.

From a fresh process:

```bash
node bin/continue-free.mjs start "$URL" before.json after.json title,description chain.json --discovery cli
node bin/continue-free.mjs continue chain.json next.json
```

`chain.json` is written with mode 0600 and holds no discovery. Stdout prints `continuation` (`correlationId`, `step`, `expiresAt`, `tokenHeld`) and a separate `measurement` record, never the token. Exit 2 means refused.

Offline continuation of the same file with the example CLI (no server, no token use):

```bash
node examples/customer-x402/bin/page-change.mjs compare --continue chain.json --after next.json --save-continuation local.json
```

```js
import { callFreeCompare, readFreeContinuation, readFreeRefusal } from "./src/free-continuation.mjs";
```

## Measurement record fields (additive)

The first seven fields keep their meaning. Three fields are added by the emitter, never accepted from the caller (`_meta["samedaydesk/measurement"]` still allows only `discovery`, and anything else is `continuation_invalid`):

| Field | Shape | Meaning |
| --- | --- | --- |
| `occurredAt` | ISO 8601 UTC with ms and `Z` | Emitter clock when the step was handled (server: injectable `now` mount option; CLI: local clock). A retried or continued step gets a new value with the same `correlationId`. |
| `discoveryBasis` | `{ kind: "request_referer" \| "mount_hook" \| "caller_meta", matched: string \| null }` or `null` | Why `discovery` has its status. `request_referer`: the request's Referer was one of this server's own discovery documents on the same Host (`matched` is the fixed path `/llms.txt`, `/skill.md`, `/SKILL.md`, `/.well-known/agent-card.json` or `/.well-known/agent.json`) or the MCP registry host (`matched: "registry.modelcontextprotocol.io"`); status is `observed`. `mount_hook`: an embedding server's own `discoveryEvidence` hook returned a bare source; status `observed`. `caller_meta`: status `declared`. `null`: status `unknown`. |
| `entrySurface` | `{ surface: "hosted" \| "installed", basis: "deployment_marker" \| "no_deployment_marker" \| "local_cli", transport: "mcp_streamable_http" \| "cli" }` or `null` | Where the step ran, from runtime facts only. A server with a non-empty `RAILWAY_DEPLOYMENT_ID` in its environment is `hosted` (`deployment_marker`); the value is never copied. Without it, `installed` (`no_deployment_marker`). The example CLI is `installed` (`local_cli`). |

Observed discovery is only as strong as a Referer header: the server sees it, the caller's `_meta` cannot produce it, but it is not authenticated and most MCP clients send none, so most records stay `declared` or `unknown`. The transport a request arrived on is reported in `entrySurface.transport`, not as discovery. No raw header, query, fragment or deployment id is retained. No exactly-once claim: a repeated step yields a second record with the same `correlationId` and step and its own `occurredAt`.

Hosted continuation has two separate gaps: the serving build e90676f4 does not include `page-change-continuation.mjs` (so hosted returns no `continuation` and no `measurement`), and the production `PAGE_CHANGE_CONTINUATION_KEYS` is not configured (so a build with the feature answers `continuation_unavailable`).
