# Native attempt-to-useful delivery

Source base: `32f07a836fb28e400d56b0e2e876043644bde31a`. The directory name is retained from the received package. The native continuation is `codex/sol-live-attempt-delivery-261003`; it selectively receives `0c29e9fb3a9d31269f666a51957067e1ee98a90e` without merging its obsolete ancestry. Current public routes, version, readback and frozen seller041 bytes remain on master’s contracts.

A registered canonical producer begins an actual interval on the existing single-process commerce admission path. A completed cut records that interval’s start and as-of, process/session, namespace, runtime bootstrap provenance, source-code fingerprint, each plane’s presence, byte ranges, prefix hashes, admitted-write digest and rotation bounds. The cut marker persists in the existing commerce event journal. It uses the existing enrolled token for authentication; no new key, database, result store or revenue authority is created.

Native reads verify the marker and captured prefixes. Missing or unreadable files, malformed/torn rows, unregistered writes, lost generations, unsafe paths and unknown filesystem ownership cannot become covered zero. An empty interval is complete only when its actual registered producer observed no writes. A disabled settlement publisher remains unknown. Covered empty settlement *journal* activity does not prove that reconciliation, revenue or a customer exists; the existing settlement generation capture is reported separately.

The seven stages are projected separately for each server-minted event/task binding: attempt, delivery, caller assertion, fixed-predicate independent replay, authorized retained artifact, authorized later read, and attributable settlement. A useful negative remains useful. An HTTP finish can remain observed when retention is absent. A later server read leaves caller receipt and applied use unknown. Multiple attempts under one task return separate `attempts[]`, with no conversion rate or merged numerator. Wallets, body digests, user agents and HTTP 200 do not establish identity. The reader reports recognized revenue as unknown; only the existing payment and settlement classifiers own revenue. Their source contracts are unchanged.

`journalCutCoverage` describes persisted capture bounds. `liveCoverage` describes those bounds on an enrolled production runtime; it can be complete or partial from actual files while customer usefulness remains unobserved. `observationClassification` and `outsideUseEstablished` are separate facts. Fixture/owner-QA observations never establish outside customers, production use or revenue. The production-context contract test uses an explicitly isolated bootstrap fixture; its positive coverage branch is not a deployment receipt. Actual VM server-entry receipts have no hosted deployment identity and leave live coverage unresolved.

The actual canonical `/chain/transaction-receipt` route retains its payment middleware. This change observes its 402 challenge and does not introduce a free bypass. Positive and receipt-absence cases exercise canonical normalizers, Express middleware, stores and separate predicate replay through an isolated fixture mount. A second mounted consumer test exercises the actual paid retention middleware, canonical reconciler with an explicit in-memory chain port, and grant-only later reads. It preserves the original server-sealed commerce event in new paid retention rows. Their operation-contract delivery criterion is reported separately from independent replay, which remains unknown without replay evidence. The public paid negative case supplies no internal observation headers: bound transport remains unknown while canonical settlement, retained operation criterion and grant-only later read remain separately visible. Older paid rows lacking that event owner stay unbound; there is no retrospective identity fallback. Public archives and existing free scoped execution retain their existing prerequisites.

From the repo root, using the existing enrolled authority already in the environment:

```sh
node task-linked-delivery/experiments/attempt-useful-view-1005/bin/read-task-cut.mjs "$TASK_REF"
```

Set `COMMERCE_BASE_URL` only for a known service origin. The default is `https://agents.samedaydesk.com`. The token is read from `COMMERCE_INTERNAL_TOKEN`, never a URL or argument. `--cut-id "$CUT_ID"` replays a retained physical cut without extending its as-of. `--event "$COMMERCE_EVENT_ID"` selects an exact original attempt.

Before a new experiment, an enrolled operator can record a new bounded interval, without backfilling an older task:

```sh
node task-linked-delivery/experiments/attempt-useful-view-1005/bin/read-task-cut.mjs --start
```

Local persisted read, after an actual capture has been recorded:

```sh
node task-linked-delivery/experiments/attempt-useful-view-1005/bin/merchant161-delta.mjs read \
  --data-dir "$COMMERCE_DATA_DIR" --task "$TASK_REF" --cut-id "$CUT_ID"
```

Source files are capped at the canonical rotating default plus one bounded row (5 MiB + 8 KiB); total source bytes are capped at 40 MiB. Each interval range is at most 1 MiB, total interval bytes 2 MiB, 4,000 admitted row digests per plane, and the persisted cut marker 8 KiB. Over-limit intervals remain partial/refused. Prefixes or markers rotated away are unknown/partial, not fresh emptiness. Restart preserves completed physical cuts; a newly enrolled process starts a new interval. These queues provide single-process exclusion, not a cross-process lock or an fsync durability guarantee.

```sh
node --test --test-concurrency=1 task-linked-delivery/experiments/attempt-useful-view-1005/test/*.test.mjs
node task-linked-delivery/experiments/attempt-useful-view-1005/bin/merchant161-delta.mjs check
```

[Root’s deployment, readback and rollback packet](../../../../docs/reviews/sol-live-attempt-delivery-261003/ROOT-PACKET.md) records native receipts, exact validation and residual enrollment. The received historical inspection remains labeled as a historical snapshot; it does not replace merchant161’s current artifact. The frozen 421 projector and retained reports keep their original replay semantics; the native stage projection requires an authenticated capture.
