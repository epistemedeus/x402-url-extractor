# ROOT1595: prospective delivery journal continuity

Product admission: `077b25417d6c4da729986d7108e829a0e17c2291`.
Operating/assignment admission: Pilot `0f1c3dcaa441df9f9267858fc5949674ebe71ee4`.
Receipt SHA-256: `6a82df17277b5ea15d5d522f35b6dc74255e4122fcfbd1c7b0f09cd955d4ed7c`.
The frozen full assignment, instructions, state, execution plan and current
commercial phase plan were read. ROOT1573/1575 remained terminal; ROOT1596's
independent scope and all other owners were untouched.

Useful checkpoint `9427a94afa6448c442f00d63dc0dfe671d457719` was pushed at
23:14 UTC, before the SPEC checkpoint deadline of 23:21:35.847 UTC.
The remaining outcome was then implemented in the same writer checkout.

## Result and causal correction

The admitted ordinary report treated a supplied `coverage: "complete"` as an
exhaustive journal certificate, even for an empty directory. The saved red
observation demonstrates that defect on the admitted implementation. Pure joins
now preserve the label as `requestedCoverage` and leave actual coverage unknown.
The normal receiver obtains coverage only from authenticated, immutable finite
producer evidence and rejects reuse outside its observed boundaries.

Existing commerce admission, producer registration, bounded write-digest history,
rotation counters and journal cuts were reused. Missing paid-success, HTTP/MCP
capture and feedback write/fault observations now come from their actual append
paths. Feedback only enrolls an enabled writer; read-only feedback readers cannot
create producer authority. Canonical journal and payment/feedback payloads remain
unchanged. A capture failure does not gate paid work.

A finite signed cut is retained in the existing commerce event journal. It binds
actual owning-source content digests, process PID/session, directory device/inode,
finite start/as-of, producer counters, file generations and exact byte-prefix
bounds. Existing bootstrap source/deployment labels are retained separately from
content identity. No supplied SHA label is treated as source proof. The existing
internal token authenticates metadata; no token or bearer is written into it.
Initial raw journal bytes are discarded after their identities/digests are taken.

The ordinary reader also now reads the producer's existing retained numbered
event segments, rather than stopping at the first rotation. An exact typed MCP
join from segment 3 is tested. No retention layer or replacement public meter was
added. Signed metadata is excluded from public metric counts. The private report
route is excluded from traffic observation, like the existing telemetry readout;
this fixes the real late self-observation race retained in the failed evidence.

## Normal configured path

The existing `server.js` bootstrap enrolls the actual telemetry, reconciler and
feedback instances for `COMMERCE_DATA_DIR`.

- Owner-authenticated `GET /v0/ordinary-delivery-join.json` flushes the existing
  producer, persists/receives a finite cut and returns the ordinary report. It
  accepts only optional `windowStart`/`windowEnd`; there is no coverage override.
- Owner-authenticated empty `POST` to the same path begins a new prospective
  interval after repair. It does not erase earlier cuts, gaps or journals.
- Authentication uses the existing `x-samedaydesk-internal` token. Responses are
  `no-store`. Anonymous access is refused and raw filesystem errors are withheld.
- The existing CLI remains read-only. It automatically receives retained cuts
  with `COMMERCE_INTERNAL_TOKEN` from its existing environment. Without that
  authority, it still returns useful lower-bound rows and exact unknown coverage.
- If capture/flush fails but journals remain readable, HTTP still returns the
  ordinary lower-bound observations with `coverageAttempt.status: unavailable`.
  An unreadable ordinary input remains an explicit refusal.

After a received cut, the unchanged ordinary command is:

```bash
node ordinary-delivery-join-cli.mjs \
  --data-dir "$COMMERCE_DATA_DIR" \
  --window-start <received-start> --window-end <received-end> \
  --source-sha <installed-source-label> --coverage unknown_for_full_window
```

Use the existing authenticated owner client for HTTP. Do not put a token into
shell history, a URL, committed output or a new credential store.

## Coverage and acceptance limits

The population is **registered-process journal appends during the finite cut**.
`complete` on a plane means all such admitted appends, including successful empty
intervals, match the retained bytes and no observed fault occurred in that interval.
It is not a claim that all earlier events have been reconciled or that every
request has finished producing delivery evidence.

