# PR61 Codex release-gate repair

Reviewed admitted merchant head `66f3ca639917db55f26e15278c47acecad4799f5`
against base `0153295c5851bf8f93fb27c77070a31417a59f69`.
This is implementation and fake-facilitator evidence, not a production release.

## Reproduced defects and repairs

- A 250-row compare fit worker stdout, but formatted output erased evidence
  arrays while retaining `charged:true` and counts of 250. Evidence is now
  indivisible: optional Markdown is dropped first, then oversized complete
  output is refused before settlement. A 1 KiB recovery-envelope reserve is
  included in the response ceiling.
- Maintained CLI accepted unrelated 2xx JSON with the expected field names.
  Its vendor verifier now checks exact product/schema, completion, quote cap,
  engine digest, per-category counts and evidence against the authorized rows.
  Cross-unit or non-finite arithmetic results remain `partial_delivered`.
- Settlement ambiguity and a hard process kill at facilitator mutation lost
  the precomputed comparison. The vendor route opts into the existing replay
  store's pre-settlement durable candidate. First ambiguous responses and
  exact-credential retries expose the result with `charged:null` and
  `settlementConfirmed:false`; they do not claim paid fulfillment. Recovery
  after restart does not settle again. Changed-body reuse remains 409.
- Trailing-slash and case aliases could enter Express/x402 while bypassing the
  literal replay route set. Vendor aliases now refuse before verification.
- Unbound vendor preflight incorrectly used batch admission. It now uses the
  same pricing-body admission as authorized vendor purchases.
- Worker admission was unlimited. At most four worker children are active per
  merchant process; the ceiling may only be reduced. Excess requests receive
  an uncharged `busy` response. Field/unit strings are capped consistently.
- Membership-only scans emitted a no-budget-delta action. The projection now
  retains added/removed keys, raw values and units using the authoritative SDS
  mapping at `485a5023843f27bb920ad2a26ad0631fa1bbb4bd`. Same-unit finite
  subtraction is explicit; overflow omits the numeric delta and stays partial.
  No bill calculation, live quote, conversion or source-coverage claim is made.
- Corrected the merchant base in the original receipt. Added explicit mapping
  provenance without rewriting the retained 1.4.0 compare/archive pins.

## Executed evidence

All builds/tests ran on the remote VM. No production credential or money was
used. Disposable buyer keys were unfunded; facilitator responses were fixtures.

- Original head: six decisive mounted HTTP/actual CLI regressions fail as
  expected. Remote receipt:
  `/workspace/pilot/receipts/worker-jobs/pr61-codex-baseline-repro-20260912.log`.
- Corrected runtime: 97 merchant/replay/lockfile/discovery/payment-contract
  tests pass, with zero failures/skips.
- Maintained buyer package: 211 pass, zero fail, one existing optional live skip.
- Final runtime receipt:
  `/workspace/pilot/receipts/worker-jobs/pr61-codex-final-runtime-20260912.log`.
- The tests include actual mounted merchant processes, maintained CLI
  inspect/approve, unrelated response rejection, worker crashes/timeouts/stdout
  bounds, hard-kill/restart, exact-credential recovery, changed-body conflict,
  signed/unsigned URL aliases, concurrent overload and an explicit flag-off
  extract/catalog baseline. All task-created test children exit.

Original Root replay measurement is preserved at `cost-measure.json`, SHA256
`e1c1ef110aa4d8bbaaaf42648669e7a3eb5e0a3500ab226c2e42783ae98ae5fd`.
New measurements are separate in `cost-measure-codex.json`: ordinary worker
33 ms, ordinary mounted HTTP 61 ms. Arrival cohorts of 6 and 12 respectively
produced 4 successful/2 busy and 9 successful/3 busy requests. Arrival count is
not simultaneous worker count; the cap remains four. Margin is still an
estimate, not demonstrated profit. Tests no longer overwrite retained receipts.

## Remaining release acceptance

The final Sol source advisory still needs controller adjudication against this
amended head. No merge, deployment, signing-key change, feature-flag enablement,
production payment or provider overage occurred. The route remains default off.
A release must integrate the final reviewed source, generate/verify the current
deployment statement and discovery metadata, and perform proportionate deployed
readback. Ambiguous settlement stays unconfirmed until independently reconciled;
the preserved comparison is not a confirmed paid-delivery claim. No customer
demand or settled revenue is implied by these tests.
