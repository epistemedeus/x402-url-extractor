# SameDayDesk customer x402 example

Bounded HTTP example that makes SameDayDesk's public `POST /extract/batch`
and backward-compatible `GET /extract` offers usable with a maintained
`@x402/fetch` client and a customer-owned wallet.

This is not a wallet framework, directory, MCP payment host, Claude/Goose paid
runtime, generic proxy, or replacement for a private durable-state buyer.

## Pinned versions

| Package | Version |
| --- | --- |
| `@x402/fetch` | `2.16.0` |
| `@x402/evm` | `2.16.0` |
| `@x402/core` | `2.16.0` |
| `@x402/extensions` | `2.16.0` (payment-identifier client enrichment) |
| `viem` | `2.55.11` |
| `agent-payment-policy` | `0.12.0` (single-page output field check only) |

Licenses: `@x402/*` Apache-2.0; `viem` and `agent-payment-policy` MIT.

Policy 0.15.0 was compared with this pin. Its additional schema-validation path
and AJV dependencies are not used here: the single-page path requires non-null
named fields, while batch validation follows the seller batch contract and buyer
selected fields (explicit nulls allowed where the seller permits them).

## Install

```bash
git clone https://github.com/epistemedeus/x402-url-extractor.git
cd x402-url-extractor/examples/customer-x402
npm ci
```

Requires Node.js 22 or newer. From an existing repository checkout, start with
`cd examples/customer-x402` instead of cloning again.

## Credential-free unpaid batch preflight (default)

Default commands never read wallet credentials, sign, send payment headers, or
pay. They run local batch admission for up to five public HTTPS URLs and caller-
selected supported fields, then fetch the unpaid `POST /extract/batch` challenge.

```bash
npm start
npm run preflight
npm run preflight -- --authorization ./fixtures/authorization-batch.json
```

## Credential-free unpaid GET preflight (backward compatible)

```bash
npm run preflight:get
npm run preflight -- --get --url 'https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com'
```

## Explicit approved purchase

Bind exact HTTPS origin/path/query, method, serialized body bytes (batch),
network, asset, recipient, amount cap, EIP-712 token name/version, signature
validity (at most 300 seconds), and buyer-required output before wallet lookup
or signing. Inject your own wallet; this package has no Pilot private buyer
dependency.

```bash
export CUSTOMER_X402_PRIVATE_KEY=0xYOUR_KEY
npm run purchase -- --approve \
  --authorization ./fixtures/authorization-batch.json \
  --private-key-env CUSTOMER_X402_PRIVATE_KEY
```

GET remains available:

```bash
npm run purchase:get -- --approve \
  --authorization ./fixtures/authorization.json \
  --private-key-env CUSTOMER_X402_PRIVATE_KEY
```

### Optional unsigned attempt receipt (recommended for ambiguous transport)

Without `--attempt-receipt`, this example does not retain the unsigned EIP-3009
`nonce` or exact `validBefore`, so an ambiguous HTTP 400/`charged:false`
outcome cannot be reconciled precisely against `authorizationState`. Opt in to
persist only the secret-free payment identity **before** the paid send:

```bash
npm run purchase -- --approve \
  --authorization ./fixtures/authorization-batch.json \
  --private-key-env CUSTOMER_X402_PRIVATE_KEY \
  --attempt-receipt ./attempt-receipt.json
```

Receipt write failure aborts the paid send. A later transport timeout or crash
keeps the receipt stage (`ready_before_send` / `paid_send_dispatched`) and
`settlementState: unknown` instead of erasing identity. The file never stores a
signature, payment header, private key, typed-data envelope, raw response, or
environment.

### Read-only reconcile

```bash
npm run reconcile -- --reconcile \
  --attempt-receipt ./attempt-receipt.json \
  --rpc-url https://YOUR_EXPLICIT_RPC
```

