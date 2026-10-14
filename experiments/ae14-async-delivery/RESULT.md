# AE14 E08 acceptance-sensitive async delivery

Verdict: delta. The isolated second funding/receipt consumer is in this directory. The selected rail was not attached. Qualification is `pending-join`. The real-rail join is held for A3/B3.

## Identity

- Base: `82a51274e7dc7a7600b90f1317a6be6b28442592` (actual 204, runtime 1.23.52)
- Branch: `codex/ae14-e08-async-delivery`
- Writer path: `experiments/ae14-async-delivery`
- Head: the commit that adds this file on the branch above. This file cannot contain its own commit id. `git rev-parse HEAD` after the export commit is the head.
- Next integration owner: dr eggbot -> Root

## Consumed inputs

- Portfolio pin `7428845d6429b78573801ee8035953e26c610eaf` on `https://github.com/epistemedeus/pilot.git`, directory `overview/self-evaluations/2026-10-14-agent-economy/` (`EXPANSION-PORTFOLIO.md`, `GRAND-PLAN.md`, `INTEGRATED-DECISIONS.md`, `EXECUTION.md`, `ROOT-CANDIDATE-RECEIVING.md`).
- Joined H matrix `ecf78d29c2c592dd03b5daef4eeba2f29772c8ae`, `GRAND-PLAN.md` section "Composed receiving matrix for the actual amended exports". Not executed here.
- Rail interface checked at A amend `f89939a09feaf6b710d04abf8109c4a0b790f05c` (`codex/ae14-a-wallet-rail`, `tools/agent-economy-rail`). That tree's `SOURCE-PINS.json` names foundation `e16f7812c7eaa563c3effcbbbb99c8f42df3cdbc`. The older pin `af5773e18f1f4863fe4c6143b746ba3c7925ce63` was not used for this interface check.
- commerce-payments pin `6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9` tag `v1.1.0`, abi sha256 `4eadfac88b44c0ff00c9274f98821031f6600145e57800d8ced405f2452c03d5`. Not vendored and not executed.
- x402 auth-capture deferred-capture seam `e95b06661e1a2a8a9a21fce34cc28b9934834650`, Apache-2.0, section "Sync and async finalize". See `THIRD-PARTY.md`.
- Live immediate-pay routes and the paid `/read` wrapper were not edited.

## What this consumer does

It quotes one capture at `floor(gross * 500 / 10000)`, keeps rail cost separate, and refuses terms `221400` and `234100` without a new fee or wallet. Disposable quotes use symbol `USDC` on `eip155:31337` and refuse the production USDC address. Signature and submitted funding are not reserved. Requester acceptance is journaled before capture. A mined reclaim wins over acceptance and does not capture. A later expiry does not replace a captured outcome. A clock expiry, and an unjournaled operator capture, read back as `unknown` and do not capture. A captured receipt this consumer did not post, or a fee or recipient mismatch, stays an incident. Lost capture responses restart by readback and do not send a second capture. Callbacks are notification-only. The direct route is the authority. Reuse of an accepted final artifact adds no paid task. Refund is distinct from reclaim and charges no second fee. Canonical acceptance stays `approval_pending` / `pending-join`.

## Tests

Owned, local PostgreSQL 16.15, Node v22.14.0:

```sh
node --test --test-concurrency=1 test/*.test.mjs
```

Exit 0. 25 passed, 0 failed. Output: `evidence/owned-suite.log`.

Inherited root suite, unchanged, recorded from the run already completed in this workspace. It was not started again.

```sh
npm test
```

Exit 1. tests 1173, pass 1162, fail 6, skipped 5. Output: `evidence/inherited-suite.log`. The six failures are outside this writer path and were not modified:

- `caller-result-client.cold.test.mjs`: installed caller consumer reaches the mounted parent without merchant source
- `caller-result-client.distribution.test.mjs`: caller generation keeps the sealed feedback archive and matches the current source
- `public-acquisition/engine.test.mjs`: cold node and python httpx clients unpack the mount and run the declared commands
- `public-acquisition/receiving-lifecycle.test.mjs`: loopback receiving observes the mounted bytes and cold commands without publishing
- `public-acquisition/receiving-lifecycle.test.mjs`: a public proof parses a readback and does not publish when the runtime pin is unmet
- `task-linked-delivery/experiments/useful-economics-100290/test/cold-export.test.mjs`: two cold consumers accept the public fixture and reject the seeded controls

## Limits

- The stand-in uses `provenance: fake` and the label `stand-in-not-rail`. It is not local-chain or production qualification, and mock parity is not claimed.
- H was not run. Anvil, the wallet keystore, and the canonical acceptance writer were not run.
- A lost capture that never landed is not auto-retried, so a second POST cannot be inferred.
- `acceptedSettled`, `paymentCompleted`, and `fundedAcceptance` stay false.
- No measured-economics claim. No production signer, funds, payment, or deployment.
- Old net promises and the frozen 234100 terms are not repriced.
