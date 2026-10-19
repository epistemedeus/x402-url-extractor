ROOT576 paid extract observation, 2026-10-19 UTC

No runtime measurement defect reproduced. Export tests and this report only;
leave serving behavior and stronger lineage rules unchanged. The new actual paid
GET is positive technical delivery evidence. Its customer purpose, usefulness,
independence and revenue classification remain unknown. Root receives this export
before any integration; nothing was deployed.

Writer starts at `b6b9735e37d89109754ffbf43a4a3fa85e95d92d`, runtime 1.23.53,
on `codex/root576-paid-extract-observation`, isolated checkout
`/home/ubuntu/ae14-work/root576-paid-extract-observation`. Execution host reports
`cursor`, Node v22.14.0. Enrolled run record declares native `gpt-6.1-sol/high`;
no additional inference session or agent was launched. Pilot context read
separately from `codex/ae18-sol-launch-20261015` at
`77a02910a0f9b1e54eb078c140e39266d147a8ba`: AGENTS, STATE and execution plan.
STATE's linked October13 handoff is absent at that ref; current user observations
supply the newer serving facts. Other writers and release families are untouched.

Evidence populations and limits:

| Evidence | What is established | Limit |
| --- | --- | --- |
| Root570 stored public GET, HTTP200, generated 03:45:37.465Z; read here without refetch | Complete one-day meter, integrity ok; 411 external actor identifiers, 85 constructed-request identifiers, one paid-success actor, zero repeat paid actors | Pseudonymous overlapping populations; no clean growth delta or customer identity |
| Same retained meter | Lifetime 63 settlements / 1172000 atoms versus supplied prior 62 / 1167000 | One additional 5000-atom settlement; no newly recognized revenue or profit |
| Root's supplied 03:48:15 Railway receiver observation, not rerun here | One row at 02:32:40.004Z, GET `/extract`, x402, 5000 atoms, unclassified; `exact_join`, one HTTP attachment, full bounded capture, validator pass, `http_v1` | Coverage `unknown_for_full_window`, exhaustive false; 62 rows withheld outside, zero rejected lines/violations. Separate meter completeness cannot upgrade this receiver |
| Same supplied row | Outcome absent, no task reference, caller declaration absent, usefulness unknown, customer fields null | Missing declaration is unknown, not refusal; complete server response is not client observation |
| Stored meter lineage | One admitted in-window reference, one `referenceMatchedIncomplete`, zero exact/conflicting joins, zero missing/unadmitted event references; payer continuity `matched_request_pseudonym`: 1 | Actor correspondence unproven; canonicalChainReplay false; customerAttribution null |
| Stored meter's reference-intersection cohort | One validated response; feedback/task class absent; continuation `transmitted`: 1 | Capability transmission does not prove client observation, declaration or useful acceptance |

Source trace, all relative to the serving source above:

1. `commerce-events.mjs:middleware` derives request digests from exact method,
   target and raw bytes; stores a keyed credential fingerprint and payer
   pseudonym, not raw credentials/addresses. Runtime protocol selection must
   match before paid evidence can be created. A header or HTTP200 alone is not
   canonical chain proof.
2. `capturePaidEvidenceResponseDigest` wraps write/end, hashes the full body and
   copies at most 10 MiB for supported targets. Reused buffers cannot change the
   retained prefix. HEAD/no-body statuses exclude body bytes. Its finalizer
   requires end and rejects synchronous write/end errors. Middleware invokes it
   only on response `finish`, for `paid_success`. Close/error/abort before finish
   does not enter that successful capture path. Finish means server completion,
   not delivery to the remote application. Close after finish cannot establish
   refusal or undo already observed server completion. No missing error marker
   authorizes inferring why a response is absent.
3. `buildHttpDeliveryValidationRecord` binds the owning exported schemas through
   `bindMerchantHttpDeliveryContracts`. `/extract` uses
   `extractMcpOutputSchema.safeParse`; generated fixtures are not its installed
   authority. `recordFromObservedResponse` binds sealed digest/length/bytes;
   schema, upstream failure, retained-length and truncation checks distinguish
   full capture, partial and invalid. No raw body is persisted in its validation
   row. Historical paid-success v1 remains `not_checked`; the attached validation
   supplies separate current technical evidence.
