# AE20 X1 url.extract route

Verdict: `complete`.

Branch `codex/ae20-x1-url-extract-route`.

Base (source pin, G4 receipt commit): `6dd7a040f80f3e3ce1d914383172721751de59a2`.
Tested head: `7e4840f95b424bf5b7d6446d89b9fe94cdc320c3`. Its parent is that base.
This file is the receipt commit on top of that head. The parent of the receipt commit is the tested head. `git rev-parse HEAD` after the receipt commit is `receiptHead` and the branch tip. `HEADS.json` leaves `receiptHead` null because this commit cannot store its own hash.

P3 in `overview/self-evaluations/2026-10-14-agent-economy/AE20-WHOLE-PORTFOLIO-COMPLETION.md` at pilot `b8ead33382b7007df337e8adf7c1536e9fb2b5c3`: usable machine services, Helm with G4 owner. N1/N2 handovers are published at pilot `e44d7afce1e25edcf09b967f75d11ab20d7168e8`. Helm owns their admission. This package does not edit the gateway worktree.

## Consumed inputs

| Input | Commit |
| --- | --- |
| G4 package `experiments/ae19-paid-continuation/` (contract, digest, fit/SSRF, idempotent submit, restart) | `6dd7a040f80f3e3ce1d914383172721751de59a2` |
| G4 tested head (parent of the base) | `dcd1b8c1d475d43840dd34646cf1877a482ac3ab` |
| J3 base | `9520a1e30c806fcf18ba03461ca337ce3c8d3b98` |
| G4 `proposed/242007-extraction-submit.patch` | unchanged bytes at `6dd7a040f80f3e3ce1d914383172721751de59a2` |
| Async provider `packages/journey-x402-async` | `1b5fd425408d34be232cd1c2ce059d3571b56c63` |
| Gateway read pin | `7e5078bbf213ae3d1ff8d4638199ff8d1d1d81a8` |
| Gateway move-to pin | `667fba353e9082d8a0842437442dabc42843abf8` |
| E08 `experiments/ae14-async-delivery` | `d5c5ab3606ba2f79d5bdfec6afb347b566966573` |
| Pilot plan | `b8ead33382b7007df337e8adf7c1536e9fb2b5c3` |
| Unchanged `ae14-launch/accept/ae19/test/routes.test.mjs` | `501c407f7a1f73ddb57de3526ff85177e3d461e9` |
| Monitor openapi used for every routes.test run | `0ad6691f79225cfba782971a910c0e79d371c8f3` |

`7e5078bb` has no `services/continuous-monitoring/openapi.json`. T1–T4 share the `0ad6691f` monitor tree so the monitor subtest stays constant. `routes.test.mjs` bytes match that pilot blob (`sha256 d9fa93748e57e12e0533f0597edd35a8ee6805d9203d3beb4413ea6e0ebb2216`). No new 242007 patch. No edit of `server.js`, E08, the G4 directory, the pilot, or neo.

## What shipped

- Provider `gateway/url-extract-routes.mjs`: `url.extract.submit`, `url.extract.poll`, `url.extract.result`. Price amount 0, unit `usd-micros`. `paymentsEnabled` stays false.
- Mount adapter `support/gateway.mjs` binds one `ExtractionService` actor before listen. Unbound `run()` fails closed (`url_extract_unbound`).
- `proposed/gateway-url-extract.patch` against `services/machine-gateway` at `667fba35`. The same diff applies at `7e5078bb`. It adds the provider, spreads it from `builtinRoutes()`, and regenerates `openapi.json` without changing `info.version` (`0.1.1` at `667fba35`, `0.1.0` at `7e5078bb`). Patched discovery includes `/v1/routes/url.extract.{submit,poll,result}/{input,output}.schema.json`.
- `proposed/OWNERS.md` names N2 as the applier. The 242007 owner remains the owner of G4's existing patch.

Submit takes `{url, idempotencyKey}`, runs the AE19 fit/SSRF check first, and returns `{jobId, status:"queued"|"ready", digest?}` in that call. A private or loopback URL is `no_fit` / `ssrf_blocked` with `attempts` 0 and `payment_attempts` 0. The same idempotency key returns the same job id and one job row. Job ids match 242007 `JOB_ID` (`/^j[a-f0-9]{32}$/`). An unknown well-formed id is `e08_job_forbidden` after the extraction read misses (HTTP contract `404` `job_absent`). A malformed id is HTTP 400 before admission. Result and poll return the stored title, status, requestedUrl, fetch_mode, and completion. The digest is sha256 of the stored canonical bytes and is stable on reread. Tampered bytes return `digest_mismatch` and verdict `unknown`.

## T1–T13

Transcripts: `evidence/tests.txt`. x1 lines: `evidence/routes-x1.txt`.

