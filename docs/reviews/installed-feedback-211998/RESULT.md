# Installed feedback journey 211998

The installed caller can now submit an optional free statement for a capability the current merchant actually issued. The statement stays caller asserted. Usefulness stays unknown. The settlement parent stays pending. This is evidence for the existing measurement path. It is not a new feedback product, an outside-use claim, customer acceptance, or revenue.

## Source

| Item | Value |
| --- | --- |
| Merchant | `epistemedeus/x402-url-extractor` |
| Base | `838abb50ec9ddac9e93d39d9f8c91f1f3ca44a35` |
| Branch | `codex/installed-feedback-journey-211998` |
| Product commit | `75991c1c0935562750922a1b92520f4fc389653d` |
| Product tree | `e912c3f2e9dc55bd83803afcb125b1e703c53852` |
| Runtime | Node `v22.23.3` |
| Install | `npm ci --ignore-scripts` with the repo `.npmrc`, 244 packages |

Skills source, EIN996, and Root publisher files were not edited. The four installed skill files match product `0693da2a609df703f892eb4322d37910c3743b69`. Hosted archives `0.1.0` and `0.1.1` were not rebuilt.

No production file changed. `mcp-server.mjs`, `caller-result-feedback.mjs`, and `server.js` are the same as `838abb50`. No shared production defect was reproduced, so there is no production before/after. The only product change is the optional loopback seam and the journey that exercises it.

## Seam

`fixtures/mcp-task-recovery-loopback.mjs` keeps the default mount: `opportunity_preflight`, `transaction_receipt`, and the native `recover_paid_result` tool. `toolCount` stays 2. Handler counts stay `{opportunity, receipt}`. `/fixture-declarations` is absent.

A string `callerResultFeedback.key` in the loopback JSON is the only switch. The fixture does not read `CALLER_RESULT_FEEDBACK_KEY` from the environment. The journey supplies a 38-byte fixture string in that JSON. An environment copy of the same string left the default mount unchanged.

When the switch is on, the fixture uses the maintained factories:

- `createCommerceTelemetry({ dataDir })` and `createCallerResultFeedbackService({ dataDir, key })` share the fixture data directory.
- `mountMcp` receives `typedTelemetry` and `callerResultFeedbackKey` in the same shape as `server.js`.
- `morpho_position` calls the production `morphoPosition` function. The fetch is the existing local GraphQL fixture. `rpcCheck` is false. Price is `$0.02`.
- `report_caller_result` is free and calls `submitMcp` through `mcpCallArguments`.
- `HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS=simulated` is set only inside that fixture process. The class is a test label. It is not settled funds.

The capability is attached only by `sealToolResultForSend`: `sealObservedMcpToolResult` for `morpho_position` / `mcp://tool/morpho_position`, then `attachMcpCallerResultFeedback` when the typed attempt reports handler success and a succeeded settlement reference. `appendMcpTypedDecision` writes the commerce event and the MCP delivery row. `submitMcp` binds that capture and writes the statement.

Native recovery stays `createIdempotencyReplay`. The journal stores the handler result before the transport hook attaches the capability.

## Installed bytes

Path: `/tmp/hermes-user-211994/.hermes/skills/samedaydesk-task-result`

| File | Bytes | SHA256 |
| --- | ---: | --- |
| `SKILL.md` | 3696 | `83fd65e53ffd93c45e7915afa0fd7e271ce226cb2a63e6d17e32b644bad66254` |
| `scripts/task-result.mjs` | 33653 | `d1bc056d8a08d912c11803f69c5d85d82348801ed28494bc870d7c4c72b714c3` |
| `references/caller-pin.json` | 3642 | `7e6adbccf8436c90e23e3ee2338cbac093c33968628e5c5cae5c7d697abb13b7` |
| `references/LICENSE.txt` | 1071 | `044d7291c37a2ead106ea4b4c26f713e63b7834637ed634da640f74e8cbe4625` |

The installed script acquired hosted caller `0.1.1` with no `--public-root`: 32421 bytes, SHA256 `693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3`, 15 members, `hostedAcceptance` false, `npmInstall` completed. The installed pin still names rejected archive `0.1.0` at 24149 bytes, SHA256 `3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b`. This journey did not re-execute that rejection.

## Journey

All facilitator, merchant, and feedback traffic stayed on `127.0.0.1`. The facilitator was the local fake used by the recovery fixture. Two morpho purchases settled. Feedback added no verify, no settle, and no morpho handler call.

