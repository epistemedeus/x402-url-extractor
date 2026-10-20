# ROOT1548 source outcome

The existing Settlement Proof offering now has a narrowly scoped, tested source
path through its maintained receipt reader and the published SDK's original job
delivery method. Reusable asset: [fulfill.mjs](fulfill.mjs), its installed-SDK
[tests](fulfill.test.mjs), and the [receiving recipe](README.md).
[Draft product PR216](https://github.com/epistemedeus/x402-url-extractor/pull/216).

Exact admitted product base is `cd0609e5ad68e0b5a9e0fa90e17d26a8998235e7`;
Pilot operating/assignment source is `21deebdcc36d21141182b7af4ce853dd214dbd4d`.
The input receipt and all four member byte counts, SHA256s and Git blob IDs are
independently recomputed in [source-proof.json](evidence/source-proof.json).
The clean useful checkpoint `84b14c504aa66bafcba007fd17b3dfe52a190b43`
(tree `97ba64b044b236c1f929dfd4efe0b30b15fac66b`) was pushed at approximately
21:35UTC, within six minutes of native admission. Its remaining outcome is
preserved in [CHECKPOINT.md](CHECKPOINT.md). Final head/tree are returned in the
native export and PR; this report does not manufacture a self-referential hash.

The adapter requires strict object input before any RPC/authentication, binds the
canonical Base asset and exact original job/request, preserves the reader's amount
cap and three outcomes, and executes the guarded SDK submit tool only from a
fresh funded provider job. It serializes the reader result once. The existing job
owner must durably CAS its retained operation to sent_unknown before external
work, preserving one original job key and artifact SHA256. Readback must return
submitted/completed status plus identical artifact bytes; an uncertain retry
cannot send again. No paid merchant call or duplicate SDK server is introduced.

The full installed npm SDK0.1.15 (ISC manifest declaration, registry gitHead
`713392c9fd2cda924026be42d2c8f1b54fa93df4`) runs in the tests. Its ordinary
JobSession, job parsing, API authentication/POST, internalSubmit, and inherited
Base/EVM retry classifier execute; only RPC, HTTP, authentication signer,
transaction client and journal boundaries are sentinels. No model child or live
provider was constructed. The pinned optional validation dependency lock is
separate from the unchanged merchant runtime manifest/lock/release1.23.55.

[Initial46-test proof](evidence/initial.tap) passes. After self-review, a clean
locked SDK reinstall with scripts disabled and the complete focused command pass
**64 tests:56 integration +8 existing receipt tests,0fail/skip/cancel**;
[final TAP](evidence/final.tap), [install log](evidence/clean-sdk-install.txt).
These runs overlap and are not additive populations. The clean install added300
packages in4s npm-reported time; this is not whole-job effort or economic cost.
`git diff --check` passes. No broad unrelated merchant suite was run.

Self-review corrected storage-order sensitivity with structural JSON binding
comparison, added a fresh pre-send job check after RPC, restricted the no-working-
funds path to no intents/custom hooks, and strengthened lost-readback recovery,
pre-send persistence failure, crash-after-marker, concurrent dispatch, artifact
mismatch, inclusive amount-cap and changed-identity cases. All final cases pass.
There were no failing test runs. The first checkpoint commit attempt refused for
missing Git author configuration; a per-command reuse of the existing repository
public author identity fixed it without global/account configuration changes.
The first branch push therefore contained only the admitted base; the subsequent
verified84b14c5push is the useful checkpoint, not that empty branch creation.

The frozen operating source lacks the linked cloud-start guide (404), as the
retained earlier findings also observed. The available agent-status helper ran
once and reported unavailable browser/session helpers. No browser was needed,
no helper/store/controller was replaced, and no unrelated writer was changed.
Public source/package reads and scoped dependency installs stayed on this actual
Cursor VM. Dependency-manager transport request totals were not measured.

## Remaining actual condition

No bounded source implementation remains planned in this branch. The smallest
next Root action is to receive this exact source, map the original job owner's
existing journal to the documented durable CAS contract, bind the original
client requirement/offering-ID association, and verify that configured adapter
with sentinels. The test Map proves the contract's use; it does not qualify the
actual retained durable store. There is no new financial ledger or default store.
The SDK job object itself supplies an offering name, not a registry-ID or original
requirement association, so that caller binding remains explicit.

Actual fulfillment additionally requires a genuine supplied original requester
job and separately admitted existing provider financial authority. Unknown
original submissions stay quarantined; do not create/fund an owner job, delete an
operation or resend to obtain a green status. API readback is carriage evidence,
not independently authenticated escrow, transaction inclusion/finality, evaluator
approval, useful buyer acceptance, settled revenue or independent demand.
SDK read/auth can itself sign; fake source success is not signature-free live
execution. No live ACP/provider/listing write, account/wallet/signature, claim,
funding, submission, outreach, payment, production release, global install,
overage or reset occurred. Original terms and every other writer remain intact.
