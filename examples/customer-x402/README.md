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

Policy 0.15.0 was compared with this pin. Its additional schema-validation path
and AJV dependencies are not used here: this example requires non-null named
fields, not a general JSON Schema contract. The pinned validator checks field
presence and serialized size; this example also checks wire bytes, media type,
non-null required values, and `ok === true`. Neither checks semantic quality.

## Install

```bash
git clone https://github.com/epistemedeus/x402-url-extractor.git
cd x402-url-extractor/examples/customer-x402
npm ci
```

Requires Node.js 22 or newer. From an existing repository checkout, start with
`cd examples/customer-x402` instead of cloning again.

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
cap, EIP-712 token name/version, signature validity (at most 300 seconds), and
buyer-required output before wallet lookup or signing. Inject your own
wallet; this package has no Pilot private buyer dependency.

```bash
export CUSTOMER_X402_PRIVATE_KEY=0xYOUR_KEY
npm run purchase -- --approve \
  --authorization ./fixtures/authorization.json \
  --private-key-env CUSTOMER_X402_PRIVATE_KEY
```

Unset the key when finished. Never commit keys. Fixture keys exist only in
local tests and are never printed.

Inspect and edit the authorization file yourself first. A provided `--url` must
match it exactly, including query order/encoding. This example supports only
x402 v2 exact EIP-3009, not Permit2, approvals, sponsorship, RPC fallback, or MCP
payments. The official wrapper consumes the already-inspected challenge and
performs at most one signed request. There is no second discovery request.

## Outcomes

| Outcome | Meaning |
| --- | --- |
| `preflight_ok` | Unpaid 402 challenge parsed |
| `authorization_refused` | Exact terms mismatch before signer |
| `valid_delivered` | JSON media type, bounded body, `ok: true`, and non-null required fields |
| `paid_invalid_output` | Paid response retained; output failed |
| `settlement_failed` | Settlement header reports failure |
| `unknown` | Ambiguous; no application retry |

HTTP 200 or a settlement header alone does not prove required output validity.
Settlement in this example is recorded as `unverified` unless the customer
checks chain state separately. There is no automatic application retry, timeout
retry, or fallback provider payment.

Challenge bodies are capped at 64 KB; output wire bytes use the authorized limit
(at most 1 MB). Each HTTP request/body read has a 15-second deadline; redirects
are refused. A timeout or disconnect after dispatch keeps `paymentSent: true`,
meaning possibly sent, not proved settled. A signer failure can leave
`paymentSigned: null`. Do not rerun unknown or paid-invalid outcomes automatically.
Signer responsiveness and wallet safety remain the customer's responsibility.
There is no cross-process pending journal, cumulative budget, or crash-safe guard.
Receipts retain redacted output and validation/payment-header observations, not
raw payment headers or signatures; redaction can remove opaque output values.

Do not transplant HTTP payment credentials into `mcp://` resources. Official
`@x402/mcp` exists but is out of scope here. Native Claude/Goose marketplace
install is already accepted; this example does not make those hosts
payment-capable.

## Tests

```bash
npm test
```

Tests drive the real `@x402/fetch` client and the copyable CLI commands against
local fixture transports. They make no production requests by default. To opt
into only the bounded unpaid production preflight:

```bash
CUSTOMER_X402_LIVE_PREFLIGHT=1 node --test --test-name-pattern='bounded credential-free production preflight' test/customer-x402.test.mjs
```

This signs nothing and uses no wallet, payment, faucet, signup, or account secret.

## Machine-readable sample

See [`results/example-result.json`](results/example-result.json) for a fixture
purchase result with truthful unverified settlement.
