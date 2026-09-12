# hg03 native Python MCP SDK consumer

Experiment-only. Owns `experiments/codex-window/hg03-mcp-native-python/` and nothing else.
Does not change the merchant, homepage, default merge, deploy, payment, outreach, or signup.

This is a **maintained official Python MCP SDK** consumer for current SameDayDesk
discovery and preflight tool envelopes, plus one constructable lockfile input path.

It is **not** a contract linter (CW07 owns that) and **not** a hand-rolled JSON-RPC client.

## Official SDK (current stable, primary evidence)

- Package: [`mcp==2.2.0`](https://pypi.org/project/mcp/2.2.0/)
- PyPI JSON: <https://pypi.org/pypi/mcp/2.2.0/json>
- Docs: <https://py.sdk.modelcontextprotocol.io/>
- Repository: <https://github.com/modelcontextprotocol/python-sdk>
- Wheel sha256 `bde982589473a060ae145e3406e9a5333fe538c97229ba841f5a7f92be004f81`
- Uploaded `2026-09-07T16:06:19Z`, classifier `Production/Stable`
- Import: `from mcp import Client` and `from mcp.server import MCPServer`

Receipt: `receipts/sdk-cite.json`.

## What it does

1. Unpaid `tools/list` against live `https://agents.samedaydesk.com/mcp` via the official Client.
2. Compare those unpaid production tools to typed discovery/preflight + `lockfile_pin_delta` envelopes.
3. Unpaid `tools/call` expects an x402 **payment-required** envelope. No payment meta is sent.
4. Local fake facilitator HTTP runtime (`GET /supported`, `POST /verify`, `POST /settle`) for paid shapes **without spend**.
5. Construct `lockfile_pin_delta` arguments from a real local `package-lock.json` path. The MCP payload is JSON objects, never the path.

Handlers never read `PRIVATE_KEY`, `CUSTOMER_X402_PRIVATE_KEY`, or a funded wallet.

Malformed JSON, malformed tool output, HTTP redirect, and timeout stay distinct outcomes.

## Recipe

See [`RECIPE.md`](RECIPE.md). Default commands never open a wallet.

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[test]"
.venv/bin/pytest -q --tb=short
.venv/bin/python -m hg03_mcp_native_python cite
.venv/bin/python -m hg03_mcp_native_python compare-production
.venv/bin/python -m hg03_mcp_native_python construct-lockfile \
  --before ../../../examples/customer-x402/package-lock.json \
  --after ../../../examples/customer-x402/package-lock.json
.venv/bin/python -m hg03_mcp_native_python recipe
```

`serve-facilitator` binds `127.0.0.1` only.

## Out of scope

- Production settle or money movement
- Homepage, deploy, merge, outreach, signup
- Another JSON-schema contract linter
- Custom JSON-RPC pretending to be the SDK
