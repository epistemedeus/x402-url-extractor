# SameDayDesk paid HTTP (synthetic new excerpt, batch omitted)

Authored for S137 migration-checklist fixtures. This new doc only restates
the always-on GET routes. It does not document `POST /extract/batch` even
though `README.md` says `EXTRACT_BATCH_ENABLED=1` adds `POST /extract/batch`
and MCP `extract_batch`. The omission is the partial: inventory includes
that operation, new docs do not cite it.

Paid `GET /extract` and `GET /read` return a typed record after settlement.

`GET https://agents.samedaydesk.com/extract?url=<https-url>` remains the single-page JSON route.
`GET https://agents.samedaydesk.com/read?url=<https-url>` remains the Markdown route.

## Documented operations

| method | route | mcpTool | challengeResource | availability |
| --- | --- | --- | --- | --- |
| GET | /extract | extract | https://agents.samedaydesk.com/extract | always |
| GET | /read | read | https://agents.samedaydesk.com/read | always |
