# ROOT1652 operating candidate and Root receiving

This source completes the qualified intake → quote → funding observation →
receipt → submission → stored readback path for the original Settlement Proof
service. It has not enrolled or activated a live receiver. A source test, empty
backlog, configured listing, stream connection or owner fixture is not customer
fulfillment, independent demand, evaluator acceptance, chain finality or income.

Original provider `0x561901cf20080e2bed6802ce718c4a17008a1ca2`, agent
`019fef7a-3b3e-7a67-b825-6abfd8ba0e17`, offering
`019ff030-09d4-7456-91b5-213ec48246b7`, name Settlement Proof, fixed **0.005 USDC**,
**1440 minutes**, **no working funds**. Sibling offers and old terms are unchanged.
The explicit `provider-name-terms` policy is retained. SDK0.1.15 lacks public
registry-job entitlement; the runtime records that limit and does not require
an invented upstream field. Catalog SLA is policy, not proven creation duration.

## Receive the source remotely, serially

Use Node22.12+ (this VM uses22.14), Linux `flock`, the exact exported commit and
owned disposable stores. No real credentials or network are needed for these
commands. Native child tests use synthetic credential/network/signing sentinels.

```sh
export NODE_OPTIONS=--max-old-space-size=768
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix integrations/acp-settlement-proof/validation --ignore-scripts --no-audit --no-fund
npm ci --prefix integrations/acp-settlement-proof/runtime --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 integrations/acp-settlement-proof/operating.test.mjs integrations/acp-settlement-proof/configured.test.mjs integrations/acp-settlement-proof/fulfill.test.mjs settlement-proof.test.mjs transaction-receipt.test.mjs
scratch=$(mktemp -d /tmp/root1652-offline.XXXXXX)
node integrations/acp-settlement-proof/receive-operating-offline.mjs "$scratch"
node integrations/acp-settlement-proof/receive-operating-offline.mjs "$scratch"
```

The two commands retain one quote, one receipt artifact and one submission,
return the same digest and perform no real funding. Retain their private scratch
only as synthetic evidence. Test loaders/preloads are never loaded by start.mjs.
The production native preload adds only process-local network limits; it replaces
no account, signing, SDK or factory implementation.

## Actual compatible boundary

The optional runtime pins **official CLI1.0.30**, gitHead
`ea26fff56cf3fad50bac23682179de3cac87d89e`, and **SDK0.1.15**, gitHead
`713392c9fd2cda924026be42d2c8f1b54fa93df4`. CLI's declared ^0.1.11 accepts this
SDK; the lock forces CLI and receiver to the same version, and the loader checks
both resolved versions. Official main `9d2be827cc19e4ea2cecfff3896398607537ea3e`
reports1.0.40; it is separately observed and is not adopted here. CLI's bundled
SKILL metadata says1.0.28 and mentions `job status`, absent from this release;
executable1.0.30/source, not that text, owns this adapter's command contract.

The loader reads only native public configuration in an explicit private ACP
profile. It requires the original active wallet/agent, public signer reference,
wallet ID and Root's exact signer ID. It invokes only native `agent signer-policy`,
`wallet sign-message` for Base `acp-auth:<timestamp>` challenges, `provider
set-budget --amount 0.005`, and `provider submit` with retained receipt bytes.
No fund/transfer/reject/complete/create/register/listing/policy-write command is
reachable. The installed native CLI alone owns token/keychain/P256 signer access.
It uses its supported headless file-backend fallback when necessary. No private
key is read/exported by merchant or this loader; no Mac account store is copied.

Actual SDK API/history/JobSession parsing and guarded executeTool run around
those native commands. The CLI re-fetches/guards the session through its own
SDK factory. SDK submit is delegated once to native CLI, avoiding a duplicate
outer artifact POST. Read-only observe makes authenticated reads and can sign
ACP auth challenges; it performs no business quote, receipt RPC or submission.
CLI may refresh its own auth tokens/public configuration during such reads.
`ACP_ONLY` is checked at startup and immediately before business commands,
against Root's pinned native signer ID. This is CLI-reported policy, not an
independent policy-server or key-possession attestation.

REST uses the published active `/jobs` array and full job/history methods.
Malformed/error responses are unknown, never empty backlog evidence. Hints carry
only chain/job IDs. The SDK's initial SSE open can retry indefinitely; the
receiver uses the same documented `/chats/stream` auth/headers with public
EventSource4.1.1 and an owned15second initial-open deadline instead. Reconnects
and30second REST catch-up re-fetch active jobs plus retained quote/delivery IDs,
including terminal jobs absent from the active array. No cursor/global/history
coverage is invented. A job that became terminal while unseen and never retained
may not be discoverable through this API. That limit is explicit.

## Lifecycle and uncertainty gates

