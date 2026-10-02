# Scoped surface delivery 100312

An agent supplies a task, one concern, and a bounded file inventory. This
candidate runs the pinned SkillGuard scanner, names what it examined, and
keeps the scanner's exit codes. A no-match is not a universal guarantee.
`blanketSafetyScore` stays null.

The caller can send changed bytes for the same concern. The rerun says
`fixed`, `unchanged`, or `inconclusive`. A share is kept only when the caller
asks and an independent rescan agrees. The share is checked with Neo's
accepted-derivative reader (`a7bd871`). A payment receipt, HTTP 200, or a
caller `accepted` flag is not that grant. A later process can use the public
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

Root applies `route/ROOT-SERVER-MOUNT.patch` only after hydrating the pins in
`SOURCE-PIN.json`. See `ROOT-RECEIVING.md`.
