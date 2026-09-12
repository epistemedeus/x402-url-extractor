# hg03 run receipt (2026-09-12)

- Base: `0153295c5851bf8f93fb27c77070a31417a59f69`
- Official SDK: `mcp==2.2.0` from https://pypi.org/pypi/mcp/2.2.0/json
- Tests: `26 passed` (`pytest -q --tb=short -p no:cacheprovider`)
- Live unpaid `tools/list`: 24 tools at `https://agents.samedaydesk.com/mcp`, server `x402-data-gateway` `1.23.49`
- Live compare: `receipts/production-compare-live.json` (`ok: true`, 0 findings)
- Local recipe: unpaid `payment_required` then local-fake `paid_shape`, facilitator verify=2 settle=2 spend=false
- Constructable lockfile path: `examples/customer-x402/package-lock.json` (`lockfileVersion` 3)
- No wallet, no production payment meta, no homepage/deploy/merge