A fresh job must bind Base/job ID, original provider role and creation, client,
evaluator, expiry/hook, exact offering name, sole strict client requirement and
its exact bytes. Catalog ID/unique name/price/SLA/no-funds are checked on first
operation. Subscriptions, intents, custom hooks, malformed/duplicate requirements
and other offers refuse. An OPEN job may have0or5000 budget atoms; only the
original5000-atom canonical-USDC quote can be sent. The receipt's target transfer
amount never becomes the service fee. SDK's job budget is canonical USDC by its
contract; it exposes no independent arbitrary-asset field to authenticate.

The existing journal now accepts an explicit quote phase, sharing the same
flock/CAS/fsync implementation and transition contract. `8453-ID.quote.json`
retains quote binding/bytes; `8453-ID.json` remains the existing delivery record.
Both retain prepared → sent_unknown → received. No balance/debt ledger exists.
Every business effect follows a fully synced sent_unknown marker. A prepared
record can resume; sent_unknown only receives stored facts, even if a crash
occurred before the external call. A quote requires exact5000 budget and one
matching budget.set history event. Delivery reuses configured.mjs/fulfill.mjs,
including useful negative reader output. Only submitted/completed status and
identical retained deliverable bytes establish stored delivery readback.

A response loss, timeout, signer refusal or crash does not authorize another
quote/submission. If the marker exists but the effect is not observed, Root must
reconcile the original operation through supported job/history/chain evidence.
Do not delete/reset/edit markers to retry. The runtime intentionally cannot
prove absence of a broadcast or automatically repair an ambiguous transaction.
Later catalog drift does not reprice retained obligations; original binding
changes still refuse. This operation retention is private and never rotates.

## Qualified target and finite workload

Use a dedicated Linux x86-64 managed worker with a persistent local filesystem and an
existing approved service OS identity. `runtime/samedaydesk-acp.service` is the
candidate. It is not installed here, and this Cursor VM is not assumed permanent.
The received Linux signer is a static x86-64 ELF executable; do not assume ARM
compatibility. The merchant's Railway HTTP process has no enrolled native account/persistent
credential model for this worker; adding a broad signer to that process is not
an acceptable hosting shortcut. No external infrastructure is provisioned.

Candidate layout is `/opt/samedaydesk-acp` for the exact read-only Git source and
`/var/lib/samedaydesk-acp` for private persistent profile, credential-backend data,
empty CLI cwd, operations and worker.json. These are declared target paths,
not this VM's identity. Parent storage must already exist, be stable and support
local flock/rename/fsync. No NFS, ephemeral volume or shared merchant DB.
Provision the profile/empty/operations directories as0700 and worker.json as0600
for the service identity. Keep the same HOME and ACP_CONFIG_DIR for enrollment
and service, including the native credential backend's private files.

Initial workload:2048MiB cgroup,768MiB parent/child Node heaps, one serial active
job, at most16eligible/retained jobs per admitted finite run,64coalesced hints,
256active rows,1000history entries/1MiB JSON,15second HTTP/header timeout,
45second native command-group deadline,4MiB per stream epoch,256KiB process log,
and60second stream epochs. Unsupported jobs do not consume eligible admission.
No model-per-event, new scheduler, resource monitor or recovery heartbeat.
The service exits after900seconds with Restart=no; do not enable a boot timer.
A native command timeout kills its owned process group, including native signer
children. A marker remains unknown. SIGTERM stops admission and contains native
commands; systemd's50second stop bound and KillMode=control-group contain the
whole dedicated service. No other writer/process group is touched.

## Exact Root enrollment and activation commands

These are Root-only future operations, **not executed by this assignment**.
First stage the exported exact Git commit into `/opt/samedaydesk-acp`, run the
locked installs/source receiving above and provision the private directories
under an already approved service user/group. The unit uses `samedaydesk-acp`;
if that OS identity is unavailable, Root must select an approved existing
identity and change User/Group/ownership together before installation. A copied
example is not an authenticated account. This task created no OS or ACP account.

Use the same dedicated remote service identity, persistent HOME and empty cwd.
Define this shell helper in Root's controlled remote terminal:

```sh
acp1652() {
  (cd /var/lib/samedaydesk-acp/empty &&
   sudo -u samedaydesk-acp env -i PATH=/usr/bin:/bin \
     HOME=/var/lib/samedaydesk-acp \
     ACP_CONFIG_DIR=/var/lib/samedaydesk-acp/profile \
     NODE_OPTIONS=--max-old-space-size=768 \
     /usr/bin/node /opt/samedaydesk-acp/integrations/acp-settlement-proof/runtime/node_modules/@virtuals-protocol/acp-cli/dist/bin/acp.js "$@" --json)
}
acp1652 configure start
# Root completes the returned URL for the EXISTING owner account, then:
acp1652 configure complete --request-id "$ACP1652_AUTH_REQUEST_ID" --wait --timeout 120
acp1652 agent use --agent-id 019fef7a-3b3e-7a67-b825-6abfd8ba0e17
acp1652 agent signer-policy --agent-id 019fef7a-3b3e-7a67-b825-6abfd8ba0e17
```

