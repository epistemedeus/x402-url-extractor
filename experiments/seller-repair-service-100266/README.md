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

## Caller-owned request

`cases/retained-case.json` stays the deterministic loopback example. A
visiting agent uses the same case schema with its own `callerId`, `operation`,
`expectedUsefulOutput`, `declaredSdk`, and `probeConsent`. `operationId` must
equal `METHOD resource`. A nearby path is not inferred. `probeConsent.class`
is `loopback`, `public-read-only`, or `public-https`, and `confirmed` must be true. `public-https` uses the same public-address boundary as payment-target checks. A private or reserved answer, a DNS change, a redirect, or a budget overrun stops the probe. The key is
not `authorization`, which the privacy authority treats as private evidence.

`maxEffort` carries `probes`, `bodyBytes`, `deadlineMs`, `totalBodyBytes`,
`totalResponseMs`, and `redirects` across the direct probe and the retest.
`deadlineMs` is an absolute whole-response deadline. `redirects` is 0. Only
GET is probed. HTTP 200, a declaration, unknown coverage, and a missing field
do not prove useful execution or a paid need.

```bash
node experiments/seller-repair-service-100266/bin/seller-repair.mjs receive \
  --case experiments/seller-repair-service-100266/cases/retained-case.json \
  --base http://127.0.0.1:PORT --retest-base http://127.0.0.1:PORT
node experiments/seller-repair-service-100266/bin/seller-repair.mjs readonly \
  --case experiments/seller-repair-service-100266/cases/public-readonly.json
node experiments/seller-repair-service-100266/bin/cold-later.mjs \
  experiments/seller-repair-service-100266/cases/retained-case.json \
  --resource /catalog/items
```

`receive` compares the authorized service with a caller-reviewed retest of a
second service the caller already runs. The package does not write the patch
into either process. A passing loopback retest is `loopback_fix` with
`deployedCounterpartyRepair` false. The public index command observes
`productionHosted === false` and is not a repair. A later caller on the same
task, SDK, and target must retest. `usefulTransferred` stays false.

The local incomplete seller-integrity report (`openapi_unavailable`,
`auditCompleted` false, body not read) stays a useful negative.
`purchaseRecommended` stays false. The price remains `$0.01` / atomic `10000`.

## Supplied public target

`cases/supplied-quota.json` and `cases/supplied-health.json` are caller
machine requests, not the catalog fixture. Quota asks whether `GET /v1/quota`
returns `quota.remaining` equal to the string `3`. Health asks whether
`GET /v1/health` returns `status` equal to `ready`. `diagnose` reads supplied
evidence without a charge. A live retest is a caller-reviewed comparison of
two processes the caller already runs. `deployedCounterpartyRepair` stays
false.

`POST /commerce/seller-repair-diagnosis` is the free intake. It is not mounted
in `server.js` on this branch. Root applies
`route/ROOT-SERVER-MOUNT.patch` before the paid middleware. The route does
not add a SKU and does not change the `$0.01` seller-integrity audit. A
completed audit is connected only when the caller asked for declaration
contract work and the report matches the same target. It still does not read
the useful body and it does not recommend a purchase.

## Portable consumer

`consumer/` is the unlaunched 0.2.0 skill. Pack it with:

```bash
node experiments/seller-repair-service-100266/bin/pack-consumer.mjs
```

The new archive is `candidate/seller-repair-external-consumer-0.2.0.tar.gz`.
`candidate/seller-repair-external-consumer-0.1.0.tar.gz` stays
`3f3552e9cdedff9910211b1820b229daa834cf3811fcc5b38035046cefda4a27` (22870 bytes).
Runtime dependencies are Node.js `>=22.22.0` and `node:crypto`,
`node:dns/promises`, `node:fs`, `node:fs/promises`, `node:http`, `node:https`,
and `node:net`. No npm packages are required. Privacy sources are vendored.
The scanner, handoff, and contribution modules stay in this repository.
`candidate/cold-command.json` is the command Root runs after hosting the
bytes. The 0.2.0 archive, provenance, source notice, and license are draft
assets under `public-acquisition/`. `hostedAcquisitionVerified` stays false.
