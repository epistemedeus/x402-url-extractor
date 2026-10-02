# Verification receipts

Authoritative acceptance is `consumer-final.tap` (26 passed, no failures/skips)
and `retained-owners.tap` / `retained-owners.json` (156 passed, no failures/skips).
All ran on the actual Cursor Cloud VM. These two sets contain 182 tests; do not
add subset runs or repeated acquisition checks to that denominator.

`owner-source-check.json` verifies 75 exact merchant owner files in both the
received checkout and disposable QA copy, plus the verbatim response digest and
license. `verification.json` binds acceptance receipts to the tested executable
file inventory. `equal-task-comparison.json` preserves two actual direct versus
received mounted cases with matching inputs/predicates and observed sequential
timings. It makes no customer, revenue, cost, review-effort or savings claim.

The full suite includes the unchanged merchant server, actual scanner/retest and
retained-result owners, journal proof/scope/correction/restart/missing/torn controls,
deadline/body/cancellation/redirect controls, two stripped caller processes,
concurrent reservations, lost output, killed in-flight recovery, archive import
closure and the patch applied to a disposable source copy. The paid-shaped journal
capture and customer grant are disposable QA; no real settlement is observed.

`checkpoint-contract.tap`, `owner-baseline.tap`, `core-controls.tap`,
`cold-server.tap`, `journal-consumer.tap`, `narrow-patch.tap` and
`archive-acquisition.tap` and `patch-export-final.tap` are narrower receiving/checkpoint runs.
The latter receives the normalized patch and archive after the final full suite;
Git apply check and source/documentation whitespace checks pass; raw historical
TAP indentation is preserved.
`core-initial.tap` and `core-receiving.tap` preserve intermediate fixture failures
that preceded the final passing run. They remain debugging history, not current
acceptance. `retained-owners-run.json` is the original wrapper stdout for the same
156-test run. No historical subset or retry is a new independent result.

Raw private caller receipts and source context are not retained here. They are
excluded from Git and the source archive. `acquired-exact-export.tap` receives the final sealed archive (not rebuilt source),
and its receipt is bound to that archive in `verification.json`.

Hosting, public acquisition, outside
requester utility, production rights and paid service delivery remain unobserved.
