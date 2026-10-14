# AE14 N2B base-health

Verdict: repaired

Base: `82a51274e7dc7a7600b90f1317a6be6b28442592` (main)

Branch: `codex/ae14-n2b-x402-base-health`

Head: the export commit on this branch whose parent is the base above. This blob cannot store its own commit id. After the fast-forward push, `git rev-parse HEAD` and the launcher HEAD file are that commit.

Next integration owner: dr eggbot -> Root (ownership chain: work-net lead -> dr eggbot -> Root).

Tests: 1168/1173 pass, fail 0, skip 5 (root `node --test` via `npm test`); pretest 19/19 pass, fail 0, skip 0; owned archive-mode 2/2 pass.

## Writer boundary

Result and evidence live in `experiments/ae14-n2b-base-health/`. Source edits outside that path are the six files under "Source files changed". No edits under `experiments/ae14-async-delivery/`, `integrations/agentverse-a2a/`, `public/downloads/continuity-client/`, other AE14 writer paths, live immediate-pay config, or vendored third-party trees. Sealed archive bytes and hash pins were left as published.

## Consumed inputs

| Input | Commit |
| --- | --- |
| This repository, unmodified base | `82a51274e7dc7a7600b90f1317a6be6b28442592` |
| pilot `EXPANSION-PORTFOLIO.md`, `GRAND-PLAN.md`, `INTEGRATED-DECISIONS.md`, `EXECUTION.md`, `ROOT-CANDIDATE-RECEIVING.md` in `overview/self-evaluations/2026-10-14-agent-economy/` | `7428845d6429b78573801ee8035953e26c610eaf` |
| pilot `GRAND-PLAN.md` section "Composed receiving matrix for the actual amended exports" (additive; scope, base, branch, and writer path unchanged) | `ecf78d29c2c592dd03b5daef4eeba2f29772c8ae` |
| pilot `tools/ops/stage-native-source.sh` (blob `613e3e336fc315650ea195270c010b1ef75ecf2a`), fetched with `gh api` Contents and used to stage both pilot commits | `c3436e8647bd111a04359193c55f2c97be77e180` |

H was not run. No A/B/C interaction was added. Joined quote, fee, acceptance, receipt, tenant, recovery, legacy 221400/234100, and HTTP/CLI cases stay pending-join for the lead-owned H harness. Service TLS and PostgreSQL verify-full were not changed and were not used to satisfy each other.

## Counts

`npm test` runs pretest, then the root `node --test` list. The lead counts are the root list.

| Run | Command | Exit | tests | pass | fail | skip | todo | duration_ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Base pretest | `npm test` | (inside exit 1) | 19 | 19 | 0 | 0 | 0 | 69.96658 |
| Base root list | `npm test` | 1 | 1173 | 1162 | 6 | 5 | 0 | 145671.609122 |
| After pretest | `npm test` | (inside exit 0) | 19 | 19 | 0 | 0 | 0 | 62.834788 |
| After root list | `npm test` | 0 | 1173 | 1168 | 0 | 5 | 0 | 173708.525544 |
| Owned | `node --test experiments/ae14-n2b-base-health/archive-mode.test.mjs` | 0 | 2 | 2 | 0 | 0 | 0 | 256.437428 |

Base root list: 2026-10-14T17:43:11Z to 2026-10-14T17:45:37Z, Node v22.14.0, npm 10.9.9, clean tree except this untracked writer path. Evidence: `evidence/base-npm-test.meta.txt`, `evidence/base-npm-test.stdout.txt`, `evidence/base-npm-test.stderr.txt`.

After root list: 2026-10-14T18:00:53Z to 2026-10-14T18:03:47Z, Node v22.14.0 (`/exec-daemon/node`), npm 10.9.9, Python 3.12.3, httpx 0.28.1, umask 0077. Shell `NODE` was unset; npm sets `NODE` to the suite binary for the script. Evidence: `evidence/after-npm-test.meta.txt`, `evidence/after-npm-test.stdout.txt`, `evidence/after-npm-test.stderr.txt`. Owned evidence: `evidence/owned-archive-mode.stdout.txt`, `evidence/owned-archive-mode.stderr.txt`.

stderr on both full runs is the Node `NO_COLOR` / `FORCE_COLOR` warning only.

## Base failures (file + title)

1. `caller-result-client.cold.test.mjs:223` — installed caller consumer reaches the mounted parent without merchant source. Fresh pack digest differed from sealed `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3`.
2. `caller-result-client.distribution.test.mjs:291` — caller generation keeps the sealed feedback archive and matches the current source. Same digest mismatch.
3. `public-acquisition/engine.test.mjs:355` — cold node and python httpx clients unpack the mount and run the declared commands. Unpacked seller-repair 0.4.1 exited 2: `node_pin_unsatisfied v22.14.0 requires >=22.22.0`.
4. `public-acquisition/receiving-lifecycle.test.mjs:547` — loopback receiving observes the mounted bytes and cold commands without publishing. Observation stayed incomplete for the same pin failure (status 4).
5. `public-acquisition/receiving-lifecycle.test.mjs:588` — a public proof parses a readback and does not publish when the runtime pin is unmet. The unmet-runtime branch was never reached because the cold command failed first.
6. `task-linked-delivery/experiments/useful-economics-100290/test/cold-export.test.mjs:21` — two cold consumers accept the public fixture and reject the seeded controls. Fresh pack digest differed from sealed `0e03fbdabec828a10ceade744a7d03d09170e1abfdd1f2844681e420c695c24c`.

