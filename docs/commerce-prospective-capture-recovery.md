# Prospective capture recovery

The settlement reconciler owns this handoff inside its existing serialized
commerce-journal admission. Parent receipt validation, ledger records, amounts,
identities, deduplication and reconciliation scheduling remain the money path.
Capture failures do not turn a successful parent append into a money failure.

Before appending producer-returned new records, the owner best-effort persists
`commerce-prospective-capture-pending.json`. Each batch binds to the exact
pre-append ledger byte count/digest and parent admission cut. Each candidate
stores only its evidence key, full parent-record digest and first observation
clock. An intent before a parent commit is not a settlement or observation.

Recovery reads the same trusted pinned directory, validates the original cut,
excludes any reference already admitted in that cut, and requires the exact
candidate to be present in current parent admission. Only those explicit new
admissions go to the existing ordinary-delivery join. It never reconstructs
retry inputs by treating all historical parents as prospective admissions.
No recovery receipt lookup, payment action or historical attribution is added.

An intent is acknowledged only after syncing and independently validating the
regular observation journal. Existing classification, feedback and first
`observedAt` survive duplicate recovery. Unknown output remains unknown; normal
late ordinary evidence can still advance an open observation under the existing
append-only revision rules.

Pending state has at most 1,024 candidates and 512 KiB. Atomic replacement uses
one fixed private temp with the same byte cap, so state plus temp is at most
1 MiB. A complete interrupted temp is usable only if it exactly equals the next
snapshot independently derived again. Invalid, conflicting, symlinked or
nonregular targets are preserved and reported, never overwritten or cleaned.
Observation initialization likewise refuses an existing empty/nonregular target.
The handoff checks namespace identity and ancestor substitution; every handoff,
parent lookup and observation operation uses the already pinned namespace.

`reconciler.status().prospectiveCaptureRecovery` reports pending/empty/absent,
awaiting-parent or unbound inputs, saturation, namespace failures, invalid state
and temp conflicts. Indeterminate pending counts are null. This diagnostic is
separate from the existing prospective public projection and money fields.
Missing state cannot recover a lost reference and does not grant coverage.

The handoff is best-effort and needs the owner's trusted Linux directory pin.
It does not add cross-process locking, reconstruct corrupt/torn files, reclaim
uncommitted identities, or guarantee analytics when persistence remains broken.
An incompatible orphan temp or stale uncommitted candidate stays bounded and
requires owner inspection; it never authorizes a historical fallback.

Focused remote replay, with synthetic fixtures and no network client:

```sh
node --test commerce-prospective-capture-recovery.test.mjs commerce-prospective-delivery.test.mjs commerce-settlement-reconciler.test.mjs
npm run test:nonlive
node --test commerce-prospective-retention.test.mjs commerce-prospective-retention.receiving.test.mjs commerce-outcome-binding.test.mjs commerce-outcome-binding.concurrency.test.mjs commerce-outcome-binding.root.test.mjs
```

The new suite includes actual child-process interruptions before parent commit
and after durable observation append, invalid/missing state, old/cross-identity
refusal, capacity limits, namespace substitution and nonregular target safety.
