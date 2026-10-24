# ROOT5876 handback

**Source-bound negative diagnosis; no merchant runtime patch or installed effect.** The original signed attempt remains `settlement_unknown`; never replay it. Root owns actual financial receiving. A longer client timeout or different facilitator is not a demonstrated remedy.

Merchant base `69927a4118ba689d9367cab91e71a194215b811f`; supplied live deployment `4d9e1dfd-cedc-49dc-9e2d-9c4f0ce134ec`. All staged operating roles and the entire assignment were read at frozen Pilot `ba6cafec52ec122f3a5bed0e8ef267218fb57f8e`. Receipt SHA256 matches `ecf144a29fc902134938b794b08e123af043bf813de7430e0ccaed6f55c994e8`. SPEC binds this Cursor host, Sol6.1/xhigh, 2097152 KiB total, 10:04 checkpoint and 10:10 export horizon. The checkpoint document actually landed **10:04:55 UTC, 55 seconds late**. No extension, renewal, extra kill timer, model child or runner-metadata edit.

## Actual boundary

Root's supplied provider cut proves correlated signed-request receipt upstream and client abandonment after 19957 ms, 499, zero transmitted bytes. It does not locate the pending stage or establish a facilitator/chain result. Partial owner-journal coverage, no joined paid rows and zero scoped runtime-log rows cannot establish no payment or delivery. No private Root journals/logs were read.

Exact Pilot client files/package/lock were read via native Git at `3582ba53e6d0d221cd81a44991918c10e2306e8e`; seven blob/hash bindings and installed SDK source hashes are in `SOURCE-INPUTS.json`. Client SDK 2.16.0/viem 2.54.1; merchant SDK 2.16.0/viem 2.55.11. No second Pilot branch or client changes.

* Client locks terms/schema/pinned public signer, durably records the only send, then applies 20000 ms through headers/body and 60000 ms overall. Post-send exceptions become unknown. The offer's 300 seconds is not the HTTP deadline.
* Merchant reserves replay state, then uses existing xpay `HTTPFacilitatorClient`. Installed SDK `/verify` and `/settle` fetches have no explicit deadline or downstream AbortSignal. Runtime transport defaults may impose other limits; those live limits/results remain unreceived. No verify/settle retry or fallback was added.
* Installed Express SDK verifies, runs `/extract`, buffers its body, then settles before emitting it. Extraction has a separate 12000 ms source deadline; its existing HTTP 200/`ok:false` failure contract does not imply useful delivery.
* The merchant durably marks `settlementAttempted` before facilitator mutation. Failed/unresolved settlement preserves quarantine; successful SDK proof/body is retained before underlying `res.end`.
* SDK cancellation dispatch covers handler failure/throw paths, but this Express middleware does not wire socket close into pending verification, capture or settlement cancellation. Local tests demonstrate late settlement in all three stages. Abort is not cancellation acknowledgement or permission to release possible spend.
* HTTP paid-success evidence is finish-based (`commerce-events.mjs`). The calibrated positive test writes one paid row; disconnected late settlement retains a replay body with zero such rows. This explains why missing delivery rows cannot settle the financial question, without claiming late settlement occurred live.

No received evidence singles out a causal merchant defect for this live stall. Root needs the original request's configured facilitator verify receipt/result, settle dispatch/result if any, and canonical chain/authorization evidence. Source tests cannot supply those facts. A future cancellation change must preserve already-attempted settlement quarantine and existing retry/receipt rights.

## Reproducer and verification

`test/normal-client-timeout-diagnosis.test.mjs` imports the unaltered exact Pilot transport Git blob and uses installed SDK header encoding plus the actual merchant. Seven serial cases cover useful positive completion/readback, known verification refusal, unavailable verification, disconnect during verify, the actual 20-second client deadline during settle, failed-settle quarantine, and disconnect during source capture. It asserts exact Base/native-USDC/5000-atom/treasury/300-second/domain terms. Synthetic invalid authorization bytes are never signed. Offer/receipt signing and pinned proof verification are not executed here; accepted source/configuration remain unchanged. Stub success is not chain evidence.

Readback reads only owned temporary replay files and matches the existing binding, without a second authorization/HTTP request. It does not expose a new public recovery endpoint. Self-review removed concurrent mutating `lookup()` use. Existing recovery tests cover restart/retry rights.

Commands, from this merchant worktree:

```sh
NODE_OPTIONS=--max-old-space-size=384 npm ci --ignore-scripts --no-audit --no-fund
ROOT5876_PILOT_GIT_DIR=/home/ubuntu/root-sol-window100337/root5876-merchant-signed-attempt-diagnosis-20261024/inputs/source-0.git NODE_OPTIONS=--max-old-space-size=128 node --test --test-concurrency=1 test/normal-client-timeout-diagnosis.test.mjs
NODE_OPTIONS=--max-old-space-size=128 node --max-old-space-size=128 test/run-independent-recovery.mjs
node --check test/normal-client-timeout-diagnosis.test.mjs
git diff --cached --check
```

Final exact exits/counts are in `WORKER-RESULT.json`; raw logs are adjacent. Recovery/replay suite: exit 0, 120/120, 53.619 seconds. Initial diagnostic exit 1 (1/7) reflected incorrect fixture assumptions about loopback source URL, header case, lookup shape and unavailable verification's actual 402 mapping. Those fixture defects were fixed; original failures remain in `diagnosis-first-run.log`. Corrected 7/7 output is retained, followed by reruns justified by cleanup diagnostics and calibrated observability assertions. No counts are promoted to live success.

Install completed with pinned modules present and package/lock unchanged; asynchronous install exit was not retained and is unknown. Attempted `/usr/bin/time -v` exited 127 (executable absent); its error is retained. No aggregate peak-RSS claim: tests ran serially with 128 MiB parent/384 MiB merchant heaps; existing runner uses bounded inherited 128/384 MiB heaps. Total enforcement remains runner-owned.

## Scope and cleanup

No wallet/key/token access, live signing, public verify/settle POST, paid API, account login, provider mutation, facilitator change, public metadata read, deployment, mail or customer contact. Child environments contain only synthetic fixture settings. Preload refuses external native sockets. Each diagnostic gate is released, its sole merchant receives task-scoped SIGTERM and is awaited/reaped, loopback connections close and temporary directories are removed. Final log records each PID/exit. Existing serial runner exits cleanly; no shared process was signalled.

Only the admitted merchant branch receives the reproducer/review export. Runtime source/package/lock, Vibes/MPP containment, original ROOT5640/5730/5762 contexts/exports, other writers and financial/STATE records remain untouched. Root receives this source package and decides further financial/release action.

Export self-review caught trailing whitespace in blank lines of the first failure log; only that whitespace was trimmed. The first staged/show whitespace check failed, then the corrected export passed.
