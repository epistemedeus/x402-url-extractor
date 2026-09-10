# SameDayDesk paid HTTP (synthetic new excerpt)

Authored for S137 migration-checklist fixtures. Phrases taken from
repository `README.md` and `plugins/samedaydesk-x402/skills/web-extract/SKILL.md`.
Not a live capture. Not a complete product surface. No prices.

Paid `GET /extract` and `GET /read` return a typed record after settlement.

`EXTRACT_BATCH_ENABLED=1` adds `POST /extract/batch` and MCP `extract_batch`.
The default is off: 25 paid HTTP operations and 22 MCP tools; enabled: 26 and 23.
Its challenge resource is `https://agents.samedaydesk.com/extract/batch`, not `mcp://`.

`GET https://agents.samedaydesk.com/extract?url=<https-url>` remains the single-page JSON route.
`GET https://agents.samedaydesk.com/read?url=<https-url>` remains the Markdown route.
`POST https://agents.samedaydesk.com/extract/batch` is the bounded batch route when live discovery shows support.

## Documented operations

| method | route | mcpTool | challengeResource | availability |
| --- | --- | --- | --- | --- |
| GET | /extract | extract | https://agents.samedaydesk.com/extract | always |
| GET | /read | read | https://agents.samedaydesk.com/read | always |
| POST | /extract/batch | extract_batch | https://agents.samedaydesk.com/extract/batch | flag:EXTRACT_BATCH_ENABLED |
