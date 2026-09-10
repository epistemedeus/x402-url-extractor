# c07 DONE

Cell: `c07`  
Owns: `src/release-brief/transform.mjs`  
Job: R2-CONSUMER-JOBS-02 (release evidence brief)  
Depends on: c06 `src/release-brief/schema.mjs`  
evidenceClass: **synthetic** (self-check also replays c09 `fixture` GitHub JSON; no live GET in this cell)

## Summary

`buildReleaseBrief(input)` turns operator-supplied commit/release sources into an auditable brief with separate **announced**, **shipped**, and **tested** planes.

- GitHub Releases JSON is split: notes/draft/body stay announced. `tarball_url` / branch `target_commitish` are not a ship.
- Git tag / commit / npm digest kinds occupy shipped. CI / test-receipt kinds occupy tested.
- Changelog labelled shipped is re-homed to announced and `decision=fail` (`plane_conflation`).
- Draft announcement with no shipped source is `fail` (`draft_not_shipped`), not shipped.
- Pass requires all three planes with agreeing identities. Missing a plane is `partial`. Tag/SHA disagreement or “All tests passed” vs CI `failure` is `conflict`.
- Operator clock is required. `"now"` is refused. No network, spend, demand, or attestation.

## Files written

| Path | Role |
| --- | --- |
| `src/release-brief/transform.mjs` | Transform + node:test / `--self-check` |
| `cells/c07/DONE.md` | this file |

## Test command

From repository root:

```bash
node --test experiments/s137-consumer-evidence-jobs/src/release-brief/transform.mjs
node experiments/s137-consumer-evidence-jobs/src/release-brief/transform.mjs --self-check
```

Result: **10 pass, 0 fail**. `--self-check` ok.

Integrator:

```js
import { buildReleaseBrief } from "./src/release-brief/transform.mjs";
const { ok, decision, brief } = buildReleaseBrief(input);
// brief.announced.items / .shipped.items / .tested.items
// brief.findings[].citationIds → brief.citations[]
```

## Cases covered

| Kind | Example | Decision |
| --- | --- | --- |
| positive | c08 `positive-aligned` (tag+SHA agree; CI success) | `pass` |
| negative | missing clock; draft-only; changelog-as-shipped | `fail` / no brief |
| partial | announced-only; announced+shipped untested; GitHub express v5.2.1 fixture | `partial` |
| conflict | tag mismatch; SHA mismatch; announced “All tests passed” vs CI failure | `conflict` |

Empty sources (c08 NOTICE) follow schema `impliedDecision`: **`unknown`**, not pass. c08 README labels that catalog row `fail`; this transform does not invent a `FAIL_FINDING_CODES` match for emptiness.

## Limitations

- Does not fetch GitHub/npm/CI. c08/c09 supply bytes.
- Does not parse git objects or npm tarballs; it classifies supplied JSON.
- GitHub `assets[]` / `tarball_url` never become shipped items.
- Announced `target_commitish` that is a 40-char SHA is a **claimed** identity, not an observed git tag.
- Empty input is `unknown` (schema), not `fail`.
- Full suite over fixtures is c10 (`test/release-brief.test.mjs`).

## evidenceClass

`synthetic` for authored cases. Real express snapshot is **fixture** (c09 live-capture replay); this cell does not retrieve it.
