# Shipping source 211906

Neomorphic branch `codex/caller-complete-receiving-211906` is `79190370f56309e2c86b10ca5418b4b92011f78d`, parent `c0ee80c30b75882f3763b50cbf5654c02f155c30`, base `df2ab3d26b767c3889db219fc2a1003603901e73`.

## Committed on 79190370

| File | Blob |
| --- | --- |
| `scripts/materialize-caller-result-0.1.1.mjs` | `c461c2ad66f850d1ee3ea9827a994cc4dc29dfe9` |
| `tests/caller-result-0.1.1-parts.test.mjs` | `32d859836ddb1be3b10066fc91bed79649285c93` |

## Checkout delta used by the gates

These three files are not a new Neomorphic commit. The gates ran on these bytes. Copies are in this directory.

| File | Blob |
| --- | --- |
| `scripts/normal-release.mjs` | `3d813b6476edf73f058fa260f61cd813255752c0` |
| `scripts/normal-release-lib.mjs` | `50e3ba728a7eb130fbe417ff7334c6b0d993d768` |
| `tests/normal-release.test.mjs` | `d7ece0f8a02f6c094498c764aca0aea5fd8a96fb` |

`package.json` blob `b9491c3c80d8db3e26fbf1cdf141dbb8ed424bc2` was not changed.

## Prebuild

```
node scripts/materialize-caller-result-0.1.1.mjs && node scripts/verify-records.mjs && node scripts/load-reconciliation.mjs && node scripts/task-square/prepare-exact-contract.mjs
```

Build script, unchanged:

```
astro build && node build.js && node scripts/record-lab-licenses.mjs
```

Normal release chain, unchanged:

```
npm run test:task-memory-contract && npm run test:work-board && npm run test:town-square && npm run test:capability-market && npm run test:scale-compose && npm run test:shared-task && node --test --test-concurrency=1 tests/*.test.mjs && npm run test:regression-corpus
```

## Imports

The materializer imports only `node:crypto`, `node:fs`, `node:path`, and `node:url`. It reads `scripts/fixtures/samedaydesk-caller-result-0.1.1.tar.gz.b64.d/00` through `05`, requires those names exactly, strips whitespace, checks base64, then requires 32421 bytes and sha256 `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3`. It writes only `public/downloads/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz` and refuses to replace different bytes.

`scripts/normal-release.mjs` imports `./normal-release-lib.mjs` and `experiments/integrated-delivery-100397/hermes-enrollment.mjs`. `planHermes` is the only behavior change: a pin-matching Hermes cache with a usable interpreter is reused, and a cache that exists off-pin is refused. It does not import a packer, a manifest, or a payment client.

No public-acquisition manifest, inventory, or cold command changed. The merchant combined index remains the `31434c53` candidate.
