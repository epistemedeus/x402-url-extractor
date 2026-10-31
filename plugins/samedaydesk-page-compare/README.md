# SameDayDesk Page Compare

Unpublished draft package for one free comparison tool. It is not a directory listing and it does not claim the public route is connected.

The tool is `compare_page_observations` on `POST /mcp/page-change`. It compares two JSON page observations the caller already holds. It does not fetch URLs, extract a remote page, schedule a later observation, or take payment.

The intended URL after deployment is `https://agents.samedaydesk.com/mcp/page-change`. Until this branch is deployed, that path is not the live tool.

## Machine use

Start the existing merchant with `PAGE_CHANGE_HTTP_ENABLED=1`. Then initialize and call the tool. The public synthetic input is `examples/public-two-observations.json`. Its title changes and its description stays the same.

```bash
curl -sS "http://127.0.0.1:${PORT}/mcp/page-change" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"page-compare-example","version":"0.1.0"}}}'
```

A call uses the same path. Put the example object in `params.arguments` and set `params.name` to `compare_page_observations`. A successful JSON result has `charged` false and `report.verdict` `changed` for that example.

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import example from "./examples/public-two-observations.json" with { type: "json" };

const client = new Client({ name: "page-compare-example", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${process.env.PORT}/mcp/page-change`)));
const listed = await client.listTools();
const result = await client.callTool({ name: "compare_page_observations", arguments: example });
await client.close();
```

`listed.tools` contains only `compare_page_observations`. Its annotations are `readOnlyHint` true, `destructiveHint` false, `openWorldHint` false, and `idempotentHint` true. Those match a pure computation over supplied JSON.

GET, PUT, PATCH, DELETE, and HEAD return 405. The body tells the caller to POST JSON-RPC. This is a stateless server, not a missing listener.

## What this draft validates

Machine schema validity, static ZIP validity, and submission readiness are separate.

* `plugin.json` and `mcp.json` validate against the Agent Plugins 1.0.0 schemas stored in `test/official-schemas/`. Those bytes were retrieved from `https://agent-plugins.org/schemas/1.0.0/`. Provenance, including last-modified dates and hashes, is in `test/official-schemas/PROVENANCE.json`.
* The ZIP `../samedaydesk-page-compare-0.1.0-draft.zip` contains this connection in the first package: `plugin.json`, `mcp.json`, `LICENSE`, `README.md`, `skills/compare-held-pages/SKILL.md`, and `examples/public-two-observations.json`.
* Submission is not ready. The current official MCP schema rejects `extensions` on a streamable HTTP server. The 31 Oct 2026 plugin docs ask for `extensions["com.openai"].auth`. Adding that object makes `mcp.json` fail schema validation. Schema `1.1.0` was not published at `https://agent-plugins.org/schemas/1.1.0/mcp.schema.json` (HTTP 404 on retrieval). This package stays schema-valid and leaves the auth object out. The server has no authentication. Paid routes on the same merchant are a different profile and are not part of this plugin.

## Not in this package

Do not invent these to make a validator pass. They remain operator work:

* a deployed answer from `POST https://agents.samedaydesk.com/mcp/page-change`
* the domain challenge at `https://agents.samedaydesk.com/.well-known/openai-apps-challenge`
* verified developer identity and Apps Management Write
* `supportURL`, `privacyPolicyURL`, and `termsOfServiceURL` (the site `homepage` and `author.url` do not fill them)
* `review.demo_recording_url`
* listing icons
* upload, review submission, and publication

`review.commerce` is false. The five positive and three negative review cases are in `plugin.json`. No reviewer credentials are in this package.

The companion skill `skills/compare-held-pages/SKILL.md` tells a caller how to use the live tool. It is not a skills-only substitute.
