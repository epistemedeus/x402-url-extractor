# c27 DONE

S153 link-index S3 (conflict-identity) on pin `fa6878de125cfdcfd77f4b47037c88667090d293`. Reuses S137 synthetic conflict fixtures; does not recreate c16–c20.

Proven: `transformLinkIndex` keeps decision `conflict` for `conflict-duplicate-ids` (`#install` stays conflict; both id hashes remain), `conflict-duplicates` (`Guide` stays bound to alpha.md and beta.md hashes; duplicate href rows kept), and `exampleCases().conflict` (same locator, two `contentSha256`s). `validateOutput` rejects `pass` + `conflicts[]`. CLI `analyze link-index` exit 0, decision `conflict`, cited `conflicting_target`, offline / no spend.

Files: `PIN.json`, `helper.mjs`, `gate.test.mjs`, this DONE.md.
Test: `node --test experiments/s153-consumer-distribution-gates/gates/c27/gate.test.mjs` — 6 pass, 0 fail. Jobs 07/08 out of scope.
