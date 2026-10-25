# Walletless first-use source handback

Source only; branch `codex/root7540-walletless-first-use-20261025`, exact base
`fb88d0b5cc6c6bfa5c65ad1b59cf025c77b7e0b8`. No deployment, live configuration,
invitation or outside use. Final HEAD/tree/push and owned-file readback accompany
this handback in `outputs/RECEIVING.json` and the final reply.

## Result and durable boundary

`POST /trial/extract` accepts JSON `{ "url": "https://example.com/" }` and optional
`textExcerptLimitChars`, using the existing extractor, public IPv4 DNS pinning,
checked redirects, 12-second deadline, 3,000,000-byte capture cap and normal JSON.
HTTP 200 can mean `sourceOk:false` or `ok:false`; truncation remains explicit.
No wallet/account/credential/payment/model is required; caller headers never
become target headers. Invalid local input and other HTTP methods do no work.

Default disabled. `GET /.well-known/extraction-trial` reads current
**disabled/enabled/scheduled/busy/expired/exhausted/unavailable** status and a
constructible request. Root machine JSON adds only its discovery pointer.
Existing paid OpenAPI bytes, descriptions, prices, challenges and replay stay
unchanged. No human copy, template, layout or asset was edited.

An explicit create-only filesystem authority fixes identity, start, expiry
(≤7 days) and allowance (1–20). Each attempted HTTP hop, including DNS failure
and redirects, gets an exclusive numbered spend marker and directory fsync
**before** network work. One exclusive directory lock covers the extraction.
Failures/partial results stay spent; restart does not replenish. Crash or
ambiguous persistence leaves authority closed. No stale-lock recovery, reset,
renewal, background job, result retention or automatic retry exists. Expiry stops
new hops; an admitted hop can finish within the existing capture deadline.

The existing bounded commerce journal receives admitted and terminal
completed/partial/refused/failed/unknown-response phases. These are separate
technical counts, without caller joins. The trial producer retains no URL,
content, prompt, IP, arbitrary source or per-caller identifier; its required
actor field is an aggregate constant within the existing epoch. Internal-token,
self-declared owner-monitor, crawler and unattributed populations stay separate.
Unattributed does not mean independent. Capture starts at the actual mount,
includes parser/method refusals and never backdates on restart. Usefulness and
later paid choice stay unknown. Existing feedback capabilities require sealed
paid-result authority and were not extended to mint a free settlement receipt.

## Reuse, review and actual tests

Received the frozen Pilot inputs/PLAN at `27fa887984cfe74887669e6c724a072efea2521c`
and receipt SHA256 `7a83f581e64acfa3508da638868dc33858a8fa8fd983da572d91415ed0c27ad6`.
Inspected actual merchant source/owning tests and PR206
`d8e4232710634e456fb87116c1d16912c257a606` URL-job/HTTP code. Reused the public URL
guard and start-before-work rule; did not import its bearer/PostgreSQL/job/funding
workflow. Received and retained the actual MIT LICENSE (2026 SameDayDesk).
Package/lock/dependencies and private gateway grants/history remain unchanged.
Self-review amended null-options compatibility, checked directory writability,
and removed an unnecessary OpenAPI extension to preserve paid discovery bytes.

Node `v22.23.3`; all suites serial, `--test-concurrency=1`, Node heap 512MiB,
`UV_THREADPOOL_SIZE=1`, `OMP_NUM_THREADS=1`. Node-reported counts include parent
cases; repeat runs are not added. Final runs have zero skip/cancel/todo:

| Final suite | Passed | Exit |
| --- | ---: | ---: |
| `extraction-trial.http.test.mjs extraction-trial-events.test.mjs` | 57/57 | 0 |
| 14 owning extraction/payment/replay/discovery/event/privacy files | 220/220 | 0 |
| `aiax-discovery/discovery.test.mjs` | 9/9 | 0 |

Focused mounted tests cover caller-selected controlled HTTP output; local,
private, DNS, redirect, parser, timeout and invalid-response failures; source
403/500; body/excerpt truncation; every availability state; corrupt, missing,
symlink and unwritable authority; parallel callers and duplicate OS controllers
sharing one budget; restart; lost delivery; interrupted lock; owner/crawler
classification; and privacy. Retained-reader tests include twelve contradictory
metadata variants, rotation, restart coverage and failed-writer coverage. No
trial signer/facilitator verification/settlement call occurs. Controlled tests
use an injected DNS/socket adapter and 300ms deadline, not live outside use.

