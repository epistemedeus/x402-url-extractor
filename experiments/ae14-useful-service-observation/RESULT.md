# J3 useful-service observation

Verdict: **delta**. The serving handback at the pinned source already accepts a result-bound `useful|not_useful` disposition and keeps measured usefulness `unknown`. It does not accept retained-use, next-task evidence, or a distinct later-task repeat bound to a prior paid result. This package extends that handback. It does not add a second feedback service.

Base: `82a51274e7dc7a7600b90f1317a6be6b28442592`  
Tree: `f95a351e763cc903f7caa4159788cb4ceacddf91`  
Runtime: `1.23.52`  
Branch: `codex/ae14-useful-service-observation`  
Head: tip of this branch that contains this file. Parent of the outcome is the base above.  
Writer: `experiments/ae14-useful-service-observation/`  
Next integration owner: Procurement lead -> dr eggbot -> Root  
Shared-serving mount: existing serving owner + Root (`route/ROOT-SERVER-MOUNT.patch`, not applied)

Tests: 217/217 passed (owned 10/10, npm run test:nonlive 194/194, http-delivery-evidence store and contract 13/13, fail 0).

## Inventory

At `82a51274` these paths already serve and stay the sole writers of their journals:

- `caller-result-feedback.mjs` writes `caller-result-feedback.ndjson` for `POST /commerce/caller-result-feedback`, with response-scoped HMAC capability, header `x-samedaydesk-caller-result-feedback`, and `Link rel="caller-result-feedback"`. Coverage is `this_retained_result_only`. Extra body fields are `unbounded_field`.
- `commerce-events.mjs` calls `attachCallerResultFeedbackHeader` on a completed paid 2xx. Actor counters are pseudonym continuity, not a later-task purchase.
- `mcp-server.mjs` publishes the same capability in `_meta`. `caller-result-client/` posts only `disposition` and `reasonCategory`.
- `commerce-prospective-retention.mjs` retains journal segments. It is not caller-declared retained use.
- `http-delivery-evidence/` is the durable observation port. Schema-valid delivery is not buyer usefulness. `ordinary-delivery-join.mjs` leaves repeat count null and usefulness unknown.
- `useful-result-reuse` is entitled retrieval of a retained result. It is not a distinct later-task purchase.

Root receipt `ROOT-RECEIVING-232950.md` at pilot `2286f21057106354a01d7b3db5677fe2d354430d` still stands: one exact paid `/extract` join, usefulness and purpose unknown, task reference and caller acceptance and repeat absent, full-window coverage unknown. The 44 unclassified settlements in that receipt are not 44 outside customers. `comparison.json`, `RESULT.md`, and `ROOT-RECEIVING-232950.json` are cited by that receipt and are not in that commit tree. Behavior-equivalent prior `838abb50ec9ddac9e93d39d9f8c91f1f3ca44a35` differs in tests, fixtures, and the package test command.

## What this package adds

`createUsefulServiceObservation` delegates a body that contains only `disposition` and optional `reasonCategory` to `createCallerResultFeedbackService.submit` with the caller's original bytes. Extension fields (`retainedUse`, `nextTask`, `originLabel`, `tenant`, `sourceSha`, `priorBinding`, `decline`) append one row to `useful-service-observation.ndjson` in the same data directory, under the existing `admitCommerceJournal` gate. The canonical statement is still written only by the feedback service.

Observed delivery is read from the existing paid-evidence and validation journals. A caller declaration is stored separately from that observation. `observedRepeat` is classified when the journals are read:

- `distinct_later_task_purchase` requires a later settled row, a different task ref, a different request digest, and a capability-bound prior link.
- `same_task_retry` is the same task ref or the same request digest.
- `entitled_reuse` is free retrieval of a passed validation, with no later settlement.
- `pseudonym_continuity` is matched continuity and is not independent control and not a purchase.
- A declaration without a later settled row stays `unknown`.

Missing capture, duplicate capture, and `windowCoverage: gap` stay `unknown`. They are not failure and not a zero customer count. `rates` stays null. `outsideCustomerCount` stays null. `outsideUsefulAnswerArrived` stays false. `e08UsefulWork` stays false. An `external_unknown` label is not an arrived outsider.

Wrong source, receipt, result, caller, and tenant are refused. A tampered capability is refused. An identical extension replays. Decline is optional and is not `not_useful`. A second tenant cannot overwrite another tenant's extension row. Restart is a new process handle on the same directory. Callers who ignore the handback keep the paid JSON body, the public GET contract, price, payment, signer authority, and entitled retrieval.

## Consumed inputs

