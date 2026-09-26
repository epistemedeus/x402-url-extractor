# CrewAI unpaid `tools/call` is `isError` (W7)

Bounded example of the CrewAI MCP path against SameDayDesk-shaped x402
MCP. It issues one unpaid Streamable HTTP `tools/call` and treats
`isError: true` as the unpaid challenge.

This is not a CrewAI core PR, not a Neo `/labs/crewai` lab, not a wallet,
and not settlement.

## What this proves

CrewAI `MCPServerHTTP(streamable=True)` / `MCPServerAdapter(transport="streamable-http")`
speaks MCP JSON-RPC. SameDayDesk unpaid `tools/call extract` is a
**successful JSON-RPC result** with `isError: true` and a Payment-required
body. HTTP 200 is not paid.

CrewAI `MCPClient.call_tool` **drops `isError`** and returns content only
(`lib/crewai/src/crewai/mcp/client.py` at pin `1.15.22`). Callers that
keep only that content cannot tell an unpaid challenge from extract
success. This example uses `call_tool_result` (keeps `is_error`) and
rejects the dropped-flag false-success.

## Pins

| Pin | Value |
| --- | --- |
| crewai | `1.15.22` MIT |
| crewai-tools | `1.15.22` MIT |
| transport | `streamable-http` |
| DSL | `MCPServerHTTP(streamable=True)` |
| adapter | `MCPServerAdapter(transport=streamable-http)` |
| keep flag | `MCPClient.call_tool_result` |
| do not use | `MCPClient.call_tool`, `Agent.kickoff`, `Crew.kickoff` |
| docs | https://docs.crewai.com/en/mcp/overview.md |

This package does not install CrewAI. The default CLI speaks the same
wire (initialize, `tools/list`, unpaid `tools/call`) against a loopback
fixture so a cold run needs no model key, no wallet, and no live merchant.

## Install

```bash
git clone https://github.com/epistemedeus/x402-url-extractor.git
cd x402-url-extractor/examples/crewai-unpaid-call-w7
```

Requires Node.js 22 or newer. No `npm ci` dependencies.

## Cold run (default)

Default commands never read wallet credentials, sign, send payment
headers, pay, or kickoff a crew.

```bash
npm start
node bin/cli.mjs
```

Expect JSON with `kind: "unpaid_tools_call_is_error"`, `mcp.isError: true`,
`mcp.handlerRan: false`, `boundary.settlement: false`. Exit 0.

## Seeded failure

The designated false-accept is: CrewAI `call_tool` dropped `isError`,
HTTP 200 content claimed as `paid_success`.

```bash
npm run seeded-failure
node bin/cli.mjs --seeded-failure
```

Exit 1. `code: "SEED_REJECT"`, `kind: "false_success"`.

## Official CrewAI snippet (not executed here)

Do not `kickoff`. Prefer `call_tool_result`:

```python
from crewai.mcp.client import MCPClient
from crewai.mcp.transports.http import HTTPTransport

# Loopback unpaid fixture only. Never https://agents.samedaydesk.com/mcp here.
transport = HTTPTransport(url="http://127.0.0.1:PORT/mcp", streamable=True)
async with MCPClient(transport) as client:
    result = await client.call_tool_result("extract", {"url": "https://example.com/"})
    assert result.is_error is True  # unpaid; not paid success
```

`Agent(mcps=["https://agents.samedaydesk.com/mcp"])` would list tools for
free and then a crew kickoff would call paid `extract`. This example
stops before kickoff.

## Refused

- `--live`, `--approve`, `--pay`, payment headers, `_meta["x402/payment"]`
- `--kickoff`, `--crew`
- `--neo`, `https://neomorphic.io/labs/crewai/` (not a live lab)
- live SDS `https://agents.samedaydesk.com/mcp` (this tree is the local fixture)
- treating HTTP 200 or dropped `isError` content as settlement

## Tests

```bash
npm test
```
