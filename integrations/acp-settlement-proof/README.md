# Configured ACP Settlement Proof delivery

The complete optional operating receiver is now documented in [OPERATE.md](OPERATE.md):
new-job intake, quote-before-funding, durable uncertainty, native CLI1.0.30 account
loading, observe mode and a finite dedicated service candidate. It reuses the
configured funded-delivery function described below. Root owns actual enrollment
and activation; no live service or independent demand is established here.

`configured.mjs` consumes an explicitly supplied existing provider `JobSession`,
SDK history/catalog clients, receipt RPC and declared journal directory. It
selects the original client's sole requirement message, validates strict reader
input, retains exact message bytes and one receipt artifact, and invokes the
installed SDK's guarded submit tool. A fresh process reopens the same disk
operation. Uncertainty never causes automatic resend. This is tested source and
an executable **offline** receiving path, not an enrolled/live provider.

Original offer: `019ff030-09d4-7456-91b5-213ec48246b7`, provider
`0x561901cf20080e2bed6802ce718c4a17008a1ca2`, fixed **0.005 USDC**, **1440 minutes**,
**no working funds**. No listing, old obligation, merchant dependency/lock or
runtime1.23.55 changes. The receipt target amount remains distinct from the fee.

## Execute offline receiving

On the actual Cursor VM, from the repository root:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix integrations/acp-settlement-proof/validation --ignore-scripts --no-audit --no-fund
node --test integrations/acp-settlement-proof/configured.test.mjs integrations/acp-settlement-proof/fulfill.test.mjs settlement-proof.test.mjs transaction-receipt.test.mjs
scratch=$(mktemp -d /tmp/acp-receive.XXXXXX)
node integrations/acp-settlement-proof/receive-offline.mjs "$scratch"
node integrations/acp-settlement-proof/receive-offline.mjs "$scratch"
```

Both invocations return the same received artifact digest. The second process
repeats neither receipt RPC nor SDK submission. The command constructs only
sentinel RPC/HTTP/signing against `https://acp.invalid`; no real provider,
credentials, listener, job creation/funding or paid route exists. Only the
optional validation install includes the SDK. Tests use owned disposable data
and ordinary Node processes, never model children.

## Existing-provider installation recipe

After separate admission of actual provider signing and a genuine supplied job,
Root composes the already enrolled account/session without account discovery:

```js
import { configureSettlementProofDelivery } from './integrations/acp-settlement-proof/configured.mjs';
const delivery = configureSettlementProofDelivery({
  session: originalExistingProviderSession,
  history: existingSdkTransport, // getHistory(chainId, jobId); no connect here
  catalog: existingSdkApi,       // getAgentByWalletAddress(provider)
  journalDirectory: '/absolute/owned/acp-delivery-operations',
  client: explicitBaseReceiptRpc,
  selectionPolicy: 'provider-name-terms',
});
const operation = await delivery.run();
```

Retain the same directory, original job and authenticated clients on reopen.
This lower-level function creates no account, signer or listener. The optional
operating entry point is separate from merchant. Root owns actual account/secret-store enrollment. SDK reads may sign an
authentication challenge; they are not signature-free live recovery.

The explicit policy is necessary: SDK0.1.15 `createJobFromOffering` writes only
an offering **name** into the job and posts JSON with contentType `requirement`.
Neither job nor message contains a registry offering ID, original-message link
or stable message ID. Public catalog data supplies the exact offer ID and terms;
the consumer verifies that unique current entry on first preparation. This
proves catalog selection, **not authenticated registry entitlement of the job**.
The binding records `registryJobAssociation: unavailable-in-sdk`. This policy
handles a matching provider-owned service job. Where original registry-ID
entitlement is required, the smallest upstream producer/server change must
persist the selected offering ID and original requirement-message ID on the job,
scope them to its authenticated client, and return both through getJob/history.
That is independent of1573's schema repair; no unreleased package is assumed.

