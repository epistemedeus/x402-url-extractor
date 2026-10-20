# Existing ACP Settlement Proof delivery

This small optional adapter connects the maintained `settlementProof()` reader
straight to SDK `JobSession.executeTool('submit', { deliverable })`. It uses no
paid merchant HTTP route and creates no jobs, accounts, wallets, listener or ledger.
It is source-tested preparation; no provider installation or real job is qualified.

The original offering is `019ff030-09d4-7456-91b5-213ec48246b7`, provider
`0x561901cf20080e2bed6802ce718c4a17008a1ca2`: fixed **0.005 USDC**, **1440 minutes**,
**no working funds**, Base canonical USDC receipt evidence. These terms and the
listing stay unchanged. The service fee is distinct from the receipt's target
`amountAtomic`. The latter retains the reader's positive cap of `1000000000000000`.

## Receiving recipe

A later genuine requester, original job/request record, existing enrolled provider
and separately authorized SDK execution are prerequisites. This branch executes
only offline sentinels. There is no executable live CLI or default credential route.
The documented CLI `serve` command is absent from the previously received release;
this recipe composes the already available SDK primitives.

Root supplies the existing `JobSession` for the original Base job and an adapter
onto its **existing authoritative job journal**, retaining the artifact and this
operation as fields of that original job record:

```js
import { fulfillAcpSettlementProof, OFFERING_ID } from './fulfill.mjs';

// Explicit transport decoding, once, after receiving the original client's
// authenticated requirement message in this same job. Do not parse arbitrary
// follow-up text or substitute a different sender's requirement.
const requirements = JSON.parse(originalRequirementMessage.content);
const operation = await fulfillAcpSettlementProof({
  session: originalProviderJobSession,
  offeringId: originalJobRecord.offeringId, // must equal OFFERING_ID
  requirements,
  journal: existingJobJournalAdapter,
});
```

The SDK job object contains the offering **name**, not its registry offering ID
or the requirement message. Root must establish that ID, original message sender,
job and agreement association from its original record before calling. The adapter
checks that supplied ID and fetched provider/name/fee; the original registry-ID
association remains a caller prerequisite. It requires a loaded funded provider
job with no intents or custom hooks, and rechecks it after receipt RPC. Canonical Base/USDC are constants; extra network/asset fields, scalars,
JSON strings, arrays, malformed inputs and numeric/over-cap amounts refuse before
RPC or SDK authentication. Omitted payer is allowed; an explicit null is not.
The three reader decisions remain `verified`, `not_verified`, `receipt_unavailable`;
a mismatch or unavailable RPC is useful delivered evidence, not fabricated success.

`journal.read(key)` returns the retained operation or null.
`journal.compareAndSet(key, expected, next)` must atomically compare full JSON
values (object key order is immaterial), durably persist `next`, and return true only after persistence completes.
Use the key `acp:8453:<original decimal job ID>` within the existing journal namespace.
Read/create/update must share its existing cross-process transaction/lock. Never
implement this contract as an unprotected read then write, or use the tests' Map
as production persistence. Persistence failure refuses before dispatch. No new
journal implementation or financial accounting store is introduced here.

The artifact is serialized once, retained with SHA256 and immutable request/job
binding, and persisted as `prepared`. A CAS persists `sent_unknown` **before**
the SDK's HTTP POST or transaction action. Only the CAS winner dispatches.
The SDK path calls its ordinary guarded tool method, not direct `session.submit()`.
No budget, fund, complete, reject, transfer, or new job method is called.

A response loss, refused signer, crash after marking, failed readback, or content
POST without a submitted state remains `sent_unknown`. Run the same function
with the same original requirements, job and journal to **read back only**.
Never delete/reset the record, replace its artifact, create a second operation,
or automatically resend even when a readback still says funded. A later actual
submitted/completed readback with byte-identical content can mark `received`.
Root must resolve genuinely unresolved financial state on the original operation;
this adapter deliberately offers no manual promotion or automatic resend path.
A received operation returns its retained receipt without producing another result.

## SDK identity and offline proof

Public npm metadata observed October20,2026 still selects
`@virtuals-protocol/acp-node-v2@0.1.15`, gitHead
`713392c9fd2cda924026be42d2c8f1b54fa93df4`, ISC declared in its package manifest.
The earlier retained source main was a different commit; tests execute the actual
published package, not an extracted method or mock SDK. npm's integrity-checked
archive is pinned in `validation/package-lock.json`:

```text
sha512-8hf92cjFiEx532PpwCTejbogqwJfCNlTn4rdYzcM96vIOvALy6hE3OJ0qU2F5H8bMPiPzdTJ8vnBIgtktPFigg==
```

Primary package/source:
[registry](https://registry.npmjs.org/@virtuals-protocol/acp-node-v2/0.1.15),
[JobSession](https://github.com/Virtual-Protocol/acp-node-v2/blob/713392c9fd2cda924026be42d2c8f1b54fa93df4/src/jobSession.ts),
[AcpAgent](https://github.com/Virtual-Protocol/acp-node-v2/blob/713392c9fd2cda924026be42d2c8f1b54fa93df4/src/acpAgent.ts).
ISC is a metadata declaration; it is not an independent license audit.

On the actual Cursor VM, from the product root:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix integrations/acp-settlement-proof/validation --ignore-scripts --no-audit --no-fund
node --test integrations/acp-settlement-proof/fulfill.test.mjs settlement-proof.test.mjs transaction-receipt.test.mjs
```

Only the optional test harness installs the SDK; the merchant runtime manifest,
lockfile, paid routes and release version stay unchanged. Tests run the actual
installed `JobSession`, `AcpJob`, `AcpAgent.internalSubmit`, API authentication,
`postDeliverable`, and Base retry classification with fake receipt/block RPC,
HTTP, authentication-signature and transaction sentinels. The fake SDK host is
`https://acp.invalid`; every fetch is intercepted and checked. SDK listeners and
real providers are never constructed. The SDK's EVM client inherits the default
non-stale classification; generic lost responses do not trigger its reprepare loop.

The existing merchant `idempotency-replay.mjs` journals paid HTTP credentials and
facilitator effects. It does not own an ACP job or SDK submission; this adapter
therefore requires the original job owner's journal rather than mixing those
financial authorities or inventing another accounting store.

The fake journal proves use of the CAS contract, including a competing-call case;
it does not qualify Root's durable journal implementation. Fake funded state,
SDK/API readback and a digest establish the tested source path and carriage
checks, not authentic escrow, inclusion/finality, original entitlement, evaluator
approval, useful buyer acceptance, independent demand, settlement or revenue.
SDK read/authentication itself may sign: no claim of signature-free live recovery
is made. No live ACP request, signature, job, submission, payment or release was run.

Smallest next Root action: receive this source, bind the existing original-job
journal to the documented CAS contract and original-message association, and run
its configured adapter against sentinels. A real delivery additionally needs a
genuine supplied job and separately admitted provider financial authority; do not
create/fund an owner job to qualify this preparation.
