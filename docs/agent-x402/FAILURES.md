# Seeded failures

Every fixture in `fixtures/` must be **rejected**. A fixture that passes
as live discovery means this pack is wrong.

Run all of them:

```bash
node docs/agent-x402/verify.mjs reject-seeded
```

Run one and quote stdout:

```bash
node docs/agent-x402/verify.mjs reject-seeded --fixture docs/agent-x402/fixtures/missing-extract.json
```

Kill-command seeded failure (no fixture file; argv is the seed):

```bash
node docs/agent-x402/verify.mjs publish
```

Expect exit 2 and a line containing
`KILL: publish/registry is out of scope for MCP unpaid discovery`.

## Fixture table

| id | Why it is not unpaid discovery | `expectReject` |
| --- | --- | --- |
| `missing-extract` | `tools/list` omits `extract` | `tools/list missing or duplicate extract` |
| `missing-extract-batch` | `tools/list` omits `extract_batch` | `tools/list missing or duplicate extract_batch` |
| `duplicate-extract` | two `extract` tools | `tools/list missing or duplicate extract` |
| `invented-tools-only` | catalog of names that were not live-required | `tools/list missing or duplicate extract` |
| `protocol-2026-07-28` | initialize-era protocol is not `2026-07-28` | `protocolVersion 2026-07-28 is out of scope for unpaid discovery` |
| `tools-call-paid` | `tools/call` plus `_meta["x402/payment"]` | `tools/call is paid; unpaid discovery stops at tools/list` |
| `payment-header-initialize` | `PAYMENT-SIGNATURE` on `initialize` | `payment headers are forbidden on unpaid discovery` |
| `mcp-method-header` | header-routed `Mcp-Method` | `Mcp-Method header is forbidden on initialize-era discovery` |
| `registry-publish` | MCP Registry publish POST | `registry publish is a kill condition` |
| `checkout-mutation` | checkout / price / SKU write | `checkout or payment mutation is a kill condition` |

These files are not live inventories. Do not POST them to the merchant,
the registry, or a checkout endpoint.

## Acceptance

Quoted verifier output for at least one fixture **and** the live
`discover` command. Green tests in other packages do not substitute.
