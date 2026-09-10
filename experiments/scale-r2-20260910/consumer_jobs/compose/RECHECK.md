# Deferred Heavy cell recheck harness (S159 + S170/S169 S153)

Operator tool that **re-runs only deferred Heavy recipes** (table-reconcile /
link-index / replay-pack), records **actual** CLI `decision` fields (never
`ok===true` as pass), and emits a delta vs `KNOWN_EXTERNAL_HEAVY_DEFECTS`
and the S152 positive partial matrix.

Schema: `x402.r2.consumer.deferred_recheck.v1`.

Resolved S153 merchant head: see `RESOLVED-S153-COMMIT.txt`
(`d520699802622a715cde1d894cc5547c42b2dca7`).

## Default path (S170) = S153 kit

- CLI: `experiments/s153-consumer-distribution-gates/kit/bin/cli.mjs`
  (delegates to sibling `experiments/s137-consumer-evidence-jobs/scripts/cli.mjs`)
- `--in`: kit `examples/table-reconcile`, `examples/link-index`, `examples/replay-pack`
- Unpacked install: `kit/dist/s137-consumer-evidence-kit.tgz` → `bin/cli.mjs` + embedded `src/`
- Maintained S137 root in Git: **`experiments/s137-consumer-evidence-jobs`** (not a separate `s137-consumer-evidence` dirname)
- Kit **excludes** jobs 07/08 (`COMPAT-07-08.md`); native `consumer_jobs/07` + `08` + compose own those paths
- **No parallel fork** of Heavy 01–06 transforms

Legacy flag: `--inputs s137-synthetic` → prior synthetic positives under
`experiments/s137-consumer-evidence-jobs/fixtures/synthetic/...`

## Cell status rules

| actualDecision (from CLI) | status |
|---|---|
| `pass` | `cleared` |
| `fail` | `still_deferred` |
| `partial` | `unexpected` |
| `conflict` / missing / other | `unexpected` |

Invariant: `status === cleared` ⇒ `actualDecision === "pass"`. Never invent.
Never treat packet `ok===true` as verdict pass.

## Operator steps

```sh
cd experiments/scale-r2-20260910/consumer_jobs/compose

# Default: S153 kit examples
node src/cli.mjs recheck-deferred --json
npm run recheck-deferred

# Legacy S137 synthetic positives (prior fail signature)
node src/cli.mjs recheck-deferred --inputs s137-synthetic --json

# Subset / gate
node src/cli.mjs recheck-deferred --include table-reconcile --json
node src/cli.mjs recheck-deferred --require-cleared --json

ls demo-out/deferred-recheck/
```

### Unpacked kit (distribution)

```sh
mkdir -p /tmp/s137-consumer-kit
tar -xzf experiments/s153-consumer-distribution-gates/kit/dist/s137-consumer-evidence-kit.tgz \
  -C /tmp/s137-consumer-kit --strip-components=1
node /tmp/s137-consumer-kit/bin/cli.mjs analyze table-reconcile \
  --in /tmp/s137-consumer-kit/examples/table-reconcile \
  --clock 2026-09-10T12:00:00.000Z
```

### Direct kit CLI (in-repo)

```sh
KIT=experiments/s153-consumer-distribution-gates/kit
CLOCK=2026-09-10T12:00:00.000Z
node $KIT/bin/cli.mjs analyze table-reconcile --in $KIT/examples/table-reconcile --clock $CLOCK
node $KIT/bin/cli.mjs analyze link-index --in $KIT/examples/link-index --clock $CLOCK
node $KIT/bin/cli.mjs analyze replay-pack --in $KIT/examples/replay-pack --clock $CLOCK
```

## Observed decisions (re-run; do not invent)

Clock `2026-09-10T12:00:00.000Z`, merchant head `d520699…`:

| id | input | decision | status |
|---|---|---|---|
| table-reconcile | kit examples/ | **partial** | unexpected |
| link-index | kit examples/ | **fail** | still_deferred |
| replay-pack | kit examples/ | **pass** | cleared |
| table-reconcile | s137 synthetic positive-agree | **fail** | still_deferred |
| link-index | s137 synthetic positive-md | **fail** | still_deferred |
| replay-pack | s137 synthetic positive-unpaid-complete | **fail** | still_deferred |

Green / other (kit examples): migration-checklist=pass, release-brief=partial,
freshness-receipt=pass. Jobs 07/08 via native compose paths (not kit).

## Known defect for Lead→Root (S158 Heavy owner)

`release-brief` synthetic `conflict-sha-mismatch.json` returns **`decision=pass`**
(with finding `cli.schema-rejected`) on this head — expected conflict/fail did
**not** hold. Capture for Heavy owner; do not invent conflict clearance.

```sh
node experiments/s137-consumer-evidence-jobs/scripts/cli.mjs analyze release-brief \
  --in experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/cases/conflict-sha-mismatch.json \
  --clock 2026-09-10T12:00:00.000Z
# → decision=pass (defect; schema-rejected finding present)
```

## Forbidden claims

No investment / revenue / ranking / escrow / custody / “full package ready”.
Do not invent Heavy pass. Do not invent release-brief conflict outcomes.
Fixture URLs remain data. Kit 217 tests / 48 native cells are **not** Root
release acceptance.

## Related

- Green buyer path: `GREEN-BUNDLE.md`
- Acquisition: `ACQUISITION.md`
- Handoff: `S170-HANDOFF.md`
- Terminal head: `receipts/s170-recheck-terminal.txt`
