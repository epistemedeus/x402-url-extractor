# Root7712 source handback

Exact admitted branch: `codex/root7712-trial-measurement-continuity-20261025`.
Base: `dbfd97a42e4fa629cdb028b12952075ca0573acf`.
Tested implementation HEAD: `2955b33bf5158e816d39f423bd78e09f4b9f6263`.
Implementation tree: `a96d956b1ac1682ee56f7d390aaa2555db6fa93d`.
The successor commit packages this handback, diagnostic metadata and the exact
TAP-file whitespace attribute only. Final published HEAD/tree and remote-head
readback are exported after push in
`/home/ubuntu/root-sol-window100337/root7712-trial-measurement-continuity-20261025/outputs/RECEIVING.json`.

The original projection mixes temporal scopes. `server.js:590` registers the
trial observer at every mount; its start time is process-local. The producer
writes admitted/terminal observations into the existing rotating journal.
`readOwnedAttemptSegment` strictly reads retained rows, and `captureSnapshot`
selects rows from the inclusive rolling-window lower bound. The trial reducer
also applies the inclusive generated-at upper bound and external-population
cutoff. It does **not** cut retained observations at the new mount time. The
public demand handler spreads that projection into its response.

The real-journal fixture reproduces owner admitted1/completed1/refused1 from
09:27 rows, a new 10:17:19.925 mount and the 10:28:31.544 cut, without another
trial invocation. The original implementation labels this retained population
`prospective_process_only`. Free-page-change HTTP and MCP have the same defect.
These counts can be retained earlier evidence; they prove no post-restart use,
capture continuity, new customer or downtime. Production rows were not copied
or independently inspected; the live observation was supplied in the assignment.

Both outcome projections now declare schema v2. Existing counts keep their
window and population rules. `countScope` names retained journal rows in the
requested window; `coverage` stays `unknown_for_full_window`,
`requestedWindowComplete` stays false and `retainedObservationContinuity` is
unknown. `currentCapture` separately exposes this process's start, prospective
capture status and whether a journal failure was observed. Existing
`captureStartedAt` remains the same process-start alias. `retainedWindowCoverage`
still describes the shared journal, never outcome-producer continuity. Consumers
checking current capture must read `currentCapture.coverage` rather than the
retained-count `coverage` field. In-repository consumers and tests are updated.

Only `commerce-events.mjs` production projection semantics changed. The journal
producer, reader, filters, retention policy/exposure and original timestamps are
unchanged. No per-event dates, caller joins, identities, usefulness or conversion
claims are added. `server.js`, extraction, payment, pricing, finite authority,
package/lock and LICENSE are unchanged. Exact-base mounted comparisons preserve
all sixteen full discovery entries, paid challenge, MCP definitions, ten emitted
HTML routes and both favicon outputs. The human-output collection SHA256 is
`32a4d1a4962941b5cabdae2c370d88c7974ad9531f7cceed6f9c41ae487ef0ce`.

Final reviewed qualification: **291 pass, 0 fail/skip/cancel/todo, exit0**, across
nine focused files. These include actual merchant process exit/restart over the
same disposable journal and authority, pre-mount/current rows, exact window/end
and external cutoffs, future rows, all populations, empty/rotated/missing/torn
retention, sticky writer failure and recovery of readable evidence. A complete
shared-journal window explicitly cannot promote outcome continuity. All fixture
merchants/listeners close; disposable directories are removed.

Node `v22.23.3`; inherited heap512MiB, UV1/OMP1, serial test concurrency1.
`npm ci --ignore-scripts --no-audit --no-fund` exited0 with the existing lock.
Commands, individual run counts/exits, source blobs and log hashes are in
[EVIDENCE.json](EVIDENCE.json). Full TAP logs remain in the exported outputs
directory. Repeated runs are not added together. The original two failing
restart regressions are retained verbatim in
[original-restart-failures.tap](original-restart-failures.tap), exit1. A file-only
whitespace attribute preserves Node's original diagnostic blank lines. The
initial diff-check and corrected diagnostic-path failure are recorded in the
evidence manifest. Final full baseline diff-check exits0.

Actual native session: `01a172a1-de6c-7a40-89bc-b57654602f6e`,
`gpt-6.1-sol` / `high`, verified from native session metadata and turn context.
One parent, zero model children; existing reserve2,097,152KiB. Frozen receipt
SHA256: `37cc070c2e5345403f7846643c29c87996cf8e7ca578f66d702a5594d936d17a`.
The complete staged assignment, supplied operating context and walletless
receiving informed this source-only work. No live trial POST/extraction,
signer/payment/account/contact, deployment, grant/allowance change, renewal,
resident process, other model, overage or reset occurred.

Root owns independent integration and any installation/release receiving.
Schema-v2 consumer receiving and actual deployed behavior remain release gates.
The original finite authority and outside useful completion/later natural paid
choice retain their existing gates; tests establish neither outside outcome.
