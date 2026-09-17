# Unpaid MCP `prompts/list`

Protocol-level prompt discovery for the SameDayDesk x402 URL extractor.
`prompts/list` and `prompts/get` of the public skill templates do not require
payment. `tools/call` stays x402-gated.

Authority: `CONTRACT.md`.

## Run

From the repository root after `npm ci`:

```bash
node mcp/prompts-list-unpaid/bin/prompts-list-unpaid.mjs
node mcp/prompts-list-unpaid/bin/prompts-list-unpaid.mjs cold-run
node mcp/prompts-list-unpaid/bin/prompts-list-unpaid.mjs seeded-failure
node --test --test-concurrency=1 mcp/prompts-list-unpaid/test/*.test.mjs
```

JSON report on stdout. Human one-liner on stderr. Exit 0 pass, 2 conformance
fail, 1 setup fail.

The cold run mounts this repo's `mountMcp` on loopback. It does not call the
live facilitator, does not pay, and does not change prices.

## Catalog

Unpaid prompts are the three public well-known skills already served at
`/.well-known/skills/*/SKILL.md`:

| name | title |
|---|---|
| `web-extract` | Web Extract |
| `page-change` | Page Change |
| `explicit-record` | Explicit Record |

Paid tool names (`extract`, `extract_batch`, …) are not prompts.
`prompts/get extract` is rejected. `prompts/get __seeded_unknown_prompt__`
is the seeded failure.

## Non-claims

- Overlay pack plus a `mountMcp` registration. **No npm publication.**
- Passing the harness is not a live production deploy.
- Unpaid prompt templates are not authorization to spend and do not execute
  extract.
