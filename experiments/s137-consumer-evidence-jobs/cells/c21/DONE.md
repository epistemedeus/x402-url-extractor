# c21 DONE

Cell: `c21`  
Job: `R2-CONSUMER-JOBS-05` (official-example offline replay pack schema)  
Schema: `s137.replay-pack.input.v1` / `s137.replay-pack.output.v1`  
**evidenceClass:** synthetic

## Files written

| Path | Role |
| --- | --- |
| `src/replay-pack/schema.mjs` | Input/output shapes, online-prereq rules, validators |
| `cells/c21/schema.test.mjs` | node:test positive/negative/partial/conflict |
| `cells/c21/DONE.md` | this file |

Did not write `fixtures/synthetic/replay-pack/` (c23), `fixtures/real/replay-pack/` (c24), `src/replay-pack/transform.mjs` (c22), or `test/replay-pack.test.mjs` (c25).

## Test command

From repo root `/tmp/s137/x402-url-extractor`:

```bash
node --test experiments/s137-consumer-evidence-jobs/cells/c21/schema.test.mjs
node experiments/s137-consumer-evidence-jobs/src/replay-pack/schema.mjs --self-check
```

Result: **23 pass, 0 fail**; self-check `{"ok":true,"tests":6}`.

## Contract (for c22)

- Default replay is offline. `online.requested` requires an explicit `prereqs[]` list and allowlist.
- `onlineReplayAllowed` is true only when consent is true, every required prereq is satisfied, the allowlist is non-empty, and no blocking kind is present.
- Blocking kinds (`paid-endpoint`, `account-signup`, `spend-authorization`) cannot be satisfied.
- Recorded responses must be supplied. `synthesizedResponse` and `fakedProviderExecution` are invalid.
- Every example and finding needs `citationIds` into `citations[]` (path and/or url; sha256 when content is present).
- Operator `clock` is required; `"now"` is refused.
- Output stays `offline: true`, `payment.attempted: false`, `cost.assignmentSpendUsd: 0`.

## Limitations

- Schema validation only; does not fetch, sign, pay, or execute providers.
- Missing recorded responses stay partial; responses are not synthesized.
- No real official snapshot in this cell (c24 owns `fixtures/real/replay-pack/` + PROVENANCE).
- Secret header values must be `REDACTED`; this pack does not store credentials.
- Path-only OpenAPI URLs cannot become `online-ready` without an absolute https URL on the allowlist.

## evidenceClass

`synthetic`