| Plane | Owning evidence | Limit |
| --- | --- | --- |
| attempts | Existing telemetry append/flush and retained event generations | Includes authenticated cut metadata; metadata is not a traffic event |
| settlements | Enabled canonical reconciler append observations | Journal continuity is separate from reconciliation/chain completeness |
| paid_success | Original v1 successful append observations | Original v1 record bytes and replay behavior are unchanged |
| http_validation | Existing sealed capture store's append/fault path | Captured validation is separate from caller usefulness |
| mcp_delivery | Existing typed MCP store's append/fault path | Does not invent HTTP v1 evidence for MCP |
| forward/task_refs | Existing owning writer counters, digests and rotations | Lost generations remain gaps |
| feedback | Enabled caller-feedback writer, durable append and rotation | Optional caller statements are not measured usefulness |

The admission gate is process-local. **Cross-process exclusivity is unproven**,
and event timestamps differ from append observation timestamps. Those two exact
gaps are always reported. Consequently store-wide `window.exhaustive` remains
false; a useful finite cut yields partial overall coverage, even when each
registered append plane is complete. Missing/unregistered producers remain
unknown. No settings or caller string can upgrade that authority.

Missing/malformed/truncated metadata, uncertain writes, generation loss, unsafe
files, changed source/store and byte/hash mismatch withhold coverage. Source
changes refuse the old code-qualified cut; restarts cannot extend an earlier
finite interval. Old completed cuts remain useful only within their original
boundaries while their captured generations survive. Existing rotations still
control retention. The existing 4,000-digest per-plane admission bound, 16 MiB
per-file and 128 MiB total snapshot bounds can produce a gap; they never imply
zero traffic. Durability is the existing producer flush/closed-file contract,
without a new power-loss guarantee.

No production store, configuration or deployment was accessed or changed. No
actual customer acceptance, installation, independent use or revenue is claimed.
Runtime `package.json`, lock, deployment statement and public-key bytes remain
identical to admission. No new service, account, signer, paid API or monitor was
introduced.

## Actual verification

The final evidence groups are `evidence/final-regression.tap` (135 passed) and
`evidence/final-configured.tap` (5 passed), with zero failures/skips/cancellations. The continuity cases are imported by the existing
ordinary test file, so the normal npm test/non-live file list receives them
without modifying the runtime manifest.

```bash
node --test ordinary-delivery-join.test.mjs caller-result-feedback.test.mjs \
  mcp-caller-result.test.mjs http-delivery-evidence/test/store.test.mjs \
  commerce-settlement-reconciler.test.mjs commerce-prospective-delivery.test.mjs \
  commerce-prospective-retention.test.mjs commerce-prospective-retention.receiving.test.mjs \
  commerce-privacy-coverage.test.mjs

node --test http-delivery-evidence.http.test.mjs \
  morpho-producer.mounted.test.mjs caller-result-feedback.http.test.mjs
```

Disposable stores cover normal writes, genuinely covered empty append intervals,
uncovered zero, missing/malformed/truncated records and metadata, actual append
failure, concurrent append/capture, retained rotation and loss, external writers,
restart/source/store change, recovery through the private configured path, and
unchanged ledger/payment/feedback behavior. The configured server test receives
six simulated paid-success rows/six captures, one real local feedback submission
and unchanged replay/payment counts. All facilitator/RPC inputs are disposable
fixtures; no live payment or external customer input is used.

Saved failures are kept honestly: `admitted-red.tap` is the original false
completeness defect; `mounted-initial.tap` used an incorrect feedback header in
the test; `configured-readout-race.tap` exposed the new owner route's queued
self-observation and was fixed at classification; `recovery-initial.tap` tried to
read an intentionally unreadable journal directory before the fixture repair.
The final checks run after those corrections. Self-review also sealed received
objects against mutation, checked finite-window binding, recovered failed
initialization and kept initial raw bytes out of long-lived state.

## Smallest next Root action

Review/integrate the focused draft product PR, then receive its first authenticated
finite cut on the next authorized merchant release. That installed read remains
necessary; this source/loopback export is not installed evidence. Preserve the
cross-process and event-time gaps when interpreting missing delivery observations.
