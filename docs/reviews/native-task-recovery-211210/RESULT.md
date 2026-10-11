# Native task recovery 211210 result

**Disposition: received.** A cold ordinary client recovers the same useful fixture receipt after a lost reply or a killed receipt call and a provider restart, with one verification and one settlement. Widening the current grant is refused. The unmounted full server still settles the same lost reply twice. That residual stays on `server.js` until Root applies the tested mount patch.

Pins checked before editing. Merchant candidate `3b5914cf0583bd92db9d9f5b2936f03bda09417f`, carrier tree `d60bb0ce97779c72eb7a997492b87ac2b7f512fc`, branch `codex/sol-structural-211200`. Executable source `18bd473162b2795b80ee9b98ef5731bdabad7072`, tree `fc086b705e1c7e8ce226110001ba1f089fbca87e`, parent `32267493d29ff1339c5199185d8231012daf0acd`, parent tree `24ce30d298a375e8b993ac29218b8540d1fb7de7`. Pilot context `8b68ef35107223f9098c629c5bf8a5b96b011edb`. The 211200 review directory is unchanged.

Product fix commit `306e3523f9687c35e575f812d3964ddf4ca296c7`, tree `d1446e744495912df231db7a914972d09cb342a9`. This review is the child of that commit on `cursor/pilot-211210-complete-task-recovery-receiving-702e`. The named successor branch is `codex/cursor-task-recovery-211210`. [Pins, hashes, and the run record](SOURCE.json).

Run `bc-90382a85-b84f-45c9-a660-87044b71adff` at https://cursor.com/agents/bc-90382a85-b84f-45c9-a660-87044b71adff. `run-info` recorded `originalModelName` `grok-4.7`, source `api`. The admission selected Cursor Grok 4.7, effort xhigh, 256k, Fast false. The run record has no effort, Fast, or `chargedCents` field, so those three stay unknown.

Runtime is SHA-verified Node v22.23.3 (`df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de` for `node-v22.23.3-linux-x64.tar.xz`). Python httpx 0.28.1 was installed only under `/tmp/native-task-recovery-211210-runtime/python-deps`. The system interpreter still raises `ModuleNotFoundError: No module named 'httpx'`. The owning acquisition test was left unchanged and run with `PYTHONPATH`.

## Cold receipt

Disposable loopback only. [Harness](cold-receipt.mjs) and [receipt](evidence/cold-receipt.json).

| Seam | Recovered output | Direct route | Attempts |
| --- | --- | --- | --- |
| Lost `opportunity_preflight` reply, provider restarted, fresh CLI resume | `decision` `attempt`, `expectedSurplusUsd` 7, deep-equal to `opportunityPreflight(args)` | free `opportunityPreflight` | verify 1, settle 1, then `recover_paid_result` |
| CLI `SIGKILL` while `transaction_receipt` was inside the fixture delay, provider restarted, fresh CLI resume | `decision` `found`, `blockTimestamp` null, finding `block_timestamp_unavailable`, deep-equal to `transactionReceipt` on the same fixture client | maintained `transactionReceipt` | verify 1, settle 1, then `recover_paid_result` |

A wider `maxAtomic` on the current grant refused before another lookup. `newPaymentPermitted` is false. Stopped and refunded stay `unknown`. `usefulness` stays `unknown`. `paidLiveCalls` is 0. These comparisons are owner QA on fixtures. They do not establish price, speed, demand, customers, or revenue.

The same focused journal, caller, MCP recovery, and HTTP replay list passed again: 56 tests, exit 0. That list already covers malformed retained output, failed persistence, retention expiry, concurrent callers, and cancellation.

## Findings closed here

1. **Unmounted lost reply settles twice.** `reproduce.mjs` on the real `server.js` exited 1: verify 2, settle 2, journal entries 0, `2 !== 1`. The disposable copy with the proposed `nativeRecovery` line exited 0: verify 1, settle 1, one journal result, decision `attempt`. The candidate recovery source already had this behavior. This receiving reproduced it and left the owning `server.js` unmounted.

2. **Default-concurrency cold parent.** Isolated `caller-result-client.cold.test.mjs` passes. Parallel copies failed with `consumer_exited_early pending_bound` (4 of 6, then 4 of 8) before the fix. The paid capture is scheduled 8ms after the MCP response so a slow append cannot delay that response. A concurrent `report_caller_result` read the journal in that gap and got `missing_capture`, which the cold consumer treats as `pending_bound`. `submitMcp` now re-reads only `missing_capture` for 250ms and still refuses when the capture never appears. The paid response is still sent before the append. After the fix, eight parallel cold tests passed, and unmodified `npm test` passed. The regression is the last test in `mcp-caller-result.test.mjs`.

3. **Missing httpx.** Reproduced as `ModuleNotFoundError` on system Python. The suite passes when `PYTHONPATH` points at httpx 0.28.1. No dependency manifest or test skip was added.

4. **Shared mount is coherent once live tool-list counts move by one.** `idempotencyReplay` already exists before the single `mountMcp` call. `toolCount` excludes free tools, so the existing "N paid tools" startup lines stay the same. `tools/list` gains `recover_paid_result`. A disposable mount with no count edit failed `extract-batch.http.test.mjs` at `26 !== 25`. After `25→26`, `26→27`, and `27→28`, the flag-off batch test, the mounted lockfile test, and the lockfile-plus-batch test each passed. `listMcpToolMetadata()` stays the static catalog and does not list this runtime-only tool. `git apply --check` passed for [SHARED-MOUNT.patch](SHARED-MOUNT.patch). The patch also appends `mcp-task-recovery.test.mjs` and `caller-result-client/test/recovery.test.mjs` to the normal `test` script. Owning `server.js` and `package.json` are unchanged in this branch.

## Gates on the unmounted tree

Unmodified `docs/reviews/native-task-recovery-211200/run-normal.mjs` at Node 22.23.3, one worker: pretest 18 pass, exit 0; normal test 1125 tests, 1121 pass, 0 fail, 4 skip, exit 0, `duration_ms` 287668.210795. The extra pass against the 211200 count of 1120 is the late-capture regression. `npm run test:nonlive`: 194 pass, exit 0. Unmodified `npm test` at default concurrency: pretest 18 pass; test 1121 pass, 0 fail, 4 skip, exit 0, `duration_ms` 110457.940583. The normal suite rewrote `public-acquisition/loopback-profile.json` (`e9a6d955…` to `b7cdeb5a…`). Original bytes were restored. The generated bytes are [retained here](evidence/loopback-profile.generated.json).

Historical 211200 failures stay in that review: Node 22.14 normal 1111 pass / 4 fail / 4 skip, and Node 22.23 default normal 1113 pass / 2 fail / 4 skip. This receiving reproduced the two Node 22.23 default failures (cold parent and absent httpx) and closed the cold-parent source defect. The httpx gap remains environmental.

## Root next action

Apply `docs/reviews/native-task-recovery-211210/SHARED-MOUNT.patch` when releasing the shared mount. Then run the owning normal entrypoint once on that tree. Leave production deployment, default-branch merge, and the published caller 0.1.0 archive untouched. `loadGrant` remains an application authority input. Advertised `endpointUrl` is `${PUBLIC_URL}/mcp`; a client dialing a different URL will refuse the scope, which is the intended binding.

No new database, task authority, or generic platform. No remaining incompatible redesign. Uncertain spend stays on the original reservation. Provider retention expiry and a cancel acknowledgement do not create a replacement payment.
