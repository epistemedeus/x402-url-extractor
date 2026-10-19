# ROOT704 source handback

Release-ready receiving record for the current-main lockfile package. This branch does not deploy, enable the route, merge, pay, or reply on a public issue. Root owns integration and the production release.

## Heads

| Repo | Ref | Head | Parent |
| --- | --- | --- | --- |
| `epistemedeus/samedaydesk` | `codex/root704-current-lockfile-source-20261019` | `83f252ad6dae6ffa19455576ce11a524bff46efc` | `d8cea059213e06d2f263be67f82e498f8052a50f` |
| `epistemedeus/x402-url-extractor` | `codex/root688-lockfile-identity-20261019` | the commit that adds this file, on PR 211 | `db84c15dcabfa4572af75ebd429011ca78effaec` |

Source PR: https://github.com/epistemedeus/samedaydesk/pull/324

Merchant PR 211 stays the only merchant writer. Do not open a second merchant PR or a new platform.

Package tree of `tools/lockfile-pin-delta` at the source head: `51c1bf199882e40ea45aafccdd93e46fdd15f51b`.

Imported runtime bytes come from `55b2dd385ab399d3919e1922dd4a0b11edccbb4a` (fast-forward of repair parent `fba9d14872bc4c04214e527b9edfb30c2123c9e7`). Draft PR 82 was not merged. `lib/`, `bin/`, `fixtures/`, and the engine `package.json` in `vendor/lockfile-pin-delta/` match that source head. `RECEIPT.md`, `PLACEMENT.md`, and `test/` stay in SameDayDesk.

`vendor/lockfile-pin-delta/LICENSE` sha256 `c9e2795d29bf1008cbd36ac045bd3c77d537438a51d8dda34e158f4e82a6a27c`.

`vendor/lockfile-pin-delta/NOTICE` sha256 `9b1ceab183cc74304b495c578660d2b1ca2317e28d20fd5f210bcde4f6db683d`. NOTICE still names `fba9d14872bc4c04214e527b9edfb30c2123c9e7`.

Engine pin: `LOCKFILE_PIN_DELTA_ENGINE_SHA` and `vendor/lockfile-pin-delta/PROVENANCE.json` `source.sha` are `83f252ad6dae6ffa19455576ce11a524bff46efc`. Catalog pin `a20232b0f777b0f737cdffefb64a9ca9d9c9ba0e` is unchanged. HTTP schema stays `samedaydesk.lockfile-pin-delta-http.v0`.

## Tests received on these trees

Node v22.14.0. Serial `--test-concurrency=1`. Heap `--max-old-space-size=1024`. No whole-site build and no global install. The merchant run used the local fake facilitator. No live paid request.

SameDayDesk, from `tools/lockfile-pin-delta`:

```bash
NODE_OPTIONS=--max-old-space-size=1024 node --test --test-concurrency=1 test/*.test.mjs
```

40 pass, 0 fail, exit 0. Current root `package-lock.json` is lockfileVersion 3, `packages` map, 194 pins, 5 missing-integrity pins, `node_modules/zod` at 3.25.76. The historical receipt's 160-pin count was not rewritten. Local-runtime assertions stayed true.

Frozen qualifier, Pilot `90732c4560e0861c299620206b24aab237be7f52`, `overview/research/phase-20261019/original-bounty-backlog-root678/qualify.mjs`:

```bash
NODE_OPTIONS=--max-old-space-size=1024 node qualify.mjs \
  --candidate-engine PATH/tools/lockfile-pin-delta \
  --require-repaired
```

33 cases, 0 repair failures, `semanticGatePassed` true, exit 0. Issue 125 and 126 meet the owner target. Issue 131 follows the field contract. Issue 124 stays needs-specific-evidence. Integrity-field equality and optional-peer inclusion were not changed. Frozen kit `ca38205279f0d543515b81b7261909e55ea2600f` was not rewritten.

Merchant, from this repository root:

```bash
NODE_OPTIONS=--max-old-space-size=1024 node --test --test-concurrency=1 \
  lockfile-pin-delta.test.mjs \
  lockfile-pin-delta.identity.test.mjs \
  lockfile-pin-delta.http.test.mjs \
  lockfile-pin-delta.buyer.test.mjs
```

29 pass, 0 fail, exit 0. The run covers direct compare, worker, HTTP, MCP result schema, failure, and recovery.

## What Root receives

1. Merge SameDayDesk PR 324 onto current main. Do not merge draft PR 82.
2. Merge merchant PR 211 after it is the projection of `83f252ad6dae6ffa19455576ce11a524bff46efc`. Confirm `LOCKFILE_PIN_DELTA_ENGINE_SHA` equals that commit and the vendor `lib/` bytes still match it.
3. Service version stays `1.23.53` here, the same number as deployed source `b6b9735e37d89109754ffbf43a4a3fa85e95d92d` and as PR 211 before this pin move. A release cut in this repo bumps `package.json`, both version fields in `package-lock.json`, `server.json`, and `plugins/samedaydesk-x402/plugin.json` together. Cut that next patch when releasing this projection. This handback does not cut it and does not deploy.
4. Hosted enable stays the existing `docs/wave5-paid-useful-job/RELEASE.md` procedure: set `LOCKFILE_PIN_DELTA_ENABLED=1` on the current Railway service, keep `EXTRACT_BATCH_ENABLED=1`, and leave MPP off this route. Unset the lockfile flag to roll back. Do not treat this source handback as that enable.
5. No new reward, signer, public issue reply, customer page, or homepage change belongs to this placement.
