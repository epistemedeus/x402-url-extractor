# AE14 N2B base-health

Verdict: repaired

Base: `82a51274e7dc7a7600b90f1317a6be6b28442592` (main)

Branch: `codex/ae14-n2b-x402-base-health`

Prior export on this branch: `83191de15b122f6be679356644030b958254268a` (archive mode plus a cold-Node swap). This commit reverts the swap and keeps `--mode=0644`.

Head: the tip of this branch after the fast-forward push. Parent is `83191de15b122f6be679356644030b958254268a`. This blob cannot store its own commit id; `git rev-parse HEAD` and the launcher HEAD file are that commit.

Next integration owner: dr eggbot -> Root (ownership chain: work-net lead -> dr eggbot -> Root).

Tests: 1168/1173 pass, fail 0, skip 5 (root `node --test` via npm on Node v22.23.3); pretest 19/19 pass, fail 0, skip 0; owned archive-mode 1/1 pass.

## Writer boundary

Result and evidence live in `experiments/ae14-n2b-base-health/`. Product edits outside that path are only the two packers under "Source files changed". `machine-acquisition.mjs`, `public-acquisition/cold-acquire.mjs`, `public-acquisition/receive.mjs`, and `public-acquisition/cold-httpx.py` match the base again. No edits under `experiments/ae14-async-delivery/`, `integrations/agentverse-a2a/`, `public/downloads/continuity-client/`, other AE14 writer paths, live immediate-pay config, or vendored third-party trees. Sealed archive bytes and hash pins were left as published.

## Consumed inputs

| Input | Commit |
| --- | --- |
| This repository, unmodified base | `82a51274e7dc7a7600b90f1317a6be6b28442592` |
| pilot `EXPANSION-PORTFOLIO.md`, `GRAND-PLAN.md`, `INTEGRATED-DECISIONS.md`, `EXECUTION.md`, `ROOT-CANDIDATE-RECEIVING.md` in `overview/self-evaluations/2026-10-14-agent-economy/` | `7428845d6429b78573801ee8035953e26c610eaf` |
| pilot `GRAND-PLAN.md` section "Composed receiving matrix for the actual amended exports" (additive; scope, base, branch, and writer path unchanged) | `ecf78d29c2c592dd03b5daef4eeba2f29772c8ae` |
| pilot `tools/ops/stage-native-source.sh` (blob `613e3e336fc315650ea195270c010b1ef75ecf2a`) | `c3436e8647bd111a04359193c55f2c97be77e180` |

H was not run. No A/B/C interaction was added. Joined cases stay pending-join for the lead-owned H harness. Service TLS and PostgreSQL verify-full were not changed.

## Counts

`npm test` runs pretest, then the root `node --test` list. The lead counts are the root list.

| Run | Node | Exit | tests | pass | fail | skip | duration_ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Base pretest | v22.14.0 | (inside exit 1) | 19 | 19 | 0 | 0 | 69.96658 |
| Base root list | v22.14.0 | 1 | 1173 | 1162 | 6 | 5 | 145671.609122 |
| Pinned pretest | v22.23.3 | (inside exit 0) | 19 | 19 | 0 | 0 | 64.81748 |
| Pinned root list | v22.23.3 | 0 | 1173 | 1168 | 0 | 5 | 138556.215353 |
| Owned archive-mode | v22.23.3 | 0 | 1 | 1 | 0 | 0 | 208.518817 |

Base command: `npm test` (default `/exec-daemon/node` v22.14.0, npm 10.9.9), 2026-10-14T17:43:11Z to 2026-10-14T17:45:37Z. Evidence: `evidence/base-npm-test.meta.txt`, `evidence/base-npm-test.stdout.txt`, `evidence/base-npm-test.stderr.txt`.

Pinned command: `PATH=/home/ubuntu/.nvm/versions/node/v22.23.3/bin:$PATH /home/ubuntu/.nvm/versions/node/v22.23.3/bin/npm test`. npm scripts ran `v22.23.3 /home/ubuntu/.nvm/versions/node/v22.23.3/bin/node`. npm 10.9.9, Python 3.12.3, httpx 0.28.1, umask 0077. 2026-10-14T18:58:51Z to 2026-10-14T19:01:10Z. Evidence: `evidence/pinned-node-npm-test.meta.txt`, `evidence/pinned-node-npm-test.stdout.txt`, `evidence/pinned-node-npm-test.stderr.txt`. Owned: `evidence/owned-archive-mode.stdout.txt`, `evidence/owned-archive-mode.stderr.txt`.

`evidence/after-npm-test.*` is the earlier run of the reverted cold-Node swap on v22.14.0 (1168/0/5). That run is not the acceptance result. The swap is gone.

stderr on these runs is the Node `NO_COLOR` / `FORCE_COLOR` warning.

## Base failures (file + title)

Product defect, fixed by `--mode=0644`. All three are `ok` on the pinned run (tests 51, 54, 1029):

