# CW18 review and repair result

- Source: `82a521a8b8778b2224cf5fd5ade2f14d7618d139`; branch `codex/cw18-astra-outcome-evidence-20260912`. Full source preserved; changes only in this experiment.
- Original worker tests: 10/10 passed. Independent hostile CLI replay: 42 failures / 45 cases before; all 45 pass after repair. Complete adapter suite: 61/61 pass.
- Fixed real serializer transaction redaction, purchase/reconcile joins and contradictions, transaction/authorization replay, GET source identity and source-refusal classification, unknown historical output, caller-feedback binding, and portable-export/file boundaries.
- Customer regression: 197 pass, 7 skipped, 0 failed. Skips: one live preflight and six mounted merchant-runtime cases with unavailable dependencies.
- Adapter/CLI coverage: 99.17% lines, 86.55% branches, 100% functions. Sequential Node tests; heap capped at 768 MB. No production acceptance or live payment/RPC.
- Export v2 is explicitly unsigned local-file evidence. Fixture purchases and arbitrary feedback cannot establish independent use, organic demand or revenue. See [README](README.md) for compatibility and trust limits.
- Before/after matrix, exact input and tested-file hashes: [review-evidence.json](results/review-evidence.json). Final candidate head and PR are recorded in the task workspace `RESULT.md` after publication.
