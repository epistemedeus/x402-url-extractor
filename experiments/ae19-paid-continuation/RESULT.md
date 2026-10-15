# AE19 G4 paid continuation

Branch `codex/ae19-g4-paid-continuation`.

Tested head, cold-entered from a fresh clone: `dcd1b8c1d475d43840dd34646cf1877a482ac3ab`.
Its parent is the J3 base `9520a1e30c806fcf18ba03461ca337ce3c8d3b98`.
This file is the receipt commit on top of that head. `git rev-parse HEAD` after the receipt commit is the branch tip. The parent of that commit is the tested head.

Remote fast-forwarded from the base to the tested head before this receipt. No force, no delete, no relabel.

## Pins read

| Pin | `git rev-parse` |
| --- | --- |
| Plan, pilot checkout `/home/ubuntu/ae14-work/g1h` HEAD | `3c8cdf63a21164ce06960733c5b98ba9b6acf9fc` |
| AE18 map, same pilot repo | `697c9e57918ecbdb5cc24e2cee11580d044ceeb5` |
| CCB, same pilot repo | `bac2ab2e64325cf76de32f9f97a9f09ac9d6d68e` |
| This branch tested head | `dcd1b8c1d475d43840dd34646cf1877a482ac3ab` |
| J3 base / first parent | `9520a1e30c806fcf18ba03461ca337ce3c8d3b98` |
| Merchant main | `82a51274e7dc7a7600b90f1317a6be6b28442592` |
| E08 `experiments/ae14-async-delivery` | `d5c5ab3606ba2f79d5bdfec6afb347b566966573` |
| Gateway neo `/home/ubuntu/root-sol-window100337/240200/source` HEAD | `7e5078bbf213ae3d1ff8d4638199ff8d1d1d81a8` |
| 242007 object in `/home/ubuntu/root-sol-window100337/232600/neo` | `1b5fd425408d34be232cd1c2ce059d3571b56c63` |
| 242008 object in that neo repo | `ed7417b085fc595c1c7dc98831c2ef57ddf32736` |
| 244005 harness checkout `/tmp/ae18-244005-replay-EANA1z/source` | `7c902ac54a992666aea1b2c044c145caaa0901ae` |
| 244005 export tip `/home/ubuntu/root-sol-window100337/244005/source` HEAD | `46175775c06f7c115a69cd5eae2286131b43b651` |

The neo worktree that holds the 242007 object is not checked out at that object. The suite archives `1b5fd425`. The mounted gateway is `7e5078bb`, not `728f27ec`.

E08 is on `codex/ae14-e08-async-delivery`. It is not an ancestor of this branch. A default clone still contained the object (`E08_OBJECT:present`).

## What ran

Cold clone of the tested head, then:

```sh
cd experiments/ae19-paid-continuation
flock /home/ubuntu/.cache/pilot-ae18-build.lock npm install --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 --test-timeout=120000
node ./bin/ae19-paid-continuation.mjs fit --url 'http://127.0.0.1/private'
env -u EXTRACT_PRICE node ./bin/ae19-paid-continuation.mjs terms
```

| Command | Exit | Count |
| --- | --- | --- |
| `git clone` of the tested head | 0 | HEAD `dcd1b8c1d475d43840dd34646cf1877a482ac3ab` |
| `npm install --ignore-scripts --no-audit --no-fund` | 0 | 16 packages |
| `node --test --test-concurrency=1 --test-timeout=120000` | 0 | tests 20, pass 20, fail 0, cancelled 0, skipped 0, suites 0, `duration_ms` 3719.007535 |
| `fit --url http://127.0.0.1/private` | 0 | `fit:false`, `reason:ssrf_blocked`, `paymentAttempts:0`, `newPayment:false` |
| `terms` | 0 | source `$0.005`, atomic `5000`, `changed:false` |

Transcript: `evidence/cold-entry.txt`.

Owner red check, not part of `node --test`:

```sh
node --test --test-concurrency=1 proposed/242007-owner-desired.fail.mjs
```

Exit 1. tests 1, pass 0, fail 1. Error `e08_extraction_submit_pending_join`. Transcript: `evidence/owner-red.txt`.

## Items 1–7

The counts below are the assertions those passing subtests enforce.

