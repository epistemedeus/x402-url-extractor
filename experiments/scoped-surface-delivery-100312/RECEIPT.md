# Receipt — scoped surface delivery 100312

Status of this package: candidate exported on `codex/scoped-surface-delivery-100312`. Continues native 312 at `77909359cce5d5ab793546b6315a6779954c6d40`. Not production, not a customer, not a payment.

## Pins

| Source | Commit | Use |
| --- | --- | --- |
| Merchant `x402-url-extractor` | `c1518cce1b60799044cfd8b8a749abb150299a63` | Host repo. `server.js` was not edited. |
| Pilot context | `64c83609faf6a44d9d8a76930546a06313100033` | L14 row and current receiving section read. |
| Sol return | `29c80e6b4aa19a437af3870489281b7820cd6cc7` | Findings on SkillGuard `951230b7` only. Not reused as a pass for the current head. |
| SkillGuard PR2 | `beec14acbb56de37cd361acc949087b9ae019b70` | Scanner pin. Version 1.3.0. Not amended here. |
| Accepted derivative 272 | `4dbd9612a2d263d464bbf7c782a7e1211c164dcb` | Foundation merged as Neo PR 249. |
| Accepted derivative 283 | `a7bd87116a4e8285e779b10e549fc4c1cd179674` | Reader loaded only when the pinned file is present. sha256 `fcd9d9c10c1a82154384f367fa7c3fc9096d234978609a1c45ade819eb102e5b`. |
| Protocol envelope 203 | `d0bff9127bd609137a32167b0120d0382ca7225e` | Declared. Not copied. |
| Maintained lock 222 | `ba7e32612568c967907828f340aa5ba7cfa91afc` | Directory flock protocol reused. That file is not copied. |
| Commerce binding 301 | merchant `commerce-outcome-binding.mjs` at `c1518cce` | Price proposal seals a server task ref. |

SkillGuard `package.json` declares MIT. That tree has no `LICENSE` file. The scanner is a deployment artifact, not a vendored tree. Neo's reader stays outside this repository.

## SkillGuard receiving (312 pin measurement, scanner unchanged)

`npm ci --ignore-scripts` then `npm test` in the pinned checkout: 35 tests, 35 pass, 0 fail, exit 0, `duration_ms` 624.470641. Node v22.14.0.

CLI `node index.js fixtures/harmless --json` exit 0, verdict clean, version 1.3.0, `executedTarget` false, 3 text files. `node index.js fixtures/env-exfil` exit 3. Library `analyze("fixtures/harmless")` returned clean. MCP `initialize` returned serverInfo version 1.3.0, and `tools/list` returned `scan_skill`. A hand-mutated clean report viewed with `--show-report` exits 66 and is labeled unverified. The fixture trees were not imported. No `EXECUTED` canary was created.

Pre-existing failure on this head: none in that `npm test`. Sol's MCP parse-error and protocol-negotiation notes remain on the unchanged MCP server. This package does not treat that as a new scanner amendment.

## This continuation

Repair history is a new scan of the original authorized bytes, or a server-owned prior token whose stored bytes are scanned again. A caller object that carries `schema`, `scanPerformed`, `findings`, or `previous` returns `comparison: "inconclusive"`, `reason: "unverified_prior"`, exit 66, and zero child spawns.

Retention ids bind owner, request, task, concern, sharing scope, and the observed rerun. Equal repaired bytes may share one payload and still keep two owners. The owner continuation is returned once; the journal stores its sha256. Correction and revocation require that continuation after restart. A later read rechecks revision and generation under the directory lock.

`ensurePublicScanner` hydrates the public scanner only. `ensureRetentionAuthority` checks a file already on disk and does not fetch. A missing journal or authority returns `retention_not_enrolled` or `retention_authority_unavailable`. The mount calls `resolveHostedScanner()` and does not open a journal unless `SCOPED_SURFACE_JOURNAL` is a non-empty string. One operation budget covers intake, materialization, every child, the retest, and a retention reread.

Acceptance and source-bound command, Node v22.14.0:

```sh
node --test --test-concurrency=1 experiments/scoped-surface-delivery-100312/test/acceptance.test.mjs experiments/scoped-surface-delivery-100312/test/source-bound.test.mjs
```

Exit 0. 22 tests, 22 pass, 0 fail. `duration_ms` 3229.542829. Tests 1–13 are the retained 312 regressions. Tests 14–22 are the source-bound additions, including the shaped forged prior.

Adjacent binding command:

```sh
node --test --test-concurrency=1 commerce-outcome-binding.test.mjs
```

Exit 0. 6 tests, 6 pass, 0 fail. `duration_ms` 717.937572.

`git apply --check experiments/scoped-surface-delivery-100312/route/ROOT-SERVER-MOUNT.patch` exit 0. The patch was not applied. `git diff --exit-code -- server.js package.json` exit 0.

The 312 receipt measured one pair in the same Node process, cash `unknown`: env-exfil text exit 3, concern match, 96 bytes, child wall 31.576 ms; add-helper exit 0, concern no_match, 44 bytes, child wall 27.458 ms. This continuation re-ran that acceptance test and did not publish a new timing table. The no-match report sets `universalGuarantee` false. Tokens, profit, and hosted price stay unknown. `recognizedRevenueAtomic` is `0`.

Seeded refusals that the suite asserts: shaped forged prior exit 66 and `spawns` 0; forged local report exit 66; wrong-owner continuation; payment receipt and `accepted: true` refused as grants; later process with `USEFUL_RESULT_GRANT` exit 64; changed later input `input_mismatch`; missing private authority with no git fetch; null and malformed retention body HTTP 400; mount without enrollment HTTP 503 `scanner_not_hydrated` and retain `retention_not_enrolled`; forged prior token `unverified_prior`; shared deadline cancels the slow child exit 65; output cap exit 65; direct child SIGKILL is not exit 0. The anonymous acquisition subtest copies the public CLI outside the repository, puts a fake `git` first on `PATH`, and runs scan plus retest with the artifact and no GitHub token or authority file.

## Integration left for Root

Place the public scanner artifact, optionally enroll a private journal and the pinned Neo reader, and apply the mount patch before paid middleware. Do not publish the price routes. Customer use, production hosting, and payment remain unproved. A static no-match is not a universal guarantee.
