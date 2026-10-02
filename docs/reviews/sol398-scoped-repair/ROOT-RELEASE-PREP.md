# Root release-prep checklist (398 / ROOT-1002)

Release-prep only. Seller **0.4.1** stays frozen (40,891 bytes, SHA256
`64dbe1ee7f69dd40ebf71741eed92f1f3f893c44af8eadf18b71c0fac82227b8`).
Audit price stays `10000` on `GET /commerce/seller-integrity-audit`.
No seller bump, no SKU change, no deploy, no merge, no settlement.

Base pin: `64ba4887916a159edb7a06daef045e505683dd77`.
Current master used for adjacency: `015f07d5a75d02a4e74709b17b2b1176501e92a5`.
Patch: `docs/reviews/sol398-scoped-repair/CURRENT-MASTER-INTEGRATION.patch`
SHA256 `8210e2ad2dd831fd7c827f33f862d1cd10363a6c26d50edc5bb98b996984d8b6`.

The claim path is 11 integration files plus 5 acquisition assets. The patch
must name exactly those 16 paths. It does not retouch extract 403/404 handling
and it does not mention I27. Deployment commands stay in `ROOT-RECEIVING.md`.
Do not run them from this checklist.

Recorded cold commands, in order: composition-route-knowledge 0.1.0,
retained-task 0.1.0, l09-next-action 0.1.0, seller-repair-external-consumer
0.2.0, seller-repair-external-consumer 0.4.1, scoped-repair-commerce-100348
0.1.2. Master has the first five. The patch adds only the 0.1.2 client command.

## Hold

Run from a checkout of `heavy/heavy-merchant-398-1002` with Node **22.22.2**
and the locked install (`package-lock.json` SHA256
`4ec0dc584c260dffa3f042297f5bea5fff2e5294ebaa679cf0ad1ae62a82743b`).
Fetch the recorded master commit before the adjacency proof. A moved master
fails closed.

```sh
set -euo pipefail
git fetch origin 015f07d5a75d02a4e74709b17b2b1176501e92a5:refs/remotes/origin/master
node docs/reviews/sol398-scoped-repair/release-prep-check.mjs
```

Exit 0 prints one JSON object with `ok: true`. `deployed` is false.
`verifyCalls` and `settleCalls` are 0.

Seeded failures must be rejected. Exit **2** is the expected rejection.
Exit 1 means the gate failed open or a file was written.

```sh
set -euo pipefail
status=0
node docs/reviews/sol398-scoped-repair/release-prep-check.mjs --seed wrong-asset-set || status=$?
test "$status" -eq 2
status=0
node docs/reviews/sol398-scoped-repair/release-prep-check.mjs --seed seller-bump || status=$?
test "$status" -eq 2
status=0
node docs/reviews/sol398-scoped-repair/release-prep-check.mjs --seed absent-authority || status=$?
test "$status" -eq 2
```

`wrong-asset-set` adds a seller 0.4.2 archive to the 5-asset claim and must
report `reason: wrong_asset_set` with the manifest hash unchanged.
`seller-bump` proposes version 0.4.2, SKU `seller-repair-external-consumer-0.4.2`,
and price `20000`. It must report `frozen_seller_bump_rejected` and leave the
0.4.1 archive hash unchanged.
`absent-authority` calls `checkAcceptance` with no public key. It must report
`repair_authority_absent` / `acceptance_authority_unavailable`,
`authorized: false`, `paymentPerformed: false`, `implementationAuthorized: false`.

## Focused suite

```sh
set -euo pipefail
node --test --test-concurrency=1 docs/reviews/sol398-scoped-repair/release-prep.test.mjs
```

## Affected merchant suites

```sh
set -euo pipefail
export SCOPED_ROOT_MOUNT_PATCHED=1
export NEO_OWNER_ROOT=/home/ubuntu/root-sol-347
export SCOPED_SURFACE_AUTHORITY=/home/ubuntu/root-sol-347/packages/accepted-derivative/src/index.mjs
export SKILLGUARD_ROOT=/home/ubuntu/sol348-skillguard
node --test --test-concurrency=1 \
  public-acquisition/*.test.mjs \
  docs/reviews/sol398-scoped-repair/mounted-receiving.test.mjs
node --test --test-concurrency=1 \
  task-linked-delivery/experiments/scoped-repair-commerce-100348/test/*.test.mjs \
  experiments/seller-repair-service-100266/test/*.test.mjs \
  experiments/scoped-surface-delivery-100312/test/*.test.mjs
node --test --test-concurrency=1 \
  commerce-events.test.mjs \
  commerce-payment-evidence.test.mjs \
  commerce-outcome-binding.test.mjs \
  commerce-outcome-binding.concurrency.test.mjs \
  commerce-outcome-binding.root.test.mjs \
  commerce-settlement-reconciler.test.mjs \
  commerce-settlement-source-delivery.test.mjs \
  task-linked-delivery/receiving.test.mjs \
  useful-result-reuse.test.mjs \
  task-linked-delivery/experiments/task-demand-100339/test/*.test.mjs
```

Neo pin `08eb7fb8b5d8971b48bad11a0c626bbc5db9f41e`.
SkillGuard pin `beec14acbb56de37cd361acc949087b9ae019b70`.
Zero skips required. Do not point these suites at a live origin.

## Stop

Do not deploy, merge, settle, remint, or open a paid route. After this
checklist, Root owns the existing deployment pipeline in `ROOT-RECEIVING.md`.
