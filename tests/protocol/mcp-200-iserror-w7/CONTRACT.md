# W7 protocol: MCP HTTP 200 + `isError` is not paid

x402 MCP rides JSON-RPC over streamable HTTP. The HTTP status of a
`tools/call` response is the JSON-RPC envelope, not settlement.

The x402 MCP transport returns a **tool result** with `isError: true` for:

- unpaid payment-required (challenge)
- invalid payment
- application / handler failure
- settlement failure

All of those are typically **HTTP 200**. HTTP 2xx plus a payment-looking
body or request header is therefore **not** `paid_success`.

`paid` is allowed only when the JSON-RPC result is a tool result whose
`isError` is not `true`. This suite never treats `result.isError === true`
as paid, including when:

- the request carried `_meta["x402/payment"]`
- the error text mentions `x402/payment`
- `_meta["x402/payment-response"]` is present
- `classifyCommerceResult` would label HTTP 200 + `paymentPresent` as paid

Naive predicate this suite rejects:

`httpStatus ∈ [200,300) ∧ paymentPresent → paid_success`

## Verify

Cold run (no prior state):

```
node --test tests/protocol/mcp-200-iserror-w7/*.test.mjs
```

Seeded failure (false paid claims must exit 0 only because they are rejected):

```
node tests/protocol/mcp-200-iserror-w7/reject-seeded.mjs
node tests/protocol/mcp-200-iserror-w7/reject-seeded.mjs --claim tests/protocol/mcp-200-iserror-w7/fixtures/seeded-false-paid-http-2xx-iserror.json
```

Rejector is not a tautology (true paid_success claim is not this failure; exit 1):

```
node tests/protocol/mcp-200-iserror-w7/reject-seeded.mjs --claim tests/protocol/mcp-200-iserror-w7/fixtures/not-this-failure-paid-success.json
```

Both cold tests and seeded rejector:

```
node tests/protocol/mcp-200-iserror-w7/run.mjs
```
