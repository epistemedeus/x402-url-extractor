# Free page comparison continuation (machine usage)

This file is outside the sealed 0.1.2 archive. `README.md`, `src/continuation.mjs` and `bin/recover-mcp.mjs` are archive members pinned by sha256, so this path lives in new files until Root repacks a release.

Tool: `compare_page_observations` on `POST /mcp/page-change`. charged: false. paymentRequired: false. No URL is fetched.

Opt in with request `_meta`. A call without it is unchanged.

| Step | `_meta["samedaydesk/continuation"]` | Arguments |
| --- | --- | --- |
| save | `{ "save": true, "discovery": "a2a" }` (discovery optional) | `before`, `after`, `fields` |
| continue | `{ "token": "<held token>", "correlationId": "ae:corr:v1:..." }` | `before` = the `after` you sent last step, a new `after`, the same `fields` |

A success carries `structuredContent.continuation` with three separate fields:

- `token`: bearer capability bound to the tool, the source identities, the fields and a digest of the held observation. Keep it private. Never log it.
- `correlationId`: `ae:corr:v1:<22 base64url chars>`. Non-authorizing chain id for measurement. It stays the same across steps.
- `discovery`: `{ status: observed | declared | unknown, source }`. Never read from the token.

A refusal is `isError: true` with `code`, `nextMethod: "tools/call"` and `nextStep`. It repeats no input and offers no paid fallback.

From a fresh process:

```bash
node bin/continue-free.mjs start "$URL" before.json after.json title,description chain.json --discovery cli
node bin/continue-free.mjs continue chain.json next.json
```

`chain.json` is written with mode 0600. Stdout prints `correlationId`, `step`, `expiresAt`, `discovery` and `tokenHeld`, never the token. Exit 2 means refused.

Offline continuation of the same file with the example CLI (no server, no token use):

```bash
node examples/customer-x402/bin/page-change.mjs compare --continue chain.json --after next.json --save-continuation local.json
```

```js
import { callFreeCompare, readFreeContinuation, readFreeRefusal } from "./src/free-continuation.mjs";
```
