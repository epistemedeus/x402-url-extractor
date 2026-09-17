# SameDayDesk Anthropic unpaid-list example

Credential-free unpaid discovery list for Claude Code / Anthropic extract
surfaces on the live SameDayDesk merchant.

This example lists:

- the local Claude Code marketplace catalog (`samedaydesk-extract@samedaydesk-claude`)
- unpaid MCP `initialize` and `tools/list` (never `tools/call`)
- HTTP discovery: `/openapi.json`, `/.well-known/x402`, `/api/actions`
- unpaid HTTP 402 probes for `GET /extract` and `POST /extract/batch`

It does **not** pay, sign, send payment headers, check out, publish, or touch
neo. Listing and install grant no payment authority. This is not an Anthropic official directory listing.

## Install

```bash
git clone https://github.com/epistemedeus/x402-url-extractor.git
cd x402-url-extractor/examples/anthropic-unpaid-list
```

Requires Node.js 22 or newer. There are no npm dependencies. From an existing
repository checkout, start with `cd examples/anthropic-unpaid-list`.

## Cold run (default)

Default commands never read wallet credentials, sign, send payment headers, or
pay. They list unpaid Anthropic/Claude extract discovery against the canonical
HTTPS merchant.

```bash
npm start
npm run list
node bin/cli.mjs
```

A 402 is the live offer, not a sale. Compact `accepts` fields are observations,
not authorization to spend.

## Recorded fixtures (no network)

```bash
npm run list:fixture
node bin/cli.mjs --fixture ./fixtures/recorded
```

## Seeded failures (must refuse)

```bash
node bin/cli.mjs --approve
node bin/cli.mjs --checkout
node bin/cli.mjs --publish
node bin/cli.mjs --neo
node bin/cli.mjs --origin http://127.0.0.1
node bin/cli.mjs --origin mcp://agents.samedaydesk.com/mcp
```

Private origins, payment flags, checkout, publish, neo, `mcp://`, and payment
headers are refused before any wallet lookup. There is no wallet.

## Tests

```bash
npm test
```

## Not in this example

- Payment, checkout, publish, or neo
- `@x402/fetch`, wallets, private keys, or payment headers
- MCP `tools/call`
- Anthropic official plugin directory submission
- A second merchant or a second price
