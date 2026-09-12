# Cost and price

Existing route prices are unchanged. Customer-facing quote text does not
name internal research models.

| Component | Status |
| --- | --- |
| Default new-route price | `$0.005` (`VENDOR_BUDGET_IMPACT_PRICE`), same band as live `GET /extract` |
| Railway hosting | Official public rates below. No invoice was read. |
| Facilitator fees | CDP public rates below. Tests stub the injectable facilitator. |
| Model / LLM cost | None. Deterministic CPU JSON compare. |
| Margin | Unknown. Not claimed non-lossmaking. Local in-process measure below. |

## Official public rates (not an invoice)

Railway resource pricing from docs.railway.com/pricing: RAM `$10` / GB / month,
CPU `$20` / vCPU / month, network egress `$0.05` / GB. Per-second meters:
`$0.00000386` per GB-second RAM and `$0.00000772` per vCPU-second.

CDP x402 Facilitator: verify is free. First 1,000 onchain facilitator
transactions per month are `$0.00`, then `$0.001` per onchain settle for `exact`.

## Local in-process measure (this host, 2026-09-12)

| Input | Request bytes | Response bytes | Wall | CPU user |
| --- | ---: | ---: | ---: | ---: |
| Ordinary caller delta (2 then 3 rows) | 553 | 3309 | 0.121 ms | 0.117 ms |
| Unit-case (4 rows) | 522 | 3239 | 0.052 ms | 0.052 ms |
| Maximal admitted (256 rows) | 30028 | 2756 | 1.15 ms | 2.573 ms |

If the max compare used one vCPU for 0.0026 s, public Railway CPU is about
`$0.00000002`. 30 KB request plus 3 KB response egress is far below `$0.005`.
After the CDP free tier, `$0.001` settle is 20% of list price. Idle RAM of the
shared merchant process is billed while the service runs, not per call. No
Railway or CDP invoice was read. `$0.005` is not an obviously loss-making
compute price.

`sold` is not set. Engine `purchaseAuthority` stays false.
This route settles x402 exact only. Existing MPP routes are unchanged.
No production deploy or money movement in this assignment.
