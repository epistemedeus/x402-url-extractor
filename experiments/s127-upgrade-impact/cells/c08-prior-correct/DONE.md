# c08-prior-correct DONE

Cell: `c08-prior-correct` (OS-session worker). Owns `src/prior.mjs` and this directory.

## Summary

S122-style immutable prior for S127 upgrade-impact packets.

- `createPrior(packet)` snapshots decision-relevant packet fields into a frozen prior. Payload sha256 uses sorted JSON (same algorithm as S122 `recipes/lib/hash.mjs`). Same canonical input ⇒ same hash. Clock is required; never `Date.now()`.
- `assertImmutable(path|prior, nextBytes?)` refuses to overwrite different prior bytes (S122 path semantics). Object form verifies payload digest.
- `correctPrior(oldPrior, newEvidence)` emits a hashed correction record and, on complete differing evidence, a **new** sequenced prior. Old prior bytes are not mutated (in-memory freeze + byte compare; on-disk fixture unchanged).
- Correction kinds: `return` (matching second snapshot), `update` (complete evidence differs → seq+1), `unknown` (missing / conflicting / partial source → keep old prior, no nextPrior).
- CLI/pipeline adapters: `run` / `attachPrior` / `replay` / `correct` return packet overlays so `scripts/lib/pipeline.mjs` can invoke this module without mutating priors.

This cell does **not** re-decide bindings. A newer version is not a break; unused export change is not a caller defect. Those rules live in binders (`src/bind.mjs` / c06). This module only hashes snapshots.

No paid demand. All fixtures are **synthetic** (not live-capture). `caller.evidenceClass` is `fixture`.

## Files written

| Path | Role |
| --- | --- |
| `experiments/s127-upgrade-impact/src/prior.mjs` | Implementation |
| `experiments/s127-upgrade-impact/cells/c08-prior-correct/fixtures/PROVENANCE.json` | Fixture vs live-capture labels |
| `experiments/s127-upgrade-impact/cells/c08-prior-correct/fixtures/packet-seq-1.json` | First synthetic packet |
| `experiments/s127-upgrade-impact/cells/c08-prior-correct/fixtures/second-snapshot-matching.json` | Second snapshot, shuffled keys + later `retrievedAt` (expect `return`) |
| `experiments/s127-upgrade-impact/cells/c08-prior-correct/fixtures/second-snapshot-export-change.json` | Used export signature change (expect `update`) |
| `experiments/s127-upgrade-impact/cells/c08-prior-correct/fixtures/second-snapshot-partial.json` | Partial provenance, unknown exportDiff (expect `unknown`) |
| `experiments/s127-upgrade-impact/cells/c08-prior-correct/fixtures/prior.seq-1.json` | Immutable prior materialized from seq-1 |
| `experiments/s127-upgrade-impact/cells/c08-prior-correct/fixtures/synthetic-dep/*.js` | Auditable source bytes for provenance `contentSha256` |
| `experiments/s127-upgrade-impact/cells/c08-prior-correct/test/prior.test.mjs` | Isolation tests |
| `experiments/s127-upgrade-impact/cells/c08-prior-correct/DONE.md` | This file |

Did not write under `fixtures/synthetic/` (c10), `test/` pack root (c10), S124/S125 trees, or any other cell.

## How to exercise

From repo root:

```bash
node --test experiments/s127-upgrade-impact/cells/c08-prior-correct/test/prior.test.mjs
```

Expected: 21 passing.

Manual:

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { createPrior, correctPrior, assertImmutable } from "./experiments/s127-upgrade-impact/src/prior.mjs";
const dir = "experiments/s127-upgrade-impact/cells/c08-prior-correct/fixtures";
const load = (n) => JSON.parse(readFileSync(dir + "/" + n, "utf8"));
const prior = createPrior(load("packet-seq-1.json")).prior;
console.log(correctPrior(prior, load("second-snapshot-matching.json")).kind);       // return
console.log(correctPrior(prior, load("second-snapshot-export-change.json")).kind);  // update
console.log(correctPrior(prior, load("second-snapshot-partial.json")).kind);        // unknown
console.log(assertImmutable(dir + "/prior.seq-1.json", "tamper").code);             // prior_immutable
'
```

Stable payload digest for `packet-seq-1.json` / matching second snapshot:

`63128fd28691fba4d29d286b702b839cd2dee18cde3e5f1c6016044413d19a2b`

CLI loader (`scripts/lib/load-src.mjs`) sees `run`, `attachPrior`, `replay`, `correct`, `loadPrior`.

## Contract mapping

Hashed prior payload keys: `caller`, `dependency`, `provenance`, `usage`, `exportDiff`, `bindings`, `summary`.

Excluded from the hash (envelope only): `clock` / `createdAt`, `prior`, `limitations`, provenance `retrievedAt`. Recapture of the same content bytes at a later `retrievedAt` is `return`.

`packet.prior` overlay shape: `{ path, sha256, sequence, immutable, ref, correction, nextPrior }`.

`payment.attempted` is always `false`.

## Limitations

- No TypeScript program analysis and no runtime exec. Fixture `bindings` / `exportDiff` are **declared** for hashing, not computed here.
- `assertImmutable` on paths is **byte** identity (S122), not JSON-semantic. Pretty-printed `prior.seq-1.json` ≠ compact `documentBytes(prior)`.
- Array order in `bindings` / `usage.imports` is significant; only object keys are sorted.
- `dynamicImport: true` is a binder unknown, not automatically a correction `unknown`.
- Envelope `label` prefers `live-capture` when mixed with `synthetic` so a fixture run cannot hide live bytes. These cell fixtures are synthetic only.
- `loadPrior` / `createPrior` hashes **payload**, not pretty-printed file bytes. CLI `pipeline.mjs` currently hashes prior **file text**; overlay `prior.sha256` from this module is the payload digest.
- First `analyze` without `--prior` creates a seq-1 ref in the overlay; this module does not write it unless `writeSequencedPrior` is called.
- Unknown / TS / lockfile-disagreement surfaces stay unknown; this cell does not invent action.

## Open questions for integrator

1. Persist `nextPrior` via `writeSequencedPrior(outDir, nextPrior)` on `correct`, or only attach `packet.prior.correction` + `nextPrior` and let the operator copy?
2. Should `packet.prior.sha256` stay the payload digest (S122) even though the CLI currently records file-text sha256 before the stage runs?
3. Should `bindings` / import arrays be sorted by symbol for hash stability across binder walk order?
4. Should `unknown` still write a correction artifact on disk (sequenced, non-prior) for audit, or only the overlay field?
5. Align correction `coverageReasons` strings with c07 `src/unknown.mjs` taxonomy, or keep this module’s source-completeness list?
6. When `--prior` points at a **packet** rather than a prior artifact, this module derives a prior via `createPrior`. Is that allowed, or should that stay `unknown`?
7. Envelope copies `caller` / `dependency` so CLI `applyPriorDefaults` can read them at top level. Confirm that is wanted vs payload-only S122 shape.

## Evidence class

| Artifact | Label | Live-capture | Paid |
| --- | --- | --- | --- |
| All c08 fixtures | `synthetic` provenance, `fixture` caller | no | no |
