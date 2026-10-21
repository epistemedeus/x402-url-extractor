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
`NODE_OPTIONS=--max-old-space-size=768`, `RAILWAY_RUN_UID=0` for narrow bootstrap.
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
Complete its URL in Root's existing account browser. A shell is not a browser.
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
