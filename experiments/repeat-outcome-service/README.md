# Repeat outcome: pinned axios advisory

Source-only laboratory prototype for H64003. It composes the existing merchant reader (`extract` and `readMarkdown`), the existing page-change monitor (`comparePageBatches`), and the existing capture provenance into one maintained decision for the package this repository already pins.

The decision is: does the supplied OSV document mark `axios@1.19.0` affected, did that record or the advisory page change, does the page contradict the record, and can a failed page clear the pin.

The direct baseline is the OSV Schema evaluation algorithm over the pinned query JSON. For this pin that feed is sufficient. This package does not open a paid offer, set a price, or write a ledger.

Run from the merchant repository root, after `npm ci`:

```bash
node --test experiments/repeat-outcome-service/test/outcome.test.mjs
node experiments/repeat-outcome-service/bin/run-outcome.mjs
```

Both commands replay pinned fixtures. They do not call OSV, GitHub, or a model API.

Read `RESEARCH.md` for the sources and the comparison. `RESULT.md` and `NEXT.md` are the handback.
