# How-to: unpaid MCP discovery (Diátaxis)

Goal-oriented recipes for an agent that must **list x402 MCP tools
without paying**. This directory is the how-to quadrant only.

Speak initialize-era `2025-11-25`. Require live or loopback
`tools/list` to include `extract` and `extract_batch`. Extra unrelated
tools are fine.

These pages do not start a wallet, facilitator, checkout, registry
publish, or `batch-settlement`. Advertised `_meta.x402` amounts are
catalog metadata, not authority to spend.

| Question | Page |
| --- | --- |
| I need to list tools unpaid, then stop | [how-to.md](how-to.md) |
| I need the follow-the-doc command | this file |

## Cold follow-the-doc run

From the repository root, Node 20+, no `npm install`, no payment:

```bash
node docs/agent-x402/howto/follow-the-doc.mjs
```

The runner serves a **committed** unpaid MCP catalog on loopback (not a
live purchase), executes tagged fences in [how-to.md](how-to.md), and
replays the seeded failures those pages say must be refused. A passing
run prints JSON with `"ok": true` and exit 0.

```bash
node --test docs/agent-x402/howto/follow-the-doc.test.mjs
```

That test is the same proof plus assertions on the JSON envelope.

Quote one seeded refusal:

```bash
node docs/agent-x402/howto/follow-the-doc.mjs --seeded-failure batch-settlement
```

## Live merchant (optional, still unpaid)

Loopback is the cold artifact. The same JSON-RPC steps against
`https://agents.samedaydesk.com/mcp` are unpaid discovery, not a sale:

```bash
node docs/agent-x402/howto/follow-the-doc.mjs --live
```

`--live` still refuses payment headers, `tools/call` with a credential,
`batch-settlement`, publish, and checkout.

## Out of scope

- MCP Registry / Smithery / marketplace publish
- `tools/call` with `_meta["x402/payment"]` or `PAYMENT-SIGNATURE`
- Enabling `@circle-fin/x402-batching` or scheme `batch-settlement`
- Price, SKU, or checkout mutation
- Treating a 402 challenge as a purchase
