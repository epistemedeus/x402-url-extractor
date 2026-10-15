# J3 useful-service observation

Verdict: **delta, amended**. The serving handback at the pinned source already accepts a result-bound `useful|not_useful` disposition and keeps measured usefulness `unknown`. It does not accept retained-use, next-task evidence, or a distinct later-task repeat bound to a prior paid result. Amendment 1 makes a repeat count only when chronology and settlement distinctness are proven, publishes that extension on the existing GET, applies the serving mount on this branch, and derives runtime qualification from the rows that were read.

Base: `82a51274e7dc7a7600b90f1317a6be6b28442592`  
Tree: `f95a351e763cc903f7caa4159788cb4ceacddf91`  
Runtime: `1.23.52`  
Branch: `codex/ae14-useful-service-observation`  
Head: tip of this branch that contains this file. Parent of the amendment is `2db5dceaee53019eb1e182043f4af076a7d37987`. Parent of the first outcome is the base above.  
Writer: `experiments/ae14-useful-service-observation/` plus the mount targets `server.js` and `commerce-events.mjs`  
Next integration owner: Procurement lead -> dr eggbot -> Root  
Shared-serving mount: applied on this branch only (`appliedToServing: "branch_only"`). Not deployed. Not merged.

Tests: 228/228 passed (owned 21/21, npm run test:nonlive 194/194, http-delivery-evidence store and contract 13/13, fail 0).

## Inventory

At `82a51274` these paths already serve and stay the sole writers of their journals:

- `caller-result-feedback.mjs` writes `caller-result-feedback.ndjson` for `POST /commerce/caller-result-feedback`, with response-scoped HMAC capability, header `x-samedaydesk-caller-result-feedback`, and `Link rel="caller-result-feedback"`. Coverage is `this_retained_result_only`. Extra body fields are `unbounded_field`.
- `commerce-events.mjs` called `attachCallerResultFeedbackHeader` on a completed paid 2xx. Actor counters are pseudonym continuity, not a later-task purchase.
- `mcp-server.mjs` publishes the same capability in `_meta`. `caller-result-client/` posts only `disposition` and `reasonCategory`.
- `commerce-prospective-retention.mjs` retains journal segments. It is not caller-declared retained use.
- `http-delivery-evidence/` is the durable observation port. Schema-valid delivery is not buyer usefulness. `ordinary-delivery-join.mjs` leaves repeat count null and usefulness unknown.
- `useful-result-reuse` is entitled retrieval of a retained result. It is not a distinct later-task purchase.

Root receipt `ROOT-RECEIVING-232950.md` at pilot `2286f21057106354a01d7b3db5677fe2d354430d` still stands: one exact paid `/extract` join, usefulness and purpose unknown, task reference and caller acceptance and repeat absent, full-window coverage unknown. The 44 unclassified settlements in that receipt are not 44 outside customers. `comparison.json`, `RESULT.md`, and `ROOT-RECEIVING-232950.json` are cited by that receipt and are not in that commit tree. Behavior-equivalent prior `838abb50ec9ddac9e93d39d9f8c91f1f3ca44a35` differs in tests, fixtures, and the package test command.

## Amendment defects

Each defect was reproduced failing-first at `2db5dcea` before the repair. Log: `evidence/amend1-failing-first.txt` (10 tests, 2 passed, 8 failed).

Passed before the repair:

- `D1 positive control counts only a strictly later distinct settlement`
- `D2 MCP meta keeps the canonical contract and does not carry the HTTP extension`

Failed before the repair:

- `D1 reversed chronology is not a distinct later-task purchase`
- `D1 equal chronology is not a distinct later-task purchase`
- `D1 missing or malformed time stays chronology_unproven`
- `D1 duplicate and case-differing settlements are not distinct purchases`
- `D1 same-task retry with unproven time stays unknown`
- `D1 unproven chronology increases repeatUnknown and not purchases`
- `D2 a cold client discovers and submits the extension from the served link`
- `D4 a later qualified fact is reported and absence or a gap stays unknown`

D1. `purchaseShape` accepted any later row with a different id and a TX-shaped settlement. It did not compare `requestStartedAt` / `responseFinishedAt`, and it did not require a different settlement effect. An earlier row, a same-instant row, or a second row of the same settlement could become `distinct_later_task_purchase`.