Uses official `authorizationState(authorizer, nonce)` through a bounded viem
JSON-RPC transport (byte limit, total timeout, finite requests, zero retries),
pinned to an observed block. Chain-time expiry comes from that block timestamp;
wall-clock expiry is reported separately. The observed block hash is rechecked
after the state read; a changed or unavailable block leaves state unknown.
Cancellation requires its own canonical successful receipt with the exact
`AuthorizationCanceled` event, not merely a filtered log. It is distinguished from an
exact successful `AuthorizationUsed` + single matching `Transfer`. Confirmation
and finality require a still-matching canonical block hash, not merely a past
height under a finalized tag. A used authorization is not delivered output and
not permission to retry. Truncated-range absence remains unknown.

Unset the key when finished. Never commit keys. Fixture keys exist only in
local tests and are never printed.

Inspect and edit the authorization file yourself first. A provided `--url` must
match it exactly, including query order/encoding. After approval, any changed
body bytes (including mutation of input objects that alters serialization) are
refused. Preflight and the paid attempt send the same body bytes. This example
supports only x402 v2 exact EIP-3009, not Permit2, approvals, sponsorship, RPC
fallback, or MCP payments. The official wrapper consumes the already-inspected
challenge and performs at most one signed request. There is no second discovery
request. `POST` does not authorize target browsing before merchant payment.

## Outcomes

| Outcome | Meaning |
| --- | --- |
| `preflight_ok` | Unpaid 402 challenge parsed |
| `authorization_refused` | Exact terms mismatch before signer |
| `valid_delivered` | GET: JSON media type, bounded body, `ok: true`, and non-null required fields |
| `useful_delivered` | Batch: seller contract, ordered row identities, requested fields, and completed all-success status |
| `partial_delivered` | Batch: seller contract satisfied with explicit failed/partial rows; not a refund |
| `paid_invalid_output` | Paid response retained; output failed contract/intent checks |
| `settlement_failed` | Settlement header reports failure |
| `unknown` | Ambiguous; no application retry |

HTTP 200 or a settlement header alone does not prove required output validity.
Settlement in this example is recorded as `unverified` unless the customer
checks chain state separately. There is no automatic application retry, timeout
retry, or fallback provider payment. Duplicate, omitted, wrong-order, or
wrong-URL batch rows are never accepted as complete.

Challenge bodies are capped at 64 KB; output wire bytes use the authorized limit
(at most 1 MB for GET, 128 KB for batch). Each HTTP request/body read has a
15-second deadline; redirects are refused. A timeout or disconnect after
dispatch keeps `paymentSent: true`, meaning possibly sent, not proved settled.
A signer failure can leave `paymentSigned: null`. Do not rerun unknown or
paid-invalid outcomes automatically. Signer responsiveness and wallet safety
remain the customer's responsibility. Without `--attempt-receipt` there is no
cross-process identity journal for EIP-3009 nonce/`validBefore` reconciliation.
With `--attempt-receipt`, only the unsigned payment identity is retained for a
separate read-only reconcile; this is not a durable budget buyer or automatic
retry system. Receipts retain redacted output, `bodyDigest`, and
validation/payment-header observations, not raw payment headers or signatures;
redaction can remove opaque output values.

Do not transplant HTTP payment credentials into `mcp://` resources. Official
`@x402/mcp` exists but is out of scope here. Native Claude/Goose marketplace
install is already accepted; this example does not make those hosts
payment-capable.

## Future owned-homepage live trial (not executed here)

`fixtures/authorization-batch-homepages.json` binds three owned public HTTPS
homepages for a separately authorized future live trial. Default commands and
tests do not call it.

## Tests

```bash
npm test
```

Tests drive the real `@x402/fetch` client and the copyable CLI commands against
local fixture transports. They make no production requests by default. To opt
into only the bounded unpaid production GET preflight:

```bash
CUSTOMER_X402_LIVE_PREFLIGHT=1 node --test --test-name-pattern='bounded credential-free production preflight' test/customer-x402.test.mjs
```

This signs nothing and uses no wallet, payment, faucet, signup, or account secret.

## Offline page-change recipe (no key, no fetch)

If you already have two delivered `POST /extract/batch` JSON files, compare
buyer-selected fields without paying again. The recipe does not fetch URLs,
schedule a second attempt, sign, retry, or contact the merchant.

