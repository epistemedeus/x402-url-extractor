# Sol395 causal task receiving

Received339's completed projection, reproduced its retained checks, and fixed
one owned defect: the native receipt-retention hook runs before HTTP finish,
but339 used finish time as retention's earliest admissible timestamp. The
projection now preserves the existing v3 `durationMs` and admits retention
within that measured response interval. Missing duration keeps the previous
finish-time bound. Causal task/operation ownership, settlement requirements and
all original retained reports retain their behavior.

Exact tested source checkpoint:
`b24ece44464302680df93639026ff103126da41a`, on
`codex/sol-causal-task-measurement-receiving-100395`, parent
`91fbf94786658c96c89f94e0f88b03caefd951b0`. The native enrolled Git account is
`epistemedeus`. The receiving-artifact commit on that branch contains this
receipt; the source checkpoint is the archive's provenance pin. No history was
force-written. Only339's projection subtree and this receiving directory change.
All 17 upstream source pins, the vendored causal/economics authority,339's
original archive and its two retained reports remain exact.

Actual checks ran on the supplied remote Cursor Cloud VM, Node 22.22.2. Full
commands, counts, source/harness hashes and TAP hashes are in
[evidence/validation.json](evidence/validation.json).

| Executed check | Pass | Fail |
| --- | ---: | ---: |
| Received current projection before edits | 15 | 0 |
| Received journal/economics before edits | 208 | 0 |
| Publication after isolated httpx setup | 31 | 0 |
| Clean native Git receiving: projection + native ports | 26 | 0 |
| Clean receiving: retained journal/economics | 208 | 0 |
| Clean receiving: publication | 31 | 0 |

The first publication run passed 30/31; the Python consumer lacked `httpx`.
Installing the already documented 0.28.1 into an isolated target directory
resolved it. Both logs remain. The final 26 include 17 projection checks and 9
native receiving checks. Replaying the identical final native harness against
unmodified91fbf94 failed three timing-dependent subtests plus their parent;
the journal check passed. That executed failure is retained in
[the regression log](evidence/logs/unfixed-native-final-harness.tap) and
[the before observation](evidence/before/native-observation.json).

Two separate Node processes ran caller-owned receipt attempts against the same
isolated durable journals through the actual telemetry mint, causal proof,
HTTP finish, paid-retention hook, runtime reconciliation, grant reads and
withdrawal ports. CallerA used the executed normalization to obtain fee 42000 wei;
caller B received and later read the operation-contract `not_found` negative.
B read A's grant after process restart, withdrew it, and observed the native
`revoked` refusal. Current B remains active; A's earlier authorized reads stay
historical and its usefulness is no longer current. No event/task id was
inferred from a label, wallet, digest, UA or 200. The returned native proof
and both durable causal sides establish the joins.

The receipt route remains `unsupported_target` in the generic schema
validator. Its journal settlement port still refuses `unbound_artifact`;
the existing receipt-retention contract and exact runtime ledger provide its
separate delivery/settlement authority. Two additional native schema-delivery
operations exercise the journal's actual settlement append, rotation, file
and directory fsync, lost acknowledgement and restart. A lost ACK after one
physical append returns `duplicate`; restart refuses `duplicate_settlement`.
A failure before bytes are written remains `write_outcome_unknown` until an
explicit later retest. Both retained generations contain one physical
settlement each, mode 0600. The injection counters in that receipt apply to the
lost-ACK attempt; the second operation is verified by physical readback.

Decision-changing negatives are retained in
[evidence/decision-negatives.json](evidence/decision-negatives.json): mismatched
read task, partial attempts, conflicting settlement/usefulness, caller success
assertion, retention outside the response interval, and scope/tenant/time
drift. Native grant probes also refuse another tenant, changed method and
expiry. All retained positive and negative checks pass after the owned fix.

One actual useful measurement gap remains. An unpaid native receipt execution
gave the caller its required 42000 wei normalized fee without settlement. The
existing retention port refused `settlement_unverified`; the native forward
producer emitted the call without valid receipt delivery/usefulness evidence.
The projection correctly reports the attempt and keeps retained usefulness,
later use and settlement unknown. Root needs an authorized causal observation
for useful free results before measuring that population. Relabeling the
response as paid, asserting success or adding a settlement would invent
authority. See [the free retained cut](evidence/free-result.retained.json).

The separate licensed 0.1.1 consumer contains 18 members, 29492 bytes:

- Archive SHA-256: `6cec3a3f4b3f51f485f1bf55688305b83a9fb41bbc34b31f30f6a774ef100cbb`
- Source member-tree digest: `a3784a1118a97385f8fc4aa80b0514f7c4d4088ca539e9496c509fb478feaa8f`
- [Archive](consumer/public/bytes/task-demand-100339/0.1.1/task-demand-100339-0.1.1.tar.gz), [manifest](consumer/public/manifest.json), [provenance](consumer/public/bytes/task-demand-100339/0.1.1/provenance.json)

The existing acquisition engine actually served and verified loopback GET/HEAD
bytes, license, notice and provenance. Fresh dependency-free consumers replayed
all three native retained cuts, a fresh second-generation query and changed
evidence. The original 0.1.0 archive refuses the new duration evidence with
`replay_mismatch`; its old retained reports still replay identically in 0.1.1.
The [cold receipt](evidence/cold-receiving.json) separates acquired source from
hosting, customers and payment. Source bundle verification and applying the
exported patch on the exact base reproduced source tree
`0b56afd7176061dc7de4058ed7f7d9e1771ed950` exactly.

Limitations: payment responses and RPC transfer readbacks are explicit fixtures;
HTTP execution, journals, fsync and grant operations are actual isolated owner
QA. No production journal was read/enrolled, no outside customer or production
hosting is established, and recognized revenue is 0. Offline exports declare
coverage/authenticity; the projection cannot authenticate them independently.
Journal325 remains one-process admission with two retained generations and
its documented filesystem durability limit. No shared producer/journal/server
patch is applied, and no new meter, identity store, payment, key, model child,
merge or deployment was created.

Root's next adoption is [ROOT-ADOPTION.md](ROOT-ADOPTION.md): compose this exact
reviewed projection with348's final consumer using caller-authorized bounded
native cuts. No work here depends on another active worker.
