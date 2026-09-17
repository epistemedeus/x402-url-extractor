# How-to: discover MCP tools without paying

You already have a Streamable HTTP MCP URL (live merchant
`https://agents.samedaydesk.com/mcp`, or `$MCP_ORIGIN` from the
follow-the-doc runner). Goal: read `initialize` plus `tools/list`,
observe one unpaid 402, and **stop**. Do not settle. Do not publish.

Speak initialize-era `2025-11-25`. Do not send `Mcp-Method`. Do not
send payment headers. Do not enable `batch-settlement`.

`$MCP_ORIGIN` is the POST URL. The cold runner sets it to loopback.
On a live host, export it yourself. Replay `mcp-session-id` when the
server returns one.

The helper is `docs/agent-x402/howto/rpc.mjs`. It posts JSON-RPC and
refuses kill actions locally.

## Initialize without a credential

<!-- follow-the-doc:step id=initialize -->
```bash
node docs/agent-x402/howto/rpc.mjs initialize
```

Expect exit 0, `"ok": true`, `protocolVersion` `2025-11-25`, and
`serverName` `x402-data-gateway`. Protocol `2026-07-28` is out of
scope: stop.

## List tools unpaid

<!-- follow-the-doc:step id=tools-list -->
```bash
node docs/agent-x402/howto/rpc.mjs tools-list
```

Expect exit 0 and exactly one `extract` plus exactly one
`extract_batch`, each with object input/output schemas. Extra
unrelated tools are fine. Do not invent names that were not returned.
`_meta.x402.paymentRequired` is catalog metadata, not a bill.

`extract` input requires `url`. `extract_batch` input requires `urls`
(array, minItems 1, maxItems 5). Missing or duplicate names are
schema drift: stop.

## Read a 402 without paying

One unpaid `tools/call` with **no** payment credential. The handler
must not run. Copy live `accepts[].scheme` (must be `exact`),
`resource.url`, `network`, `asset`, and `payTo` if present. Do not
hardcode a price and do not treat the challenge as permission to pay.

<!-- follow-the-doc:step id=unpaid-402 -->
```bash
node docs/agent-x402/howto/rpc.mjs unpaid-402 --tool extract
```

Expect exit 0, `"paymentRequired": true`, `"handlerRan": false`,
`"batchSettlement": false`. Then stop. Discovery is complete.

## Refuse batch-settlement

`extract_batch` is a bounded tool name. It is not the x402
`batch-settlement` scheme and not `@circle-fin/x402-batching`. If an
offer lists `scheme: "batch-settlement"`, reject it. Do not enable
that scheme.

<!-- follow-the-doc:seeded-failure id=batch-settlement -->
```bash
node docs/agent-x402/howto/rpc.mjs enable-batch-settlement
```

Expect exit non-zero. Stdout or stderr matches
`batch-settlement scheme is forbidden for unpaid MCP discovery`.

Fixture: [fixtures/batch-settlement.json](fixtures/batch-settlement.json).

## Refuse a paid tools/call

Do not attach `_meta["x402/payment"]` during this how-to.

<!-- follow-the-doc:seeded-failure id=tools-call-paid -->
```bash
node docs/agent-x402/howto/rpc.mjs tools-call --pay --tool extract
```

Expect exit non-zero. Stdout or stderr matches
`tools/call with payment is paid; unpaid discovery does not settle`.

## Refuse payment headers on initialize

<!-- follow-the-doc:seeded-failure id=payment-header-initialize -->
```bash
node docs/agent-x402/howto/rpc.mjs initialize --header PAYMENT-SIGNATURE=e30=
```

Expect exit non-zero. Stdout or stderr matches
`payment headers are forbidden on unpaid discovery`.

## Refuse Mcp-Method

Header-routed MCP is not initialize-era `2025-11-25`.

<!-- follow-the-doc:seeded-failure id=mcp-method-header -->
```bash
node docs/agent-x402/howto/rpc.mjs initialize --header Mcp-Method=initialize
```

Expect exit non-zero. Stdout or stderr matches
`Mcp-Method header is forbidden on initialize-era discovery`.

## Refuse registry publish

A version label lag versus live `/mcp` is not authority to publish.

<!-- follow-the-doc:seeded-failure id=registry-publish -->
```bash
node docs/agent-x402/howto/rpc.mjs publish
```

Expect exit non-zero. Stdout or stderr matches
`registry publish is a kill condition`.

## Document-only seeded failures

These JSON files are not live inventories. Do not POST them to a
merchant, registry, or checkout. The follow-the-doc runner rejects
them in-process:

| id | Why it is not unpaid discovery |
| --- | --- |
| `missing-extract` | `tools/list` omits `extract` |
| `protocol-2026-07-28` | initialize-era protocol is not `2026-07-28` |
| `checkout-mutation` | checkout / price / SKU write |

Id `missing-extract` is also required by the runner even though it has
no bash fence. Fixture: [fixtures/seeded-failures.json](fixtures/seeded-failures.json).

## Stay on unpaid discovery

If the next action is pay, settle, publish, register, or change a
price, stop. A 402 body is not a purchase. `tools/list` is not
demand.
