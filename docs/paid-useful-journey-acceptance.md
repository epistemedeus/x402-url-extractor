# Paid useful journey acceptance

Root assignment `PAID-USEFUL-JOURNEY-100141`. One machine path: free discovery-drift to the existing `GET /commerce/seller-integrity-audit`. The paid response must do additional work (response contract, repair plan, or findings for that exact origin, route, and method). Prices, recipient, SKUs, and human pages stay as they are. An offer is not revenue. An explicit `authorizePurchase` decision is required, and this client sends a payment only in test mode.

## Commands

```sh
npm run test:paid-useful-journey
node --test paid-useful-journey.test.mjs
node examples/paid-useful-journey/cli.mjs diagnose \
  --catalog examples/paid-useful-journey/fixtures/catalog.json \
  --live examples/paid-useful-journey/fixtures/live.json \
  --stale-ms 86400000
npm run test:paid-useful-journey:live
node examples/paid-useful-journey/cli.mjs live-unpaid
```

`paid-useful-journey.live.test.mjs` is not part of `npm test` or `npm run test:nonlive`. Live checks are unpaid. Payment legs use the in-process test facilitator.

## Root live acceptance checklist

- Free diagnosis of the fixture mismatch is eligible, names `GET /commerce/seller-integrity-audit` for `https://example.com` `/extract` `GET`, and does not fetch or pay. `match`, `stale`, and `reordered-multiple-offer` stay ineligible. Freshness-unknown alone stays ineligible.
- Production and the local merchant, unpaid, return `402` for the seller-integrity operation with amount `10000`, the existing payTo, a `service-desc` link, and a `purchase-evidence` link. `/.well-known/agent-payment-evidence.json` lists the operation. `/healthz` stays `200`. Unpaid `GET /extract` stays `402`. Facilitator verify and settle stay at zero on those unpaid calls.
- Explicit decline is an unpaid `402`. Missing authorization, the wrong terms digest, an expired authorization window, a redirect, and a challenge whose route or query target changed send no `payment-signature`.
- Live mode (`--test-mode` absent) returns `live_payment_refused` before any payment fetch.
- Test-mode purchase against the fake facilitator settles once. A second call after a settled reference, an in-flight session, or a paid success with no settlement reference does not send another payment.
- A paid `200` that only echoes the drift report, or that lacks findings, a response contract, and a repair plan, is useful `false`. A seller-integrity body for the requested target with one of those fields is useful `true`. Merchant `5xx` after payment is `delivery_failed` and is not replayed.
- A claimed settlement hash that is not on an attempt event joins as `false_claim`. `revenueRecognized` is false for offers, attempts, and matching settlement references.
- Joined stages use `unknown` where evidence is absent. Actor labels come only from the explicit header. A wallet or `originClass` does not select `owner_test`, `recruited`, or `independent`.
- Commerce events remain the only store. The optional `paidUsefulJourney` object does not make an event non-canonical and does not appear in the public snapshot. Raw header text, response bodies, query values, and payer addresses are not stored on the journey object.

Passing this checklist shows a working conversion instrument and an experiment-ready join. It does not show that an independent buyer will pay.