D2. The paid response Link pointed at `GET /commerce/caller-result-feedback`, and that GET returned only `callerResultFeedbackPublicContract()`. A cold client could not learn `retainedUse`, `nextTask`, `originLabel`, `tenant`, `priorBinding`, `decline`, or `x-samedaydesk-prior-caller-result`.

D3. `route/ROOT-SERVER-MOUNT.patch` matched a checkable diff and was not applied, so the owned tests exercised a stand-in app.

D4 is a source-inspection finding, not an executed exploit. Runtime reports hardcoded this run's QA receipt: `outsideUsefulAnswerArrived: false`, `hJoin` pending and not run, `outsideCustomerCount: null` as if it were a measured zero, `E08_USEFUL_WORK: false`, and the blind spot `no_outside_useful_answer_in_this_run`. A later qualified observation would still have printed those constants.

## What this package does

`createUsefulServiceObservation` delegates a body that contains only `disposition` and optional `reasonCategory` to `createCallerResultFeedbackService.submit` with the caller's original bytes. Extension fields (`retainedUse`, `nextTask`, `originLabel`, `tenant`, `sourceSha`, `priorBinding`, `decline`) append one row to `useful-service-observation.ndjson` in the same data directory, under the existing `admitCommerceJournal` gate. The canonical statement is still written only by the feedback service. Callers who ignore the handback keep the paid JSON body, the previous GET keys, price, payment, signer authority, and entitled retrieval.

The same GET keeps every `callerResultFeedbackPublicContract()` key and value and adds one field, `usefulServiceObservation`. That field names the schema, the extension fields and enums, the prior-capability header, the byte limit, `optional: true`, `charged: false`, and usefulness `unknown`. There is no new path and no second writer.

MCP `_meta` does not carry that field. `attachMcpCallerResultFeedback` refuses a published meta document that contains `http://`, `https://`, or `CALLER_RESULT_FEEDBACK_PATH`. The HTTP description includes that path, so copying it into MCP meta would drop the existing capability. `mcp-server.mjs` and `caller-result-feedback.mjs` were not edited. `tools/list` does not publish the extension. The paid MCP tool result still uses `callerResultFeedback.submitMcp`.

Observed delivery is read from the existing paid-evidence and validation journals. A caller declaration is stored separately from that observation.

A later purchase counts only when both of these hold:

- Chronology is proven. All four timestamps match the historical ISO instant (`YYYY-MM-DDTHH:mm:ss.sssZ` or without milliseconds), each row's `responseFinishedAt` is at or after its own `requestStartedAt`, and `later.requestStartedAt` is strictly after `prior.responseFinishedAt`. Equal is not after.
- The rows are distinct canonical settlement effects. The key is the lower-cased `settlementReference`. A usable effect is exactly one paid row with that key. A second id, or a hex-case difference, collapses to one effect and is `settlement_effect_ambiguous`, which is not distinct.

Reversed or equal chronology is `chronology_not_after`: class `unknown`, `countsAsRepeatPurchase` false. It is not the token `no_repeat`. Missing, malformed, or finish-before-start time is `chronology_unproven`. That reason is never `distinct_later_task_purchase`, never an outside repeat, and never `no_repeat`. The same rule applies to `same_task_retry`: the same task ref, the same request digest, or a `same_task` relation classifies as a retry only after chronology and a distinct settlement effect are proven. Unproven time stays `chronology_unproven`.

When no candidate is proven, the report prefers `chronology_unproven`, then `settlement_effect_ambiguous`, then `chronology_not_after`, otherwise `repeat_not_observed`. A proven purchase is not erased by a different row that is unproven. Rows that fail `isHistoricalV1PaidSuccess` stay in the historical read as `non_historical` and are surfaced as unproven paids, so missing time is not dropped as `later_result_missing`.

Other classes stay as before:

- `entitled_reuse` is free retrieval of a passed validation, with no later settlement.
- `pseudonym_continuity` is matched continuity and is not independent control and not a purchase.
- A declaration without a later settled row stays `unknown`.

