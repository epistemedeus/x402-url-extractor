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

## Lockfile pin-delta (same client; not the default command)

`POST https://agents.samedaydesk.com/lockfile-pin-delta` is the live x402-only
compare of two caller-supplied npm `package-lock.json` objects at **5000 atomic
USDC**. It is paid convenience, not a second payment stack. Default commands
still do **not** pay this route. There is no auto-approve and no precomputed
`PAYMENT_SIGNATURE` prerequisite: inspect unpaid, then `--approve` with the
caller's **already configured** wallet (environment variable name only).

Distinguish:

- **Offline local compare:** `vendor/lockfile-pin-delta` in this checkout
  (`node vendor/lockfile-pin-delta/bin/lockfile-delta.mjs --before <lock>
  --after <lock>`). No wallet.
- **Kit 1.1.0:** a candidate / not publicly deployed. This README does not
  advertise a live public kit URL.
- **Analysis scope:** added / removed / changed name+version+integrity+resolved
  pins. Identical pins are informational, not failure. Not an install, audit,
  or npm registry fetch.
- **No vulnerability guarantee:** a pin-delta is not a CVE proof. This client
  does not join advisories.
- **Paid HTTP:** one bounded compare after an inspected 402 and explicit
  `--approve`.

`examples/lockfile-pin-delta-buyer/cli.mjs` only forwards an already-made
payment header if the caller supplies one. Ordinary agents should use this
customer-x402 client instead of inventing signatures.

Credential-free inspect (never touches a wallet):

```bash
npm run preflight -- --authorization ./fixtures/authorization-lockfile.json
```

Explicit approved purchase (existing wallet / expenditure authority only):

```bash
npm run purchase -- --approve \
  --authorization ./fixtures/authorization-lockfile.json \
  --private-key-env CUSTOMER_X402_PRIVATE_KEY \
  --attempt-receipt ./attempt-receipt.json
```

Unknown transport after a signed send is **not** permission to pay again.
Reconcile the attempt receipt; do not mint a new authorization.

```bash
npm run reconcile -- --reconcile \
  --attempt-receipt ./attempt-receipt.json \
  --rpc-url https://YOUR_EXPLICIT_RPC
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

### Optional HTTP companion (disabled by default)

The same `comparePageBatches` job can be called over unpaid
`POST /recipes/page-change` when the merchant is started with
`PAGE_CHANGE_HTTP_ENABLED=1`. Supply already delivered JSON artifacts in the
request body. The companion does not fetch, pay, raise caller limits, or add a
paid SKU, schedule observations, or retain request artifacts. It does not log
raw inputs. For example, with two batch responses saved locally:

```bash
jq -n --slurpfile before before.json --slurpfile after after.json \
  '{before:$before[0],after:$after[0],fields:["title","description"]}' \
  | curl --fail-with-body -H 'Content-Type: application/json' \
      --data-binary @- http://127.0.0.1:3000/recipes/page-change
