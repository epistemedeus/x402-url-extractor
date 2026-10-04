# One covered current merchant interval

Status: killed. This is a new native read. `attemptOf` is null. It is not a resume and not a remint. No second cut was started. Nothing was deployed, merged, or published.

## Identity

| Fact | Value |
| --- | --- |
| Merchant commit | `e4d984b66d49c5fb2a54008f0fa92588562a9b60` (merchant167, merge of PR 167) |
| Railway deployment | `1b407af9-85f0-46ba-b63d-d3c6b7e062bc` (named 1b407af9) |
| Origin | `https://agents.samedaydesk.com` |
| Native session | `7d7095fe-06e5-4e2a-9d71-3b482f356231` |
| GitHub commit status | success, `x402-url-extractor - x402-url-extractor`, description `Success - agents.samedaydesk.com` |
| GitHub deployment | `6832542576`, environment `x402-url-extractor / production`, sha `e4d984b66d49`, latest state success at `2026-10-03T20:13:05Z` |

The commit-status target URL contains deployment id `1b407af9-85f0-46ba-b63d-d3c6b7e062bc`. That GitHub deployment object and the Railway deployment id are different identifiers for the same published pin.

## Interval

Producer: `canonical_commerce_and_useful_result_journals`, not observed on a current cut. Deployment success is not a journal producer capture.

Population: external task attempts inside one covered current cut. Not established.

Window: none. No cut `from` / `asOf` was read.

Recognized revenue: unknown. Customer: none. Payment permitted: false. No conversion rate and no merged numerator. This operation spent nothing and did not change reward configuration.

## Six facts

Each value is for the unread current cut only.

- External task attempts. Producer: canonical commerce journal. Population: external task attempts in the current cut. Window: none. Value: unobserved.
- Protocol negatives. Producer: canonical commerce journal. Population: protocol negatives bound to attempts in the current cut. Window: none. Value: unobserved.
- Useful delivery. Producer: canonical commerce journal. Population: useful delivery stages for attempts in the current cut. Window: none. Value: unobserved.
- Retained or later use. Producer: canonical commerce journal. Population: retained artifacts and later reads for attempts in the current cut. Window: none. Value: unobserved.
- Settlement. Producer: canonical settlement journal for the current cut. Population: settlement rows joined to attempts in the current cut. Window: none. Value: unobserved. No settlement file for this cut was read, so emptiness is not claimed and is not reconciliation, revenue, or a customer.
- Missing attribution. Producer: existing per-attempt reader. Population: attempts that would have been attributed inside the current cut. Window: none. Value: the enrolled token and the production journal mount are absent, so no attempt is attributed.

A wallet, a body digest, a user agent, and HTTP 200 were not used as a customer. The public `current.json` seam and the public `/healthz` settlement ledger are different populations and were not used as this interval.

## Coverage

Journal cut: not mounted. The host has no `COMMERCE_DATA_DIR`. The only local `commerce-events.ndjson` is `docs/reviews/sol-live-attempt-delivery-261003/evidence/isolated-journals/commerce-events.ndjson`. That fixture was not used as the production interval. The existing reader returned `decision: unresolved`, `reason: unobserved_interval`, `journalCutCoverage: unknown`, `liveCoverage: unresolved`, `recognizedRevenueAtomic: unknown`, `window: null`.

Live production: unresolved. GitHub reports deployment `1b407af9` success for this pin. The journal cut on that runtime was not read.

## Named failure

`existing_enrolled_authority_required`. `COMMERCE_INTERNAL_TOKEN` is unset, so `read-task-cut.mjs --start` stopped before a request. This is an observed failure, not a covered useful negative.

Production answered an unauthenticated start-action POST with HTTP 403 `{"error":"unauthorized"}`. That response has no `captureStarted` field. This operation did not send a token and did not open a cut.

## Commands

Node `v22.14.0`. `npm ci --ignore-scripts` exit 0.

```text
git rev-parse HEAD
e4d984b66d49c5fb2a54008f0fa92588562a9b60

node task-linked-delivery/experiments/attempt-useful-view-1005/bin/read-task-cut.mjs --start
Error: existing_enrolled_authority_required
exit 1

COMMERCE_BASE_URL=https://agents.samedaydesk.com/not-root node .../read-task-cut.mjs --start
Error: service_origin_rejected
exit 1

ATTEMPT_USEFUL_PIN_PROBE=wrong-merchant node .../merchant161-delta.mjs check
{"decision":"reject","reason":"merchant_pin_rejected","attemptOf":null,"liveCoverage":"unresolved","paidSuccess":"unresolved"}
exit 2

node .../merchant161-delta.mjs check
status applied, attemptOf null, liveCoverage unresolved, thisBranchDeployed false
exit 0

node .../merchant161-delta.mjs read --data-dir docs/reviews/sol-live-attempt-delivery-261003/evidence/isolated-journals --task <fixture ref>
decision unresolved, reason unobserved_interval, journalCutCoverage unknown, liveCoverage unresolved
exit 0

curl -X POST -H 'x-samedaydesk-result-action: start-attempt-capture' --data '' \
  https://agents.samedaydesk.com/.well-known/useful-result-reuse/current.json
HTTP 403 {"error":"unauthorized"}
```

Missing fact: `COMMERCE_INTERNAL_TOKEN` is unset and no production journal directory is mounted, so the existing reader cannot read or start one covered current interval.
