CW37 R2 committed and pushed: `3c48c0f9979c58bf6757b439a020b8cf79a6f857`, draft PR65.

F5 dormant boot and F6 lossy raw-number admission repaired. F7 operation metadata now declares x402-only behavior and actual attestation coverage; R1 MCP and unknown-settlement retention remain intact.

Executed: 43/43 R2 leaf regressions (47 TAP tests), 336/336 merchant/shared tests, 211 buyer passes and one optional live skip. Baseline current head reproduced 14 failing leaf checks. Fake facilitators and isolated local stores only.

Production vendor enablement remains blocked: the installed signed statement does not cover this route. No real payment, production signing, deployment, merge, or model API billing.

Full tracked receipt: `docs/merchant-integration-review-r2-2026-09-12.md`; raw evidence: `experiments/codex-window/cw37-r2-regressions/evidence/`.
