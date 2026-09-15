# H37 discovery-metadata compatibility

Bounded merchant-side compatibility for CDP Bazaar indexing fields. Public sources only. No live verify, settle, wallet, or CDP spend.

## Seller event (public)

[coinbase/cdp-sdk#816](https://github.com/coinbase/cdp-sdk/issues/816): indexed resource, some settlements not counted.

- [Provider comment](https://github.com/coinbase/cdp-sdk/issues/816#issuecomment-5669678376) (2026-09-14): logs support a **missing** required `paymentPayload` field rather than a facilitator rejection. Exact historical field (`resource` vs `extensions.bazaar`) is **unknown**. Indexing uses `paymentPayload`, not `paymentRequirements`. Open-source clients are expected to echo; **many servers overwrite with their own discovery information**.
- [Seller capture comment](https://github.com/coinbase/cdp-sdk/issues/816#issuecomment-5656693863): Sepolia / x402.org `EXTENSION-RESPONSES` observations are **not** CDP proof. Header states `no header`, `empty header`, and `{}` must stay distinct.
- No further provider reply after 2026-09-15 00:00 UTC (checked against the public comment list).

Docs: [Get discovered](https://docs.cdp.coinbase.com/x402/seller/get-discovered), [bazaar.md](https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md). Settle must carry `paymentPayload.resource`; clients echo `extensions.bazaar`.

## SDK inspection (@x402/* 2.16.0, @coinbase/x402 2.1.0)

- Exact EVM EIP-3009 signs `from`, `to`, `value`, `validAfter`, `validBefore`, `nonce` only. `resource` and `extensions` are unsigned.
- `@x402/core` `x402Client.createPaymentPayload` copies `resource` and `extensions` from `PaymentRequired`. `@x402/fetch` re-exports the same client. **`wrapFetchWithPayment` auto-retries paid requests and was not used.**
- `validateExtensions` allows omitted client extensions. Present `bazaar: {}` fails `extension_echo_mismatch` **before** `onBeforeVerify`.
- `bazaarResourceServerExtension` only `enrichDeclaration` on the 402. It does not fill `paymentPayload`. Express auto-registers it when routes declare bazaar.
- `HTTPFacilitatorClient` logs allowlisted `EXTENSION-RESPONSES` fields on success and swallows decode errors (absent / empty / malformed / `{}` conflated).

Existing merchant `onBeforeVerify` / `onBeforeSettle` continuity already filled **missing** `resource` / `extensions.bazaar` from route-owned declarations. That path is retained.

## Change

1. Treat empty-object `resource: {}` (and `extensions.bazaar: {}` when the hook runs) as unusable-absent and fill from declared metadata. Conflicting `resource.url`, wrong types, and enriched bazaar stay untouched. Payments are never declined for discovery-hint shape.
2. Allowlisted `EXTENSION-RESPONSES` diagnostics: `absent` | `empty` | `malformed` | `decoded`, plus bazaar `success` | `processing` | `rejected` | `unknown`. Missing telemetry stays `unknown`. Facilitator client is wrapped; request bodies and signed authority are unchanged.
3. Exact changed-byte hashes for `resource` / `extensions` vs authority (`x402Version` + `payload` + `accepted`). No signature or payload dumps.

## Proved bytes (offline capture)

Unsigned stub payloads. Authority SHA-256 of `payload` was identical across opportunity-preflight fill cases (`75984b6ba9f7e2b7d952d14cb970644f05bb108794b4d522af0ff97eaf5142af`, 71 bytes).

| Case | resource bytes | resource URL on facilitator |
| --- | --- | --- |
| Official client echo | 592 | request-derived 402 URL (loopback in this fixture) |
| Omit `resource` | 0 → 559 | `https://agents.samedaydesk.com/work/opportunity-preflight` |
| Empty `resource: {}` | 2 → 559 | same canonical PUBLIC origin + path |
| Conflicting URL | unchanged | `https://evil.example/work/opportunity-preflight` (retained) |
| Second route omit | filled | `https://agents.samedaydesk.com/commerce/seller-integrity-audit` |

`paymentRequirements` never carried `resource` or `extensions`.

## Negative controls

- Wrong route: opportunity-preflight payload on seller-integrity-audit → `No matching payment requirements`, verify count 0 (amount differs).
- Conflicting `resource.url` retained; payment not declined.
- Empty `bazaar: {}` → SDK `extension_echo_mismatch`, verify count 0. Documented hook cannot fill this; it runs after echo validation.
- x402 v1 with omitted resource is not filled by the v2 exact-EVM hook.
- `EXTENSION-RESPONSES`: absent, empty, malformed, decoded `{}`, success, rejected are distinct. Pre-call telemetry is `unknown`.

## Not claimed

- Not independent proof of issue 816 historical payloads.
- Not CDP facilitator ingestion, catalog `lastCalledAt`, or 30-day removal-clock identity.
- Seller Sepolia / x402.org captures are not this result.
- Empty bazaar objects are still declined by the SDK echo check.
- 402 `resource.url` on loopback still follows `adapter.getUrl()`; omitted-field fill uses `PUBLIC_URL` + path and never `Host`.

## Tests

```bash
npm run test:discovery-compatibility
```

37 pass / 0 fail / 0 skip. Extra regression: `node --test --test-concurrency=1 merchant-path-indexing-continuity-capture.test.mjs` (1 pass).
