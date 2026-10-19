# Persisted merchant audit outcomes

The HTTP capture retains complete bounded bytes only long enough to validate
them. `full_bounded_capture` never meant that the body was stored. The existing
canonical serializer deliberately excluded that transient body; an old digest
cannot recover its semantic outcome.

`recordFromObservedResponse` now derives an optional `outcomeSummary` directly
from the parsed bytes already checked against the owning seller-audit contract.
The existing validation journal persists it together with `outcomeSummaryStatus`.
There is no response-body retention, migration or retrospective backfill.

## Version and bounds

`samedaydesk.seller-audit-outcome.v1` supports seller output `1.3.0` and completed
audit reports `agent-payment-integrity.audit.v4`. Its fixed scalar fields are:

| Fields | Allowed values / meaning |
| --- | --- |
| `schemaVersion`, `responseDigest` | Fixed summary version and the exact parent response digest |
| `decision` | `machine_buyable`, `contract_ready`, `repair_required` |
| `auditCompleted` | Whether the bounded audit completed, independently of delivery and usefulness |
| `failureCategory` | `none`, `unknown`, or one of the five route-owned failure codes |
| `runtimeCoverage` | `verified`, `static_post`, `target_unconstructible`, `probe_failed`, `challenge_unverified`, `incomplete`, `unknown` |
| `contractCoverage` | `admissible`, `absent`, `partial`, `invalid`, `unknown` |
| `repairMode`, `repairComplete` | `advisory` / `absent`; boolean / null |
| Finding counters below | Integers 0–99 in each fixed category |
| `findingOverflow` | True when at least one category exceeds 99; a count of 99 then means at least 99 |

The failure codes are `exact_route_not_declared`, `openapi_unavailable`,
`openapi_invalid`, `route_ceiling_exceeded`, `bounded_transport_failure`.
Unknown codes retain only the typed `unknown` category.

The finding counters are `contractAbsent`, `contractPartial`, `contractInvalid`
(the corresponding exact `seller_response_contract_*` codes),
`requiredPathMissing` and `targetInvalid` (known prefixes, excluding their
arbitrary suffixes), `bindingMismatch` (exact full-request-binding code),
`economicsMismatch` (the three known economics/declaration mismatch codes),
`protocolInvalid` (known x402/MPP challenge/schema/realm codes),
`bazaarInvalid` (the enumerated Bazaar findings and its two example-invalid
prefixes), `probeFailed` (credential-free probe failure), and `unknownFindings`.
The exact mapping lives in `http-delivery-evidence/seller-outcome.mjs`.

The summary is at most 1,024 UTF-8 bytes with no arrays or nested objects. It
retains no target, query, path/property name, repair text, origin, participant,
credential, payer or wallet. Repair/path counts and raw strings are omitted.

## Receiving behavior

The parent record supplies the route, contract and validator authority. The
summary must match its response digest, complete byte lengths, schema counters,
HTTP status and delivery classification. Only complete schema-checked bodies
qualify; an incomplete audit can retain a failure summary while its technical
validator verdict remains `unknown`. Contradictory fields cannot establish a
semantic outcome. A private metadata seal detects mutation before live append.

Missing old fields remain absent. Unsupported versions become `unsupported`;
malformed or contradictory semantic metadata becomes `invalid`, with a null
summary. These failures preserve the ordinary technical evidence and never
change payment authority or trigger another delivery. The actual frozen-base
serializer accepts new journal rows and ignores the optional summary; the new
reader accepts its old producer rows without inventing one.

`ordinary-delivery-join-cli.mjs` uses the existing event/digest/route/reference
join before exposing a summary. Identical duplicate validation appends count
once per report row; conflicting summaries do not choose a winner. Its
`sellerAuditOutcomes` contains fixed availability, decision and coverage counts
for seller-audit rows in that window. The digest is omitted from the operator
export. Historical missing counts, whole-window coverage, audit completion,
technical delivery and optional caller feedback stay separate. A summary
supplies no caller statement, identity, usefulness or revenue classification.

## Source validation and installation handoff

Base: `b309c6e2a1e1794a324c1c422c1c841a76038686` on `master`.
The draft PR records the exact final head/tree and actual command receipts.
Service version for this successor is `1.23.55` in `package.json`, both
`package-lock.json` version fields, `server.json`, and
`plugins/samedaydesk-x402/plugin.json`.

The first same-process HTTP run reported 45/45. Root's later cold replay was
44/45: `diagnostic-delivery.test.mjs` lost-summary teardown raised `ENOTEMPTY`
because a paid response started `noteContinuationTransmission` as an untracked
dynamic import while `flush` waited only for the commerce-event queue. The
successor owns that already-started measurement and drains it from `flush` and
from the typed MCP lifecycle, without awaiting it on the response or send path
and without nesting journal admission. An observation failure does not retry
the paid event, rewrite the summary, or charge.

Successor checks on Node v22.14.0 ran serially with
`NODE_OPTIONS=--max-old-space-size=384` and exited 0: cold lost-summary 1/1,
HTTP evidence 49/49, seller route 7/7, non-live 214/214, payment/replay/
feedback/continuation lifecycle 166/166, construction/machine/version 20/20,
deployment publication 6/6, startup and runtime-source 4/4, and machine-surface
HTTP 1/1. Plugin manifest checks passed 7/7; the pre-existing unpaid live
initialize test stays skipped unless `SAMEDAYDESK_EXPECTED_LIVE_VERSION` is
set. These groups overlap and are not added. The complete repository-wide
`npm test` is not the receipt. Draft PR 212 records the commands and limits.

The regressions exercise the real seller producer, capture middleware,
canonical append/restart reader, ordinary join and operator CLI. They cover
static and partial coverage, useful negative decisions, incomplete audits,
unknown codes/versions, overflow, wrong digest/route/validator/reference/event,
caller injection, contradictory metadata, canary strings, duplicate/replay and
a failed observation write. All settlement/payment fixtures are synthetic.

Root can receive the exact PR head in an isolated checkout, compare its tree to
the PR receipt, and run:

```sh
NODE_OPTIONS=--max-old-space-size=384 npm ci --ignore-scripts --no-audit --no-fund
NODE_OPTIONS=--max-old-space-size=384 npm run test:http-delivery-evidence
NODE_OPTIONS=--max-old-space-size=384 node --test --test-concurrency=1 seller-integrity-audit.test.mjs ordinary-delivery-join.test.mjs
```

Integrate through the existing release controller on the next real release.
No new configuration, service, journal or schema migration is needed. After
that release and the next real paid audit event, use the existing metadata-only
read path with the actual installed source SHA and a finite event window:

```sh
node ordinary-delivery-join-cli.mjs \
  --data-dir "$COMMERCE_DATA_DIR" \
  --window-start "$EVENT_WINDOW_START" \
  --window-end "$EVENT_WINDOW_END" \
  --coverage unknown_for_full_window \
  --source-sha "$INSTALLED_SOURCE_SHA"
```

Receive an exact joined summary for that new event, its explicit completion and
coverage, and unchanged caller feedback/usefulness. Inspect missing/invalid
counts independently. Do not reconstruct historical bodies or infer complete
window coverage from summary availability. Keep operator output private.

This handoff stops at tested source. Deployment and installed receiving on a
real paid event remain Root-owned and have not been performed here.