| Input | Commit | Tree | Status |
| --- | --- | --- | --- |
| x402-url-extractor serving source | `82a51274e7dc7a7600b90f1317a6be6b28442592` | `f95a351e763cc903f7caa4159788cb4ceacddf91` | received |
| epistemedeus/samedaydesk `tools/result-reuse`, `tools/recurring-job-recipes` | `d8cea059213e06d2f263be67f82e498f8052a50f` | `98f0b9f601fdebf40c1e2f7914c8eb21c08aa2d5` | read-only |
| Neo `experiments/ae14-task-economics/` | `75312c3ac1590dbf913ae516b7fb76c9db6e74d9` | `2919c38894e9e87c056b5006860d87fb7384601f` | qualified |
| Neo `experiments/ae14-task-native-acquisition/` | `272bce6b5c6aec144c9e0eda7438967d5ff67f7a` | `19ac899bdedc1f3f787664e530d10d3cf4171561` | qualified |
| Neo `experiments/contributor-network-measurement-227900/` | `301711b8eac39cdeda16466bc72e3d379fd91486` | repo `a4f6304496bb97fb817edc5c93eb564d78e26cc1`, path `5ad6d5d77ff12a802f93fb80d7be7e2938aecfd0` | contract only, not ingested |
| Neo E18 `codex/ae14-e18-market-attribution-consumer` | `11871c33e294ad6acecd0fa7049d9104d9152723` | `f232a170736629e083ffc31337b545fd9925fc79` | pending-join; head rechecked unchanged |
| E08 `experiments/ae14-async-delivery/` | `d5c5ab3606ba2f79d5bdfec6afb347b566966573` | `a6356b16a27ae52cdea92043b79378a6e31925e8` | contract only; async delivery not built |
| pilot portfolio / composition / H matrix | `7428845d6429b78573801ee8035953e26c610eaf` / `2286f21057106354a01d7b3db5677fe2d354430d` / `ecf78d29c2c592dd03b5daef4eeba2f29772c8ae` | staged by `stage-native-source.sh` at `c3436e8647bd111a04359193c55f2c97be77e180` | read |

H was not run. Quote, fee, acceptance, expiry, receipt reuse, tenant and authority refusal, recovery, and legacy terms `221400` / `234100` are unchanged by this package, so a later H harness can join the serving path. `hJoin.ran` is false.

## Tests

Owned, against the pinned handler and the existing observation port:

`node --test --test-concurrency=1 experiments/ae14-useful-service-observation/test/*.test.mjs`  
10 passed, 0 failed. Log: `evidence/owned-tests.txt`.

The owned tests use `validExtractBody` and `recordFromObservedResponse` from the serving evidence port. Controls cover wrong source, receipt, result, caller, and tenant; tampered capability; lost and duplicate capture; restart; malformed feedback; decline; gap coverage; purchased versus free entitled retrieval; distinct later-task purchase versus same-task retry and pseudonym continuity.

Inherited, unchanged:

`npm run test:nonlive`  
194 passed, 0 failed. Log: `evidence/inherited-nonlive.txt`.

`node --test http-delivery-evidence/test/store.test.mjs http-delivery-evidence/test/contract.test.mjs`  
13 passed, 0 failed, included in `evidence/inherited-handback.txt` (that log also repeats the handback files already inside `test:nonlive`; those repeats are not a second population).

Route comparison on one local synthetic capture (`evidence/route-comparison.json`): direct setup 3 reads, extended setup 4 reads; review fields 2 versus 4; latency 1.267 ms versus 0.979 ms on this machine. The extended sample was a warm second read. The direct route leaves retained use and repeat `unknown`. The extended route reports declared `retained` and observed `entitled_reuse` for a synthetic free retrieval. `outsideUsefulAnswerArrived` is false.

Cold replay, no network and no payment: `node experiments/ae14-useful-service-observation/bin/cold-replay.mjs <data-dir>` and the same command with `--gap`. Log: `evidence/cold-replay.txt`. The gap report keeps the repeat class `unknown`.

Mount check: `git apply --check experiments/ae14-useful-service-observation/route/ROOT-SERVER-MOUNT.patch` exited 0. The patch was not applied. `server.js` and `commerce-events.mjs` are unchanged. Log: `evidence/mount-check.txt`.

Release candidate: `node experiments/ae14-useful-service-observation/bin/export-candidate.mjs` wrote `candidate/release-candidate.json`. `machineOnly` true, `appliedToServing` false, `deployment` `not_performed`, `paidProbe` false, `livePurchase` false, `humanCopyChange` false.

## Limits

No outside useful answer arrived in this run. No production settlement was reclassified. Full-window coverage remains `unknown_for_full_window`, so this package publishes no rate and no customer denominator. E18 measurement ingest and the H harness are pending-join. E08 async delivery was not built. The repository `npm test` script was not run; it includes HTTP journeys outside this no-paid-probe boundary. `caller-result-feedback.http.test.mjs` was not booted. No deployment, live purchase, signer use, or default-branch merge was performed.