| # | Command | Exit | Counts |
| --- | --- | --- | --- |
| T1 | `AE19_GW=/tmp/ae20-x1-unpatched-7e AE19_MON=/tmp/ae20-x1-pins/mon-root node --test --test-concurrency=1 /tmp/ae20-x1-pins/routes.test.mjs` | 1 | tests 4, pass 2, fail 2, cancelled 0, skipped 0, `duration_ms` 44.308605. x1 not ok, `no URL extraction route`. x2 not ok, `no authorize path`. Gateway free routes and monitor routes ok. |
| T2 | same, `AE19_GW=/tmp/ae20-x1-unpatched-667` | 1 | tests 4, pass 2, fail 2, cancelled 0, skipped 0, `duration_ms` 41.711832. x1 red. Other subtests the same as T1. |
| T3 | same, `AE19_GW=/tmp/ae20-x1-apply667` (temp copy of `667fba35` plus `gateway-url-extract.patch`) | 1 | tests 4, pass 3, fail 1, cancelled 0, skipped 0, `duration_ms` 41.698963. x1 ok. x2 still red. Gateway free routes and monitor routes still ok. Openapi version stays `0.1.1`. |
| T4 | same, `AE19_GW=/tmp/ae20-x1-apply7e` (temp copy of `7e5078bb` plus the same patch) | 1 | tests 4, pass 3, fail 1, cancelled 0, skipped 0, `duration_ms` 42.306045. x1 ok. The patch applies. Openapi version stays `0.1.0`. x2 still red. |
| T5 | T13 subtest `T5 injected public fetch returns a job id, stored fields, and a stable digest` | 0 | `duration_ms` 147.275492. Mounted `POST /v1/execute`. Job id returned. Result readable by job id. Digest matches stored bytes and the reread. |
| T6 | T13 subtest `T6 private loopback is no_fit ssrf_blocked with zero attempts` | 0 | `duration_ms` 86.899346. `http://127.0.0.1/private`: `no_fit` / `ssrf_blocked`, attempts 0, payment attempts 0. |
| T7 | T13 subtest `T7 a lost submit body retries onto the same job and one extraction` | 0 | `duration_ms` 106.156261. Same idempotency key, new gateway key, one job row, extractor invoked once. |
| T8 | T13 subtest `T8 unknown well-formed job id is forbidden after a 404 and a malformed id is 400` | 0 | `duration_ms` 93.143557. Extraction HTTP 404 `job_absent`, then gateway `e08_job_forbidden`. Malformed id HTTP 400. |
| T9 | T13 subtest `T9 tampered stored bytes are digest_mismatch and verdict unknown` | 0 | `duration_ms` 96.250534. `digest_mismatch`, verdict `unknown`. |
| T10 | T13 subtest `T10 a new process and pool recover a leased job with the same id and digest` | 0 | `duration_ms` 292.034602. New process and pool. Same job id and digest. |
| T11 | T13 subtest `T11 quote and test are price 0 with no capture and no payment fields` | 0 | `duration_ms` 87.026814. `POST /v1/test` and `/v1/quote` on `url.extract.*`: price 0, requirements null, no payment fields, no capture. |
| T12 | clean detached worktree of `6dd7a040` at `/tmp/ae20-x1-g4-clean/experiments/ae19-paid-continuation`, `node --test --test-concurrency=1 --test-timeout=120000`, inside `unshare --user --map-root-user --mount` | 0 | tests 20, pass 20, fail 0, cancelled 0, skipped 0, `duration_ms` 2339.324351. Inherited G4 suite. Host path `240200` was not created. |
| T13 | `cd experiments/ae20-x1-url-extract-route && node --test --test-concurrency=1 --test-timeout=120000 test/*.test.mjs` | 0 | tests 11, pass 11, fail 0, cancelled 0, skipped 0, `duration_ms` 2124.433115. |

Tests: 11/11 writer pass, 20/20 G4 inherited pass. routes.test x1 is red at unpatched `7e5078bb` and `667fba35`, and green with the patch on both pins. x2 stays red. T3 and T4 exit 1 because x2 is still an expected failure. That assertion was not weakened.

T12 mounts a detached neo worktree at `7e5078bb` and the neo clone that contains `1b5fd425` only inside the private mount namespace. The G4 tests hardcode `/home/ubuntu/root-sol-window100337/240200/source` and `.../232600/neo`. Those paths were not created on the host.

## Proposed patches and owners

| Patch | Owner | Applied here |
| --- | --- | --- |
| `proposed/gateway-url-extract.patch` | N2, neo `services/machine-gateway` (read at `7e5078bbf213ae3d1ff8d4638199ff8d1d1d81a8`, moving to `667fba353e9082d8a0842437442dabc42843abf8`) | no; temporary copies only. Applies on both pins. |
| G4 `experiments/ae19-paid-continuation/proposed/242007-extraction-submit.patch` | owner of neo `packages/journey-x402-async` at `1b5fd425408d34be232cd1c2ce059d3571b56c63` | no new patch. G4's patch is sufficient and byte-unchanged. |
| none for E08 | AE14 Work Network Lead, `d5c5ab3606ba2f79d5bdfec6afb347b566966573` | not required |
| none for `server.js` | merchant runtime | not required |

## Pending-join

- The live gateway stays unpatched until N2 applies `proposed/gateway-url-extract.patch`.
- Unpatched `242007` at `1b5fd425`: `e08.async.submit` remains `e08_extraction_submit_pending_join` until that package owner applies G4's patch. The `url.extract.*` routes are the discoverable free path. They do not close that gap.
- `243002` successor stays pending-join. This mount does not claim it.
- Qualified rail stays pending-join. `payment_attempts` stay 0. Quote requirements stay null. No capture and no payment fields on the free path.
- No terms change and no `server.js` change.

## Limits

- Free and test paths only. Disposable PostgreSQL schema `ae19_paid_continuation` in `ae19g4_*` databases, plus the gateway's temp sqlite file. No deploy, signer, key, wallet, funds, capture, settlement, public chain transaction, publication, new account, merge, or pull request.
- No new ledger, queue, registry, or protocol brand. The provider string is `ae19-extraction-contract`.
- Patches were applied only in temporary copies. N2's gateway worktree was not entered, written, reset, or fetched.
- HTTP 200 on a failed receipt is not treated as useful work. Useful reads require the stored title, status, requested URL, fetch mode, completion, and a stable digest.

## Next integration owner

Helm with the G4 owner, then Root. N2 applies the gateway patch. The 242007 owner applies G4's existing async patch if that submit path should leave `e08_extraction_submit_pending_join`.
