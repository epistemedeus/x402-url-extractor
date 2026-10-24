# ROOT5916 source handback

The merchant now retains bounded prepared HTTP output **before** facilitator settlement, in the existing bound replay record. It remains `pending`/`protected` and explicitly `unqualified` until the ordinary SDK completion path supplies its existing response proof. No installed effect or recovery of the original live body is claimed.

This continues native session `01a16d57-2ff0-7d93-95d6-846c6aa2393b`, Sol6.1/xhigh, on the original branch and clean predecessor `f4f2bba42e375a755631af105c311530c0b42247`. The immutable context, own-admission/claim, source and lifetime were joined before execution. All staged roles/full assignment and the public-safe finality JSON were received at frozen Pilot `f9352e9f5444debb7d2a9a4ec3e3f1bbad7e613a`. AGENTS is byte-identical to the already fully read original. Bindings/hashes are in `SOURCE-AND-ADMISSION.json`.

Checkpoint was written **10:41:36.206853 UTC**, before 10:45:32.669. The new SPEC's export horizon is 11:22:06.354; the predecessor horizon was not reused. No extra kill timer, model child, credit exception, renewal, runner receipt or financial/STATE edit.

## Demonstrated seam and repair

Installed x402 2.16.0 Express buffers the useful handler response, then calls settlement with `transportContext.responseBody/responseHeaders`. Its non-success, dropped/truncated reply and parse-failure branches discard that buffer. The previous merchant captures only the later response writes, so possible settlement can coexist with a durable marker and no retained useful body.

`server.js` registers the SDK's supported `onBeforeSettle` hook. `idempotency-replay.mjs` stores the exact buffered bytes, length, SHA256, status and only bounded Content-Type under `record.prepared`, with `qualification: "unqualified"`. Existing HMAC request/payment/authorization identity, key epoch, capacity, permissions and expiry remain authoritative. A storage/bounds/binding refusal uses the SDK's explicit abort result; a second dispatch check prevents settlement without preparation or an extant reservation. No handler/SDK/facilitator is reimplemented.

The existing settle wrapper still writes the possible-spend marker before dispatch. It records bounded stage/transport facts under the same record's `httpLifecycle`: verification, preparation, settlement attempted, reply classification and finish/close. A syntactically valid SDK-reported transaction is correlation evidence only. SDK non-success/HTTP error/transport failure remains unknown spend; no hook recovers it as success. On ordinary successful completion, existing proof/body replay replaces the unqualified copy and preserves lifecycle facts. A disconnected request may still settle; this change retains evidence rather than claiming cancellation.

No price, recipient, schema/offer extension, signer, timeout, facilitator, client, package/lock or Vibes/MPP containment change. Applies to x402 HTTP requests admitted into the existing replay namespace; it adds no new payment parser or public endpoint.

## Recovery/readback contract

The existing internal `lookup(exactBinding)` now returns the pending record for privileged in-process inspection. `record.prepared` is private evidence, never a replay hit or payment receipt. Normal HTTP/MCP pending consumers keep their unknown-outcome refusal; repeated, anonymous and wrong-bound requests receive no prepared bytes and initiate no new settlement. Existing completed responses retain their old replay rights.

`lookup` retains its existing write/prune behavior and expiry rights. It was used only on owned fixtures here, never the live original record. Root must preserve its original evidence with its supported read-only route. There is no automatic promotion/reconciliation API: later reconciliation needs separately verified exact request/credential/transaction evidence and authority. Chain settlement alone cannot qualify useful output. Legacy records lacking prepared bytes remain pending; no bytes are reconstructed or invented.

## Qualification

Run from the merchant worktree with the existing lock-installed SDK:

```sh
NODE_OPTIONS='--max-old-space-size=384 --import=./test/independent-recovery-preload.mjs' node --test --test-concurrency=1 test/prepared-http-result-retention.test.mjs idempotency-replay.test.mjs mcp-task-recovery.test.mjs replay-boundary.http.test.mjs
node --check idempotency-replay.mjs
node --check test/prepared-http-result-retention.test.mjs
git diff --cached --check
```

Final actual command: **exit 0, 54/54**, zero failed/cancelled/skipped, 49.975 seconds. This is 17 new controls plus 37 affected existing HTTP/MCP replay/recovery regressions, not 54 new cases or Root replay. The mounted regressions include actual merchant process restart; new controls restart the real Express/SDK server and journal against durable state. The old entire 7+120 diagnosis was not rerun.

New controls cover SDK success, non-success, HTTP 503, dropped/truncated/invalid reply after a separately modeled possible effect, late success and missing-reply disconnects, restart/readback, known verification refusal, preparation/marker/completion storage failures, oversize, old-record/key-generation refusal, expiry/capacity and wrong request/payer/credential/ID/amount/recipient. Stub possible effects are not chain transfers. No wallet/signing or live proof verification is executed.

`retention-before.log` records the corrected pre-fix baseline: exit 1, 1 passed/11 failed. Initial fixture cleanup rejected before closing its listener; only identified owned test child 905568 was terminated, original log retained, and cleanup fixed. First repair passed 12/12; expanded self-review then exposed one fixture migration racing its writer (15/16). Stopping that fixture before migration fixed it; 16/16 passed, then the added late-success control and final regressions passed 54/54. Intermediate failures remain adjacent; log blank-line trailing whitespace is normalized only for clean export.

## Remaining evidence and cleanup

Root's finalized 5000-atom transfer and exact-instance temporal pending record are supplied observations. Their cryptographic original-request join, original facilitator reply/in-memory stage, HTTP body/signed receipt and useful delivery remain unreceived. This prospective source repair cannot recover bytes already absent from the live store. The immutable client journal stays `settlement_unknown`; no original authorization was replayed or read.

All tests used loopback fixtures, fixed invalid synthetic authorization bytes and existing SDK. Network preload refuses external native sockets; no live payment/verify/settle/RPC, provider/account/config/deploy, mail, real credential or wallet action occurred. Serial execution and bounded test-parent heap stayed within the admitted 2097152 KiB job; `RESOURCE-SNAPSHOT.json` is a 321164 KiB quiescent aggregate snapshot, not a peak claim. Existing fixture children keep their own clean environments.

`CLEANUP-OBSERVATION.json` verifies the initial test PIDs absent, removes its one owned leftover fixture directory and finds no matching owned test nodes. Normal fixture servers/connections/temp files closed; no shared job was signalled. Canonical terminal/session/claim release and any installed effect are received separately by Root.