4. Telemetry's serialized enqueue appends commerce event, v1 evidence and
   validation to existing stores. Journal admission coordinates in-process
   producers; it does not make these files a cross-process transaction. Write
   failure or absent finish can still withhold evidence and cannot be backfilled
   from a quote. The supplied joined row positively has the required evidence.
5. `reconcileCommerceSettlementEvents` obtains receipt and block, requires a
   successful transaction and exactly one positive canonical-token transfer to
   the configured treasury, checks supplied response facts and keyed payer
   continuity, then produces the existing settlement row. It never sums multiple
   incoming transfers. `readCommerceSettlementAdmission` deduplicates references
   and binds the accepted cut. These source rules describe installed behavior;
   they are not our execution of the new transfer's chain replay.
6. `ordinary-delivery-join.mjs` matches admitted source event ID, reference,
   protocol, timestamp, route, request/response digests and attached validation.
   Complete bounded capture plus pass yields `exact_join`. It takes the amount
   from admitted settlement; it does not require an amount in the HTTP proof.
   `outcomeFor` separately looks for an outcome-forward record with stage
   `delivery`. `buildHttpFinishForwardRecords` returns none without an authorized
   outcome claim. An ordinary paid response can therefore have both an exact
   technical join and `outcomeDelivery: absent`, without missing HTTP evidence.
7. `server.js:/v0/commerce-demand.json` combines event snapshot, admitted status
   and prospective journal through private WeakMap associations.
   `commerce-payment-evidence.mjs:classifyReference` separately requires reference,
   route, protocol, equal event timestamp and equal amount on BOTH event and
   admission. A null comparison is incomplete, a differing value is conflict.
   `decodeResponseSettlement` reads amount only from the successful response
   proof; standard x402 success/transaction/network proofs can omit it. The
   request's quoted/authorized amount is deliberately not settlement evidence.
   The fixture reproduces a null event amount and an independently admitted
   5000-atom transfer: exact HTTP join, incomplete lineage, absent outcome.
   This is an explanatory reproducer, not a private read proving that the actual
   event's missing field was amount. Root's narrow field read below resolves it.

The meter's prospective cohort also retains validated technical evidence. The
stored prospective header's sourceVersion 1.23.52 / captureVersion
`prospective_delivery_v1` describes its original capture baseline, not a failed
1.23.53 deployment. Preserve that header, earlier v1 files, omitted transmission
fields and old unknowns. No reason was found to alter an authoritative producer,
borrow payer identity from references, weaken lineage, or add another journal.

Executed focused verification, all on this VM with fixture payments/RPC only:

| Command | Final result |
| --- | --- |
| `node --test root576-paid-extract-observation.test.mjs` | 7/7 pass |
| `node --test --test-concurrency=1 http-delivery-evidence/test/contract.test.mjs http-delivery-evidence/test/store.test.mjs http-delivery-evidence/test/capture.test.mjs http-delivery-evidence.http.test.mjs ordinary-delivery-join.test.mjs commerce-payment-evidence.test.mjs commerce-settlement-reconciler.test.mjs paid-extraction-continuation.send-boundary.test.mjs idempotency-replay.test.mjs` | 129/129 pass |
| `node --test --test-concurrency=1 commerce-prospective-delivery.test.mjs` | 13/13 pass |

149 distinct final tests pass, zero failures/skips. New seven cases cover the
combined observed shape, response amount/known-owner policy, amount conflict,
schema-invalid HTTP200, upstream truncation, missing-end/synchronous send errors,
and an application-lost GET recovered from the persisted journal after restart
without another handler execution. The last case uses a fake response sink and
does not claim a particular network loss sequence. Existing actual loopback HTTP
finish/partial/socket-destroy/client-abort controls complement it; mounted full
server tests use a fake facilitator and controlled source pages. Existing
prospective tests recover late capture after unknown/no_response while preserving
the first clock, and retain evidence after raw deletion. No fixture is this
event's chain replay or evidence of outside client recovery. Dependencies installed
with `npm ci --ignore-scripts --no-audit --no-fund`; no build. TAP receipts remain
private in `/tmp/root576-{shape,base,prospective}-tests.tap`.

Exact remaining Root read, through its existing Railway SSH route in the serving
app directory; do not invoke the paid endpoint, start a server, or run the mutable
reconciler loop. Existing environment values stay inside Root's private process:

