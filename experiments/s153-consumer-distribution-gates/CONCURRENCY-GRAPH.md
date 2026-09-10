# S153 concurrency graph

Immutable pin: S137 tip `fa6878de125cfdcfd77f4b47037c88667090d293`.
Branch: `codex/s153-consumer-distribution-gates-20260910`.
Writable trees only: `experiments/s137-consumer-evidence-jobs/**`, `experiments/s153-consumer-distribution-gates/**`.

## Cells

48 gates = 6 artifacts × 8 situations. One-writer path: `gates/cNN/`.
Reuse S137 fixtures; do not recreate prior implementation cells.

| Sit | Meaning |
|---|---|
| S1 | positive supplied workflow |
| S2 | partial/missing prerequisites |
| S3 | contradictory/duplicate identity |
| S4 | malformed/oversize/type/path |
| S5 | CLI stdout/exit/batch |
| S6 | programmatic import roundtrip |
| S7 | source/receipt/freshness coverage integrity |
| S8 | distributable archive + README acquisition |

## Admission

Wave1 16, then +6/+9 while prior active if MemAvailable≥25% and disk free≥20%.
S137 lower bound: 32 OS sessions / 3498 MB RSS. Native-child canary=2 ≠ OS CLI sessions.
No grandchildren. Capture session/request IDs, overlap, RSS, MemAvailable, useful completion.

## Compatibility

R2-CONSUMER-JOBS-07/08 owned elsewhere. Keep exclusion wiring and stable export surface for the six tools.
No publication, payment, overage, accounts, wallets, or public writes.
