# Caller-owned free task observation

Owned scope: this directory only. Base is
`519645af3a2fa36f745d59f08aab4008776a4aa6`. Shared adoption changes are exported
as unapplied patches and tested only in disposable exact-source receiving.

The bridge joins an explicitly authorized native task and server-minted attempt
to the exact received receipt bytes. It separates delivery, a caller usefulness
assertion, an independently executed predicate, retention rights and later reads.
It uses the existing customer grant journal, metric kinds, read/revoke ports and
causal producer. Paid retention continues to require verified settlement.

The exported consumer takes bounded explicit cuts. Offline provenance is a
supplied export, not independently authenticated journal authority. No customer
identity, token savings, production enrollment, settlement or revenue follows
from useful free output.

From an extracted archive, Node 22 needs no installed dependencies:

```sh
node bin/free-task-observation.mjs query --bundle fixtures/after.bundle.json --retain /tmp/my-free-result.json
node bin/free-task-observation.mjs replay --receipt /tmp/my-free-result.json
node --test test/portable.test.mjs
```

The CLI accepts explicit JSON files or stdin and creates retained output with
exclusive mode0600. It refuses overwrite, symlinks, malformed/deep input and
silent stdin after its deadline. Default bounds are 1 MiB per input/output,
2 MiB summed source bytes, 4000 records, 12 source cuts, depth24 and 5 seconds.
Those are reused339 bounds, not a new meter.

Two fixed predicates are executable: `fee-total-wei` checks the fee against
gas used times effective gas price; `receipt-absence` establishes whether a
mined receipt was unavailable at the source check. A failure to execute or
reach the provider does not satisfy the absence predicate. An assertion without
a separately executed matching receipt remains unverified, even after reading
its retained artifact. A source change invalidates inherited useful output.

Root composition uses `createFreeTaskObservation` with explicitly injected
existing native authorization/proof, customer store, read/revoke, request
binding and bounded read-only cut/replay ports. `handleFreeTaskObservation`
adapts POST on the existing `current.json` resource and the existing retained
grant resource. `exposeAuthorizedCausalProof` exposes the native seal only for
an authenticated, task-bound opt-in receipt request. The three included Root
patches remain UNAPPLIED: scoped free response-digest capture, optional sharing
of the existing customer store, and optional observation-handler mounting.
No server.js or395 projection change is needed in this packet.

Free grants authorize read and withdrawal; sharing is refused unless separately
delegated. Retention is an opt-in right, independent of usefulness verification.
`settlementStatus` stays unknown, `paidValidDelivery` and `paymentPermitted` stay
false, and no free settlement row is written. The original paid entry point
still refuses `settlement_unverified`.

The customer journal's existing writes do not fsync. A read-back record can
reconcile a lost acknowledgment, but cannot recover a lost plaintext grant or
establish power-loss durability. Absence remains `write_outcome_unknown` with
no automatic retry. journal325's fsync/rename settlement guarantee stays
separate. Two retained generations and one writer process remain the limit;
cross-process exclusion is not established. Root must supply honest coverage
and current rights: missing predecessors, partial/torn cuts, expiry, withdrawal
and ambiguous grant ownership remain explicit.

Fixtures are stripped actual owner HTTP/journal runs with explicit fixture RPC
observations. They establish no independent customer, live chain truth or
production hosting. The separate direct receiver consumes exactly the same
stripped input without importing the projector. Repository RESULT.md and
HEAVY-IMPLEMENTATION-PLAN.md carry the executed evidence and next Root adoption.
