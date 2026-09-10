# SameDayDesk extract_batch telemetry label (synthetic new excerpt)

Authored for S137 migration-checklist fixtures. Field names from
`mcp-typed-telemetry-producer.mjs` (`resource` and `httpRoute`).
This document is a second new-docs source, not a correction of `new-http.md`.
Not a live capture. No prices.

Telemetry product resource remains labeled mcp://tool/extract_batch.
HTTP route for the same tool is /extract/batch.

## Documented operations

| method | route | mcpTool | challengeResource | availability |
| --- | --- | --- | --- | --- |
| POST | /extract/batch | extract_batch | mcp://tool/extract_batch | flag:EXTRACT_BATCH_ENABLED |
