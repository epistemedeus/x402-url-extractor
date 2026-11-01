# CW35 reviewed consumer receipt

## Exact sources and ownership

- Reviewed CW02 export: `8b86ebcc04ce27d19f2fccc5ddff8799cb860668`.
- Owning merchant base: `0153295c5851bf8f93fb27c77070a31417a59f69`.
- Actual mounted server and maintained buyer: frozen PR61
  `3cb29f079604071e041a4b794990bb65fc593b3e`.
- Review branch: `codex/cw35-repeat-buyer-review-20260912`.
- All changes are within `experiments/codex-window/cw02-repeat-lockfile/`.
  No shared merchant, maintained buyer, payment architecture, or CW18 edit.

## Accepted repairs

1. Match maintained npm pin normalization, including trimmed values, numeric
   versions, non-string integrity, workspace names, BOMs, and nested dependency
   maps. Reject oversized/non-regular inputs and excessive JSON graphs.
2. Require explicit boolean execution approval plus a separately bound approval
   with textual operator/time metadata. Normalize and validate priced terms;
   refuse malformed and unknown CLI arguments before execution.
3. Acquire an exclusive per-intent filesystem lock before wallet child startup.
   A preexisting lock or attempt blocks replay even if state still says prepared.
   Unknown outcomes retain the original identity; no automatic retry/unlock.
4. Independently validate paid product/schema, digest, counts, normalized pin
   metadata, full added/removed/changed evidence, analysis, and output/price caps.
   An unrelated, forged, or truncated response is `paid_invalid_output`.
   Missing integrity remains `partial_delivered`, not full fulfillment.
5. Bound child execution to 90 seconds and 2 MiB output, preserve split UTF-8,
   and refuse success for unknown or unclean child results.

## Executed evidence

- Original exported six-test gate: 6 pass, 0 fail.
- Six new root-cause regressions on that original source: 0 pass, 6 fail.
- Final revised package gate: **37 pass, 0 fail, 0 skip**.

Final remote command:

```sh
CW35_MERCHANT_ROOT=/workspace/pilot/tmp/w5-heavy-paid-job-bridge-20260912-r1/x402-url-extractor npm test
```

Run from this package in the review worktree. Receipt/log:
`/workspace/pilot/receipts/worker-jobs/cw35-release-acceptance-20260912.{json,log}`.

The gate invokes the actual maintained CLI against a real mounted merchant
process and fake facilitator with disposable unfunded keys. It covers actionable
and no-change output, membership and nested pins, response loss and same-identity
retry refusal, five paid-response mutations, price/recipient/route challenge
mismatch before verification, partial integrity, changed approved body,
same-process and separate-process concurrency, and explicit flag-off behavior.
It also performs an offline tarball install and verifies installed prepare
emits the same intent and approval remains false.

The earlier CW02 18/19 wider customer run remains historical evidence, not a
passing gate claimed here. Frozen PR61 separately recorded the full maintained
buyer run (211 pass, one optional skip). No shared-source correction was inferred
from that older mounted GET/extract failure.

## Remaining acceptance and limits

No merge, deployment, feature enablement, production request, funded payment,
registry publication, credential change, or overage occurred. This is owner QA,
not an independent customer or revenue claim. Merchant integration/release
acceptance belongs to the separate PR61/PR62 integration owner.

The amount authorization is a cap, not an exact live quote lock. Updated terms
normalization may require a fresh approval, but never use that to bypass an
unreconciled older attempt. Preserve the same durable state and old receipts.
The filesystem lock assumes one operator-controlled local state directory;
it is not distributed coordination or protection from an operator editing
their own state. Failures after dispatch intentionally require reconciliation.
