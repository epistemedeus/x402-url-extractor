# RESULT: SDK-to-merchant payment-identifier interop

## Root cause

`examples/customer-x402/src/purchase.mjs` registered only `ExactEvmScheme`. Official `@x402/core` 2.16.0 merges seller `payment-identifier` declarations into the payment payload **without** generating an `id`. Batch `requiredReplayPaths` then rejected `!binding.hasPaymentIdentifier` as the misleading `bounded_payment_validity_required` (HTTP 400, `charged:false`, no settlement). Seller free discovery already declares `payment-identifier` with `required:true` on `POST /extract/batch` and `required:false` on stock GET. MPP uses a credential-bound digest and clears the identifier guard via non-x402 protocol short-circuit; left unchanged.

## Repair

1. Customer client registers an official `ClientExtension` that calls `appendPaymentIdentifierToExtensions` from `@x402/extensions/payment-identifier` 2.16.0.
2. Merchant classifies missing identifier as `payment_identifier_required` vs unbounded validity as `bounded_payment_validity_required`.
3. Patch metadata prepared for merchant `1.23.45` and example `0.2.1` (not deployed).

## Tests actually run (Node v22.23.2, umask 022)

| Suite | Result |
| --- | --- |
| Root `npm pretest` | 13 pass |
| Root `npm test` | 592 pass / 1 skipped (+7 vs prior 585; new interop + classification) |
| `npm run test:extract-batch` | 25 pass |
| `npm run test:replay-boundary` | 19 pass |
| Example `npm test` | 56 pass / 1 skipped |
| `npm audit --omit=dev` (root + example) | 0 vulnerabilities |
| `npm pack --dry-run` | merchant 1.23.45, example 0.2.1 |
| `git diff --check` | clean |

Negative control: official ExactEvmScheme-only payload against mounted merchant fails with `payment_identifier_required`; repaired public customer client succeeds with one settle, exact body bytes, replay/restart safe.

## Remaining limits

- No live wallet, canary spend, production POST, deploy, or default-branch merge.
- Settlement remains facilitator-verified in fixtures; example does not prove on-chain finality.
- Merchant patch is prepared only; publication/signing of deployment statement is root-owned if required.

## Exact next action

Root reviews branch `codex/batch-sdk-interoperability-20260907` once, then publishes merchant `1.23.45` + example `0.2.1` and retries the owned live C22 batch under root wallet control.
