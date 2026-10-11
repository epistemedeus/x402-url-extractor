# Shipping source 211906

Exact bytes committed as Neomorphic `79190370f56309e2c86b10ca5418b4b92011f78d`.

| File | Blob |
| --- | --- |
| `scripts/materialize-caller-result-0.1.1.mjs` | `c461c2ad66f850d1ee3ea9827a994cc4dc29dfe9` |
| `tests/caller-result-0.1.1-parts.test.mjs` | `32d859836ddb1be3b10066fc91bed79649285c93` |

Copies in this directory are those two files. `package.json` was not changed.

## Prebuild

`package.json` blob `b9491c3c80d8db3e26fbf1cdf141dbb8ed424bc2`.

```
node scripts/materialize-caller-result-0.1.1.mjs && node scripts/verify-records.mjs && node scripts/load-reconciliation.mjs && node scripts/task-square/prepare-exact-contract.mjs
```

Build script, unchanged:

```
astro build && node build.js && node scripts/record-lab-licenses.mjs
```

## Imports

The materializer imports only `node:crypto`, `node:fs`, `node:path`, and `node:url`. It reads `scripts/fixtures/samedaydesk-caller-result-0.1.1.tar.gz.b64.d/00` through `05`, requires those names exactly, strips whitespace, checks base64, then requires 32421 bytes and sha256 `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3`. It writes only `public/downloads/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz` and refuses to replace different bytes. It does not import a manifest, a packer, or a payment client.

No public-acquisition manifest, inventory, or cold command changed in this closure. The merchant combined index remains the `31434c53` candidate.
