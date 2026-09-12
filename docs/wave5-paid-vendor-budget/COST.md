# Cost and price

Existing extract, lockfile, and homepage prices are unchanged. Customer-facing
quote text does not name internal research models.

| Component | Status |
| --- | --- |
| Default new-route price | `$0.005` (`VENDOR_BUDGET_IMPACT_PRICE`), same band as live `GET /extract` |
| Railway hosting | Official public rates below. No invoice was read. |
| Facilitator fees | CDP public rates below. Tests stub the injectable facilitator. |
| Model / LLM cost | None. Deterministic CPU JSON compare. |
| Margin | Unknown. Estimate only. Not a proven-profit claim. |

## Official public rates (2026-09-12, not an invoice)

Railway from [docs.railway.com/pricing.md](https://docs.railway.com/pricing.md)
and [railway.com/pricing.md](https://railway.com/pricing.md): RAM `$10` / GB /
month, CPU `$20` / vCPU / month, egress `$0.05` / GB. Per-second meters:
`$0.00000386` per GB-second RAM and `$0.00000772` per vCPU-second.

CDP x402 Facilitator from
[docs.cdp.coinbase.com/x402/seller/facilitator.md](https://docs.cdp.coinbase.com/x402/seller/facilitator.md):
verify is free. First 1,000 onchain facilitator transactions per month are
`$0.00`, then `$0.001` per onchain settle for `exact`.

## Pre-fix measurement on this host (2026-09-12)

The table below is historical evidence from the admitted PR61 implementation,
not a measurement of the corrected concurrency and output contract. The Root
replay `cost-measure.json` is preserved unchanged. The current implementation
admits at most four workers per merchant process and rejects excess requests
without settlement. Final release-gate measurements, when explicitly requested,
write a separate `cost-measure-codex.json`; tests no longer overwrite evidence.

Pure-function in-process compare is not the live path. Live calls spawn an
isolated Node worker. Receipt: `cost-measure.json`.

| Path | Request | Response | Wall |
| --- | ---: | ---: | ---: |
| In-process ordinary | 553 B | 3309 B | 0.31 ms |
| Worker ordinary | 553 B | 3310 B | 41.3 ms |
| Worker max 256 rows | 30028 B | 2757 B | 38.8 ms |
| Mounted HTTP ordinary | 553 B | 3310 B | 71 ms |
| Mounted HTTP max 256 | 30028 B | 2757 B | 53 ms |
| Cohort 1 / 6 / 12 max | ordinary | 3310 B | 49 / 92 / 166 ms |

Process footprint (Linux VmRSS of merchant plus descendants):

| State | RSS |
| --- | ---: |
| Idle merchant | 194 MiB |
| After one paid call | 207 MiB |
| Peak during 12 concurrent | 349 MiB |

Worker spawn (~40 ms) dominates the compare. 12 concurrent paid POSTs peaked
about 155 MiB above idle. Children were reaped; `ownedVendorBudgetWorkerCount`
returned to 0.

Variable-cost estimate for the worst observed call window (~0.17 s, ~0.34 GB
RSS, ~33 KB on the wire): Railway CPU about `$0.0000013`, RAM-during-window
about `$0.0000002`, egress about `$0.0000015`. After the CDP free tier,
`$0.001` settle is 20% of `$0.005`. Idle merchant RAM is billed while the
shared process runs, not per vendor-budget call.

`$0.005` is not an obviously loss-making compute price on these measurements.
That is an estimate, not proven margin. Keep the provisional price.

`sold` is not set. Engine `purchaseAuthority` stays false.
This route settles x402 exact only. Existing MPP routes are unchanged.
No production deploy or money movement in this assignment.
