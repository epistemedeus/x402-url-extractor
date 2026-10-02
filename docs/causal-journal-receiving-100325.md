# Causal journal receiving 100325

Repairs settlement admission in the existing `createForwardOutcomeWriter`. No new outcome database, payment authority, signer, price, or commerce product.

## What changed

Validation, the single-settlement check, the exact event-id check, the append, and the index update run inside one process-local claim for the resolved journal directory. The task-ref queue stays separate, so the two claims do not re-enter each other. Distinct directories do not share a claim. A refusal for one operation does not reject another operation.

Same-reference concurrent admission writes one journal line. The other caller receives `duplicate_settlement`. Distinct references also leave one line and one explicit `duplicate_settlement` refusal. A new writer reloads the retained current and rotated files before it admits.

`server.js` builds one `createCommerceTelemetry` writer and `mountUsefulResultReuse` builds a second `createForwardOutcomeWriter` on `COMMERCE_DATA_DIR` (or `cwd/data`). Both share this process-local claim. The claim is not cross-process exclusion. `createCommerceTelemetry` still requires `writerProcessCount === 1`.

A thrown append is not retried. The retained files are read back. An exact event id already present is `duplicate`. Absence stays `write_outcome_unknown`.

Settlement appends use `FORWARD_JOURNAL_DURABILITY` (`local-filesystem-fsync-rename-v1`): `fsync` the journal file and, if that append rotated the file, `fsync` the directory. This holds only where the kernel reports success after the bytes and the directory entry are stable. Restoring an older backup onto the same path is not detected.

Rotation remains one generation. Prior bytes stay in `commerce-outcome-binding.1.ndjson`. Symlinks are not followed. Torn tails are separated and not rewritten. Mode stays `0600`. Schema, prices, the causal producer, and the seller callback are unchanged. Recognized revenue stays 0.

## Root integration command

From the repository root, with Node 22.22.2:

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
node --test --test-concurrency=1 \
  commerce-outcome-binding.concurrency.test.mjs \
  commerce-outcome-binding.test.mjs \
  commerce-outcome-binding.root.test.mjs \
  commerce-events.test.mjs \
  task-linked-delivery/receiving.test.mjs \
  task-linked-delivery/experiments/delivery-outcome-100173/test/join.test.mjs \
  task-linked-delivery/experiments/useful-economics-100290/test/join.test.mjs \
  task-linked-delivery/experiments/useful-economics-100290/test/merchant-execution.test.mjs \
  task-linked-delivery/experiments/useful-economics-100290/test/cold-export.test.mjs
```

Package scripts `test:task-linked-delivery` and `test:useful-economics` cover the same binding, producer, and economics files. Do not point these commands at the live merchant journal. Do not merge, deploy, or pay from this branch.