Actual before/disabled/enabled emissions preserve all ten human HTML routes
(including inline assets) and two favicon redirects. All three raw collections
have SHA256 `32a4d1a4962941b5cabdae2c370d88c7974ad9531f7cceed6f9c41ae487ef0ce`.
Full bodies, not template-name comparisons, are retained in `emissions-final/`.
Paid OpenAPI and canonical paid challenges also compare exactly to the base.

Original failures are retained: first two 51-case runs each had 48 pass/3 fail
(two assertions compared local listener ports, failing their parent too).
The fixture now uses node:http with an explicit canonical Host/scheme. A later
56-case run had one new test incorrectly expecting a readable snapshot from
ENOTDIR; it now verifies refusal, restores only its fixture directory and checks
that the original writer failure still withholds coverage. A diagnostic's
unavailable `python` exited 127; installed `python3` completed it. Dependency
installation `npm ci --ignore-scripts --no-audit --no-fund` exited 0, no package
changes. No original failure or repeat count was erased or promoted.

Exact commands, all actual case identities/counts/exits and full TAP logs are in
`/home/ubuntu/root-sol-window100337/root7540-walletless-first-use-20261025/outputs/TESTS.json`.
The same retained directory holds full emissions and final source/cleanup
receiving. These are receiving artifacts, not additional committed assets.

## Unexecuted activation and rollback

Root independently receives pushed source and actual behavior first. Require
one serving replica/process and one authoritative local POSIX persistent volume
with atomic mkdir/exclusive-create/fsync, preserved across restart. The existing
commerce journal supports one writer. Independent per-replica volumes, ephemeral
storage, NFS semantics, snapshot rollback, deleted markers or recreated authority
are unsupported. Concurrency was tested on one shared local filesystem, not
independent hosts. Volume loss/corruption or an abandoned lock closes the trial.

After receiving explicit identity/start/expiry/allowance, provision **once while
disabled** on that volume (placeholders are intentionally not live authority):

```js
import { provisionExtractionTrial } from './extraction-trial.mjs';
await provisionExtractionTrial('/ABSOLUTE/PERSISTENT/VOLUME/EXPERIMENT', {
  schema: 'samedaydesk.extraction-trial-budget.v1',
  experimentId: 'RECEIVED-EXPERIMENT-ID',
  startsAt: 'RECEIVED-START-ISO', expiresAt: 'RECEIVED-EXPIRY-ISO', maxStarted: 20,
});
```

Later activation sets `EXTRACTION_TRIAL_ENABLED=1` and `EXTRACTION_TRIAL_STORE`
to that exact directory, retaining the one-writer setup. Receive status/bounds
and deployed human preservation. Rollback removes/clears the enable flag while
retaining authority, spend markers, abandoned locks and all paid rights. No
migration, financial write, allowance renewal or reset is required/authorized.

## Native and cleanup

Actual session `01a17230-7649-7e41-8f18-50f67088616a`, `gpt-6.1-sol` / `xhigh`,
verified in launch receipt and native argv; one parent/zero model children,
2,097,152KiB total reservation. Actual Cursor VM
`bc-ec55ab26-6e23-4562-9c7a-649331bdba1f`, boot
`46920f98-723f-459d-ab1e-985512ebe221`; start October25 08:32:20.742 UTC.
Checkpoint 09:45:47.197 UTC; required lifetime 10:10:47.198 UTC.

All owned test merchants/listeners/source servers exited/closed and temporary
source/data mirrors were removed; readback found zero remaining fixture dirs or
test Node processes. The crash test killed only its identified merchant child.
Ignored node_modules and exported evidence remain for receiving. No live
allowance, customer store, account/signer/payment/contact/financial action,
credit/reset, new model process or unrelated-job cleanup occurred. Native/Git
account stores remain untouched. The native producer is still active writing
this handback; Root receives its later terminal/reaped state separately.

Remaining gates: independent Root receiving; durable-volume/replica qualification;
explicit finite activation; unchanged deployed human assets; then outside useful
completion and a separate natural eligible paid choice. No automatic renewal or
scale-up follows fixtures.
