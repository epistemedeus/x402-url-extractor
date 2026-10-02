# Seller repair service 100266

One retained repair case for a caller task whose useful output is not proved
by an OpenAPI `required` array or by HTTP 200. The case reuses the pinned
`agent-payment-integrity` scanner, `GET /commerce/seller-integrity-audit` at
the existing `$0.01` / `10000` atomic price, and the useful-result-reuse
revocation helpers. This package does not purchase, sign, or add a price.

## Gap

Intake today is a seller-integrity query or a discovery-drift diagnosis. The
paid report can return an advisory OpenAPI repair plan. That plan does not
read the target's useful body, apply a patch, retest it, or remain valid for
a later task or SDK. `compatibility-maintenance-100175` refuses to transfer a
client-refusal receipt. It does not repair a response body. Customer grants
retain transaction receipts, not this repair.

The missing delta is the bound case: task, exact origin/method/resource,
expected output, declared SDK/runtime, maximum effort, free probes, a patch
fixture, an independent retest, and a later consumer that refuses a stale
task or SDK.

## What the 0.01 audit adds

Beyond the free probe it can check the unpaid challenge, OpenAPI response
contract, advisory repair actions, optional Bazaar metadata, and x402/MPP
economics. `repairPlan.boundary.sellerRuntimeVerified` stays false. It does
not read a paid body and does not prove handler execution. A missing field,
a semantic question, or a paid body that was not fetched returns `unknown`
or `unsupported`. `paidAuditRequired` stays false.

## Retained case

`cases/retained-case.json` asks whether `GET /catalog/item` on
`https://seller.example` returns `result.sku` equal to `WIDGET-1`. The
fixture declaration requires `result.sku`. The unpaid body omits it. The
patch copies the catalog constant onto `result.sku`. Deleting the required
path, or leaving the field out, fails the retest.

## Commands

From the merchant repository root, on Node 22:

```bash
node experiments/seller-repair-service-100266/bin/seller-repair.mjs reproduce \
  --case experiments/seller-repair-service-100266/cases/retained-case.json
node experiments/seller-repair-service-100266/bin/seller-repair.mjs compare \
  --case experiments/seller-repair-service-100266/cases/retained-case.json
node experiments/seller-repair-service-100266/bin/seller-repair.mjs reject-seeded \
  experiments/seller-repair-service-100266/fixtures/seeded-false-useful.json
node experiments/seller-repair-service-100266/bin/cold-later.mjs \
  experiments/seller-repair-service-100266/cases/retained-case.json
node --test --test-concurrency=1 \
  experiments/seller-repair-service-100266/test/journey.test.mjs \
  experiments/seller-repair-service-100266/test/merchant-handoff.test.mjs
```

`reproduce` exits 0 when the independent retest matches. `reject-seeded`
exits 2 when the seeded claim is refused. Exit 0 is not a customer payment.
Cash and tokens stay `unknown`. Recognized revenue atomic stays `0`.

A cold later process exits 2 when `COMMERCE_DATA_DIR`,
`COMMERCE_INTERNAL_TOKEN`, `USEFUL_RESULT_GRANT`, or `SELLER_REPAIR_PRIVATE`
is set. Pass `--sdk python-httpx@1` or a different `--task` to refuse stale
applicability. The contribution path does not return a receipt share and
does not transfer a spending grant.
