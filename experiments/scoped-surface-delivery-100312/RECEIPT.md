# Receipt — scoped surface delivery 100312

Status of this package: candidate exported. Not production, not a customer, not a payment.

## Pins

| Source | Commit | Use |
| --- | --- | --- |
| Merchant `x402-url-extractor` | `c1518cce1b60799044cfd8b8a749abb150299a63` | Host repo. `server.js` was not edited. |
| Pilot context | `64c83609faf6a44d9d8a76930546a06313100033` | L14 row and current receiving section read. |
| Sol return | `29c80e6b4aa19a437af3870489281b7820cd6cc7` | Findings on SkillGuard `951230b7` only. Not reused as a pass for the current head. |
| SkillGuard PR2 | `beec14acbb56de37cd361acc949087b9ae019b70` | Scanner pin. Version 1.3.0. Not amended here. |
| Accepted derivative 272 | `4dbd9612a2d263d464bbf7c782a7e1211c164dcb` | Foundation merged as Neo PR 249. |
| Accepted derivative 283 | `a7bd87116a4e8285e779b10e549fc4c1cd179674` | Reader actually loaded. sha256 `fcd9d9c10c1a82154384f367fa7c3fc9096d234978609a1c45ade819eb102e5b`. |
| Protocol envelope 203 | `d0bff9127bd609137a32167b0120d0382ca7225e` | Declared. Not copied. |
| Maintained lock 222 | `ba7e32612568c967907828f340aa5ba7cfa91afc` | Declared. No second lock or database. |
| Commerce binding 301 | merchant `commerce-outcome-binding.mjs` at `c1518cce` | Price proposal seals a server task ref. |

SkillGuard `package.json` declares MIT. That tree has no `LICENSE` file. The scanner is hydrated, not vendored. Neo's reader is private and is hydrated outside this repository.

## SkillGuard receiving

`npm ci --ignore-scripts` then `npm test` in the pinned checkout: 35 tests, 35 pass, 0 fail, exit 0, `duration_ms` 624.470641. Node v22.14.0.

CLI `node index.js fixtures/harmless --json` exit 0, verdict clean, version 1.3.0, `executedTarget` false, 3 text files. `node index.js fixtures/env-exfil` exit 3. Library `analyze("fixtures/harmless")` returned clean. MCP `initialize` returned serverInfo version 1.3.0, and `tools/list` returned `scan_skill`. A hand-mutated clean report viewed with `--show-report` exits 66 and is labeled unverified. The fixture trees were not imported. No `EXECUTED` canary was created.

Pre-existing failure on this head: none in `npm test`. Sol's MCP parse-error and protocol-negotiation notes remain on the unchanged MCP server. This package does not treat that as a new scanner amendment.

## This candidate

Acceptance command:

```sh
node --test --test-concurrency=1 experiments/scoped-surface-delivery-100312/test/acceptance.test.mjs
```

Exit 0. 13 tests, 13 pass, 0 fail. `duration_ms` 1292.412844.

Adjacent binding command:

```sh
node --test --test-concurrency=1 commerce-outcome-binding.test.mjs
```

Exit 0. 6 tests, 6 pass. `duration_ms` 753.575401.

`git apply --check experiments/scoped-surface-delivery-100312/route/ROOT-SERVER-MOUNT.patch` exit 0. The patch was not applied.

One measured pair, same Node process, cash `unknown`:

| Tree | Exit | Concern | Bytes | Child wall | Child user CPU | Prep |
| --- | --- | --- | --- | --- | --- | --- |
| env-exfil text | 3 | match | 96 | 31.576 ms | 6333 µs | 883.207 µs |
| add helper | 0 | no_match | 44 | 27.458 ms | 2637 µs | 252.637 µs |

The no-match report sets `universalGuarantee` false. Tokens, profit, and hosted price stay unknown. `recognizedRevenueAtomic` is `0`.

Seeded refusals covered by the 13 tests: forged local report exit 66, path traversal, secret text absent from the report, symlink and binary and path collision before a child scan, slow child cancelled exit 65, output cap exit 65, wrong context, changed input, payment receipt and `accepted: true` refused as grants, later process with `USEFUL_RESULT_GRANT` exit 64.

## Integration left for Root

Hydrate the two pins, choose a private journal directory, and apply the mount patch before paid middleware. Do not publish the price routes. Customer use, production hosting, and payment remain unproved.