The fetched job binds chain/job/client/provider/evaluator, name, exact fee,
canonical Base USDC, expiry and absence of intents/custom hooks. Requirement
selection binds chain/job, client sender, exact content and timestamp; duplicate,
absent, wrong-sender or subscription requirements refuse. A byte digest is a
retention binding, never an invented server message ID. Authenticated API/history
is the trust boundary, not independent chain or message-signature proof. SLA1440
is checked catalog policy, not proven original creation duration: the job gives
only its expiry. Job/history are rechecked after receipt RPC and on readback.
The strict reader preserves verified/not_verified/receipt_unavailable, the
inclusive amount cap and optional payer semantics. Negative evidence is delivered.

## Durable operation contract

`journal.mjs` retains operation fields only, not another accounting ledger or a
fictional pre-existing ACP account/job record. Root explicitly declares its new
operation-retention directory. One `8453-<original decimal job ID>.json` retains
the immutable binding, artifact and digest plus prepared → sent_unknown → received.
Files are private, bounded and never rotated/deleted by this code. Corruption,
unsupported transitions, symlinks and write faults refuse.

Read/CAS reuse the scoped-surface experiment's Linux directory-inode flock,
shared across processes and released by process exit. Callbacks are synchronous;
no lock spans awaited network calls. Each CAS compares structural JSON, writes
an exclusive temporary file, fsyncs it, atomically renames and fsyncs the directory
before success. The directory must be stable, exclusively owned and on a local
filesystem supporting flock/rename/fsync. Its parent must already be provisioned
and stable; the journal syncs that parent's entry before use. Replacing/deleting it or its records
invalidates the contract; network filesystems are unqualified. Crash temporary
files are ignored. There is no lock stealing, record reset or automatic migration.

The durable sent marker precedes every SDK POST/signing action. A marking fault
refuses dispatch. A crash/lost response after marking reopens read-only. HTTP
storage alone stays uncertain; only submitted/completed API status and identical
deliverable bytes advance to received. Catalog changes do not rewrite old
obligations; original fetched job/message must still match. A legacy retained
record without the new source binding refuses rather than gaining authority.

Storage review: commerce-journal-admission gates one process only;
http-delivery-evidence/store appends evidence without ACP CAS/fsync;
useful-result-reuse/store has in-process admission and bounded rotation; the
scoped-surface journal has fitting cross-process locking/rename but different
records and no fsync. We reuse its lock directly and add only the missing ACP
operation persistence. idempotency-replay remains the paid merchant credential/
effect authority and is not used for ACP.

## Source and evidence

Merchant and reused lock source are this repository's MIT code (root LICENSE).
Unchanged optional pin: @virtuals-protocol/acp-node-v2@0.1.15, registry gitHead
713392c9fd2cda924026be42d2c8f1b54fa93df4, ISC declared by its manifest,
integrity-pinned in validation/package-lock.json. Primary sources:
[JobSession](https://github.com/Virtual-Protocol/acp-node-v2/blob/713392c9fd2cda924026be42d2c8f1b54fa93df4/src/jobSession.ts),
[producer/submit](https://github.com/Virtual-Protocol/acp-node-v2/blob/713392c9fd2cda924026be42d2c8f1b54fa93df4/src/acpAgent.ts),
[package](https://registry.npmjs.org/@virtuals-protocol/acp-node-v2/0.1.15).
This is metadata attribution, not an independent license audit.

[Public discovery receipt](evidence/root1575/public-discovery.json) receives the
same original offering/terms anonymously. Bounded search snapshots using valid
all/online/offline filters return different sets; none includes our provider in
the top five. This is not a causal test of changing our online state and does
not explain the prior omission or guarantee future visibility.

See [1575checkpoint](CHECKPOINT1575.md), [1548 historical result](RESULT.md) and
TAP under evidence/root1575. Readback proves carriage, not chain finality,
useful customer acceptance, settlement, revenue or live provider readiness.
The real remaining boundary is a genuine original job and separately admitted
existing-provider enrollment/signing, plus upstream fields if authenticated
registry-ID association is required.
