# ROOT1677 managed container

This is the distinct deployment seam on merged85e798b1. It reuses the received
ROOT1652 receiver and preserves its session, receipts, terms and214/188 gates.
Root owns platform deployment, existing-account/device enrollment and actual
receiving. No live account or platform action was executed here.

## Build this checkpoint

From the exact exported branch, generate the allowlisted context; never send the
whole working directory, HOME, node_modules or a credential store to a builder.

```sh
export NODE_OPTIONS=--max-old-space-size=768
node integrations/acp-settlement-proof/managed/export-context.mjs /tmp/root1677-build
# On a host with an existing Docker daemon, or Root's managed builder:
docker build --platform linux/amd64 --memory=2g \
  -f /tmp/root1677-build/integrations/acp-settlement-proof/managed/Dockerfile \
  -t samedaydesk-acp:root1677 /tmp/root1677-build
```

No Docker executable/daemon is available on this worker; no global installation
or privileged build is attempted. Source entry tests are separate from OCI
receiving. The pinned AMD64 Node22.14.0 image digest comes from Docker Hub's
manifest. Both npm ci steps use the received exact locks with scripts disabled,
serial768MiB heaps. The final stage retains only the root reader's dependency
closure plus the optional native runtime, not the merchant web dependencies.

The default image command is credential-free `receive`: initialize/reopen the
private volume, import the production closure and receive local flock/fsync,
then exit. It does not read credentials, generate a key or contact a network.

```sh
# Dedicated disposable receiving volume only:
docker volume create root1677-receive
docker run --rm --memory=2g --cpus=1 --network=none \
  -v root1677-receive:/var/lib/acp-worker samedaydesk-acp:root1677
docker run --rm --memory=2g --cpus=1 --network=none \
  -v root1677-receive:/var/lib/acp-worker samedaydesk-acp:root1677 receive
```

## Root platform settings

Target only existing service153e79b1-f365-4edc-96f8-64082f5a0345 in
project39cd108e-7036-40cd-97a7-8a86efa1cfd0 / production
02b78d43-d0f3-48b0-91ed-a2763ef8d2bd. Root must receive its exact settings before
activation: one replica; Linux AMD64;2048MiB memory; one vCPU; restart NEVER;
no public domain/port, healthcheck, cron, autosleep or automatic Git deployment.
Mount one NEW dedicated private local persistent volume at `/var/lib/acp-worker`.
Do not attach merchant storage. Set `ACP_DATA_DIR=/var/lib/acp-worker`,
`NODE_OPTIONS=--max-old-space-size=768`, `RAILWAY_RUN_UID=0` for narrow bootstrap,
`RAILWAY_DOCKERFILE_PATH=integrations/acp-settlement-proof/managed/Dockerfile`,
`RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0`,
`RAILWAY_DEPLOYMENT_DRAINING_SECONDS=50`.
No ACP credentials belong in Railway environment variables.

Use the exported context as source, Dockerfile
`integrations/acp-settlement-proof/managed/Dockerfile`, context root `/`, no
predeploy command. Leave start override empty for the default receive mode.
Root may explicitly set the complete start command to:

```sh
/usr/bin/tini -s -- node /opt/acp/integrations/acp-settlement-proof/managed/entry.mjs enrollment-hold 900
```

That hold exists only for a private Railway SSH enrollment window and exits
within900seconds or on SIGTERM. It has no HTTP listener, timer service, model
or recovery heartbeat. Never configure automatic restart after its exit.
Bootstrap touches only a fresh empty root-owned mount, then permanently drops
the process to the official image's existing node UID/GID1000. Every mode uses
the same private HOME, XDG paths, ACP profile, empty CLI cwd and operations.
An unmarked nonempty volume, symlink, owner conflict or nonempty cwd refuses;
there is no recursive chown, migration, deletion or journal reset.

