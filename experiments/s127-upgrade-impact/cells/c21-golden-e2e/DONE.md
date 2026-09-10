# c21-golden-e2e DONE

Golden expected packet for one synthetic caller + old/new pair covering the three PACKET-CONTRACT decisions that an integrator must keep straight:

| Binding | Surface | Decision |
| --- | --- | --- |
| `usedRemoved` statically imported, removed in 2.0.0 | `.` | **action** |
| `unusedRemoved` not imported, removed in 2.0.0 | `.` | **no_action** |
| `dynamicRemoved` only reachable via `import("s127-golden-kit/plugin")`, removed in 2.0.0 | `./plugin` | **unknown** |

`summary.nextAction` is `action` because of the used removal. `format` is used and unchanged → `no_action` (newer version alone is not a break).

## Outputs

- Golden packet: `expected/packet.json` (`schema`: `s127.upgrade-impact.packet.v1`)
- Must-hold facts: `expected/assertions.json`
- Compose input descriptor: `expected/case.json` (does not invoke CLI)
- Immutable first prior: `expected/prior.seq-1.json` (`sha256` `46328ad32237f65be81bcd78dbd2992476a93f1f1389dff444ac72258ee9d23b`, from `src/prior.mjs` `createPrior`, read-only reuse)
- Integrator compare helper: `lib/assert.mjs` (`compareToGolden`, `assertGoldenDecisions`, `validatePacket`)
- Self-check receipt: `receipts/self-check.json` (`ok: true`)
- How to assert: `README.md`

Frozen operator clock: `2026-09-10T12:00:00.000Z` (`CLOCK.txt`). Not `Date.now()`.

## Label

**synthetic fixture.** Not live-capture. `url` is null. `contentSha256` values are sha256 of local fixture bytes. `paidDemand` false. `payment.attempted` false. Cost $0. No registry fetch. No package lifecycle scripts (trees have none). Do not `npm install`.

## Integrator notes

Do **not** depend on unfinished CLI. Assert with:

```js
import { compareToGolden, loadGoldenPacket } from "./cells/c21-golden-e2e/lib/assert.mjs";
const result = compareToGolden(actualPacket, loadGoldenPacket());
```

Fact-based compare (not byte-identical JSON). `summary.nextAction` `review_breakages` is an accepted alias of `action`. PACKET-CONTRACT rule 4 is **per-surface**: a binder that taints unused main-surface symbols because `./plugin` is dynamically imported does not match this golden. Type-only `src/types.ts` is not runtime usage.

## Limitations

- No full TypeScript program analysis. `import type { FormatOptions }` is recorded as type-only and unknown.
- Fixture-grammar scan only (`export function NAME`, static named `import`, literal `import()`). Not es-module-lexer / acorn / meriyah. Re-exports, computed specifiers, CJS interop stay unknown if a producer claims them.
- No runtime execution of caller or package code.
- Lockfile has no registry `resolved` URL; `resolvedOld`/`resolvedNew` are the synthetic lock version fields.
- First observation: `prior.ref` is null. Missing/conflicting/partial source and same-version no-op are **other** cases, not this golden.
- `src/bind.mjs` currently ORs any dynamic reference into a package-wide flag; that is stricter than this golden and would fail `unusedRemoved: no_action`. Align the binder to per-surface rule 4.

## Isolation self-check

Owned write path only: `cells/c21-golden-e2e/`.

- `node scripts/self-check.mjs` → OK
- No `node_modules`, no `SCRIPT_RAN.marker`, no `SENTINEL_SHOULD_NOT_EXIST`
- `lib/assert.mjs` and `scripts/self-check.mjs` do not import `scripts/cli.mjs`
- Git status for this cell: untracked directory `experiments/s127-upgrade-impact/cells/c21-golden-e2e/`
- Negative mutations of the three triples are rejected by `assertGoldenDecisions`

## Exact files written

All under `experiments/s127-upgrade-impact/cells/c21-golden-e2e/`:

```
CLOCK.txt
DONE.md
PROVENANCE.json
README.md
package.json
expected/assertions.json
expected/case.json
expected/packet.json
expected/prior.seq-1.json
fixtures/caller/package.json
fixtures/caller/package-lock.json
fixtures/caller/src/app.js
fixtures/caller/src/types.ts
fixtures/packages/s127-golden-kit/1.0.0/README.md
fixtures/packages/s127-golden-kit/1.0.0/index.js
fixtures/packages/s127-golden-kit/1.0.0/package.json
fixtures/packages/s127-golden-kit/1.0.0/plugin.js
fixtures/packages/s127-golden-kit/2.0.0/README.md
fixtures/packages/s127-golden-kit/2.0.0/index.js
fixtures/packages/s127-golden-kit/2.0.0/package.json
fixtures/packages/s127-golden-kit/2.0.0/plugin.js
lib/assert.mjs
lib/contract.mjs
lib/hash.mjs
lib/paths.mjs
lib/scan-fixture.mjs
receipts/self-check.json
scripts/self-check.mjs
```
