# SameDayDesk LangChain unpaid x402 list

Bounded, credential-free example that lists advertised x402 HTTP resources
from a seller `/.well-known/x402` catalog for a LangChain tool. Default
commands never pay.

This is not a wallet, not `@x402/fetch`, not checkout, and not a replacement
for [`examples/customer-x402`](../customer-x402). Listed amounts are catalog
advertisements, not live 402 challenges and not authorization to spend.

## Install

```bash
git clone https://github.com/epistemedeus/x402-url-extractor.git
cd x402-url-extractor/examples/langchain-unpaid-list
npm ci
```

Requires Node.js 22 or newer. From an existing repository checkout, start with
`cd examples/langchain-unpaid-list` instead of cloning again.

## Cold run (default; local fixture; no network)

```bash
npm start
npm run list
node bin/cli.mjs
node bin/cli.mjs --catalog ./fixtures/well-known-x402.json
node bin/cli.mjs --catalog ./fixtures/well-known-x402.json --query extract
node bin/cli.mjs --catalog ./fixtures/well-known-x402.json --route /extract
```

## Seeded failure (must exit non-zero)

```bash
node bin/cli.mjs --catalog ./fixtures/hostile/malformed.json
node bin/cli.mjs --catalog ./fixtures/hostile/private-url.json
node bin/cli.mjs --approve
```

Hostile fixtures cover malformed JSON, missing `items`, loopback and `mcp://`
resources, URL credentials, plain HTTP, x402 v1, a paid extract body, and a
402 challenge document presented as a catalog.

## Optional live well-known fetch

Still unpaid. GET only. HTTP 200 is required. HTTP 402 on the catalog is
rejected (`discovery_paywalled`). Paid routes such as `GET /extract` are not
fetched.

```bash
node bin/cli.mjs --origin https://agents.samedaydesk.com
node bin/cli.mjs --url https://agents.samedaydesk.com/.well-known/x402
```

## LangChain tool

The default CLI does not call a model. Wrap the local tool:

```js
import { unpaidListTool } from "./src/tool.mjs";

const json = await unpaidListTool.invoke({ query: "extract" });
// name: list_unpaid_x402_resources
```

Function-calling spec (no model call):

```bash
node bin/cli.mjs --tool-spec
```

A LangChain JS agent can bind `unpaidListTool.name`, `unpaidListTool.description`,
`unpaidListTool.schema`, and `unpaidListTool.func`. Payment stays in
`examples/customer-x402` after an inspected 402. This example will not sign.

## Not in this example

- Production settle or money movement
- Wallet load, `--approve`, or payment headers
- Fetching paid extract/read/batch bodies, even unpaid 402 challenges
- Publishing a LangChain Hub package
- Neo, marketplace checkout, or a second payment stack
