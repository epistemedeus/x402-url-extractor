# Lockfile pin-delta buyer example

External CLI against a provided merchant base URL. It reads local
`package-lock.json` objects and posts them as HTTP JSON. It does not send
filesystem paths, shell commands, or registry URLs to the merchant.

Live paid route: `POST https://agents.samedaydesk.com/lockfile-pin-delta`,
x402-only, **5000 atomic USDC**. Default for this CLI is unpaid inspect
(HTTP 402). It does **not** sign and does **not** require a precomputed
`PAYMENT_SIGNATURE`. Ordinary already-authorized wallets use
`examples/customer-x402` with explicit `--approve`.

## Discover (free)

```bash
node examples/lockfile-pin-delta-buyer/cli.mjs \
  --base-url https://agents.samedaydesk.com \
  discover
```

Reads `/openapi.json`, `/.well-known/x402`, `/api/actions`, and one unpaid
`POST /lockfile-pin-delta`. A 402 is the live offer. Missing path means the
host has not set `LOCKFILE_PIN_DELTA_ENABLED=1`. This is not a sale.

## Compare (posts JSON objects; unpaid by default)

```bash
node examples/lockfile-pin-delta-buyer/cli.mjs \
  --base-url https://agents.samedaydesk.com \
  compare \
  --before ./before-package-lock.json \
  --after ./after-package-lock.json
```

Without a caller-supplied payment header this prints the unpaid challenge.
Do not paste production credentials into tests. Do not invent raw signatures.

## Ordinary already-authorized wallet (preferred)

Use the existing `examples/customer-x402` client for inspect → `--approve` →
attempt-receipt → read-only reconcile, with the caller's **already configured**
wallet (environment variable name only; never commit keys):

```bash
cd examples/customer-x402
npm ci
npm run preflight -- --authorization ./fixtures/authorization-lockfile.json
npm run purchase -- --approve \
  --authorization ./fixtures/authorization-lockfile.json \
  --private-key-env CUSTOMER_X402_PRIVATE_KEY \
  --attempt-receipt ./attempt-receipt.json
npm run reconcile -- --reconcile \
  --attempt-receipt ./attempt-receipt.json \
  --rpc-url https://YOUR_EXPLICIT_RPC
```

That path binds exact HTTPS URL, method, `{before, after}` body bytes, network,
asset, recipient, and amount cap before any signer access. Payment is not the
default. There is no auto-approve.

### Offline local compare vs paid HTTP

- **Offline local compare:** `vendor/lockfile-pin-delta` in this checkout.
  Same pin-delta analysis, no wallet, no x402.
- **Kit 1.1.0:** a candidate / not publicly deployed. This README does not
  advertise a live public kit URL.
- **Analysis scope:** name+version+integrity+resolved pins only. Identical pins
  are informational.
- **No vulnerability guarantee:** pin-delta is not a CVE proof and does not join
  advisories.
- **Paid convenience:** live `POST /lockfile-pin-delta` at 5000 atomic USDC,
  x402-only. Charge is the bounded compare, not an install or audit.

Hermes can load AgentSkills; it has **no** native SameDayDesk payer. Do not
copy a wallet into a skill. Signing stays in customer-x402.

## Not in this example

- Production settle or money movement
- Silent wallet creation or keys in prompts
- Caller file paths in the HTTP body
- npm install / audit
- Flipping the engine `sold` flag
- A second payment after an unknown outcome
