# MCP Registry packet for Root (do not publish from this worker)

Namespace: `io.github.epistemedeus/x402-data-gateway` (immutable versions).
Schema: `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`.

Exact `server.json` beside this file is merchant 1.23.49, identical to
repository `server.json` at the commit that adds this packet.

Verified source URLs (GET, 2026-09-12):

- GitHub: `https://github.com/epistemedeus/x402-url-extractor`
- Website: `https://agents.samedaydesk.com/`
- Remote: `https://agents.samedaydesk.com/mcp` (`streamable-http`)

Official registry latest (GET `/v0.1/servers/io.github.epistemedeus%2Fx402-data-gateway/versions/latest`):
version `1.23.45`, `isLatest=true`, same name/description/website/remotes.
No tool or resource schemas in that listing.

Construction-changing metadata since 1.23.45 is **not** the version label:

- Live MCP tool `lockfile_pin_delta` (`required: before, after`)
- Live OpenAPI `POST /lockfile-pin-delta` (`required: before, after`)
- `GET /extract` still requires query `url` (unchanged request params)

Live MCP `tools/list` already returns 24 tools including lockfile because
the remote URL is current. Publishing 1.23.49 only syncs the immutable
version label. Do not invent badge adoption. This worker did not call
`/v0.1/publish`.
