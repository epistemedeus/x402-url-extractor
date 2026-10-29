# NEXT

Root owns merge, installed release, customer communication, and any human preview. This branch is the source export. It is not merged and it is not deployed.

H64202 may test this source on its own. A later fix from that batch needs its own admission. This owner does not supervise that run.

Leave plugin protocol pins on `2025-11-25`. Leave package version `1.23.55`, prices, recipients, and the `qs` override `6.16.0`.

The axios pin is exact `1.20.0`. Applicability stays separate: this merchant and `@coinbase/cdp-sdk` do not set `httpVersion: 2`.

A future tool schema that `mcp-zod3-json-schema.mjs` cannot project fails the MCP mount at startup. `server.js` already logs `/mcp mount FAILED` and leaves the other HTTP routes up. The current catalog compiled during startup smoke.

A `settle()` that returns `{ success: false }` without throwing still follows the existing wrapper and is attached as `x402/payment-response` on the handler result. The refusal covered here is a thrown `settle()`.