Use this from the full public repository checkout, not a separately packed npm
tarball. Source-identity helpers live at the repository root. The comparison
covers selected values in the supplied artifacts; it does not validate the full
seller output schema or prove downstream business utility. The existing
purchase-time buyer validation remains a separate step.

### Fixture quickstart

From `examples/customer-x402` after `npm ci`:

```bash
npm run page-change -- job --job ./fixtures/page-change/customer-job/job.json
npm run page-change -- compare \
  --before ./fixtures/page-change/customer-job/before.json \
  --after ./fixtures/page-change/customer-job/after.json \
  --fields title,description,headings \
  --format text
```

The fixture pair is owner proof that selected-field before/after, failed
rows, missing rows, and coverage unknowns stay visible. It is not buyer
demand. `charged: true` is not useful output. Reordered rows with the same
source URL are order, not content change. An absent selected field is coverage
unknown, not deletion.

See `src/page-change/NOTICE.md` for ownership, license, and reviewed-source
pins. UTF-8 shortening applies only to text display excerpts; JSON
`changes[].before/after` keep exact admitted values.

### Two existing public client deliveries

Save each paid or unpaid batch JSON exactly as returned:

```bash
npm run page-change -- compare \
  --before /path/to/first-delivery.json \
  --after /path/to/second-delivery.json \
  --fields title,description,headings \
  --clock 2026-09-08T12:00:00.000Z \
  --max-stale-ms 86400000
```

A later observation is a separately authorized second purchase of the same
URL list and fields. Inspect and edit the authorization file yourself first.
This recipe will not run `purchase`, send a payment header, or retry an
unknown outcome.

HTTP 200, settlement headers, and `charged: true` do not prove useful
selected-field output.

## Offline buyer-record recipe (no key, no fetch)

If you already have delivered `GET /extract` or `POST /extract/batch` JSON,
project buyer-named fields with explicit JSON Pointers and a local JSON Schema.
The recipe does not fetch URLs, schedule a second attempt, sign, retry, guess
entities, or contact the merchant.

Extraction is not identity or legal verification. Source JSON-LD remains a
source statement. Multiple Product or `sameAs` candidates stay unsupported.

Use the full public repository checkout, not a standalone npm tarball. Install
this customer package with `npm ci`; root merchant helpers remain source inputs.
Mapping targets are flat field names, with one explicit pointer per field.

Pinned schema adapter: `ajv@8.20.0`. See `src/record/NOTICE.md`.

### Fixture quickstart

From `examples/customer-x402` after `npm ci`:

```bash
npm run record -- \
  --input ./fixtures/record/product-jsonld/delivery/extract-batch.json \
  --mapping ./fixtures/record/product-jsonld/mapping.json \
  --schema ./fixtures/record/product-jsonld/schema.json \
  --out /tmp/samedaydesk-record-product

npm run record -- \
  --input ./fixtures/record/org-contact/delivery/extract.json \
  --mapping ./fixtures/record/org-contact/mapping.json \
  --schema ./fixtures/record/org-contact/schema.json \
  --out /tmp/samedaydesk-record-org
```

The product JSON-LD fixture emits one complete Product record and one partial
record missing `sku`. The organization-contact fixture is partial because email
is absent, not null. Failed source rows stay in accounting and are not turned
into valid empty records. This is owner proof, not buyer demand.

### Already delivered customer JSON

```bash
npm run record -- \
  --input /path/to/extract-or-batch.json \
  --mapping /path/to/mapping.json \
  --schema /path/to/schema.json \
  --out /tmp/samedaydesk-record
```

Exit 0 is all requested mapped fields present and schema-valid. Exit 1 is a
useful partial. Exit 2 is usage, unsupported mapping/schema, or zero usable
records. `--out` must be a fresh or empty directory.

This recipe will not run `purchase`, send a payment header, or retry an
unknown outcome.

## Machine-readable sample

See [`results/example-result.json`](results/example-result.json) for a fixture
purchase result with truthful unverified settlement, and
[`results/attempt-receipt.sample.json`](results/attempt-receipt.sample.json) for
the safer unsigned attempt-receipt shape (no secrets).
