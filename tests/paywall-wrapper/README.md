# Paywall wrapper fixtures (unpublished)

Synthetic fail-closed fixtures for a platform-priced wrap of SameDayDesk
`GET /extract` and for rewriting that GET as POST. Not a live listing, not an
OpenServ account, and not Agent402 source.

OpenServ [issue 6](https://github.com/openserv-labs/client/issues/6) is a
fixture contract, not an integration. The observable hosted-trigger shape at
`openserv-labs/client@fb3f1d11911900aabb63ee5230a6a9466df99a03` exposes a
priced POST (`x402Pricing`, `x402WalletAddress`, input schema) and no
canonical seller resource, method, or output contract.

## Check

```bash
node tests/paywall-wrapper/check.mjs tests/paywall-wrapper/fixtures/openserv-priced-post-wrap-sds-extract.json
# exit 1, codes include two_paywall or settlement_owner_hidden

node tests/paywall-wrapper/check.mjs tests/paywall-wrapper/fixtures/get-extract-rewritten-as-post.json
# exit 1, codes include unsupported_target or authorization_refused

node tests/paywall-wrapper/check.mjs tests/paywall-wrapper/fixtures/sds-mcp-extract-one-paywall.json
# exit 0, one_paywall
```

These paths are unpublished: they are not in `package.json` scripts and must
not be listed on a marketplace.
