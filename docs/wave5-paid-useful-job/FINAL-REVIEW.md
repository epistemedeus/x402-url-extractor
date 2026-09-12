# FINAL-REVIEW — POST /lockfile-pin-delta

Reviewer: W5-H01 merchant exclusive amendment owner.
Parent session `729e76bf-ea1d-49e7-8a31-4cc569fb1320`.
Start HEAD: `d758f85f36ec913c186e9f61581374768d000fff`.
Closeout start: `0eaef8297d3ad991224dd328d3bbb10569293afe`.
Base: `a143898dd1ec35c097ca7eb0b472f30dad1ee319`.
Branch: `codex/w5-h01-merchant-review-20260911`.

## Verdict

**Ready for controlled hosted enable beside existing `extract_batch`.**

Root policy already preserves extract_batch, existing routes, and the low introductory
price. This closeout makes timeout/crash/oversized/nonzero-exit **not** look like a
successful charged compare. Not ready as a signed-statement rewrite, proven-margin
release, or production-money event. This job does not deploy.

## Payment ordering (from source)

Mounted order for this POST: bounded JSON parser and admission (`validateLockfilePinDeltaRequest`)
→ idempotency replay → `mppDualStack.middleware` → x402 `paymentMiddleware` → `serveLockfilePinDelta`.

- **x402 (`@x402/express` 2.16.0):** verify, then the handler, then `processSettlement` only
  if `res.statusCode < 400`. HTTP `>=400` cancels settlement (`handler_failed`). Execute-before-settle.
- **MPP (`mpp-dual-stack.mjs`):** `mppx.evm.charge()` runs in authorize **before** `next()`.
  A paid MPP credential sets `res.locals.samedaydeskPayment.protocol = "mpp"` and skips the
  x402 gate. Settle-before-execute.

## Failure semantics

| Outcome | HTTP | `charged` | Notes |
| --- | ---: | --- | --- |
| Admission refuse (HTML, path, URL, command, oversize input) | 400/413/415 | false | Before payment. |
| Completed compare (actionable / informational / partial) | 200 | true | Useful paid output. Identical pins are informational, not failure. |
| Timeout, crash, oversized worker stdout, nonzero exit (x402) | 503 | false | Status >=400 skips x402 settle. Same credential may retry; not a replay hit of a fake success. |
| Same failures after MPP already settled | 503 | true, `owedDelivery: true` | Do not lie with `charged: false`. Same credential retries through existing replay quarantine without a new settle. |
| Unknown facilitator settlement | 503 | not a new settle | Existing quarantine; settle count stays 1. |
| Worker nonzero exit with valid-looking stdout | crash | as above | Rejected. Owned zero-exit worker still delivers. |

HTTP 200 is only a completed compare. Discovery examples remain a successful journey delta.

## Evidence

| Gate | Result |
| --- | --- |
| Independent supplied pairs | Pass. Handwritten expected pins vs vendor journey and added-removed. Same-pair informational. |
| Malformed / oversized before payment | Pass. Unpaid 400/413, `charged: false`, settle 0. |
| Replay body / key / principal / protocol | Pass. Drift 409, settle unchanged. MPP body bind refuses without a second settle. |
| Timeout / crash not a successful compare | Pass. x402 timeout and crash → 503, `charged: false`, settle 0, retry not a 200 hit. |
| MPP owed delivery | Pass. Timeout → 503, `charged: true`, `owedDelivery: true`, retry settle still 1. |
| Unknown settlement quarantine | Pass. |
| Nonzero exit vs zero-exit control | Pass. Owned `fixtures/lockfile-pin-delta/workers/nonzero-exit.mjs` rejected; `zero-exit.mjs` delivers. |
| Worker reap | Pass. Timeout, stdout bound, and nonzero-exit leave `ownedLockfileWorkerCount() === 0`. |
| extract_batch stays enabled | Pass. Both flags: OpenAPI 27 paid ops, MCP 24 tools. `npm run test:extract-batch` 45/45. |
| Catalog / copy | Pass. Production OpenAPI 26 paid, batch live, lockfile absent. Default-off 25/22. M01 catalog `a20232b0…`, engine `fba9d148…`. No D26/EC2. |
| Price | `$0.005` not proven margin. See COST.md public-rate estimate. No invoice. No live charge. |

## Tests run on this source

```
npm run test:lockfile-pin-delta
# 24 pass
```

```
npm run test:extract-batch
# 45 pass
```

```
node --test --test-concurrency=1 \
  extract.http.test.mjs startup-smoke.test.mjs discovery-contract.test.mjs \
  mcp-tool-metadata.test.mjs machine-surface-parity.test.mjs \
  machine-surface-parity.http.test.mjs paid-action-effect-profile.test.mjs \
  service-deployment-publication.test.mjs construction-surface.test.mjs
# 36 pass
```

105 pass. No weakened incumbent tests. No live payer key.

## Remaining Root decisions

1. Deploy this branch without merging `master` (Auto does not deploy).
2. Set `LOCKFILE_PIN_DELTA_ENABLED=1` without unsetting production `EXTRACT_BATCH_ENABLED`.
3. Re-sign the 25-route statement only if the new route must appear in the signed envelope.
4. Shared-process idle RAM and post-free-tier CDP `$0.001`/settle stay unknown against a real invoice.

Unknown: live Railway/CDP invoice; live MCP `tools/list` (OpenAPI 26 paid confirmed earlier; `/.well-known/mcp.json` is 404).
