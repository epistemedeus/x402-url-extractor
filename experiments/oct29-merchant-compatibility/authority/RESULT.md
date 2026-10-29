# Native settlement authority

Tested source `c18f842ae814c587617bf8637c8a1b82548cd345`, tree `63c68227a1a7f556810d54c95ab3f26e30fe46ce`. This report is the child of that commit. Parent `2fee96dadee6e95ed0e98bc9a47dc6c48b730667` remains the joined export. Historical `RESULT.md`, `NEXT.md`, `joined/`, and `experiments/oct29-mpp-availability/evidence` stay as written.

`@x402/core@2.16.0` `SettleResponse` requires boolean `success`, string `transaction`, and `network`. The client `PaymentResponseContext` treats `success: true` as settled, `success: false` as failed, a payment-required body with no settle response as verify failure, and `error` as transport or parse failure. `settlePayment` returns the facilitator object unchanged. `settlePaymentResult` attaches that object and spreads the handler body. `isSettleResponseStructure` only checks that `success` is present. That stack has no path where a settle object without boolean `success` authorizes delivery.

`withholdUnprovenNativeSettlement` sits on the native paid callback, before the shared replay journal and before either era delivers the result. Delivery requires `success === true`, a string `transaction`, and a non-empty string `network`. Boolean `success === false` stays `settlement_unsuccessful` with `settlementSuccess: false` and payment-response `{ success: false }` only. Every other native proof, including a missing, empty, malformed, null, or nonboolean `success`, becomes `settlement_unproven` with empty `_meta`. That hold does not set `success: false`, `charged`, or `settlementSuccess`. The handler may already have run. `idempotency-replay.mjs` is unchanged: only `proof.success === true` is retained, so an attempted unknown settle stays quarantined as `payment_execution_in_flight_or_unknown`.

`paidHttp` still uses `withholdExplicitFalseSettlement` only. The mounted `extract_batch` bridge calls its real loopback route. Boolean false is withheld. A route-owned HTTP 200 with `success: true`, and a route-owned HTTP 200 with no payment-response, both deliver that route body. Free tools stay on `freeUnpaidHandler`. Challenges and safe handler errors pass through. An `isError` flag does not keep a protected paid body. A caller-supplied payment-response is not facilitator authority.

`2e197da2a3e994417af818e8641fab5bd7079e01` still shows the original paid-body release. `bdea3f75dfbea51fe10e1f617a2dc758ed124030` withholds boolean false and still delivered a body when `success` was absent or nonboolean. The joined 16-pass payment run did not prove this boundary. H64202 `dbe233339e155a857d624a12c117f4d59a8bbcf9` and blob `ea2d06360932c430ea32b22391cf291fced1618a` stay immutable.

## Installed contracts

Lock sha256 `6b0841b16cdf16d80908d69c93a694ae8d7b6d1af70df5156656703c67af172c`, equal to `3da72788305b3529704b8e99f2abbce06d15fb75`. Base lock `28d5a53db8e9107efb07be00b377a96e5afce9f897a9852c3915c293345dd42c` stays a separate fact. No dependency edit.

- `@x402/core@2.16.0` `https://registry.npmjs.org/@x402/core/-/core-2.16.0.tgz` `sha512-7MjwOEiE6ICAYtOsK9vQl66Ho4jERDuuoRg/No2Nc2GQ7y/M/yu4DJ65LzeBycQE+Qrg2RqQG7KR51tyT+hzjQ==`
- `@x402/mcp@2.16.0` `https://registry.npmjs.org/@x402/mcp/-/mcp-2.16.0.tgz` `sha512-VNCHByCQt9Kyu9V6fMENkKViP2sillgL8euhN73KOhBtvNB+mf9qHKjktTL9EqLbYOToZ1RmX26tM1n2W/JLRA==`

Package `1.23.55`, axios override `1.20.0`, `qs` `6.16.0`, zod `3.25.76`, SDK `1.30.0`, server and client `2.4.0`. `server.js` still has `modernProtocol: true`.

## Command

```sh
ACCEPTANCE_DIR=/tmp/h64201-authority-accept node experiments/oct29-mpp-availability/accept.mjs
```

