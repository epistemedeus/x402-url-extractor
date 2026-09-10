# c04 DONE — migration-checklist S4 malformed-input

Pinned S137 `fa6878de125cfdcfd77f4b47037c88667090d293`. Reused `negative-malformed-inventory` and `negative-missing-new-docs`; did not recreate S137 cells. Jobs 07/08 out of scope.

Proven: `transformFixtureCase` yields `decision=fail`, `coverage=missing`, cited `malformed-inventory` / `missing-new-docs` (`invalid-input`); missing `new.md` is not invented. Hostile keys fail without throw; missing clock throws (not invented). `validateInput` is `invalid` for non-array operations, `"now"`, paid claim, oversize path.

CLI `analyze migration-checklist --in <negative case>` exits 0 with a fail packet (stdout stable across reruns). Unreadable `--in` and `https://` exit 1; missing `--clock` and jobs 07/08 exit 2. Offline, `payment.attempted=false`, demand claims stay false.

Files: `PIN.json`, `helper.mjs`, `gate.test.mjs`, this DONE.md. Command: `node --test experiments/s153-consumer-distribution-gates/gates/c04/gate.test.mjs` — 11 pass, 0 fail.
