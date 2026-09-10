# SameDayDesk extract_batch payment binding (synthetic new excerpt)

Authored for S137 migration-checklist fixtures. Phrases from repository
`README.md` and `mcp-server.mjs`. Not a live capture. No prices.

Its challenge resource is `https://agents.samedaydesk.com/extract/batch`, not `mcp://`.
Payment challenge and credentials are bound to the HTTP resource, not mcp://.

## Documented operations

| method | route | mcpTool | challengeResource | availability |
| --- | --- | --- | --- | --- |
| POST | /extract/batch | extract_batch | https://agents.samedaydesk.com/extract/batch | flag:EXTRACT_BATCH_ENABLED |
