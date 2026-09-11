# Cost and price

Existing route prices are unchanged.

| Component | Status |
| --- | --- |
| Default new-route price | `$0.005` (`LOCKFILE_PIN_DELTA_PRICE`), same band as live `GET /extract` |
| D26 proposed `0.003` USDC | Assumption. Not used. |
| D26 EC2 CPU-credit model | Assumption. Not this host's CPU bill. |
| Railway hosting / RAM / egress | Unknown. Not read from a Railway invoice in this assignment. |
| Facilitator fees | Unknown for the production facilitator. Tests stub the injectable facilitator. |
| Model / LLM cost | None. Deterministic CPU JSON compare. |
| Margin | Unknown. Not claimed non-lossmaking. |

`sold` is not set. Engine `purchaseAuthority` stays false.
Settlement remains the existing x402 exact / MPP rails when the flag is on.
No production deploy or money movement in this assignment.
