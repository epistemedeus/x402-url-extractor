# NEXT

Root owns merge, release, PR 243, customer communication, and signer-free readback. This branch is the candidate at `c18f842ae814c587617bf8637c8a1b82548cd345`. It is not merged and it is not deployed.

`withholdUnprovenNativeSettlement` is the native priced gate. Boolean false remains `settlement_unsuccessful`. Absent, malformed, and nonboolean settlement is `settlement_unproven` and stays out of the replay journal. The joined report's note that a missing boolean `success` could still carry the handler body describes `bdea3f75` and `2fee96da`. `c18f842ae814c587617bf8637c8a1b82548cd345` closes that residual. Those earlier positive runs did not prove this boundary.

`2e197da` remains the original paid-body reproduction. H64202 `dbe23333` stays immutable. `idempotency-replay.mjs`, `package.json`, and `package-lock.json` were not edited. The lock still equals `3da7278`. Axios applicability stays separate from the `1.20.0` pin.

`paidHttp` withholds only an explicit boolean false copied from the route payment-response. A route-owned HTTP 200 is that route's delivery authority. Free tools, unpaid challenges, safe handler errors, and a retained successful recovery stay on their existing paths.

Production MPP stays off until Root configures it. This run did not read, copy, restore, or rotate production secrets or config. Leave package `1.23.55`, prices, recipients, and `qs` `6.16.0`.
