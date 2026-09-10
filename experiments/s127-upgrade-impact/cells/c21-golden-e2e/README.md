# c21 golden end-to-end packet

Synthetic caller + `s127-golden-kit@1.0.0` → `2.0.0` pair that must produce one PACKET-CONTRACT packet showing three decisions at once:

| Symbol | Surface | Used? | Change | Decision |
| --- | --- | --- | --- | --- |
| `usedRemoved` | `.` (static named import) | yes | removed | **action** |
| `unusedRemoved` | `.` (not imported) | no | removed | **no_action** |
| `dynamicRemoved` | `./plugin` (`import()`) | unknown | removed | **unknown** |

`format` stays used and unchanged → `no_action` (a newer version alone is not a break).

**Label:** `synthetic`. Not live-capture. No paid demand. No registry fetch. Do not run lifecycle scripts (these trees have none).

This cell does **not** depend on the pack CLI. The golden packet is the expected output.

## Files

| Path | Role |
| --- | --- |
| `expected/packet.json` | Golden packet (`s127.upgrade-impact.packet.v1`) |
| `expected/prior.seq-1.json` | Immutable first prior derived from the packet (`createPrior`); `prior.sha256` hashes the canonical payload |
| `expected/assertions.json` | Machine-readable must-hold facts |
| `expected/case.json` | Input descriptor for a future `composePacket` |
| `fixtures/caller/` | Synthetic caller (`src/app.js` + type-only `src/types.ts`) |
| `fixtures/packages/s127-golden-kit/1.0.0/` | Old tree |
| `fixtures/packages/s127-golden-kit/2.0.0/` | New tree |
| `lib/assert.mjs` | Integrator compare helper (no CLI import) |
| `scripts/self-check.mjs` | Isolation + fixture/packet consistency |

Paths inside the packet are pack-relative (`cells/c21-golden-e2e/...`) from `experiments/s127-upgrade-impact`.

## How the integrator should assert

Do not wait for, spawn, or import `scripts/cli.mjs`. Compare a producer packet to this golden.

```js
import { compareToGolden, loadGoldenPacket } from "./cells/c21-golden-e2e/lib/assert.mjs";

const golden = loadGoldenPacket();
const result = compareToGolden(actualPacket, golden);
if (!result.ok) throw new Error(result.errors.join("\n"));
```

Or load `expected/assertions.json` and check `mustHold` yourself.

Default comparison is **fact-based**, not byte-identical JSON:

1. `schema` equals `s127.upgrade-impact.packet.v1`.
2. Required PACKET-CONTRACT fields are present (`schema`, `createdAt`, `clock`, `caller`, `dependency`, `provenance`, `usage`, `exportDiff`, `bindings`, `summary`, `prior`, `limitations`).
3. The three binding triples above match **exactly** (`symbol`, `used`, `changeKind`, `decision`). Extra bindings are allowed if they do not contradict those symbols.
4. `summary.nextAction` is `action`. Alias **`review_breakages`** is accepted (used by `src/bind.mjs` for a used removal).
5. `summary.actionableChanges` includes `usedRemoved` and does not include `unusedRemoved` or `dynamicRemoved`. Entries may be strings or `{ symbol }`.
6. `summary.unusedChanges` includes `unusedRemoved` and does not include `usedRemoved`. `dynamicRemoved` is unknown, not a confirmed unused change.
7. `summary.unknownReasons` mentions dynamic import (`dynamic_import` or equivalent substring).
8. `exportDiff.removed` includes `usedRemoved`, `unusedRemoved`, `dynamicRemoved`.
9. `caller.evidenceClass` and provenance `label` values are `synthetic` (not `live-capture`).
10. `clock` / `createdAt` may differ if the operator injects another clock; freeze `2026-09-10T12:00:00.000Z` for replay. Do not invent `Date.now()` when clock is missing.
11. Rationale strings need not match byte-for-byte. `ruleId` / `surface` / `dynamicImport` on bindings are optional extras; if present, `dynamicRemoved.dynamicImport` must be `true`.
12. `prior.ref` is `null` on this first observation. Companion file `expected/prior.seq-1.json` is the immutable prior snapshot of that packet (`sequence: 1`). Do not overwrite those bytes; later corrections write `seq-N+1`.

When a producer exists, feed it `expected/case.json` (clock, caller paths, old/new trees). Then `compareToGolden`.

## Per-surface dynamic import (rule 4)

PACKET-CONTRACT: *Dynamic import of package ⇒ unknown for that surface.*

This golden uses **two specifiers** of one dependency:

- `s127-golden-kit` — static named imports (`format`, `usedRemoved`). Unused main-surface removal (`unusedRemoved`) stays `no_action`.
- `s127-golden-kit/plugin` — `import()` only. `dynamicRemoved` stays `unknown` even though it was removed.

`usage.dynamicImport` at package level is **`false`**. Only the plugin usage row is `dynamicImport: true`.

If a binder ORs any dynamic specifier into a package-wide flag and then:

- demotes `usedRemoved` from `action` → `unknown`, or
- promotes `unusedRemoved` from `no_action` → `unknown`,

that binder does **not** match this golden. Fix the binder to be per-surface.

## What this golden is not

- Not live-capture. Provenance `url` is null; hashes are sha256 of local fixture bytes.
- Not a paid job. `payment.attempted` is false. Cost is $0.
- Not full TypeScript analysis. `src/types.ts` exists so producers must **not** treat `import type { FormatOptions }` as runtime use.
- Not runtime execution. Do not `npm install` these trees. Extract/read files only.
- Missing, conflicting, or partial source is a different case (`unknown`, not `action`). Same-version no-op is a different case (`no_action`).

## Self-check

```bash
node cells/c21-golden-e2e/scripts/self-check.mjs
```

Writes `receipts/self-check.json`. Confirms schema, the three decisions, provenance hashes, fixture-grammar scan vs packet, and that this cell does not import the CLI.
