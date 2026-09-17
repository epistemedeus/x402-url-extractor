# SameDayDesk CrewAI unpaid `tools/list`

CrewAI-shaped unpaid discovery against the live SameDayDesk MCP at
`https://agents.samedaydesk.com/mcp`. This example runs `initialize` then
`tools/list` over Streamable HTTP and stops. It does not call tools, kick off
a crew, sign, or pay.

CrewAI's host API is `crewai_tools.MCPServerAdapter` with
`transport: "streamable-http"`. Accessing the adapter's tool list is unpaid
MCP discovery. Using a listed tool would be `tools/call` and is out of scope.

## Pins

| Pin | Value |
| --- | --- |
| MCP URL | `https://agents.samedaydesk.com/mcp` |
| Transport | `streamable-http` |
| Protocol | `2025-11-25` |
| Required tools | `extract`, `extract_batch` |
| Extra tools | accepted |
| CrewAI adapter (optional host) | `crewai-tools` MCP extra, documented at 1.15.22; not installed here |

GET `/mcp` is a JSON discovery document (`method: POST`). It is not
`tools/list`. Live unpaid discovery is POST `initialize` then POST
`tools/list`. Tool metadata is not authorization.

## Install

Node.js 22 or newer. No extra npm packages.

```bash
git clone https://github.com/epistemedeus/x402-url-extractor.git
cd x402-url-extractor/examples/crewai-unpaid-list
node bin/cli.mjs --json
```

From an existing checkout, start with `cd examples/crewai-unpaid-list`.

CrewAI itself is optional. This directory does not install it.

## Copyable CrewAI host path (list only)

```python
from crewai_tools import MCPServerAdapter

server_params = {
    "url": "https://agents.samedaydesk.com/mcp",
    "transport": "streamable-http",
}

with MCPServerAdapter(server_params) as tools:
    names = [tool.name for tool in tools]
    assert "extract" in names
    assert "extract_batch" in names
    # STOP. Do not call tools. Do not create Agent/Task/Crew.
```

Shipped params: [`fixtures/crewai.mcp.json`](fixtures/crewai.mcp.json). Default
headers stay empty. If `crewai_tools` is absent, use the Node or stdlib Python
clients below and record that limit. Do not install CrewAI from this folder.

```bash
python3 python/mcpserver_adapter_example.py
```

## Cold unpaid list (default)

Default commands never send `tools/call`, payment headers, or `Mcp-Method`.
They do not send protocol `2026-07-28`.

```bash
node bin/cli.mjs
node bin/cli.mjs --json
python3 python/list_tools.py --json
```

Require `extract` and `extract_batch`. Extra unrelated tools are fine. Do not
call them.

## Seeded failure

Offline hostile inventory that omits `extract` and claims success. The product
must reject it.

```bash
node bin/cli.mjs --seeded-failure --json
```

Expected: exit **1**, `error.code: SEED_REJECT`,
`seeded.false-accept.missing-extract`. Other refused recordings:

```bash
node bin/cli.mjs --fixture ./fixtures/seeded/tools-call-attempt.json --json
node bin/cli.mjs --fixture ./fixtures/seeded/payment-header.json --json
```

## Three different checks

Do not mix these:

1. Config read: `fixtures/crewai.mcp.json` only. No MCP connection.
2. Seeded failure: designated missing-`extract` fixture. Offline.
3. Live unpaid discovery: POST `initialize` then `tools/list` on
   `https://agents.samedaydesk.com/mcp`. Require `extract` and
   `extract_batch`. Extra tools are accepted.

`npm test` runs a loopback mock, the seeded rejection, and the live unpaid
list. Loopback `--url http://127.0.0.1:<port>/mcp` is test-only.

## Not this example

- Not a paid `tools/call` and not `Crew.kickoff()`
- Not a wallet, signer, or `@x402/fetch` customer
- Not protocol `2026-07-28` and not `Mcp-Method`
- Not an MCP Registry or CrewAI marketplace publish
- Not a default source header (`X-SameDayDesk-Agent-Source` is unset)

HTTP customer preflight and explicitly authorized purchase stay in
[`examples/customer-x402`](../customer-x402). This package does not become
payment-capable from that example. MCP and HTTP credential scopes remain
distinct.

## License

MIT. Same license as `epistemedeus/x402-url-extractor`.
