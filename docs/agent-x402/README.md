# x402 agent docs: MCP unpaid discovery

Cold-follow pack for discovering the live SameDayDesk MCP tools **without
paying, publishing, registering, or mutating checkout**. This directory is
the only write surface for that job.

Authoritative merchant: `epistemedeus/x402-url-extractor` default branch.
Live remote: `https://agents.samedaydesk.com/mcp` (Streamable HTTP).

This pack is not a wallet, installer, marketplace listing, MCP Registry
publish, or payment client. Advertised `_meta.x402` amounts are catalog
metadata, not authority to spend.

## Cold start (do these in order)

1. Read [BOUNDARY.md](BOUNDARY.md). If the next action would publish,
   register, pay, or mutate checkout, **stop**.
2. Follow [DISCOVERY.md](DISCOVERY.md) against the live remote. Stop after
   `initialize` plus `tools/list`.
3. Run the verifier below. Quote its stdout. Do not treat a green unit
   test elsewhere in the repository as this pack's acceptance.
4. Run at least one seeded failure from [FAILURES.md](FAILURES.md) and
   confirm the verifier rejects it.

Do not skip to `tools/call`, HTTP 402 purchase, `@x402/fetch`, npm
publish, or `POST /v0.1/publish`.

## Verifier (canonical cold follow)

From the repository root, Node.js 20+:

```bash
node docs/agent-x402/verify.mjs
```

That command does two things and then exits:

- Live unpaid discovery against `https://agents.samedaydesk.com/mcp`
- Rejection of every seeded fixture in `docs/agent-x402/fixtures/`

Useful slices:

```bash
node docs/agent-x402/verify.mjs discover
node docs/agent-x402/verify.mjs reject-seeded
node docs/agent-x402/verify.mjs reject-seeded --fixture docs/agent-x402/fixtures/missing-extract.json
node --test docs/agent-x402/verify.test.mjs
```

Kill commands (`publish`, `registry`, `pay`, `payment`, `checkout`,
`tools/call`, `call`) exit 2 without contacting a registry or wallet.

## Required inventory (not a global count)

Unpaid `tools/list` must include **exactly one** `extract` and **exactly
one** `extract_batch`, each with matching input and output schemas.
Extra unrelated tools are accepted. Do not fail solely because the live
catalog grew. Do not invent tools that were not returned.

`extract` input requires `url`. `extract_batch` input requires `urls`
(1–5 public HTTPS URLs). Output schemas must keep the required paths
listed in [DISCOVERY.md](DISCOVERY.md).

## What success is

A JSON report with `ok: true`, `extractPresent: true`,
`extractBatchPresent: true`, `paymentAttempted: false`,
`registryPublishAttempted: false`, and `toolsCallAttempted: false`.
That is discovery, not a purchase and not a listing.

## Layout

```text
docs/agent-x402/
├── README.md
├── BOUNDARY.md
├── DISCOVERY.md
├── FAILURES.md
├── verify.mjs
├── verify.test.mjs
└── fixtures/
```
