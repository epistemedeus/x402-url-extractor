# Joined merchant candidate

Tested source `3ab40526a63faf247b8a83ac3986b88157f3db7e`, tree `6f73da10cdc3b5eb7266ee8eae7397cb26b71cd6`. This report is the child of that commit. The merge is `adcf0afc5421b669d0377a53e9312712c0829e86`, tree `25a79f286c894cc93e33dddcc28ff0ebe024eee2`, parents `3da72788305b3529704b8e99f2abbce06d15fb75` and `ab5bf51b60c7fa6e2d3587fcac23b26f00872b65`.

Lineage kept on `codex/root64201-heavy-window-20261029`:

| Commit | Role |
| --- | --- |
| `a1dc09bb076b823fb3492ea79fa10f8602ed01a5` | Shared base. Lock sha256 `28d5a53db8e9107efb07be00b377a96e5afce9f897a9852c3915c293345dd42c`. |
| `424c5fbcda77c8dbbd8fb3f6b669a7c3600e4bf2` | `2026-07-28` opt-in and axios `1.20.0`. |
| `2e197da2a3e994417af818e8641fab5bd7079e01` | Compatibility evidence. Explicit `{ success: false }` still returned the paid body. |
| `bdea3f75dfbea51fe10e1f617a2dc758ed124030` | `withholdExplicitFalseSettlement` on the shared paid callback. |
| `3da72788305b3529704b8e99f2abbce06d15fb75` | Amendment evidence. Maintenance lock sha256 `6b0841b16cdf16d80908d69c93a694ae8d7b6d1af70df5156656703c67af172c`. |
| `ab5bf51b60c7fa6e2d3587fcac23b26f00872b65` | H64330 availability. Same base. PR 243 was not changed. |

`server.js` keeps `modernProtocol: true` and uses `operationIdentityFromAction`. `mcp-server.mjs` keeps the false-settlement withhold. Package `1.23.55`, axios override `1.20.0`, `qs` `6.16.0`, root zod `3.25.76`, SDK `1.30.0`, server and client `2.4.0`. The joined lock equals the `3da7278` lock. The `a1dc09bb` lock is a separate recorded fact. No further dependency change.

The H64330 `accept.mjs` at `ab5bf51b` archived `2e197da` and required the candidate lock to equal `a1dc09bb`. That script and its `experiments/oct29-mpp-availability/evidence` stay as that historical run. The deciding entry installs this HEAD, requires the `3da7278` lock, and writes this directory.

## Command

```sh
ACCEPTANCE_DIR=/tmp/h64201-joined-accept node experiments/oct29-mpp-availability/accept.mjs
```

Started `2026-10-29T20:20:12.356Z`, exit 0, wall `42.45s`. `git archive HEAD` then `npm ci --ignore-scripts` for that tree and for auditor `ef519956505b195454aa670230b0936258b451fb`. Installed axios `1.20.0`, SDK `1.30.0`, server `2.4.0`, client `2.4.0`. Python `mcp` `2.3.0` from `/tmp/oct29-mcp-py-site`. Node `v22.23.4`. One serial process. No model child. Process RSS was not sampled.

## Mounted server.js

`lab.mjs` booted the archived `server.js` with MPP off, then a generated disposable secret, then off again in a new process. Each selected audit was HTTP 402 with empty findings. Protocols were `x402`, then `mpp` and `x402`, then `x402`. The pinned client negotiated `2026-07-28` in all three modes and the free `careers_board_cold` call had `charged: false`. Legacy SDK `1.30.0` and the pinned client each listed 29 tools. Optional routes with Circle off, a short secret startup refusal (`at least 32 bytes`, process never reached `listening on`), wrong method, HEAD, invalid input, and the x402-only lockfile route passed inside that lab. Facilitator calls were eight `GET /supported`, verify 0, settle 0. The public Action wrapper exited 1 with `origin address is not public`. `auditIntegrity` then read the captured method and URL responses. Captures used loopback HTTP, canonical Host `agents.samedaydesk.com`, and `x-forwarded-proto: https`. Ten human page hashes matched the preserved H64330 acceptance record, and `comparePreserved` matched the preserved base capture `71ccb41dee3f89e503f19ef6ae9ad3bb38e06a68ba9ba5a8c80ef90051bfc094`.

Focused availability regressions: 83 pass, 0 fail, `duration_ms` `18251.014377`, local facilitator verify 0, settle 0.

## Payment clients

`node --test --test-concurrency=1` on the fresh install, 16 pass, 0 fail, `duration_ms` `6736.773619`.

| Gate | Result on this tree |
| --- | --- |
| Axios `1.20.0` pin and rejecting lookup | Pass. Applicability stays separate from the pin. |
| Production `modernProtocol: true` and legacy default | SDK `1.30.0` negotiates `2025-11-25`. Client `2.4.0` pins `2026-07-28` on the production mount and falls back on the default mount. Free `local_note` returns `charged: false`. Unpaid `enrich` challenges with handler 0. |
| Malformed era, metadata, and header identity | Unsupported era is a protocol error. Malformed metadata is `-32602`. Conflicting header is `-32020` with verify 0 and handler 0. |
| Verify false | Verify 1, settle 0, handler 0. |
| Settle throw | `isError`, no paid note, no `payment-response.success`. Counts verify 1, settle 1, handler 1. |
| Settle boolean false | Both mounts withhold. Text is `settlement_unsuccessful`. No paid body and no success receipt. Typed `settlement_failure`, `handlerInvoked` true, `settlementState` `failed`. Forged request `success: true` does not win. |
| Unknown settlement | Missing boolean `success` stays `telemetry_incomplete` and `settlementState` `unknown` on both mounts. |
| Same credential and changed args | Handler stays 1. `recover_paid_result` does not return the withheld note. |
| New nonce | Counts become verify 2, settle 2, handler 2. |
| Lost-response success | `recover_paid_result` returns note `kept`. Verify, settle, and handler stay 1. |
| Python `mcp` `2.3.0` | Pin and legacy both see `settlement_unsuccessful` and `paymentSuccess` false. |
| Stdio pin | Free structured output and unpaid `enrich` challenge. |

Pilot `dbe233339e155a857d624a12c117f4d59a8bbcf9` blob `ea2d06360932c430ea32b22391cf291fced1618a` remains the `2e197da` reproduction, where those false-settlement cases exposed the paid table. That tree was not edited. H64330 `evidence/original-failures.json` was not edited.

## Bounds

Compatibility clocks `2026-10-29T17:10:00.000Z` and `2026-10-29T17:25:00.000Z`, and amendment clocks `2026-10-29T20:35:00.000Z` and `2026-10-29T20:50:00.000Z`, stay as recorded. This join uses checkpoint `2026-10-29T21:05:00.000Z` and requiredUntil `2026-10-29T21:20:00.000Z`, inside foreground `2026-10-29T21:22:41.463791Z`. Model `grok-4.7`, effort `xhigh`, session `0bd1eb6c-5b57-43a7-a305-765230c19f6b`, host `cloud-n`. No model child in this join. The earlier payment review child remains the one recorded in the amendment RESULT.
