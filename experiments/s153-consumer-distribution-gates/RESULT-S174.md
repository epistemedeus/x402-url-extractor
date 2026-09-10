# S174 consumer final CLI fix

Base: S153 export `d520699802622a715cde1d894cc5547c42b2dca7` (kit pin lineage `fa6878de125cfdcfd77f4b47037c88667090d293`).
Branch: `codex/s174-consumer-final-cli-fix-20260910` @ `891dc330e64a521abf4da2229db944d2c1111982`.
Writable: `experiments/s137-consumer-evidence-jobs/**`, `experiments/s153-consumer-distribution-gates/**`.

## Defect (Bot Useful recheck evidence)

Recheck branch resolved by Git: `codex/r2-consumer-s170-s153-recheck-20260910` @ `c36eff932c983d9ad06cd6d6e5ea8466f457c1e4`
(user alias s169 / `codex/r2-consumer-s169-s153-recheck-20260910` not present; S170 is the actual exported recheck head).

Reported: release-brief + `fixtures/synthetic/release-brief/cases/conflict-sha-mismatch.json`
returned decision=pass with cli.schema-rejected. Expected conflict/fail.

Root cause:
1. CLI fed the synthetic-case wrapper to schema + transform.
2. Schema correctly rejected the wrapper.
3. release-brief source wrap treated lanes.* string paths as empty lane documents with agreeing empty identities, yielding false pass.
4. pickDecision preferred transform pass over schema rejection.

## Fix

- CLI unwraps synthetic-case envelopes to nested `.input` (operator --clock preserved).
- Transform ignores non-object lane path strings (no empty-identity false align).
- pickDecision: schema rejection + transform pass becomes fail; preserves partial/conflict/fail/unknown.

## Literal CLI results (Node v22.23.2)

Merchant pack:

```
node experiments/s137-consumer-evidence-jobs/scripts/cli.mjs analyze release-brief \
  --in experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/cases/conflict-sha-mismatch.json \
  --clock 2026-09-10T18:00:00.000Z
```

Result: decision=conflict ok=true (no cli.schema-rejected).

Controls: positive-aligned=pass; partial-announced-only and partial-missing-tested=partial;
other conflicts=conflict; negative-draft-only=fail; negative-empty=unknown.

Clean unpack of regenerated kit/dist/s137-consumer-evidence-kit.tgz:

```
node bin/cli.mjs analyze release-brief --in examples/release-brief/conflict-sha-mismatch.json --clock 2026-09-10T18:00:00.000Z
# decision=conflict
node bin/cli.mjs analyze release-brief --in examples/release-brief/positive-aligned.json --clock 2026-09-10T18:00:00.000Z
# decision=pass
node bin/cli.mjs analyze release-brief --in examples/release-brief/partial-announced-only.json --clock 2026-09-10T18:00:00.000Z
# decision=partial
```

## Tests

- New: test/release-brief-cli-regression.test.mjs 6/6
- Release-brief + catalog suites 27/27
- S153 gates 48/48 (no quota-filler cells; capacity evidence unchanged)

## Fixed / remaining

| Item | Status |
| --- | --- |
| release-brief conflict-sha-mismatch CLI pass+schema-rejected | fixed |
| S158-03/04/05 (prior draft) | not reopened; no independent repro on this head beyond the SHA-mismatch defect |
| Jobs 07/08 / Bot wrappers | unchanged; recheck packet used as consumer evidence only |

## Capacity

Preserved from S153: peak 49 OS grok --cwd sessions; native-child canary remains S137 childrenStarted=2. No new capacity cells.

## Non-claims

Offline only. No publish/merge/deploy, payment, overage, or quota reset.