```

No key, wallet, or payment header is needed. `clock`, `observedAt`, and
`maxStaleMs` are caller-supplied metadata, not verified observations. This route
always reports unknown freshness and makes no current/fresh claim;
`allowFreshClaim: true` is rejected. Use the returned coverage and ambiguity
fields as well as the verdict. A successful comparison does not prove useful
paid delivery or authoritative observation time.

Defaults are a 270,336-byte request, 131,072 bytes per artifact, JSON depth 16,
4,096 JSON nodes, 32 sources, 11 fields, 512 sequence entries, 64 changes,
200-byte excerpts, 32 action items, and a 262,144-byte worker/result ceiling.
The request body and comparison share one 5-second deadline; timeout or
disconnect cancels the owned worker (TERM, then KILL after at most 500 ms).
At most two admitted requests run per process, including body upload time.
Busy requests get 503; each IP is limited to 12 POST attempts per minute and
rate bookkeeping is capped at 1,024 IPs. Operator `PAGE_CHANGE_HTTP_MAX_*`
settings and `PAGE_CHANGE_HTTP_TIMEOUT_MS` can only tighten these ceilings.
Static error and discovery documents are independently small, not comparison
results. `GET /recipes/page-change/openapi.json` describes the route.

`GET /recipes/page-change/health` reports a 40-character commit only when the
host supplies one (`RAILWAY_GIT_COMMIT_SHA` on Railway git deploys, or
`SOURCE_COMMIT`). `PAGE_CHANGE_SOURCE_COMMIT` is a local/test pin used only when
those host values are absent. Disagreeing pins are not emitted. This is the
host-injected revision, not an independently verified attestation. When a commit
is available, health also sets `x-source-commit`. Optional
`PAGE_CHANGE_XAGENT_SLUG` enables `/.well-known/xagent-verification.json` only
when the slug is valid and the commit matches health; mismatched
`PAGE_CHANGE_XAGENT_COMMIT` is refused. The offline
`scripts/page-change-xagent-sidecar.mjs` uses the clean official validator pin
`422f0aeb5520a3506b08b05cfefcb76c6cb786c0`. It does not sign rights, open a
contest PR, or claim live proof. Product readiness is not submission readiness.

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


### Exact source package and deployment binding

Build only committed source, from the complete merchant checkout. The destination's
parent must exist, its final directory must be fresh, and its basename must equal
the slug. Substitute the exact reviewed or composed commit for `<commit>`:

```sh
node scripts/page-change-xagent-package.mjs --commit <commit> --out /tmp/samedaydesk-page-change
XAGT_PLUGIN_ROOT=/path/to/clean/xagt-plugin node scripts/page-change-xagent-sidecar.mjs /tmp/samedaydesk-page-change
```

The official checkout must be clean at `422f0aeb5520a3506b08b05cfefcb76c6cb786c0`.
The sidecar verifies the validator file bytes as well as its Git revision and
runs offline only. A pass establishes baseline package structure, not rights,
completeness, public Git availability, live deployment or acceptance. RIGHTS.md
remains an unsigned template. Mutable worktree mode and a different review-commit
label are rejected. SOURCE_MANIFEST.json records exact source hashes and omissions.

The packet contains the offline page-change source and fixtures, including
`vendor/change-digest`; run `node --test page-change-http.test.mjs` inside `source`.
It deliberately excludes a public PEM key and a test containing a synthetic
secret pattern under the official filters. Thus it is not a complete bootable
merchant checkout and its full root test script is not the packet gate.
`extract-batch-page-change.test.mjs` additionally needs installed dependencies
(including zod); it is not a standard-library-only test. Deploy from the complete
owning Git checkout, with its existing lockfile and public-key asset, rather than
from the filtered packet. No generated packet is included in this feature branch.

For a later operator deployment, preserve existing merchant configuration and
prices. Set `PAGE_CHANGE_HTTP_ENABLED=1` and
`PAGE_CHANGE_XAGENT_SLUG=samedaydesk-page-change`. Railway Git deployment should
inject `RAILWAY_GIT_COMMIT_SHA`; other pipelines may inject `SOURCE_COMMIT` from
the actual deployed Git revision. Those are host/deployer assertions, not signed
attestations. Leave `PAGE_CHANGE_SOURCE_COMMIT` and `PAGE_CHANGE_XAGENT_COMMIT`
unset unless needed for local tests; every supplied pin must agree. If root
composes a new commit, rebuild the packet for that new exact commit before
comparing metadata. Never paste an older review pin to make a check pass.

After the operator's deployment, read `/recipes/page-change/health` and
`/.well-known/xagent-verification.json` on the intended origin. Both must report
the exact deployed commit, health must have status `ok`, proof must have exactly
`schemaVersion: 1`, the chosen slug and that commit, and both `x-source-commit`
headers must match their bodies. A missing, invalid or conflicting pin is a
failed binding, not authorization to overwrite it. These are verification
instructions only; this source review performs no deployment or online sidecar.
