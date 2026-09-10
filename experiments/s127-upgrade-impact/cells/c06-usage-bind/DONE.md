# c06-usage-bind DONE

Cell: bind a c03 usage list to a c05 `exportDiff` and emit packet `bindings[]` + `summary`.

## Summary

Pure function `bindUsageToExportDiff` (alias `bind`) in `src/bind.mjs`. No network, no package scripts, no parsers imported.

Decision rules (PACKET-CONTRACT):

| Rule | Result |
| --- | --- |
| used + removed | `decision: action`, `nextAction: review_breakages` |
| used + signatureChanged or renamed-with-target | `decision: action`, `nextAction: upgrade_with_edits` |
| unused change (including unused added) | `decision: no_action`, listed in `summary.unusedChanges` |
| dynamic import of the package | that surface `unknown`; unused non-added changes cannot be claimed unused |
| missing / partial / conflicting source | `unknown`, never `action` |
| lockfile / alias / resolved-version disagreement | `unknown` |
| same version and no exportDiff changes | `no_action` (even without usage lists) |
| newer version with only added unused exports | `no_action` (version bump is not a break) |

`summary.nextAction` priority: `review_breakages` > `upgrade_with_edits` > `unknown` > `no_action`.

If a static used+removed/signature/rename is proven **and** a dynamic import also exists, nextAction stays the action (breakages/edits) and `unknownReasons` records the dynamic surface.

Evidence class: **synthetic** fixtures only. No live-capture. No paid demand invented.

c03 (`src/imports.mjs`, `s127.upgrade-impact.usage.v1`) and c05 (`src/export-diff.mjs`, `s127.upgrade-impact.export-diff.v1`) landed during this cell. Bind consumes their **output shapes** (including nested `exportDiff`, `usage[].names`, coverage `"full"`/`"static"`). It does not import those modules (avoids pulling lexers into a pure bind).

## Files written

- `experiments/s127-upgrade-impact/src/bind.mjs`
- `experiments/s127-upgrade-impact/cells/c06-usage-bind/bind.mjs` (re-export)
- `experiments/s127-upgrade-impact/cells/c06-usage-bind/package.json`
- `experiments/s127-upgrade-impact/cells/c06-usage-bind/run-fixtures.mjs`
- `experiments/s127-upgrade-impact/cells/c06-usage-bind/stubs/usage.mjs`
- `experiments/s127-upgrade-impact/cells/c06-usage-bind/stubs/export-diff.mjs`
- `experiments/s127-upgrade-impact/cells/c06-usage-bind/test/bind.test.mjs`
- `experiments/s127-upgrade-impact/cells/c06-usage-bind/fixtures/PROVENANCE.json`
- `experiments/s127-upgrade-impact/cells/c06-usage-bind/fixtures/*.json` (16 synthetic cases)
- `experiments/s127-upgrade-impact/cells/c06-usage-bind/DONE.md`

## How to exercise

From pack root `experiments/s127-upgrade-impact`:

```bash
node --test cells/c06-usage-bind/test/bind.test.mjs
node cells/c06-usage-bind/run-fixtures.mjs
```

Or from the cell directory: `npm test`.

17 `node:test` tests. Last run: 17 pass, 0 fail. Fixture runner: 16/16 `match: true`.

Minimal call:

```js
import { bindUsageToExportDiff } from "./src/bind.mjs";
const out = bindUsageToExportDiff({
  usage: { coverage: "complete", references: [{ symbol: "foo", kind: "named" }] },
  exportDiff: { coverage: "complete", removed: ["foo"] },
  dependency: { name: "demo-pkg", oldVersion: "1.0.0", newVersion: "2.0.0" },
});
// out.summary.nextAction === "review_breakages"
```

`applyBindToPacket(packet)` copies only known packet fields and fills `bindings`, `summary`, merged `limitations`.

Extra binding fields beyond the contract (safe to strip): `ruleId`, `renamedTo`.

## Limitations

- No runtime execution; no TypeScript checker; TS/dynamic surfaces stay unknown when the producer labeled them (or when c03 reports `filesUnknown` / `filesPartial`).
- Packet-level `partial` / `unknown` / `conflict` / missing exportDiff or usage forbids `decision: action` for every symbol (stricter than c07 `ALLOW_PARTIAL` on covered surfaces).
- Symbol identity is the export **name** (`foo`, `default`). c05 keys by `entry + name`; two export-map entries with the same local name would collapse.
- `import * as ns` treats every changed export as used (c03 does not follow member access).
- `typeOnly` imports are treated as used (may over-claim runtime breakages).
- Bind does not call `src/unknown.mjs`; c07 can still constrain bindings after this cell.
- Fixtures are hand-written **synthetic**. Parser provenance in c03 (es-module-lexer / meriyah live-capture) is not reused here.

## Open questions for integrator

1. Compose with c07: `summarizeUnknown` emits `nextAction: "action"`, while this cell emits `review_breakages` | `upgrade_with_edits`. Recommend: run bind first, then c07 may only *downgrade* `action` → `unknown`, never rename the two action nextActions.
2. c07 `partial_coverage` is `ALLOW_PARTIAL` (covered used symbols may stay action). This cell maps any producer `coverage: partial` to packet unknown. Confirm which policy the packet uses.
3. Should the binding key be `entry + name` (c05) instead of `name`?
4. Should `typeOnly: true` usage be `no_action` / `unknown` rather than used+removed action?
5. Unused `added` is included in `unusedChanges`. Drop it if the CLI summary should only show removals/signatures?
6. Same-version short-circuit currently ignores missing usage. Keep?
7. `ruleId` / `renamedTo`: keep on bindings or strip at packet assemble (c09)?
