# c36 DONE — replay-pack S4 malformed-input

Replay-pack (R2-CONSUMER-JOBS-05) fail-closes on reused S137 negatives: `negative-missing-examples` (no example bytes; none invented) and `negative-paid-marker` (HTTP 402 is a refusal, not executed spend). Schema `selfCheckFixtures().negativeInputs` are `invalid` → decision `fail`. Missing operator clock throws; `now`, empty/wrong-type `examples`, secret headers, synthesized responses, satisfied `paid-endpoint`, `file:` URLs, and >64 examples never become `pass`.

CLI `scripts/cli.mjs analyze replay-pack` on those `case.json` files/dirs exits 0 with packet `decision=fail`. Remote `--in` URLs exit 1 with no packet; missing path and >1 MiB inputs exit 1 with `decision=fail`. Invented `--clock now` exits 2. Unparseable `{`-prefixed text is a stable exit 0 with **observed** `decision=partial` (transform threw; not claimed fail). Offline, `payment.attempted=false`, spend 0. Jobs 07/08 unused.

Files: `gates/c36/PIN.json`, `helper.mjs`, `gate.test.mjs`, `DONE.md`. Read-only reuse of `src/replay-pack/{schema,transform}.mjs`, `scripts/cli.mjs`, `fixtures/synthetic/replay-pack`. Test: `node --test experiments/s153-consumer-distribution-gates/gates/c36/gate.test.mjs` — 10 pass, 0 fail.
