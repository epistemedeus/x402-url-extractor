# SameDayDesk CrewAI unpaid tools/list

Credential-free CrewAI example that lists SameDayDesk MCP tools through
native `crewai.mcp.MCPServerHTTP`. Default commands never read a wallet,
never send payment headers, and never issue `tools/call`.

Live remote: `https://agents.samedaydesk.com/mcp` (streamable HTTP).
`tools/list` is free protocol discovery. Paid `tools/call` is out of
scope.

## Pins

| Pin | Value |
| --- | --- |
| CrewAI | `1.15.22` |
| `mcp` | `1.28.1` (CrewAI 1.15.22 requires `mcp~=1.28.1`) |
| Native class | `crewai.mcp.MCPServerHTTP` |
| Live URL | `https://agents.samedaydesk.com/mcp` |
| Required tools | `extract`, `extract_batch` |

This is not `crewai_tools.MCPServerAdapter`, not an Agent/Crew kickoff, not
a wallet, and not a Goose or Claude plugin.

## Install

Requires Python 3.10–3.13. From a repository checkout:

```bash
cd examples/crewai-sds-mcp-list
uv venv .venv --python 3.12
uv pip install --python .venv/bin/python -r requirements.txt
```

`python3 -m venv .venv` plus `.venv/bin/pip install -r requirements.txt`
is equivalent when `ensurepip` is available.

Set `CREWAI_DISABLE_TELEMETRY=true` if you want to disable CrewAI telemetry
yourself. The CLI already sets it.

## Copyable CLI

Cold unpaid `tools/list` against the live merchant (the default):

```bash
.venv/bin/python bin/cli.py
.venv/bin/python bin/cli.py --url https://agents.samedaydesk.com/mcp
```

Seeded failures this example rejects:

```bash
.venv/bin/python bin/cli.py --seeded-failure missing-extract
.venv/bin/python bin/cli.py --seeded-failure tools-call
.venv/bin/python bin/cli.py --seeded-failure payment-header
```

`--seeded-failure missing-extract` starts a loopback streamable-HTTP MCP
that omits `extract` / `extract_batch`, points `MCPServerHTTP` at it, and
exits non-zero. `--call`, `--approve`, and payment headers are refused
before any merchant request.

## What this example does

1. Build `MCPServerHTTP(url=..., streamable=True)` with empty headers.
2. Map it the same way CrewAI's native resolver maps HTTP configs:
   `HTTPTransport(url, headers, streamable)` then `MCPClient.list_tools()`.
3. Require `extract` and `extract_batch` (extra live tools are accepted).
4. Print JSON. Never call a tool.

## What this example does not do

- No `tools/call`, no x402 payment, no MPP, no wallet.
- No `Agent(..., mcps=[...])` and no model execution.
- No `Mcp-Method` header. This example does not advertise dual-stack MCP.
- No OAuth. Unpaid `initialize` and `tools/list` do not require a login.
- Loopback `http://127.0.0.1:<port>/mcp` is only the seeded fixture.

## Tests

```bash
.venv/bin/python -m unittest discover -s test -v
```

That suite includes the seeded incomplete-inventory rejection. The cold
live command is `python bin/cli.py` (network). Green unit tests alone are
not a live merchant proof.

## License

MIT on this example. CrewAI remains separately licensed by its authors.
