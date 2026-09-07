# SameDayDesk customer x402 example

Bounded HTTP example that makes SameDayDesk's public `GET /extract` offer usable
with a maintained `@x402/fetch` client and a customer-owned wallet.

This is not a wallet framework, directory, MCP payment host, Claude/Goose paid
runtime, generic proxy, or replacement for a private durable-state buyer.

## Pinned versions

| Package | Version |
| --- | --- |
| `@x402/fetch` | `2.16.0` |
| `@x402/evm` | `2.16.0` |
| `@x402/core` | `2.16.0` |
| `viem` | `2.55.11` |
| `agent-payment-policy` | `0.12.0` (output field check only) |

Licenses: `@x402/*` Apache-2.0; `viem` and `agent-payment-policy` MIT.

## Install

```bash
cd examples/customer-x402
npm install
```

## Credential-free unpaid preflight (default)

Default commands never read wallet credentials, sign, send payment headers, or
pay.

```bash
npm start
npm run preflight
npm run preflight -- --url 'https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com'
```

## Explicit approved purchase

Bind exact HTTPS origin/path/query, method, network, asset, recipient, amount
cap, and buyer-required output before `@x402/fetch` runs. Inject your own
wallet; this package has no Pilot private buyer dependency.

```bash
export CUSTOMER_X402_PRIVATE_KEY=0xYOUR_KEY
npm run purchase -- --approve \
  --authorization ./fixtures/authorization.json \
  --private-key-env CUSTOMER_X402_PRIVATE_KEY
```

Unset the key when finished. Never commit keys. Fixture keys exist only in
local tests and are never printed.

## Outcomes

| Outcome | Meaning |
| --- | --- |
| `preflight_ok` | Unpaid 402 challenge parsed |
| `authorization_refused` | Exact terms mismatch before signer |
| `valid_delivered` | Buyer-required output fields present |
| `paid_invalid_output` | Paid response retained; output failed |
| `settlement_failed` | Settlement header reports failure |
| `unknown` | Ambiguous; no application retry |

HTTP 200 or a settlement header alone does not prove required output validity.
Settlement in this example is recorded as `unverified` unless the customer
checks chain state separately. There is no automatic application retry, timeout
retry, or fallback provider payment.

Do not transplant HTTP payment credentials into `mcp://` resources. Official
`@x402/mcp` exists but is out of scope here. Native Claude/Goose marketplace
install is already accepted; this example does not make those hosts
payment-capable.

## Tests

```bash
npm test
```

Tests drive the real `@x402/fetch` client against local fixture transports, plus
one bounded credential-free production preflight (no signing, payment, faucet,
signup, or secrets).

## Machine-readable sample

See [`results/example-result.json`](results/example-result.json) for a fixture
purchase result with truthful unverified settlement.