If this remote service identity already has its approved native signer, reuse
it and put its exact signerId into worker.json. Auth enrollment alone does not
install a signing key. If it does not, **stop before start**: Root's separate
native-device enrollment is the smallest remaining authority step. The official
route for Root's separately admitted enrollment is:

```sh
acp1652 agent add-signer --agent-id 019fef7a-3b3e-7a67-b825-6abfd8ba0e17 --policy restricted --no-wait
# Root completes the returned signerUrl under the EXISTING account, then:
acp1652 agent signer-status --agent-id 019fef7a-3b3e-7a67-b825-6abfd8ba0e17 --request-id "$ACP1652_SIGNER_REQUEST_ID" --public-key "$ACP1652_PUBLIC_KEY" --wait --timeout 120
acp1652 agent signer-policy --agent-id 019fef7a-3b3e-7a67-b825-6abfd8ba0e17
```

This official step generates a device-local signer and requires Root's own
admission; the worker never executes it. `restricted` must read back `ACP_ONLY`.
No policy weakening, signer import/export, new wallet or new ACP agent. Root
records the returned exact signerId; the loader refuses a missing/mismatched
profile/policy. Do not substitute official main1.0.40 or a portable-key assumption.

Set worker.json from runtime/worker.example.json with the actual received
signerId and approved receipt RPC, preserving every account/offer/finite value.
Run observe first (same identity/environment as the service):

```sh
sudo -u samedaydesk-acp env -i PATH=/usr/bin:/bin \
  HOME=/var/lib/samedaydesk-acp NODE_OPTIONS=--max-old-space-size=768 \
  /usr/bin/node /opt/samedaydesk-acp/integrations/acp-settlement-proof/start.mjs \
  observe /var/lib/samedaydesk-acp/worker.json --once
acp1652 job list
# For an actual supplied original job only:
acp1652 job history --chain-id 8453 --job-id "$ACP1652_ORIGINAL_JOB_ID"
```

Root receives policy, original identity, actual observed backlog and its limited
coverage before enabling effects. An empty backlog is not a failure or demand.
Then install the reviewed unit and admit one finite900second serve window:

```sh
sudo install -m 0644 /opt/samedaydesk-acp/integrations/acp-settlement-proof/runtime/samedaydesk-acp.service /etc/systemd/system/samedaydesk-acp.service
sudo systemctl daemon-reload
sudo systemctl start samedaydesk-acp.service
sudo systemctl show samedaydesk-acp.service -p ActiveState -p SubState -p Result -p ExecMainStatus -p MemoryMax -p RuntimeMaxUSec
sudo journalctl -u samedaydesk-acp.service --since '-16 minutes' --no-pager -n 200
```

For real receiving use only a genuine external job, not an owner-funded test.
Receive validated original requirement → quote marker/readback → actual client
funding → retained receipt decision/digest → submit marker → stored original job
readback, with native `job history` plus retained private records. A real funding
or settlement observation is separate from source readiness and useful acceptance.

Rollback stops this dedicated service and leaves its native profile and operation
records intact, permitting read-only reconciliation and source rollback without
replay. Do not remove the journal or rerun uncertain effects:

```sh
sudo systemctl stop samedaydesk-acp.service
sudo systemctl show samedaydesk-acp.service -p ActiveState -p SubState -p Result -p ExecMainStatus
acp1652 job list
# If an original operation exists:
acp1652 job history --chain-id 8453 --job-id "$ACP1652_ORIGINAL_JOB_ID"
```

If Root needs credential revocation, use the native account's dashboard for this
exact device signer after reconciling pending operations. Never revoke the Mac
or another writer's signer as part of a worker rollback.

## Sources and license/import closure

Owned code and the reused lock are repository MIT. Optional CLI/SDK manifests
declare ISC. Public EventSource4.1.1 is MIT. The integrity-pinned optional lock
contains461dependency entries; source-boundary.json records license metadata,
including undeclared/SEE LICENSE and LGPL entries. Installed dependency license
files remain with the packages. This is a declared source/import closure, not
a blanket legal audit or a license grant for the bundled native signer binary.
No dependency is added to the merchant production manifest/lock.

Primary source contracts:
[CLI1.0.30 package](https://registry.npmjs.org/@virtuals-protocol/acp-cli/1.0.30),
[CLI source](https://github.com/Virtual-Protocol/acp-cli/tree/ea26fff56cf3fad50bac23682179de3cac87d89e),
[distinct main1.0.40](https://github.com/Virtual-Protocol/acp-cli/blob/9d2be827cc19e4ea2cecfff3896398607537ea3e/package.json),
[SDK0.1.15](https://github.com/Virtual-Protocol/acp-node-v2/tree/713392c9fd2cda924026be42d2c8f1b54fa93df4),
[EventSource](https://github.com/EventSource/eventsource).
