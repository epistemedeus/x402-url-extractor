# Next Root receiving

Runtime/source is tested at `5ef03b39b80de8d047388de0aa6b0852c298fc13`.
Fetch the final review/export branch using the enrolled official helper:

```sh
GH_CONFIG_DIR=/home/ubuntu/.config/pilot-gh git -c credential.helper= -c 'credential.helper=!/usr/bin/gh auth git-credential' fetch origin codex/sol-scoped-repair-receiving-100398
```

`CURRENT-MASTER-INTEGRATION.patch` was checked/applied against actual default
branch `master` at `015f07d5a75d02a4e74709b17b2b1176501e92a5`, preserving seller
0.4.1. It includes four exact client assets and inventory. SHA256:
`8210e2ad2dd831fd7c827f33f862d1cd10363a6c26d50edc5bb98b996984d8b6`.
The original producer patch is already applied on the worker branch.

Root's isolated integration checkout needs exact 348 source and its received
task-demand dependency. Preserve its current 395 owner files; the export changes
none. Compatibility QA used completed 339 only in a disposable checkout, without
reading an active 395 worktree or waiting for it. If 348 is absent, obtain only
that directory from the requested pin, then apply the shared patch:

```sh
# Run in Root's isolated receiving checkout with its task-demand owner present.
set -e
test ! -e task-linked-delivery/experiments/scoped-repair-commerce-100348
git archive d9f8f0ac82b14ead8ecac4748640c2396b93192d task-linked-delivery/experiments/scoped-repair-commerce-100348 | tar -xf -
# Set the absolute exported review directory.
sol398_review=/PATH/received-100398/docs/reviews/sol398-scoped-repair
git apply --check "$sol398_review/CURRENT-MASTER-INTEGRATION.patch"
git apply "$sol398_review/CURRENT-MASTER-INTEGRATION.patch"
git diff --check
```

If 348 is already present, verify the source pin instead of copying over it.
Do not reapply the patch to an integrated checkout. Newer Root shared source
needs its own patch check; this result pins the exact source tested here.

Reproduce source receiving in disposable clones from the export checkout. The
explicit Neo path is a completed source checkout containing the pinned commit.
The inherited surface suite expects public SkillGuard at
`/home/ubuntu/sol348-skillguard`, pin `beec14acbb56de37cd361acc949087b9ae019b70`.

```sh
node docs/reviews/sol398-scoped-repair/receive-final.mjs \
  --source 5ef03b39b80de8d047388de0aa6b0852c298fc13 \
  --master 015f07d5a75d02a4e74709b17b2b1176501e92a5 \
  --neo /PATH/completed-neo-checkout \
  --neo-pin 08eb7fb8b5d8971b48bad11a0c626bbc5db9f41e \
  --out /PATH/disposable-receiving-evidence
node docs/reviews/sol398-scoped-repair/receive-mounted-acquisition.mjs /PATH/anonymous-loopback-evidence.json
```

Deployment preparation is tested Node **22.22.2** and the `node server.js` entry,
with existing locked dependencies. `.railwayignore` includes 348/339, packaged
scanner and acquisition files. Root uses its existing Railway project/service/
deployment pipeline. The Railway CLI is absent in this worker; no deployment
command was executed. Fresh actual merchant processes exercised the entry,
scanner, free diagnosis, 21 assets and extracted CLI execution.

For historical recovery, set `SCOPED_REPAIR_PACKET_DIR` to a separate directory
under the existing persistent volume with one writer. Keep packet storage separate
from commerce journals. Without that setting fresh free delivery works; accept/
review/reuse explicitly refuse unavailable readback. This patch configures no
new volume or spend. Quote/key/retention/evidence providers remain unavailable
by default; Root injects existing trusted providers when enrolled.

After Root deploys the composed source, run anonymous public receiving. This is
the public variant of the receiver tested against the actual mounted merchant
in loopback; production results are **unobserved** here. Its request/asset/child
bounds and evidence outputs remain separate from frozen bytes. Keep new public
artifacts separate until Root receives and installs them through the existing
publication process.

```sh
set -e
sol398_readback=$(mktemp -d)
node public-acquisition/receive.mjs --proof public \
  --origin https://agents.samedaydesk.com \
  --artifact "$sol398_readback/artifact.json" \
  --evidence "$sol398_readback/acquisition.json"
curl --fail --silent --show-error --proto '=https' --max-time 5 --max-filesize 37921 \
  https://agents.samedaydesk.com/.well-known/public-acquisition/assets/scoped-repair-commerce-100348/0.1.2/scoped-repair-commerce-100348-0.1.2.tar.gz \
  -o "$sol398_readback/client.tar.gz"
printf '%s  %s\n' f95db152722ac820d57975cdab9b2bb486888f2faf023dc271b82da5eba84656 "$sol398_readback/client.tar.gz" | sha256sum --check
mkdir "$sol398_readback/client"
tar -xzf "$sol398_readback/client.tar.gz" -C "$sol398_readback/client"
cd "$sol398_readback/client"
node bin/check-cold.mjs
```

Six declared cold commands are owner QA, including the client's missing-request
refusal. They establish acquisition/command behavior; outside usefulness requires
each caller's explicit task and observed result. From extracted bytes:

```sh
node bin/scoped-repair.mjs deliver --service https://agents.samedaydesk.com --request /PATH/caller-sdk.json > sdk-delivery.json
node bin/scoped-repair.mjs check --packet sdk-delivery.json
node bin/scoped-repair.mjs deliver --service https://agents.samedaydesk.com --request /PATH/caller-seller.json > seller-delivery.json
node bin/scoped-repair.mjs check --packet seller-delivery.json
node bin/scoped-repair.mjs reuse --service https://agents.samedaydesk.com --request /PATH/later-current-input.json
```

The request schema is `src/contracts.mjs`; later input is
`{ "packetId": "sha256:...", "request": <explicit current request> }`.
The client supports bounded stdin/lowered ceilings, public HTTPS and no redirects;
it never sends payment headers. Check verifies integrity/predicate without proving
remote execution authenticity. Keep claimant usefulness, observed work, current
sharing rights and settlement separate. The existing $0.01 audit is the sole quote
scope; no verify/settle command is part of this handoff. Root chooses its concrete
outside caller and authorized action; the existing invitation remains unsent.
