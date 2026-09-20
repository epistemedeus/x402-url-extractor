# W7 protocol: MCP HTTP 200 + `isError` is not paid

x402 MCP rides JSON-RPC over streamable HTTP. The HTTP status of a
`tools/call` response is the JSON-RPC envelope, not settlement.

The x402 MCP transport returns a **tool result** with `isError: true` for:

- unpaid payment-required (challenge)
- invalid payment
- application / handler failure
- output-schema failure (after the handler; settle may already have run)

`@x402/mcp` settlement failure is **not** always `isError: true`. When
`settle()` returns `{ success: false }` it attaches
`_meta["x402/payment-response"]` and leaves `isError` unset. When
`settle()` throws, it re-challenges with `isError: true`.

All of those are typically **HTTP 200**. HTTP 2xx plus a payment-looking
body or request header is therefore **not** `paid_success`.

`paid` is allowed only for a JSON-RPC tool result whose `isError` is not
`true` **and** whose settlement proof has `success === true`. This suite
never treats `result.isError === true` as paid, including when:

- the request carried `_meta["x402/payment"]`
- the error text mentions `x402/payment`
- `_meta["x402/payment-response"]` is present
- `classifyCommerceResult` would label HTTP 200 + `paymentPresent` as paid

Naive predicate this suite rejects:

`httpStatus ∈ [200,300) ∧ paymentPresent → paid_success`

## Verify

Cold run against the real loopback MCP (exit 0):

```
node tests/protocol/mcp-200-iserror-w7/check.mjs --cold
```

Seeded failure: HTTP 200 `isError:true` claimed as `paid_success` is rejected (exit 1):

```
node tests/protocol/mcp-200-iserror-w7/check.mjs --seeded-failure
```

`--live` is refused (exit 1).

Cold node:test suite (exit 0):

```
node --test tests/protocol/mcp-200-iserror-w7/*.test.mjs
```

Seeded false-paid corpus (exit 0 because each claim is rejected):

```
node tests/protocol/mcp-200-iserror-w7/reject-seeded.mjs
```

Rejector is not a tautology (true `paid_success` is not this failure; exit 1):

```
node tests/protocol/mcp-200-iserror-w7/reject-seeded.mjs --claim tests/protocol/mcp-200-iserror-w7/fixtures/not-this-failure-paid-success.json
```

Both cold tests and seeded rejector:

```
node tests/protocol/mcp-200-iserror-w7/run.mjs
```
