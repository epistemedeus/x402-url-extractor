# Cost and price

Existing route prices are unchanged. Customer-facing quote text does not
name internal research models.

| Component | Status |
| --- | --- |
| Default new-route price | `$0.005` (`LOCKFILE_PIN_DELTA_PRICE`), same band as live `GET /extract` |
| Railway hosting / RAM / egress | Unknown. No Railway invoice was read. |
| Facilitator fees | Unknown for the production facilitator. Tests stub the injectable facilitator. |
| Model / LLM cost | None. Deterministic CPU JSON compare. |
| Margin | Unknown. Not claimed non-lossmaking. |

Empirical bound (this host, in-process, max-admitted pair, recorded by
`lockfile-pin-delta.test.mjs`): see FINAL-REVIEW.md after the test run.

`sold` is not set. Engine `purchaseAuthority` stays false.
Settlement remains the existing x402 exact / MPP rails when the flag is on.
No production deploy or money movement in this assignment.