1. A changed grant id was refused before any request. Exit 3, `handle_rejected`, `grant_grantId_changed`.
2. The installed `recover --action start` paid `morpho_position` for fixture address `0x4352Cc849b33a936Ad93bB109aFDec1c89653b4f`. Accepted amount was `20000`. Verify 1, settle 1, morpho handler 1. The retained result had `ok: true`, `positionCount: 1`, recovery meta version 1, and a present `report_caller_result` capability. Content and `_meta` were preserved. Payment nonce and signature were absent from the skill stdout.
3. The acquired `0.1.1` client called `recover_paid_result` for that same payment after `listTools`. The recovered result had recovery meta and no capability (`reason: absent`). Verify, settle, and the morpho handler stayed unchanged. The journal snapshot does not inherit the live token. The test did not copy one onto it.
4. Installed MCP feedback on a result with no token returned `missing_input`, `connected: false`, and made no request.
5. Installed feedback `useful` / `matched_task` returned `caller_asserted_acceptance`. `charged` false, `usefulness` unknown, `bound` false, `parent` pending, `idempotentReplay` false, `tokenEcho` false. Verify, settle, and the handler stayed at 1.
6. The same statement again was `idempotentReplay: true`. `not_useful` / `wrong_output` on that same result was `tool_refusal` / `conflicting_statement`, with `retainedDisposition: useful`.
7. A copy whose body `positionCount` was changed, while the issued token stayed, was another idempotent replay. The declaration count stayed 1. The altered body was not accepted as a new result.
8. The provider process was restarted on the same data directory and key. `readDeclarations` returned one row: `source: caller`, `inferred: false`, `disposition: useful`, `reasonCategory: matched_task`.
9. The acquired client connected, listed tools, and called `reportMcpCallerResult` on that same token. Accepted, `idempotentReplay: true`, `parent: pending`, `usefulness: unknown`, `charged: false`, `payerIdentity: false`. This was the same report tool, not a projection of the skill stdout.
10. `startPaidMcpResult` from that same acquired client paid a second `morpho_position`. The capability was present and was not the first token. Installed feedback `not_useful` / `wrong_output` was accepted with `parent: pending` and `idempotentReplay: false`. Facilitator totals were verify 2 and settle 2. The restarted process counted one morpho handler for that second execution. Disk retained two `paid_success` events and two morpho delivery rows.
11. `caller-result-feedback.ndjson`, `mcp-tool-delivery.v1.ndjson`, and `commerce-events.ndjson` did not contain either capability token or either payment nonce. Delivery `usefulness` was unknown. Statements were `source: caller`, `channel: mcp`, `usefulness: unknown`. `commerce-settlements.ndjson` was absent, so the parent stayed pending.
12. A token with the last character changed was `tool_refusal` / `tampered_capability`. Declarations stayed 2.
13. Dropping the next `report_caller_result` response was `transport_failure` / `transport_failed`. Declarations stayed 2. Verify and settle stayed 2.
14. A new provider process whose feedback clock was eight days ahead refused the same token as `expired_capability`. The two caller declarations were still readable and were not marked accepted utility.
15. A second fixture with an empty key delivered morpho and issued no capability. Installed feedback was `missing_input` and did not connect.

## Gates

| Command | Result |
| --- | --- |
| `node --test --test-concurrency=1 installed-feedback-journey-211998.test.mjs` | 2 pass, exit 0 |
| Focused feedback, delivery, and recovery files listed below | 151 pass, exit 0 |
| `npm test` | 1167 pass, 2 fail, 4 skip, exit 1 |

Focused files: `mcp-task-recovery.test.mjs`, `caller-result-client/test/recovery.test.mjs`, `caller-result-client.distribution.test.mjs`, `caller-result-feedback.test.mjs`, `mcp-caller-result.test.mjs`, `caller-result-feedback.http.test.mjs`, `morpho-producer.mounted.test.mjs`, `http-delivery-evidence/test/contract.test.mjs`, `http-delivery-evidence/test/store.test.mjs`, `http-delivery-evidence/test/capture.test.mjs`, `http-delivery-evidence.http.test.mjs`, `http-delivery-evidence/test/diagnostic-delivery.test.mjs`, `http-delivery-evidence/test/morpho-delivery.test.mjs`, `mcp-typed-telemetry-producer.test.mjs`, `mcp-typed-telemetry-producer.mounted.test.mjs`, `commerce-prospective-delivery.test.mjs`.

The two `npm test` failures were replayed apart from this seam:

- `public-acquisition/engine.test.mjs` failed with `ModuleNotFoundError: No module named 'httpx'`. That file is unchanged. After Python `httpx` 0.28.1 was present, the same test passed, exit 0.
- `useful-result-reuse.http.test.mjs` failed with `EADDRINUSE` on fixed port `39114` during the concurrent suite. Alone, `clean loopback caller retrieves a scoped result and leaves paid routes unpaid` passed, exit 0. This branch does not change that port.

Skips in `npm test`: deployed extract machine documentation, official offline validator without `XAGT_PLUGIN_ROOT`, sidecar without the official validator checkout, and unpaid initialize-era `extract_batch`. They are existing gates.

`public-acquisition/loopback-profile.json` was rewritten while tests ran and was restored. It is not in the product commit. `chargedCents` was not recorded.

## Integration

1. Review product `75991c1c0935562750922a1b92520f4fc389653d` on `codex/installed-feedback-journey-211998`. The following commit is only this receipt.
2. Run `npm ci --ignore-scripts`, then `node --test installed-feedback-journey-211998.test.mjs`. The journey uses the installed skill at the path above, or `SAMEDAYDESK_INSTALLED_SKILL_ROOT`. Without that script the journey skips and the default-mount test still runs.
3. Leave feedback optional. An empty key and a missing token stay unknown to the caller. Do not require `report_caller_result` for delivery.
4. Merge, registry publication, deployment, and any public claim stay with Root. This export did not merge or publish.
