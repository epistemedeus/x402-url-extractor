# Paid useful journey client

Machine client for one existing conversion. A free discovery-drift comparison can offer the already deployed seller-integrity audit when the live unpaid terms disagree with the catalog on a specific seller dimension. The paid audit adds the response contract, repair plan, and machine-buyable decision. The free comparison does not.

This directory is not a catalog and does not add a route, price, or recipient. Quote, amount, asset, network, and payTo come from the live unpaid `402` challenge.

## Command

```sh
node examples/paid-useful-journey/cli.mjs diagnose \
  --catalog examples/paid-useful-journey/fixtures/catalog.json \
  --live examples/paid-useful-journey/fixtures/live.json \
  --stale-ms 86400000
```

`diagnose` does not fetch or pay. Exit `0` includes an ineligible result. The fixture catalog is 10000 atomic units and the fixture live observation is 20000, so the result is eligible and names `GET /commerce/seller-integrity-audit`.

```sh
node examples/paid-useful-journey/cli.mjs offer \
  --catalog examples/paid-useful-journey/fixtures/catalog.json \
  --live examples/paid-useful-journey/fixtures/live.json \
  --merchant https://agents.samedaydesk.com \
  --actor owner_test
```

`offer` and `decline` send no payment. `decline` is an explicit unpaid request.

```sh
node examples/paid-useful-journey/cli.mjs purchase \
  --catalog examples/paid-useful-journey/fixtures/catalog.json \
  --live examples/paid-useful-journey/fixtures/live.json \
  --merchant http://127.0.0.1:PORT \
  --actor owner_test \
  --authorize \
  --test-mode
```

Purchase requires `--authorize` and `--test-mode` together. `--authorize` binds the terms digest, target, and expiry just read from that merchant. The client reads the challenge again immediately before any test-mode payment and refuses when the digest, target, or expiry no longer match. Without `--test-mode` the command exits `2` with `live_payment_refused` and sends no `payment-signature`. A redirect is not followed.

```sh
node examples/paid-useful-journey/cli.mjs reuse \
  --catalog examples/paid-useful-journey/fixtures/catalog.json \
  --live examples/paid-useful-journey/fixtures/live.json \
  --merchant https://agents.samedaydesk.com \
  --actor independent \
  --useful true
```

Reuse is an unpaid request. It is recorded only after a caller passes `--useful true` because an earlier attempt already validated additional work. It is not an attempt and not revenue.

```sh
node examples/paid-useful-journey/cli.mjs join \
  --data-dir /path/to/commerce-data \
  --journey <32 hex>
```

Optional `--claim-settlement 0x…` is compared with settlement references already on attempt events. A claim that is not among those references is `false_claim`. `revenueRecognized` stays false.

```sh
node examples/paid-useful-journey/cli.mjs live-unpaid
```

Reads the production unpaid challenge and documentation links. It sends no payment header.

## Measurement

The header `x-samedaydesk-paid-journey` carries `v`, `journey`, `diagnosis`, `decision` (`offer`, `decline`, `attempt`, `reuse`), and an optional actor label: `owner_test`, `recruited`, `independent`, or `unknown`. A missing, invalid, or address-shaped label is stored as `unknown`. The header must not carry a wallet, price, or URL.

The merchant writes `paidUsefulJourney` on the existing commerce event for `GET /commerce/seller-integrity-audit` only. There is no second event file. An offer or a call is not revenue. Useful delivery is true only when the paid JSON is the seller-integrity product, names the same origin, route, and method, and includes a response contract, repair plan, or non-empty findings. A copy of the free drift report is not useful.

`joined-example.json` is the offer-only join of `fixtures/offer-only-events.json` for the fixture diagnosis at `2026-09-10T07:22:00.000Z` with `--stale-ms 86400000`. Attempt, settlement, useful delivery, decline, and later reuse are the string `unknown`. The payer field on the source event is ignored.

Binding: `binding.json`. Acceptance checklist: `docs/paid-useful-journey-acceptance.md`.

Classifying an unpaid door (payable, 402 without payment metadata, a blanket 402 on an invented path, or a method mismatch) is the free decision in `examples/unpaid-door-decision`. The 2026-10-01 public replay did not require this paid operation for that question. This client still offers the existing seller-integrity audit only after an unresolved discovery-drift comparison, and only with an explicit authorization. It does not send a live payment.