All six are `ok` in the after TAP (tests 51, 54, 918, 932, 933, 1029).

## Environment-only skips (same five before and after)

No new skips. Each skip is the inherited condition:

1. `cold-discovery.http.test.mjs` — deployed extract advertises machine documentation. Skips when `COLD_DISCOVERY_LIVE !== "1"` (TAP `# SKIP` with no extra message).
2. `installed-feedback-journey-211998.test.mjs` — installed caller reports a free statement for the issued morpho capability. Skips when `scripts/task-result.mjs` is absent. `SAMEDAYDESK_INSTALLED_SKILL_ROOT` was unset, so the message is `installed skill missing at /tmp/hermes-user-211994/.hermes/skills/samedaydesk-task-result/scripts/task-result.mjs`.
3. `page-change-xagent-package.test.mjs` — official offline validator accepts exact commit package when pin is supplied. Skips when `XAGT_PLUGIN_ROOT` is unset: `Set XAGT_PLUGIN_ROOT to the clean official pin for this gate`.
4. `page-change-xagent-package.test.mjs` — sidecar detects a skip-worktree modification to the official validator. Skips when `XAGT_PLUGIN_ROOT` is unset: `Official validator checkout not supplied`.
5. `plugins/samedaydesk-x402/plugin.test.mjs` — unpaid initialize-era initialize and tools/list require extract and extract_batch. `liveTest` is `test.skip` when `SAMEDAYDESK_EXPECTED_LIVE_VERSION` is unset (TAP `# SKIP` with no extra message).

## Source files changed

1. `caller-result-client/export/pack.mjs` — pass `--mode=0644`. Sealed caller 0.1.1 bytes are mode 0644. umask 0077 made GNU tar store 0600 and change the digest. Source member hashes already matched. Archive bytes and the pinned sha were not regenerated.
2. `task-linked-delivery/experiments/useful-economics-100290/export/pack.mjs` — same `--mode=0644` for sealed useful-economics 0.1.0.
3. `machine-acquisition.mjs` — `resolveColdCommandNode()` keeps `process.execPath` when it satisfies `>=22.22.0`, otherwise the lowest installed Node that does. On this machine that is `/home/ubuntu/.nvm/versions/node/v22.23.3/bin/node` (v22.23.3). Receiving still reports `process.version`. Machine pin `>=22.20.0` and the sealed consumer pin `>=22.22.0` are unchanged. `experiments/seller-repair-service-100266/bin/caller-deliver.mjs` was not edited.
4. `public-acquisition/cold-acquire.mjs` — cold step argv uses `resolveColdCommandNode()` where the command says `node`.
5. `public-acquisition/receive.mjs` — receiving cold commands use the same substitution. Evidence still stores the original argv and `process.version`, so on Node v22.14.0 the public-proof test still takes the unmet-runtime branch (status 4, no artifact).
6. `public-acquisition/cold-httpx.py` — `resolve_node()` uses `NODE` only when that binary is `>=22.22.0`. Otherwise it asks `resolveColdCommandNode()`. `npm test` sets `NODE` to `/exec-daemon/node` (v22.14.0). A bare `node --test` does not, which is why an isolated engine run could pass while the full script still failed.

Owned regression (not added to the root `test` script, so the 1173 count stays comparable): `experiments/ae14-n2b-base-health/archive-mode.test.mjs`. It packs both archives under umask 0077 and requires the sealed digests, and it requires the resolved cold Node to satisfy `>=22.22.0`.

## Inherited suite

The inherited suite is root `npm test` (pretest plus the `node --test` list in `package.json`). It was run unchanged at the base and again after the fix. Assertions, names, timeouts, and snapshots were not weakened, deleted, renamed, or regenerated. Subset scripts (`test:nonlive`, `test:public-acquisition`, and the others) name files already inside that list and were not given a second run. `public-acquisition/loopback-profile.json` was rewritten by the passing engine test and restored from HEAD before commit (`restored: public-acquisition/loopback-profile.json` in the after meta). It is not in this diff.

## Limits

- httpx 0.28.1 is the documented Python cold client. It was installed with `python3 -m pip install --user 'httpx==0.28.1'` into the user site. It is not a repository dependency. Without that import, the python half of `public-acquisition/engine.test.mjs` exits on `ModuleNotFoundError`.
- The suite process remains Node v22.14.0, which does not satisfy the machine pin or the sealed consumer pin. Cold commands use the installed v22.23.3 binary. Historical loopback profile Node v22.22.2 is not installed here. The committed loopback profile was not replaced with this machine's profile.
- No production signer, funds, live offer, payment, deployment, or merge to main.
- H is pending-join and was not claimed.