```js
const at = "2026-10-19T02:32:40.004Z";
const dataDir = process.env.COMMERCE_DATA_DIR || `${process.cwd()}/data`;
const joined = await receiveOrdinaryDeliveryJoin({
  dataDir, windowStart: at, windowEnd: at,
  coverage: "unknown_for_full_window",
  sourceSha: "b6b9735e37d89109754ffbf43a4a3fa85e95d92d",
  includeLocalIds: true,
});
```

Import that existing function from `./ordinary-delivery-join.mjs`. Reconfirm the
serving source using Root's existing release read; `sourceSha` above is a label,
not self-verification. Require one exact `/extract` row and use its private
`local.sourceEventId` / `local.settlementReference` to select just that commerce
event from the current/rotated files. Retain only its id, ts, route, result,
paymentProtocol, paymentActor, settlementReference, settlementAmountAtomic,
settlementNetwork and settlementCurrency. Compare amount presence/equality and
the other three lineage fields with that admitted row. Do not export request
headers, URL, body, user agent or network actor material.

For the canonical replay, use the existing Base client configuration
(`MORPHO_BASE_RPC_URLS`, same fallback/timeout as
`createCommerceSettlementReconciler`), and existing server payee configuration.
Exactly two successful RPC reads suffice: `client.getTransactionReceipt({ hash:
reference })`, then `client.getBlock({ blockNumber: receipt.blockNumber })`.
Require success, canonical block hash equal to receipt.blockHash, non-removed
matching log, exactly one canonical `BASE_USDC` Transfer to configured payee,
amount 5000, and its transaction hash/logIndex. Keep the private tuple
`(chainId, blockNumber, blockHash, transactionHash, logIndex, token, from, payee,
amountAtomic, blockTimestamp)`; do not substitute receipt.from for Transfer.from.
The existing reconciler does not persist logIndex/blockHash, so the admitted row
alone is insufficient for this stronger replay receipt.

Replay the selected event in memory with the existing function (import from
`./commerce-settlement-reconciler.mjs`), supplying a client backed by those two
already-read results:

```js
await reconcileCommerceSettlementEvents(JSON.stringify(selectedEvent), "", {
  actorSecret: process.env.COMMERCE_ACTOR_SECRET,
  payerClasses: process.env.COMMERCE_PAYER_CLASSES || "",
  treasury: configuredServingPayee,
  settlementEvidenceSince: process.env.COMMERCE_SETTLEMENT_EVIDENCE_SINCE,
  client: {
    getTransactionReceipt: async () => receipt,
    getBlock: async () => block,
  },
});
```

The empty ledger argument avoids skipping this already-admitted reference;
this pure call writes nothing. Require no issues and one matching 5000-atom row.
Its payer-continuity check compares the Transfer.from HMAC with the stored request
pseudonym using the existing secret, and its class uses the existing configured
payer policy. A positive known-owner match can classify that activity; no match
remains unclassified, not proven independent. If additional known owner activity
is recorded outside that policy, Root compares only those already-held records
privately; absence of a match is not proof of an outside buyer. Export only
sanitized replay/continuity/known-owner-match results and a private-receipt digest.
No credential retrieval, new credential, owner contact or production write is
needed. This read/replay was not performed by this writer.

The actual call bought one bounded no-JavaScript public-URL extraction response:
structured page metadata and text excerpt under the existing capture contract,
for an admitted 5000 atoms. It did not establish the caller's underlying task or
whether the result saved work. Observed: paid GET, technical capture/pass,
unclassified settlement, a silent transmitted continuation opportunity, and no
repeat paid actor in this complete meter window. Unknown: client observation,
task purpose, acquisition cause (meter discovery kind `none` is unattributed),
useful acceptance, independence, natural repeat, effort saved and marginal cost.
No numeric profit, token ROI, buyer identity or new recognized income follows.

Next product-changing observation is a result-bound useful/not-useful declaration
from this actual caller through the existing continuation, ideally with its task
class; it would identify fit or a concrete correction. Missing feedback remains
unknown. Root's private replay first determines whether the payment was known
owner activity. Preserve this paid technical success and consume a naturally
arriving continuation/repeat through the installed path; do not buy another probe,
message a customer or expand the platform to manufacture that observation.

Export scope: this report and `root576-paid-extract-observation.test.mjs` only.
No runtime source/config/capture version changed; no draft PR is warranted for a
runtime fix. Exact committed head/tree are returned with the branch export
receipt, avoiding a self-referential commit hash in this file.
