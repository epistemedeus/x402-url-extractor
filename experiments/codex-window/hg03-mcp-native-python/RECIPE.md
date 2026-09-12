# Verified recipe

Use the official Python MCP SDK (`mcp==2.2.0`). Default steps never open a wallet
and never send a production payment.

## 1. Cite the SDK

```bash
python -m hg03_mcp_native_python cite
```

Expect `package=mcp`, `version=2.2.0`, `client_module` under `mcp.*`.

## 2. Unpaid production tools/list

```bash
python -m hg03_mcp_native_python compare-production
```

Live source: `https://agents.samedaydesk.com/mcp` (streamable HTTP).
This is discovery, not a purchase. Compare is constructability, not CW07 lint.

Current live server info (2026-09-12 unpaid initialize): `x402-data-gateway` `1.23.49`.
Discovery/preflight tools present: `opportunity_preflight`, `agent_discoverability_audit`,
`payment_offer_preflight`, `seller_integrity_audit`, `contract_qualified_search`,
`agent_surface_budget_audit`. Lockfile tool: `lockfile_pin_delta` with required object
fields `before` and `after`.

## 3. Unpaid production tools/call

`opportunity_preflight` with `{rewardUsd, hours, hourlyCostUsd}` returns
`isError=true` and structured `{x402Version:2, error:"Payment required ...", accepts:[...]}`.
Do not attach `_meta["x402/payment"]` on production. Do not sign.

## 4. Construct lockfile input from a real path

Merchant MCP `lockfile_pin_delta` requires JSON objects, not filesystem paths.

```bash
python -m hg03_mcp_native_python construct-lockfile \
  --before ../../../examples/customer-x402/package-lock.json \
  --after ../../../examples/customer-x402/package-lock.json
```

That path is a real `package-lock.json` in this checkout (`lockfileVersion` 3).
The command reads it locally and prints that MCP arguments are objects.
Identical pins are informational.

Path strings such as `./package-lock.json` are refused before the local facilitator.

## 5. Local fake facilitator paid-shape (no spend)

```bash
python -m hg03_mcp_native_python recipe
```

In-process official `Client` against a local `MCPServer`:

1. `tools/list` is free.
2. `tools/call` without payment -> `payment_required`.
3. `tools/call` with `_meta["x402/payment"]` whose payload `kind` is `local-fake`
   and `spend` is false -> local facilitator `/verify` then `/settle`.
4. Handler runs. Settlement transaction is `local-fake:no-spend`. Mainnet and
   real-looking signatures are refused.

Network for the fake runtime is `eip155:84532`, payTo is the zero address.
This is not authorization to spend on Base mainnet.

## Outcome kinds (do not collapse)

| kind | meaning |
| --- | --- |
| `payment_required` | valid unpaid x402 envelope |
| `payment_invalid` | facilitator rejected the local-fake payload |
| `paid_shape` | handler ran after local verify+settle |
| `malformed_json` | tool text is not JSON |
| `malformed_tool_output` | JSON missing required envelope fields |
| `redirect` | HTTP 3xx refused |
| `timeout` | deadline exceeded |
| `input_refused` | lockfile path/command/URL rejected before payment |
| `credential_refused` | wallet secret in arguments |

## Not in this recipe

- `--approve`, private keys, funded wallets
- Production settle
- Homepage or deploy