Started `2026-10-29T20:45:01.998Z`, exit 0, wall `36.75s`. `git archive HEAD` of `c18f842ae814c587617bf8637c8a1b82548cd345`, then `npm ci --ignore-scripts` for that tree and auditor `ef519956505b195454aa670230b0936258b451fb`. Installed axios `1.20.0`, SDK `1.30.0`, server `2.4.0`, client `2.4.0`. Python `mcp` `2.3.0` from `/tmp/oct29-mcp-py-site`. Node `v22.23.4`. One serial process. No model child. Process RSS was not sampled.

The same entry's archive also ran the availability lab and regressions. Off, on, and off again each had protocol `2026-07-28`, 29 tools, and free `samedaydesk-careers-board-cold-recipe` with `charged: false`. Protocols were `x402`, then `mpp` and `x402`, then `x402`. Ten human page hashes matched the preserved base capture `71ccb41dee3f89e503f19ef6ae9ad3bb38e06a68ba9ba5a8c80ef90051bfc094`. Facilitator calls were eight `GET /supported`, verify 0, settle 0. Startup refusal contained `at least 32 bytes` and the public Action wrapper exited 1 with `origin address is not public`. Regressions: 83 pass, 0 fail, `duration_ms` `14713.66335`, verify 0, settle 0.

## Payment clients

`node --test --test-concurrency=1` on the fresh install: 20 pass, 0 fail, `duration_ms` `6728.577706`. Focused M06 on this same `mcp-server.mjs` passed before the commit: missing boolean `success` stayed `telemetry_incomplete` and `settlementState` `unknown`, and boolean false stayed `settlement_failure`.

| Gate | Result on this tree |
| --- | --- |
| Axios `1.20.0` pin and rejecting lookup | Pass. Applicability stays separate from the pin. |
| Production `modernProtocol: true` and legacy default | SDK `1.30.0` and client `2.4.0` on both mounts. Free `local_note` returns `charged: false`. Unpaid `enrich` challenges with handler 0. |
| Missing, empty, malformed, missing, and nonboolean proof | Both mounts and both clients withhold `settlement_unproven`. Text, structured content, and metadata omit the note. No `charged` and no `success: false`. Forged caller `success: true` does not release the body. Handler count increases by 1. Telemetry stays `telemetry_incomplete` / `unknown`. |
| Boolean false | `settlement_unsuccessful`, `settlementSuccess: false`, meta `{ success: false }` only. Typed `settlement_failure`, `handlerInvoked` true, `applicationOutcome` `success`, `settlementState` `failed`. |
| Settle throw | Challenge, no paid note, no `payment-response.success`. Counts verify 1, settle 1, handler 1. |
| Contract success | `success: true`, string transaction, and network `eip155:84532` deliver `structuredContent.note` and `payment-response.success` true. |
| Already `isError` protected body | Null proof is withheld as `settlement_unproven`. A safe `{ ok: false, error: "safe_handler", charged: false }` handler error is returned as that error. |
| Unknown retry | Same credential stays verify 1, settle 1, handler 1 and returns `payment_execution_in_flight_or_unknown` without the note. Changed arguments stay at handler 1. `recover_paid_result` does not return the note. A new nonce is verify 2, settle 2, handler 2 and is withheld again. |
| Lost-response success | `recover_paid_result` returns note `kept`. Verify, settle, and handler stay 1. A new nonce becomes 2, 2, 2. |
| paidHttp | Real mounted route. Boolean false is withheld. `success: true` and a 200 with no payment-response deliver the route body. |
| Python `mcp` `2.3.0` | Pin and legacy see `settlement_unsuccessful` with `paymentSuccess` false, and `settlement_unproven` with `paymentSuccess` null. |
| Stdio pin | Free structured output and unpaid `enrich` challenge. |

## Bounds

This third amendment uses checkpoint `2026-10-29T21:05:00.000Z` and requiredUntil `2026-10-29T21:20:00.000Z`. The acceptance above finished at `2026-10-29T20:45:38.698Z`. Earlier compatibility, false-settlement, and join windows stay in their own reports. Model `grok-4.7`, effort `xhigh`, session `0bd1eb6c-5b57-43a7-a305-765230c19f6b`, host `cloud-n`. No production access, payment, signing, settlement, merge, or deployment.
