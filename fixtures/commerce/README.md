# x402 commerce fixtures (unpaid materialize / wrapper)

Unpublished local fixtures for the commerce plane of SameDayDesk x402. They
drive existing unpaid materialization, wrapper `charged:false`, and receipt
verification primitives. They are not a hosted route, MCP tool, listing, or
paid service.

Reuse, do not reimplement:

| Plane | Existing primitive |
|---|---|
| Provider eligibility vs catalog reach | `auditCoinbaseMaterialization` in `agent-discoverability-audit.mjs` |
| Exact-route listing identity | `evaluateListingIdentity` (`agent-payment-policy`) |
| Catalog vs live unpaid amount | `compareDiscoveryLive` in `discovery-drift.mjs` |
| Unpaid wrapper evidence | `charged:false` |
| EIP-712 offer receipt | `@x402/extensions/offer-receipt` `verifyReceiptSignatureEIP712` |
| Unsigned attempt receipt | `validateAttemptReceipt` in `examples/customer-x402` |

This directory never refreshes Bazaar as owner, never polls CDP, never pays,
and never mutates publish, registry, payment, or checkout state. `--live`,
`--refresh`, `--cdp`, and `--poll` are refused.

## Operator commands

Copy-paste, unpaid, fixture-only:

```bash
node fixtures/commerce/check.mjs fixtures/commerce/unpaid-materialize/seeded-absence.json
node fixtures/commerce/check.mjs fixtures/commerce/unpaid-materialize/sds-extract-canonical.json
node fixtures/commerce/check.mjs fixtures/commerce/receipts/forged-offer-receipt.json
```

Exit **1** when composed states show a catalog-reach gap, amount mismatch,
wrapper `charged:true`, two paywalls, or a forged receipt. Exit **0** when SDS
`GET /extract` listing identity is canonical, the wrapper stays uncharged, and
no mismatch is observed. Exit **2** for refused flags or invalid usage.

## Seeded cases

1. **Validator-accepted unpaid 402 plus empty exact-resource search**
   (`unpaid-materialize/seeded-absence.json`): `provider_accepted_not_materialized`
   and `route_absent`. Absence is not demand.
2. **Atomic 5000 vs 10000** (`unpaid-materialize/amount-mismatch.json`):
   discovery-drift `mismatch`. Amounts are compared as strings.
3. **SameDayDesk `/extract` listing identity**
   (`unpaid-materialize/sds-extract-canonical.json`): `canonical` at
   `https://agents.samedaydesk.com/extract`. Canonical origin match is not
   hostname-ownership proof.
4. **Wrapper `charged:true`** (`unpaid-materialize/wrapper-charged-true.json`):
   unpaid evidence must stay `charged:false`.
5. **Two-paywall wrap** (`wrapper/two-paywall-wrap.json`): platform plus seller
   charges. Not one SDS paywall.
6. **Forged offer receipt** (`receipts/forged-offer-receipt.json`):
   `payload.payer` mutated after a merchant signature. Format stays `eip712`.
   Recovered signer is not the merchant (`foreign_receipt_signer`).

## Tests

```bash
node --test fixtures/commerce/test.mjs
```

Not added to `package.json` test scripts.
