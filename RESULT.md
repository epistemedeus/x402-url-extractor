# RESULT: public customer attempt receipt + read-only reconcile

## Gap reproduced

C22's real batch attempt signed and sent once, then returned HTTP 400 with
`charged:false` and no settlement hash. Root retained request/result and
confirmed the funded canary still held its full 0.01 USDC, but the public
example result kept neither the unsigned EIP-3009 `nonce` nor exact
`validBefore`, so precise `authorizationState` reconciliation was impossible.
C23 fixed payment-identifier enrichment; this branch does not redo that work.

## Source approach

In `examples/customer-x402` only:

1. Opt-in `--attempt-receipt` on the real `@x402/fetch` / `ExactEvmScheme` path.
2. After official payload creation (sign + payment-identifier enrichment) and
   **before** paid send, durably persist a secret-free receipt:
   scheme/version, chain/asset, payer/payee, amount, nonce, validity, request
   binding (`bodyDigest` when POST), and payment identifier when present.
3. Receipt-write failure aborts paid send. Transport timeout/crash updates stage
   to `paid_send_dispatched` / `failed_after_identity` with `settlementState:
   unknown` without erasing identity.
4. Read-only `--reconcile --rpc-url` validates receipt structure first, then
   calls official USDC `authorizationState` via viem/`eip3009ABI`, optionally
   matches `AuthorizationUsed` + exact `Transfer`, and reports confirmation vs
   finality separately. Claims always set `deliveredOutput` / `retryAuthorized`
   / `respendAuthorized` to false.
5. No-receipt purchases remain compatible and state the missing-identity limit.

## Tests actually run (Node v22.23.2, umask 022)

| Suite | Result |
| --- | --- |
| Example `npm test` | 67 pass / 1 skipped live |
| Root `npm run pretest` | 13 pass |
| Root `npm test` | 592 pass / 1 skipped |
| `npm audit --omit=dev` (root + example) | 0 vulnerabilities |
| `npm pack --dry-run` | merchant 1.23.45, example 0.2.2 |
| `git diff --check` | clean |

All acceptance coverage is offline/local fixtures exercising exported purchase,
receipt, reconcile, and CLI entrypoints (no parallel fake client).

## Limits

- No live merchant purchase, funded-wallet RPC, credential-store access, or
  real authorization signing beyond public test keys in fixtures.
- No retry/unlock/respend, funding, daemon, or private Pilot journal port.
- No merchant runtime change; example patch metadata only (`0.2.2`).
- Truncated log absence is not final no-settlement beyond `authorizationState`.

## Exact next controller action

Root reviews branch `codex/public-attempt-receipt-20260907`, then publishes
example `0.2.2` if accepted. Any future live ambiguous-outcome retry decision
must use a preserved attempt receipt + explicit RPC reconcile under root wallet
control; do not infer delivery or respend permission from chain usage alone.
