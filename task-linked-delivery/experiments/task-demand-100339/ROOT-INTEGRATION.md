# Isolated receiving proposal for Root

Import `exportObserverSource` and `projectObserverEvidence` from
`src/observer-integration.mjs` after the existing observer obtains an explicitly
authorized bounded read-only cut. Pass the caller's question and per-plane
source envelopes. Retain the resulting machine report with its stripped
snapshot using the CLI or the exported retention functions. Shared routes and
any route-level authorization remain Root's decision and implementation.

Source handoff uses the existing causal producer's task-ref rows and v3 events,
forward outcome v2, receipt retain/revoke and later-read metrics, and runtime
reconciliation sourceEventId. The adapter owns no telemetry writer. It does
not call `readMerchantRecords(dataDir)`: that legacy economics export reads a
directory and lacks total-byte and descriptor bounds. Root should provide its
supported read-only exports with their real coverage declarations; absent or
truncated generations remain partial/unknown. The CLI takes explicit files or
stdin, with no implicit environment/provider inputs.

The existing aggregate `createCommerceTelemetry.snapshot()` and useful-result
`current()`/`metrics()` interfaces lack a covered task-attempt denominator and
do not establish task-level later-use ownership. Their aggregate counts cannot
fill missing causal rows. journal325's one-process settlement admission and two
retained generations remain unchanged. Forward rows have no timestamps; the
projection preserves that limit. Multiple grants sharing a read record and
multiple causal attempts for a retained task/operation remain ambiguous.

The candidate under this module's `export/public` is a standalone receiving
set for the existing public-acquisition engine. Root may inspect/load it
independently; this branch changes no global manifest, catalog, mount, price,
payment rail, subscription, DB, crawler or Neo L09 surface. Its originalUrl
fields are path conventions and are not hosting evidence. Local cold receipts
are owner QA, with outside use and recognized revenue false/zero.

Validation from merchant root:

```sh
node --test task-linked-delivery/experiments/task-demand-100339/test/*.test.mjs
```

Replay the retained commands in journal325 and the settlement reconciler suites
before any receiving decision. RESULT.md records the executed checks and exact
candidate provenance. No merge, deployment or contact is requested here.