Missing capture, duplicate capture, and `windowCoverage: gap` stay `unknown` (`source_gap_stays_unknown` on the repeat). They are not failure and not a zero customer count. `rates` stays null. `outsideCustomerCount` stays null because a label or a pseudonym is not an identity. The reason is `no_identity_assumption`. Null is not zero.

Runtime qualification is read from `observed_fact` rows in the observation journal (`outside_useful_answer`, `h_join`, `e08_useful_work`), with `evidence: "observed"`, `synthetic !== true`, and named `recordId` sources. The value is `true`, `false` only with that qualified evidence, or `unknown`. Absence or a gap is `unknown`, never `false` and never a zero count. Conflicting facts stay `unknown`. An `external_unknown` label is `label_is_not_outsider`, not an arrived outsider. `hJoin.ran` is `true` or `false` only when an H result is present in the inputs; otherwise `ran` is `"unknown"`. Callers cannot self-declare these facts on the HTTP extension. The submit acknowledgement leaves `e08UsefulWork` as `"unknown"`. The report and cold replay derive the value from the rows they read.

This run's QA receipt, which is not a runtime constant, is in `candidate/release-candidate.json` under `receipt`: no qualified outside answer was in the journals exercised here, H was not run, and E08 async delivery was not built.

Wrong source, receipt, result, caller, and tenant are refused. A tampered capability is refused. An identical extension replays. Decline is optional and is not `not_useful`. A second tenant cannot overwrite another tenant's extension row. Restart is a new process handle on the same directory.

## Consumed inputs

| Input | Commit | Tree | Status |
| --- | --- | --- | --- |
| x402-url-extractor serving source | `82a51274e7dc7a7600b90f1317a6be6b28442592` | `f95a351e763cc903f7caa4159788cb4ceacddf91` | received |
| epistemedeus/samedaydesk `tools/result-reuse`, `tools/recurring-job-recipes` | `d8cea059213e06d2f263be67f82e498f8052a50f` | `98f0b9f601fdebf40c1e2f7914c8eb21c08aa2d5` | read-only |
| Neo `experiments/ae14-task-economics/` | `75312c3ac1590dbf913ae516b7fb76c9db6e74d9` | `2919c38894e9e87c056b5006860d87fb7384601f` | qualified |
| Neo `experiments/ae14-task-native-acquisition/` | `272bce6b5c6aec144c9e0eda7438967d5ff67f7a` | `19ac899bdedc1f3f787664e530d10d3cf4171561` | qualified |
| Neo `experiments/contributor-network-measurement-227900/` | `301711b8eac39cdeda16466bc72e3d379fd91486` | repo `a4f6304496bb97fb817edc5c93eb564d78e26cc1`, path `5ad6d5d77ff12a802f93fb80d7be7e2938aecfd0` | contract only, not ingested |
| Neo E18 `codex/ae14-e18-market-attribution-consumer` | `11871c33e294ad6acecd0fa7049d9104d9152723` | `f232a170736629e083ffc31337b545fd9925fc79` | pending-join |
| E08 `experiments/ae14-async-delivery/` | `d5c5ab3606ba2f79d5bdfec6afb347b566966573` | `a6356b16a27ae52cdea92043b79378a6e31925e8` | contract only; async delivery not built |
| pilot portfolio / composition / H matrix | `7428845d6429b78573801ee8035953e26c610eaf` / `2286f21057106354a01d7b3db5677fe2d354430d` / `ecf78d29c2c592dd03b5daef4eeba2f29772c8ae` | staged by `stage-native-source.sh` at `c3436e8647bd111a04359193c55f2c97be77e180` | read |

`git ls-remote` on 2026-10-15 for `epistemedeus/neomorphic-io` `refs/heads/codex/ae14-e18-market-attribution-consumer` returned `11871c33e294ad6acecd0fa7049d9104d9152723`. Log: `evidence/amend1-e18-ls-remote.txt`. No Root receipt names that head, so E18 stays pending-join. Measurement `227900` was not ingested. `measurement.ingested` is `"unknown"` with reason `measurement_journal_not_read`.

