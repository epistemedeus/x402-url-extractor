# CW37 merchant integration R2 — execution receipt

Source validated: `3c48c0f9979c58bf6757b439a020b8cf79a6f857`, parent `79229d0caf9bd5a1f20dd8cdb46d286722721d17`. Branch `codex/cw37-merchant-integration-20260912`; draft PR https://github.com/epistemedeus/x402-url-extractor/pull/65. Isolated remote VM checkout: `/workspace/pilot/tmp/cw37-astra-merchant-integration-20260912/src`.

## Scope and exact inputs

Continues the integration of PR61 `3cb29f079604071e041a4b794990bb65fc593b3e` and PR62 `a0458cfbd5bae39eb93dfaadd6790677a7d0b737`, both ancestors, on master base `0153295c5851bf8f93fb27c77070a31417a59f69`. R1 source and MCP/unknown-settlement repairs are retained. This receipt describes executions by this native account, not writer reports or controller-executed claims. No child model, model API, reset, or overage was used.

The CW42 final pack/receipt was read from `/workspace/pilot/tmp/cw42-astra-merchant-off-admission-proof-20260912`; its workspace was not modified. Its test source and network fence were copied into this branch and adapted to owned port 55543. Current source at 79229d0, rather than the old advisory, was the baseline.

## Reproductions and repairs

- **F5:** baseline failed four dormant-startup witnesses: unset/0 flag with malformed price or omitted discovery fixture. The server now imports the vendor implementation only when enabled; the commerce delivery binder follows the same condition, default config exports avoid dormant price parsing, and mounting the vendor parser is conditional. Ten dormant scenarios now boot the incumbent server: health 200, extract 402, vendor 404. Malformed limits were already tolerated while off and remain controls. The delivery-contract unit test explicitly injects the vendor schema without enabling a route.
- **F6:** raw integer `9007199254740992` versus `9007199254740993`, decimal `0.1` versus `0.10000000000000001`, underflow, and overflow-rounding aliases reproduced false no-change behavior. A shared raw JSON admission parser compares exact decimal coefficients and exponents with the decimal value of Number's canonical serialization. Its oracle is decimal identity using BigInt, not two JSON.parse computations. Non-finite or rounded raw values are refused before settlement. Merchant HTTP, encoded snapshots, raw MCP calls, maintained-client bodyRaw, and vendor CLI authorization files use this boundary. Equivalent spelling (`0.10`, `1e-1`) and signed zero are admitted; distinct canonical values, negative values, safe-boundary values, subnormals, and finite maximum controls remain exercised. Already-created JS objects carry JS Number values; original text must be supplied as bodyRaw when its spelling/value must be checked. This is an explicitly bounded numeric domain, not arbitrary-precision arithmetic.
- **F7:** vendor resources declare x402 only. A2A tags and invocation prose, purchase-evidence receipt/replay fields, and existing OpenAPI/action/effect contracts agree. MCP now exports a structured Zod pricing-row input contract rejecting empty snapshots, and retains the R1 output schema and unpaid challenge handling. The description stays within the facilitator's 500-character limit.
- **Attestation boundary:** the installed signed statement still does not cover the vendor route. No statement was signed or forged. The action catalog and purchase manifest publish per-operation `uncovered` status; enabling the vendor with `NODE_ENV=production` fails before listen when exact coverage is absent. The adapted attestation test independently verifies the historical incumbent signature, confirms vendor absence, verifies the advertised limitation, and tests this production-mode gate. This is truthful coverage/gating, **not** proof of a new vendor attestation. An authorized release owner must supply and validate exact signed coverage before production enablement. Local fake-facilitator tests deliberately run outside production mode.

## Actual test evidence

Committed pack command from the checkout:

```sh
NODE_OPTIONS=--max-old-space-size=768 node experiments/codex-window/cw37-r2-regressions/run.mjs /workspace/pilot/tmp/cw37-astra-merchant-integration-20260912/src /workspace/pilot/tmp/cw37-astra-merchant-integration-20260912/r2-final.json
```

