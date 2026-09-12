# Cost and price

Existing route prices are unchanged. Customer-facing quote text does not
name internal research models.

| Component | Status |
| --- | --- |
| Default new-route price | `$0.005` (`LOCKFILE_PIN_DELTA_PRICE`), same band as live `GET /extract` |
| Railway hosting | No invoice was read. Official public rates below. |
| Facilitator fees | CDP public rates below. Tests stub the injectable facilitator. |
| Model / LLM cost | None. Deterministic CPU JSON compare. |
| Margin | Unknown. Not claimed non-lossmaking. |

## Official public rates (not an invoice)

Railway resource pricing from [docs.railway.com/pricing](https://docs.railway.com/pricing)
(also listed on [railway.com/pricing](https://railway.com/pricing)): RAM `$10` / GB / month,
CPU `$20` / vCPU / month, network egress `$0.05` / GB. Per-second meters on the marketing
page: `$0.00000386` per GB-second RAM and `$0.00000772` per vCPU-second.

CDP x402 Facilitator from
[docs.cdp.coinbase.com/x402/seller/facilitator](https://docs.cdp.coinbase.com/x402/seller/facilitator):
verify is free. First 1,000 onchain facilitator transactions per month are `$0.00`, then
`$0.001` per onchain settle for `exact`.

## Conditional introductory estimate

Empirical in-process max-admitted pair on this host: 110,145 bytes, 613 pins, about 21 ms
wall. If that compare used one vCPU for 0.021 s, public Railway CPU is about `$0.00000016`
and 160 KB egress is about `$0.000008`. Those per-call meters are far below `$0.005`.

That is **not** proven margin. Idle RAM of the shared merchant process is billed while the
service runs, not per lockfile call. After the CDP free tier, `$0.001` settle is 20% of the
list price. No Railway or CDP invoice was read. No guaranteed-profit claim.

`sold` is not set. Engine `purchaseAuthority` stays false.
This route settles x402 exact only. Existing MPP routes are unchanged.
No production deploy or money movement in this assignment.