Root's pins named for this amendment, on pilot `codex/agent-economy-input-20261014`: `312a5e72a3afa10cf4d8330c86f2ee3a6bd46318` (`overview/STATE.md`, `overview/self-evaluations/2026-10-14-agent-economy/`) and `40babb5657c661cd223cd65d06bbcc747d291bb3` (`overview/self-evaluations/2026-10-14-agent-economy/ROOT-RECEIVING-BATCH4.md`). GitHub compare reports `40babb56` as one commit ahead of `312a5e72`. The same branch's `git ls-remote` tip on this date is `a82db843b6fd419ac853176224f96839747c926e`, eight commits ahead of `40babb56`. This package does not treat that tip as a new Root receipt. Root keeps live money, deployment, and publication.

H was not run. Quote, fee, acceptance, expiry, receipt reuse, tenant and authority refusal, recovery, and legacy terms `221400` / `234100` are unchanged by this package, so a later H harness can join the serving path. With no H result in the inputs, runtime `hJoin.ran` is `"unknown"`. The receipt records that H was not run.

## Tests

Failing-first, then the repair. The same test names now pass inside the owned run.

Owned, against the pinned handler, the existing observation port, and the branch server:

`node --test --test-concurrency=1 experiments/ae14-useful-service-observation/test/*.test.mjs`  
21 passed, 0 failed. Log: `evidence/amend1-owned-tests.txt`.

That run includes the D1 chronology cases (reversed, equal, missing, malformed, duplicate and case-differing settlement, positive control, unproven same-task retry, and the `repeatUnknown` tally), the D2 cold-client discovery submit, the D2 MCP characterization, the D4 qualified and unknown report, and `D3 the branch server discovers, accepts, replays, and restarts the extension`.

The D3 test is loopback only. Settlement class is `simulated`. The facilitator listens on `127.0.0.1`. `paidProbe` is false. It follows `Link rel="useful-service-observation"`, submits a body built from the served contract, checks old GET keys, replays one observation row, compares a canonical body with `createCallerResultFeedbackService.submit`, checks that `POST /mcp` `tools/list` does not publish the extension, and restarts a new process on the same data directory.

Inherited, unchanged:

`npm run test:nonlive`  
194 passed, 0 failed. Log: `evidence/amend1-nonlive.txt`.

`node --test http-delivery-evidence/test/store.test.mjs http-delivery-evidence/test/contract.test.mjs`  
13 passed, 0 failed. Log: `evidence/amend1-store-contract.txt`.

`node --test caller-result-feedback.http.test.mjs`  
2 passed, 0 failed, on this branch's server. Log: `evidence/amend1-inherited-http.txt`. The file was not edited. These two tests are not part of the 228, so the total is not counted twice. Settlement in that file is the existing simulated loopback facilitator. `paidProbe` stays false.

The first-outcome route comparison and cold replay remain in `evidence/route-comparison.json` and `evidence/cold-replay.txt`. They describe the pre-amendment constants and are not the amendment counts.

Mount: `git diff 82a51274e7dc7a7600b90f1317a6be6b28442592 -- server.js commerce-events.mjs` is 2 files changed, 12 insertions, 5 deletions. `commerce-events.mjs` replaces the paid-response import and call with `decoratePaidResponse`. `server.js` constructs the observation on the existing feedback service, delegates POST, passes `x-samedaydesk-prior-caller-result`, and serves `usefulServiceObservationPublicContract()` from the existing GET. The patch file equals that diff. `git apply --check` fails because the working tree already contains it. `git apply --reverse --check` exits 0. Log: `evidence/amend1-serving-diff.txt`.

Release candidate: `node experiments/ae14-useful-service-observation/bin/export-candidate.mjs` writes `candidate/release-candidate.json`. `machineOnly` true, `appliedToServing` `"branch_only"`, `deployment` `not_performed`, `paidProbe` false, `livePurchase` false, `humanCopyChange` false. Runtime reports are `derived_from_observations`. The QA facts live under `receipt`.

## Limits

No qualified outside useful answer was present in the journals exercised for the receipt. No production settlement was reclassified. Full-window coverage remains `unknown_for_full_window`, so this package publishes no rate and no customer denominator. E18 measurement ingest and the H harness are pending-join. E08 async delivery was not built. The repository `npm test` script was not run; it includes HTTP journeys outside this no-paid-probe boundary. No deployment, live purchase, signer use, or default-branch merge was performed.
