# ROOT-1004 extract task completion

status: done

Candidate: optional `textExcerptLimitChars` on the existing extract path, plus the existing customer caller deciding completeness from capture flags and an explicit predicate. No new paid route, price, recipient, or response fields.

## What changed

- Default excerpt stays 1,200 characters. A caller may set `textExcerptLimitChars` from 1 through 40,000, the same returned-text ceiling as `GET /read`. Bad values return HTTP 400 `charged: false` before fetch or settlement. The price stays 5000 atomic USDC (0.005) and payTo stays `0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee`.
- Batch uses the same parser and a tighter ceiling so five excerpts cannot pass admission and then exceed the 128 KiB response cap. Five URLs admit 4,096 characters. Omitting the key leaves the canonical body unchanged.
- `decideExtractTask` does not fetch or pay. Schema-pass without a predicate is not task completion. A cropped excerpt with an excerpt predicate is `partial_delivered` and names `raise_excerpt_budget` with `purchaseAuthorized: false`. Markdown names existing `GET /read` and does not call it. Source refusal stays refusal. A 3 MB body cutoff is `source_budget_exhausted`. Metadata can be satisfied while body text is cropped.
- URL-only responses keep the same JSON keys. The old customer fixture with no capture and no task stays `valid_delivered`.

## Measured

Population: hooked fixture hosts and one local merchant with a fake facilitator. Cost: 0 USDC. No source plaintext retained. Historical October 4 purchases were not repeated.

| Case | Predicate | Result |
| --- | --- | --- |
| Short page | excerpt, 5 chars | satisfied, text length 5, not truncated, 6 ms |
| Default long page, no predicate | none | schema-pass, text 1,200, `textTruncated` true, satisfied null, delivery partial, next `/read` not executed |
| Same record | metadata | satisfied, reason `metadata_sufficient_text_cropped` |
| Same record | excerpt, 2,000 chars | unsatisfied, `raise_excerpt_budget`, not executed |
| Excerpt budget 8,000 | excerpt, 2,000 chars | satisfied, marker present, text length 2,423, `textTruncated` false, same response keys |
| Markdown predicate | markdown | unsatisfied, next `/read` not executed; a separate read was 2,424 chars, marker present, not truncated, 3 ms |
| Read bound | markdown, 40,001 chars | markdown length 40,000, truncated, `bound_exceeds_product` |
| 403 | excerpt | `source_refused`, schema-pass, not a second purchase |
| Abort at 40 ms | excerpt | producer `timeout`, caller unavailable, 41 ms |
| Redirect | excerpt, 5 chars | requested `start.example`, final `end.example/page`, satisfied |
| 4 MB stream | excerpt | body 3,000,000 bytes, both truncation flags, `source_budget_exhausted`, 20 ms |
| Non-object body | excerpt | delivery invalid |
| Five-URL batch at 40,000 | admission | rejected before fetch; omitted key stays absent |
| Old fixture, no task | none | `valid_delivered`, task satisfied null |
| Cropped excerpt through the caller | excerpt, 2,000 | `partial_delivered`, not useful |
| Settlement `success: false` | excerpt | `settlement_failed`, next action not executed |
| Mounted `textExcerptLimitChars=0` | seeded failure | HTTP 400, charged false, settle 0, source fetches 0, 26 ms |
| Mounted unpaid default and 8,000 | challenge | both HTTP 402, amount 5000, same payTo, description 402 code points |
| Mounted paid default then replay | same payment id | replay `hit`, settle stays 1 |
| Same payment id with budget 8,000 | conflict | HTTP 409, charged false, settle stays 1 |
| Separate paid `/read` | markdown route | HTTP 200, marker present, not called by extract |

Live origin readback on 2026-10-04, this branch not deployed:

`curl -sS --max-time 20 "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com&textExcerptLimitChars=0"`

HTTP 402, amount 5000, same payTo, description 493 code points, description does not name `textExcerptLimitChars`, Bazaar query parameters are only `url`.

## Verify

```
env -u FORCE_COLOR -u NO_COLOR node --test extract.semantics.test.mjs extract-task-completion.test.mjs extract-batch.test.mjs examples/customer-x402/test/customer-x402.test.mjs examples/customer-x402/test/request-construction.test.mjs
```

Exit 0. 52 tests, 51 pass, 1 skip, 0 fail.

```
env -u FORCE_COLOR -u NO_COLOR node --test extract-task-completion.http.test.mjs
```

Exit 0. Mounted journey passed in 1881 ms.

```
env -u FORCE_COLOR -u NO_COLOR node --test plugins/samedaydesk-x402/plugin.test.mjs extract.http.test.mjs extract-batch.http.test.mjs goose-native.test.mjs mcp-output-schema-extract.test.mjs
```

Exit 0. 46 tests, 45 pass, 1 skip, 0 fail.

```
env -u FORCE_COLOR -u NO_COLOR node experiments/extract-task-completion-1004/measure.mjs
```

Exit 0. Writes `EVIDENCE.json`.

## Limits

The two October 4 calls remain usefulness-unknown. This run does not identify a payer or claim those calls needed a full document. Neither route executes JavaScript. A larger excerpt does not recover a body stopped at 3 MB. Batch cannot carry a 40,000-character excerpt for five URLs. Root integrates and deploys; this branch is not live.

## Next outside check

After integration, the same public curl must return HTTP 400 with `charged: false` before any 402. Then one declared excerpt predicate on a fixture, with `requiredChars` above 1,200, must stay `partial_delivered` and must not purchase another route.
