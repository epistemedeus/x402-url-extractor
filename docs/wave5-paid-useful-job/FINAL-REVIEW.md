# FINAL-REVIEW — POST /lockfile-pin-delta

Reviewer: W5-H01 merchant exclusive amendment owner.
Parent session `729e76bf-ea1d-49e7-8a31-4cc569fb1320`.
Closeout start: `47cdff8083527e58850824b060d8749a13d73ec2`.
Branch: `codex/w5-h01-merchant-review-20260911`.
Package: `1.23.47`.
Implementation: `902a7335ca2d657ab6ed1d52dcdf88cc09306062`.

## Verdict

**Ready for controlled hosted x402-only enable beside existing `extract_batch`.**

Root deploys. This patch does not merge `master`. Existing MPP routes and
`extract_batch` stay dual-stack. This new route is x402-only for initial live.
No owed-retry is sold. Margin remains a conditional public-rate estimate, not a
release gate.

## Capability filter

One filter, not a pile of warnings:

- Omit `POST /lockfile-pin-delta` from `createMppDualStack` routes (no MPP charge).
- Omit it from MPP OpenAPI (`profile === "mpp"`).
- Catalog / default OpenAPI `x-payment-info` lists `x402` only.
- Paid-action-effect retry omits `mppRequirement` on this operation.
- Machine-surface parity kills x402-only catalog actions from MPP OpenAPI.

## Semantics

| Outcome | HTTP | charged | settle |
| --- | ---: | --- | --- |
| Completed compare, including informational no-change | 200 | true | 1 |
| Unpaid valid body | 402 x402 `Payment-Required` | — | 0 |
| Unpaid MPP advertisement | none | — | 0 |
| Supplied MPP `Authorization` | 400 `mpp_not_accepted` | false | 0 |
| Admission refuse | 400/413/415 | false | 0 |
| x402 timeout / crash / oversized stdout / nonzero exit | 503 | false | 0 |

x402 still execute-before-settle (`@x402/express` 2.16.0: HTTP `>=400` skips settle).
MPP `charge()` is not registered for this path, so it cannot settle. Do not claim an
unregistered MPP path as production-tested.

## Tests

```
npm run test:lockfile-pin-delta
# 23 pass
npm run test:extract-batch
# 45 pass
node --test --test-concurrency=1 \
  extract.http.test.mjs startup-smoke.test.mjs discovery-contract.test.mjs \
  mcp-tool-metadata.test.mjs machine-surface-parity.test.mjs \
  machine-surface-parity.http.test.mjs paid-action-effect-profile.test.mjs \
  service-deployment-publication.test.mjs construction-surface.test.mjs
# 37 pass
```

105 pass on this source (same envelope size as the prior collector 105; lockfile MPP-pay tests replaced by MPP-refuse; +1 parity unit).

Unknown: live Railway/CDP invoice (not a gate). Signed 25-route statement unchanged
and need not attest this route yet.
