# c07 DONE

S7 coverage-integrity for `migration-checklist` (R2-CONSUMER-JOBS-01). Pin `fa6878de125cfdcfd77f4b47037c88667090d293`.

Proven: synthetic PROVENANCE/SOURCE-PINS and schema `PINNED_SOURCE_HASHES` match observed bytes; real x402 v1→v2 artifacts match claimed sha256 and Apache-2.0 LICENSE/NOTICE (not an attestation). `retrievedAt` ≠ `sourceCommitDate`; captureLabel `live-capture` vs replay `fixture` stay distinct. Transform `positive-complete` is `pass` with citation hashes from PROVENANCE. A wrong claimed sha256 is `conflicting_source`, claimed hash is echoed, observed bytes are not overwritten, decision stays `pass`. Real transform is `pass` while schema coverage and `observations.json` stay `partial` (omitted STATE / uncaptured schemes); those labels are not merged. CLI analyze of the pinned case is `pass`, offline, no 07/08; `--evidence-class live-capture` without capture is `conflict`. Packets and kit exclude S137 concurrency receipts.

Files: `gates/c07/PIN.json`, `gates/c07/helper.mjs`, `gates/c07/gate.test.mjs`, `gates/c07/DONE.md`.

```bash
node --test experiments/s153-consumer-distribution-gates/gates/c07/gate.test.mjs
```

11 pass, 0 fail. Offline only.
