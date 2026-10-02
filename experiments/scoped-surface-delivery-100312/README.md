# Scoped surface delivery 100312

An agent supplies a task, one concern, and a bounded file inventory. This
candidate runs the pinned SkillGuard scanner, names what it examined, and
keeps the scanner's exit codes. A no-match is not a universal guarantee.
`blanketSafetyScore` stays null.

The caller can send the original bytes and the changed bytes for the same
concern. The rerun scans both. It says `fixed`, `unchanged`, or
`inconclusive`. A saved report is an unverified observation: shaping its
`schema`, `scanPerformed`, commit, or findings does not make a repair.
A server that stored the original bytes can also accept its own opaque prior
token. That token is not a caller report.

A share is kept only when the caller asks and an independent rescan agrees.
The record binds the originating owner, task, request, concern, explicit
sharing scope, and the observed rerun. Equal bytes may share a payload and
still keep separate owners. The originating owner corrects or revokes with a
continuation that survives restart. A later read checks the current
revision. Neo's accepted-derivative reader (`a7bd871`) is the optional
retention authority. A payment receipt, HTTP 200, or a caller label is not
that grant. Without that authority the free scan and retest still run, and
retention returns an explicit limit. A later process can rescan a public
regression without receiving payment, reward, or owner id.

The direct free baseline remains:

```sh
npx github:epistemedeus/skillguard <local-tree>
```

Hosted intake and the repair rerun are separate unpublished proposals. Their
prices are unknown. This package does not charge, publish a SKU, or edit
`server.js`.

## Commands

From the merchant repository root, on Node 22:

```sh
node --test --test-concurrency=1 experiments/scoped-surface-delivery-100312/test/acceptance.test.mjs
node --test --test-concurrency=1 commerce-outcome-binding.test.mjs
node experiments/scoped-surface-delivery-100312/bin/cold-consumer.mjs task-a.json task-b.json
```

`task-a.json` and `task-b.json` are caller files with different `taskId` and
different file bytes. The consumer exits with the scanner exit: `0` clean,
`2` suspicious, `3` dangerous. Input errors exit `64`. A cancelled or bounded
child exits `65`. `--show-report` on the pinned scanner stays unverified and
exits `66`.

The cold consumer refuses one file or two identical inventories.

## What is not claimed

A clean static result does not prove the tree is safe. An unverified local
report is not a scan. Owner QA cohort `owner_qa` on the price proposal is not
customer revenue. Cash, token, and profit figures are unknown.
`recognizedRevenueAtomic` stays `0`.

Root applies `route/ROOT-SERVER-MOUNT.patch` only after placing the public
scanner artifact from `deploy/artifact.mjs`. Missing retention enrollment
does not stop the merchant process. See `ROOT-RECEIVING.md`.