1. `caller-result-client.cold.test.mjs:223` — installed caller consumer reaches the mounted parent without merchant source. Fresh pack digest differed from sealed `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3`.
2. `caller-result-client.distribution.test.mjs:291` — caller generation keeps the sealed feedback archive and matches the current source. Same digest mismatch.
3. `task-linked-delivery/experiments/useful-economics-100290/test/cold-export.test.mjs:21` — two cold consumers accept the public fixture and reject the seeded controls. Fresh pack digest differed from sealed `0e03fbdabec828a10ceade744a7d03d09170e1abfdd1f2844681e420c695c24c`.

Environment-only on Node v22.14.0, which is below the sealed seller-repair pin `>=22.22.0` (`experiments/seller-repair-service-100266/bin/caller-deliver.mjs` writes `node_pin_unsatisfied`). The machine pin in `machine-acquisition/pins.json` is `>=22.20.0`. v22.14.0 satisfies neither. These three pass on Node v22.23.3 (tests 918, 932, 933) with the suite process itself. No skip was added. No second pin was added. Cold commands still use `process.execPath`, and receiving still records `process.version`, which is that same process.

4. `public-acquisition/engine.test.mjs:355` — cold node and python httpx clients unpack the mount and run the declared commands.
5. `public-acquisition/receiving-lifecycle.test.mjs:547` — loopback receiving observes the mounted bytes and cold commands without publishing.
6. `public-acquisition/receiving-lifecycle.test.mjs:588` — a public proof parses a readback and does not publish when the runtime pin is unmet.

## Environment-only skips (same five at base and on the pinned run)

1. `cold-discovery.http.test.mjs` — deployed extract advertises machine documentation. Skips when `COLD_DISCOVERY_LIVE !== "1"`.
2. `installed-feedback-journey-211998.test.mjs` — installed caller reports a free statement for the issued morpho capability. `SAMEDAYDESK_INSTALLED_SKILL_ROOT` was unset: `installed skill missing at /tmp/hermes-user-211994/.hermes/skills/samedaydesk-task-result/scripts/task-result.mjs`.
3. `page-change-xagent-package.test.mjs` — official offline validator accepts exact commit package when pin is supplied. `XAGT_PLUGIN_ROOT` unset: `Set XAGT_PLUGIN_ROOT to the clean official pin for this gate`.
4. `page-change-xagent-package.test.mjs` — sidecar detects a skip-worktree modification to the official validator. `XAGT_PLUGIN_ROOT` unset: `Official validator checkout not supplied`.
5. `plugins/samedaydesk-x402/plugin.test.mjs` — unpaid initialize-era initialize and tools/list require extract and extract_batch. `liveTest` is `test.skip` when `SAMEDAYDESK_EXPECTED_LIVE_VERSION` is unset.

## Source files changed

1. `caller-result-client/export/pack.mjs` — `--mode=0644`. Sealed caller 0.1.1 bytes are mode 0644. umask 0077 made GNU tar store 0600 and change the digest. Source member hashes already matched. Archive bytes and the pinned sha were not regenerated.
2. `task-linked-delivery/experiments/useful-economics-100290/export/pack.mjs` — same `--mode=0644` for sealed useful-economics 0.1.0.

Reverted to base text, per receiving: `resolveColdCommandNode` in `machine-acquisition.mjs` and its callers in `public-acquisition/cold-acquire.mjs`, `public-acquisition/receive.mjs`, and `public-acquisition/cold-httpx.py`. It selected an installed Node while evidence still stored `process.version`, and it duplicated the sealed `>=22.22.0` pin.

Owned check, not in the root `test` script: `experiments/ae14-n2b-base-health/archive-mode.test.mjs`. It packs both archives under umask 0077 and requires the sealed digests.

## Inherited suite

The inherited suite is root `npm test`. It was run unchanged at the base on v22.14.0 and again on v22.23.3 after this amend. Assertions, names, timeouts, and snapshots were not weakened, deleted, renamed, or regenerated. Subset scripts name files already inside that list and were not given a second run.

## Loopback profile (pre-existing, not fixed here)

`public-acquisition/engine.test.mjs` writes the tracked file `public-acquisition/loopback-profile.json` when the cold node and python clients both succeed (the `writeFileSync` at the end of that test). That write is in the base source. `docs/reviews/sol398-scoped-repair/ROOT-RELEASE-PREP.md` already says the acquisition suite rewrites this file and that it must be restored before commit. The pinned run did rewrite it (`156` lines of diffstat in `evidence/pinned-node-npm-test.meta.txt`) and it was restored with `git restore --source=HEAD -- public-acquisition/loopback-profile.json`. It is not in this commit. The base v22.14.0 run did not reach that write because the cold-client test failed first.

## Limits

- httpx 0.28.1 is the documented Python cold client, installed with `python3 -m pip install --user 'httpx==0.28.1'`. It is not a repository dependency. Without that import, the python half of `public-acquisition/engine.test.mjs` exits on `ModuleNotFoundError`.
- Acceptance run uses Node v22.23.3, which satisfies `>=22.22.0`. Default `/exec-daemon/node` remains v22.14.0. On that binary the three pin failures above still fail. Historical loopback profile Node v22.22.2 is not what this run wrote; the committed profile was restored.
- No production signer, funds, live offer, payment, deployment, or merge to main.
- H is pending-join and was not claimed.