1. Free fit-check. Subtests `free fit-check takes no payment and returns a useful no-fit` and `a free no-fit is retained and a fit does not fetch`. Private and loopback URLs are `ssrf_blocked` with `paymentAttempts` 0 and `newPayment` false. The no-fit row is stored; a second read returns the same digest of the stored bytes. A passing `https://example.com/` fit does not call extract. One CLI no-fit, exit 0.
2. Existing terms only. Subtests `runtime terms are read and not rewritten` and `terms command prints the unchanged runtime price`. `server.js` still has `EXTRACT_PRICE` default `$0.005`, atomic `5000`, network `eip155:8453`, asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, `changed:false`. `221400` and `234100` are refused. E08 quote terms stay `e08-async-v1` on `eip155:31337` and refuse that production asset. No terms write.
3. Funded service without a second purchase. Subtests `unchanged E08 accepts one extraction artifact and reuse does not capture again` and `submit runs the extractor once, rereads after a lost body, and does not repurchase`. One stand-in capture: gross `105263`, platform fee `5263`, contributor net `100000`, rail cost `0`, `invocations` 1 after accept, after a second accept, and after reuse. Reuse `newPayment` false, `paidTaskCountDelta` 0. Lost HTTP body plus the same idempotency key: 1 job row. Gateway replay of the synthetic submit returned the same receipt id and did not insert another job (`idempotency-replayed` true).
4. Source-change applicability. Subtests `source change admits one bounded occurrence and a later need reads the stored digest` and `244005 export is consumed when its pinned roots are present`. First sight is `not_yet_due`. One digest change admits one occurrence (`source_changed`). A further change while that occurrence is open is `occurrence_open`. `schedulesCreated` 0. The finite monitor arms no timer. 244005 changed disposition `bounded_assessment`, unchanged disposition `not_yet_due`, effect counts `paymentAttempts` 0, `captures` 0, `paidTaskIncrement` 0, `repairExecutions` 0.
5. Late callback. Subtest `a late callback is reconciled without a second capture`. First callback HTTP 503, `acked` false, `attempts` 1. A new service on the same journal then receives the ack (`attempts` >= 2). `invocations` stays 1. A second accept is replayed. Reuse does not pay again.
6. Restart. Subtest `a restarted service recovers a leased job from postgres`. A second pool to the same database recovers 1 leased row to `queued`, then finishes the same job id. Stored bytes digest matches. `payment_attempts` 0. Title read back from stored bytes is `After restart`.
7. Accepted result versus capture. Subtests `per-capture floor is not a cumulative reprice`, `a capture mismatch stays unknown`, and the E08 seam subtest. Floor of 19 is 0, of 20 is 1, of 21 is 1, of 38 is 1, of 105263 is 5263. The journal quote plus one port row matches. A second invocation, a fee mismatch, a missing capture, or a different digest stays `unknown`. Both the matched verdict and the unknown verdict are reread from `ae19_paid_continuation.capture_verdict`. `paymentCompleted`, `acceptedSettled`, and `fundedAcceptance` stay false.

Distinct later need: `measureLater` reads the stored prior digest, `paymentAttempts` 0, and `distinct` true. A tampered result becomes `digest_mismatch` / `unknown` and is not measured.

## Gateway port

Subtest `unpatched 242007 submit through the pinned gateway stays the extraction gap`: execute of `https://example.com/` on gateway `7e5078bb` with unpatched `1b5fd425` returns a failed receipt, `error.code` `e08_extraction_submit_pending_join`, `output` null. `POST /v1/test` still returns that gap. The neo object is unchanged.

Subtest `a real URL through patched 242007 returns an extraction readable by job id`: the patch is applied only in a temporary copy. `http://127.0.0.1/private` returns `no_fit` / `ssrf_blocked`, `gap` null, `attempts` 0, `payment_attempts` 0. `https://ok.example/` with the merchant fetch hook returns title `Hooked`, `fetch_mode` `injected`. `https://example.com/` with the hook unset returns title `Example Domain`, `status` 200, `requestedUrl` `https://example.com/`, `fetch_mode` `merchant-public-fetch`, `attempts` 1, `payment_attempts` 0, `completion` `ready`, `gap` null. The receipt GET returns that job id. An unknown job id fails `e08_job_forbidden`. The allowlisted non-extraction id falls through and fails `e08_readback_failed`. `server.js` and `experiments/ae14-async-delivery` stay clean.

E08 at `d5c5ab36` is loaded from a hash-checked archive. No `e08-*.patch`.

## Pending-join

- `243002` successor: pending-join until its final pin. This mount does not claim it.
- Unpatched `242007` at `1b5fd425`: submit remains `e08_extraction_submit_pending_join` until that package's owner applies `proposed/242007-extraction-submit.patch`.
- Qualified rail: pending-join. Captures are the E08 stand-in (`eip155:31337`, provenance fake). `paymentCompleted`, `acceptedSettled`, and `fundedAcceptance` are false. `qualification` and `railJoin` stay `pending-join`.
- `242008` retained operations: not mounted. It is context, not this port.
- Gateway `test()` on the submit route still reports the gap. The closed path is `execute`.

## Proposed patches

| Patch | Owner | Applied |
| --- | --- | --- |
| `proposed/242007-extraction-submit.patch` | neo `packages/journey-x402-async` at `1b5fd425408d34be232cd1c2ce059d3571b56c63` | no; temporary copy only |
| none for E08 | AE14 Work Network Lead, `d5c5ab3606ba2f79d5bdfec6afb347b566966573` | not required |
| none for `services/machine-gateway` | gateway owner at `7e5078bbf213ae3d1ff8d4638199ff8d1d1d81a8` | not required |
| none for `server.js` | merchant runtime | not required |

## Limits

- Product state is PostgreSQL schema `ae19_paid_continuation` in a disposable `ae19g4_*` database. The gateway keeps its own sqlite-wal file in a temp directory. This package does not open SQLite and does not arm a timer, cron, or daemon.
- Cold entry of the merchant repo does not contain neo, samedaydesk, or the pilot. On this VM the suite uses the checkouts above. A machine without those paths fails the gateway and 244005 subtests; it must not record them as pass.
- 244005 was consumed from the tested harness `7c902ac`. The export tip `46175775` is that tree plus docs. The harness verified its own input sha256 pins.
- No funds movement, live payment, signer, key, chain transaction, terms change, deploy, or human-page publication.
- No counter-quote party is named. D09 is out of this package.

## Remaining Root actions

- The 242007 owner applies `proposed/242007-extraction-submit.patch` on neo `1b5fd425` (or a descendant). Until then, production mounts of that pin still return `e08_extraction_submit_pending_join`.
- Leave `243002` pending-join until its final pin.
- Keep E08 with the AE14 Work Network Lead. G4 does not need a patch there.
- Do not treat the stand-in capture as a qualified rail or as `paymentCompleted`.
- Merchant extract terms stay `$0.005` / atomic `5000` unless a later owner changes `server.js`.
