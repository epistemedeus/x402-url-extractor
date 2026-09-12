# CW37 R2 current-source regression pack

Copied from the CW42 read-only pack; its workspace was not changed. Run from this checkout:

```
NODE_OPTIONS=--max-old-space-size=768 node experiments/codex-window/cw37-r2-regressions/run.mjs "$PWD" /absolute/receipt.json
```

One test worker, 768MB heap, loopback port 55543, isolated temporary commerce stores. A network fence permits only loopback and the intercepted fake facilitator. Credentials and signing callbacks are dummy fixtures; no real signing or settlement occurs. The runner checks tracked source hashes before and after execution. New source must be tracked before running its missing-fixture mirror.

Original CW42 witnesses were rerun on 79229d0: 27 passed, 14 failed. R2 retains these witnesses, adds the production enablement gate and raw MCP numeric admission. The attestation witness now explicitly verifies the incumbent signature, verifies that vendor is uncovered, checks published per-operation coverage, and separately checks production-mode refusal. It does **not** claim a new vendor signature. Signing remains outside this task.

Numeric expectations are explicit mathematical relations between raw decimal literals, independent of JSON.parse. The accepted domain is finite raw decimal values exactly equal to the decimal value of Number's canonical serialization. Equivalent spellings and signed zero are accepted; rounding and underflow aliases are rejected before settlement. This is a bounded numeric domain, not arbitrary decimal precision.