Baseline: 27 leaf checks passed, 14 failed (Node TAP includes three failed parent suites: 44 total, 27 pass, 17 fail). First repaired candidate: 42 leaf checks passed. Final committed pack adds the raw MCP witness: **43/43 leaf checks; 47/47 TAP tests, zero failures/skips**, 29.557 seconds. Source hash `daa788b9fcb8b872715bf2a43cc7b223c02e589253adcfa3e476387b0239f48c`; clean tracked status before run, source unchanged during run, same HEAD after, zero remaining owned children. Full baseline and final witnesses are tracked under `experiments/codex-window/cw37-r2-regressions/evidence/`.

The pack runs actual `node server.js`, its worker/compiled engine, raw HTTP, the official MCP SDK list/call client, and the maintained buyer with a dummy signer callback. Only loopback and an intercepted fake facilitator are permitted. No real transaction signing, real facilitator, or real settlement occurs in this pack. Mathematical expected relations are explicit test inputs independent of the service and buyer recomputation.

All broader commands use `NODE_OPTIONS=--max-old-space-size=768`, `TMPDIR=/workspace/pilot/tmp/cw37-astra-merchant-integration-20260912/test-tmp`, and `TEST_MERCHANT_PORT=55543`:

```sh
node --test --test-concurrency=1 a2a-storefront.test.mjs purchase-evidence-manifest.test.mjs service-deployment-publication.test.mjs construction-surface.test.mjs machine-surface-parity.test.mjs vendor-budget-impact.release-gate.test.mjs vendor-budget-impact.test.mjs vendor-budget-impact.http.test.mjs vendor-budget-impact.cost.test.mjs payment-offer-preflight.test.mjs seller-integrity-audit.test.mjs receipt-referral-recheck.test.mjs idempotency-replay.test.mjs mcp-payment-header.test.mjs mcp-output-schema.test.mjs mcp-output-schema-wave2.test.mjs mcp-output-schema-wave3.test.mjs mcp-output-schema-extract.test.mjs mcp-tool-metadata.test.mjs mcp-typed-telemetry-producer.test.mjs mcp-typed-telemetry-producer.mounted.test.mjs bazaar-resource-metadata.test.mjs commerce-events.test.mjs paid-action-effect-profile.test.mjs http-delivery-evidence/test/contract.test.mjs
```

Final merchant/shared execution: **336 passed, zero failed/skipped**, 73.743 seconds. Includes actual server/MCP buyer unknown retention, all owned HTTP statuses, unknown settlement without another spend, crash/restart durable computed delivery, and seller diagnostic regressions. Prior intermediate broad execution: 314 passed, 22 failed because the newly expanded description exceeded 500 characters; fixed before source commit and this complete rerun. The intermediate failure log is retained for audit.

Buyer execution, from `examples/customer-x402`:

```sh
node --test --test-concurrency=1 test/*.test.mjs
```

Final buyer execution: **211 passed, zero failed, one optional live preflight skipped** (212 total), 39.067 seconds. The actual maintained CLI inspect/approve fixture, paid vendor output, replay, concurrent refusal, and unknown retention cases passed. This rerun used the same committed runtime source.

## Limits and integration status

Test runner concurrency was one, with 768MiB Node heap. Merchant port 55543; broader tests use ephemeral ports for auxiliary fake services and isolated temporary stores, never a shared or production DB. Existing concurrency/overload tests intentionally overlap bounded fixture calls inside one test. Broader payment fixtures use test-only accounts/signatures and fake facilitators; no funded account, production signing key, or real payment was used. The dedicated R2 pack uses dummy signature bytes only. The optional live buyer preflight remains disabled. No customer traffic, adoption, sales, or production success is inferred.

Only this integration checkout was edited; CW42 remained read-only. No default merge, deployment, production DB, outreach, real purchase, or signed deployment statement. Source was pushed to the existing draft PR65. The full legacy service suite was not claimed or run. The source fix is ready for review; production vendor enablement remains blocked on valid exact signed attestation coverage. Receipt commits after the validated source commit contain documentation/evidence only.