Private shell entry (Root's enrolled Railway CLI/account only):

```sh
railway ssh --project 39cd108e-7036-40cd-97a7-8a86efa1cfd0 \
  --environment 02b78d43-d0f3-48b0-91ed-a2763ef8d2bd \
  --service 153e79b1-f365-4edc-96f8-64082f5a0345
# Inside that private shell; every invocation drops to UID/GID1000 itself:
acp1677() {
  ACP_DATA_DIR=/var/lib/acp-worker NODE_OPTIONS=--max-old-space-size=768 \
    node /opt/acp/integrations/acp-settlement-proof/managed/entry.mjs "$@"
}
acp1677 receive
acp1677 cli configure start
```

Native CLI stdout is saved0600 at
`/var/lib/acp-worker/enrollment/last-result.json`; platform logs contain only its
path. Root reads it only in the private shell, not deployment logs or receipts.
Disable shell tracing/terminal recording before reading it. Consume it only
after a successful CLI exit: a failed/interrupted command preserves the previous
result, and an uncertain operation must be reconciled rather than replayed.
Save the returned requestId/publicKey privately before the next CLI call replaces
last-result.json. Complete its URL in Root's existing account browser. A shell is not a browser.
Never repeat an uncertain enrollment call blindly. Root retains request IDs and
uses the supported completion/status command:

```sh
acp1677 cli configure complete --request-id "$ACP1677_AUTH_REQUEST_ID" --wait --timeout 120
acp1677 cli agent use --agent-id 019fef7a-3b3e-7a67-b825-6abfd8ba0e17
acp1677 cli agent signer-policy --agent-id 019fef7a-3b3e-7a67-b825-6abfd8ba0e17
# Only when this device has no existing approved signer, Root's authority step:
acp1677 cli agent add-signer --agent-id 019fef7a-3b3e-7a67-b825-6abfd8ba0e17 --policy restricted --no-wait
# Root completes the returned URL under the EXISTING account, then:
acp1677 cli agent signer-status --agent-id 019fef7a-3b3e-7a67-b825-6abfd8ba0e17 --request-id "$ACP1677_SIGNER_REQUEST_ID" --public-key "$ACP1677_PUBLIC_KEY" --wait --timeout 120
acp1677 cli agent signer-policy --agent-id 019fef7a-3b3e-7a67-b825-6abfd8ba0e17
```

The CLI command allowlist supports only these enrollment/read calls and original
job list/history. Secret outputs never enter the worker. Native CLI alone owns
the encrypted-file store, token handling and signer. No Mac store is copied.

## Root readback, finite activation and rollback

The image receives every allowlisted source byte against `source-identity.json`
and emits its SHA256 plus file count. Compare that digest with the exporter
receipt for the exact source commit before enrolling. Receive logs also bind
UID/GID1000, stable HOME/profile/operations and Node version. Keep Root's private
platform deployment/image digest readback alongside this source receipt.

The sole persistent volume has this layout (all directories0700, owned1000):

```text
/var/lib/acp-worker/.managed-layout.json  #0600, layout/UID/GID only
/var/lib/acp-worker/home/                 # native HOME and XDG backend data
/var/lib/acp-worker/profile/              # official CLI profile/auth
/var/lib/acp-worker/empty/                # must stay empty
/var/lib/acp-worker/operations/           # original immutable-intent journal
/var/lib/acp-worker/enrollment/           # private CLI results
/var/lib/acp-worker/worker.json           #0600, explicit fixed worker configuration
```

After Root receives the original provider/agent identity, exact signerId and
`ACP_ONLY` policy from the native CLI, configure using those public references
and Root's approved HTTPS receipt RPC. The command fixes the original provider,
agent, offering,0.005USDC/1440minutes/no-funds policy and existing finite bounds.
It creates worker.json once, accepts an identical repeat and refuses a differing
existing configuration. It neither provisions auth nor registers a signer.

```sh
acp1677 configure-worker --signer-id "$ACP1677_SIGNER_ID" --rpc-url "$ACP1677_RECEIPT_RPC_URL"
acp1677 observe --once
acp1677 cli job list
# Only for a genuine original job that Root is receiving:
acp1677 cli job history --chain-id 8453 --job-id "$ACP1677_ORIGINAL_JOB_ID"
```

`observe --once` performs authenticated read/policy checks and can sign native
ACP auth challenges. It does not quote, fetch receipt RPC or submit. An empty
backlog is an observation under documented active-array-plus-retained-ID coverage,
not exhaustive global/history coverage or a failure. CLI may refresh native
auth tokens; their directory stays on this volume. Root's approval URL must be
completed in the existing account's separate browser, never a copied Mac store.

After Root receives policy/identity/observe, replace the hold's start override
with this exact complete command for one finite activation:

```sh
/usr/bin/tini -s -- node /opt/acp/integrations/acp-settlement-proof/managed/entry.mjs serve
```

Keep one replica, Restart NEVER,2048MiB/one vCPU and no scheduler. This runs the
existing receiver in the same entry process; no wrapper swallows signals.
Tini forwards SIGTERM to it, and its AbortController stops admission, aborts
network reads and terminates owned native CLI/signer process groups. Commands
are bounded45seconds in the worker,500ms TERM→KILL escalation,256KiB worker
logs,768MiB Node heaps, one serial job,16eligible jobs and runForSeconds900.
Enrollment CLI commands separately have a150second group/256KiB output bound
so the supported120second configure/status waits can finish. Do not run
concurrent enrollment commands or enroll while serve is active.

Root must receive `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=50` (the platform's
SIGTERM→SIGKILL buffer), with no overlap between old/new
writers. Stop the old instance before a source switch; do not add a systemd
unit or process manager inside this image. A volume-backed single replica is
not a global exclusivity proof. Original flock/CAS/rename/file+directory-fsync
journal behavior is reused unchanged.

For real receiving, use genuine external original work: validated client
requirement → synced quote marker → stored exact5000-atom quote history → actual
client funding → useful receipt/digest → synced submission marker → identical
stored deliverable. Receive native history plus private retained records. A
source/image pass, listing, stored delivery readback or stream connection alone
is not customer acceptance, evaluator acceptance, chain finality or revenue.

Rollback: stop only this dedicated deployment through Railway's existing Root
control route. Read back its terminal state, zero remaining worker/CLI children
and Restart NEVER before any source change. Preserve the volume, native HOME,
profile, enrollment results, worker configuration and every original operation.
Never delete/edit/reset sent_unknown or received records to retry. If inspection
is needed, set the same image to the finite enrollment-hold command, use the
same private shell identity and run only observe/job history; then stop it.
For code rollback, pin the previously received managed image/source digest and
keep this exact volume and UID/GID. Do not roll back to the old systemd-only
source as though it were a received container image. Root reconciles unknown
operations through supported original job/history evidence; no automatic replay.
Only Root may revoke this exact device after reconciliation; never another
writer's or the Mac's signer.

Railway contracts checked October21 from official documentation:
[private SSH](https://docs.railway.com/cli/ssh),
[root-owned mounted volumes](https://docs.railway.com/volumes),
[Docker start command](https://docs.railway.com/builds/build-and-start-commands),
[restart Never](https://docs.railway.com/deployments/restart-policy),
[shutdown variables](https://docs.railway.com/variables/reference),
[deployment teardown](https://docs.railway.com/deployments/deployment-teardown).
These document supported routes; Root's actual account/deployment/settings
readback remains required and was not performed by this source owner.

## Exact Root upload commands

The exporter places the dedicated managed/railway.json at the context root. It
pins Dockerfile, one replica, restart NEVER, zero overlap and50second draining
without touching merchant's repository-level platform config. Root must still
receive the account's memory/CPU limits, dedicated volume, private networking
and start override. These commands are provided for Root, not executed here:

```sh
# Use Root's existing authenticated CLI. Supply exact target IDs on each command.
railway volume list --project 39cd108e-7036-40cd-97a7-8a86efa1cfd0 \
  --environment 02b78d43-d0f3-48b0-91ed-a2763ef8d2bd \
  --service 153e79b1-f365-4edc-96f8-64082f5a0345 --json
# Create only if no dedicated volume already exists, after Root's budget check:
railway volume add --project 39cd108e-7036-40cd-97a7-8a86efa1cfd0 \
  --environment 02b78d43-d0f3-48b0-91ed-a2763ef8d2bd \
  --service 153e79b1-f365-4edc-96f8-64082f5a0345 --mount-path /var/lib/acp-worker
# After setting/readback of2048MiB/one vCPU/private/restart/volume settings:
railway up /tmp/root1677-build --path-as-root \
  --project 39cd108e-7036-40cd-97a7-8a86efa1cfd0 \
  --environment 02b78d43-d0f3-48b0-91ed-a2763ef8d2bd \
  --service 153e79b1-f365-4edc-96f8-64082f5a0345 --detach
```

Upload only a freshly exported source-only context. A local cold-test context
contains node_modules and a disposable test volume; never upload that directory.
For the first private enrollment deployment, Root can select the bounded hold
start command before upload. If Root first chooses default receive, its clean
exit is expected and there is no running SSH target until the finite hold is
explicitly deployed. Use the configured existing project/account, never `--new`.
[Upload contract](https://docs.railway.com/cli/up),
[volume CLI](https://docs.railway.com/cli/volume),
[platform config](https://docs.railway.com/config-as-code/reference).

## Repeatable local source checks

On the isolated Linux worker with the admitted2GiB budget (all jobs serial):

```sh
export NODE_OPTIONS=--max-old-space-size=768
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm ci --prefix integrations/acp-settlement-proof/runtime --omit=dev --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 integrations/acp-settlement-proof/managed/managed.test.mjs integrations/acp-settlement-proof/managed/context.test.mjs
```

The root-owned-mount regression uses the host's existing passwordless sudo only
for a disposable test directory, then runs the actual entry and receives its
permanent drop to UID/GID1000. It installs nothing globally. The native-store
regression generates one unregistered synthetic key only in its disposable HOME,
reopens/signs in another process and deletes that test directory. It performs
no network/auth/registration or fresh independent crypto audit. Boundary tests
explicitly substitute a local process sentinel; the cold-context test imports
the real production closure. These are source/entry gates, not OCI/platform gates.
