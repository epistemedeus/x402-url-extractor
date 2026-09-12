# FINAL-REVIEW — POST /lockfile-pin-delta

Reviewer: W5-H01 merchant exclusive amendment owner.
Parent session `729e76bf-ea1d-49e7-8a31-4cc569fb1320`.
Start HEAD: `d758f85f36ec913c186e9f61581374768d000fff`.
Base: `a143898dd1ec35c097ca7eb0b472f30dad1ee319`.
Branch: `codex/w5-h01-merchant-review-20260911`.

## Verdict

**Ready for flag-gated hosted enable beside existing `extract_batch`.**

Not ready as a signed-statement / proven-margin / production-money release. Root still decides Railway ship, `LOCKFILE_PIN_DELTA_ENABLED=1`, and whether to re-sign the 25-route envelope.

## Evidence

| Gate | Result |
| --- | --- |
| Independent supplied pairs, no install/URL job input | Pass. Handwritten expected pins in `fixtures/lockfile-pin-delta/expected-*.json` vs vendor journey and added-removed fixtures. Same-pair control is informational. Git resolved-only pair stays distinct. |
| Malformed / oversized refuse before payment | Pass. Unpaid HTML/path/oversize → 400/413, `charged: false`, facilitator settle 0. |
| Replay: changed body / key / principal / protocol | Pass. Same x402 payment, different body, `from`, signature, `accepted.network`, or payment-identifier → 409, `charged: false`, settle unchanged. x402 blob as `Authorization` does not 200. MPP pays, replays, and refuses a changed body without a second settle. |
| Worker timeout + output bound, no leaked children | Pass. `ownedLockfileWorkerCount() === 0` after timeout and after stdout over `maxResponseBytes`. HTTP timeout stays `analysis: not-run`, charged. |
| `extract_batch` stays enabled | Pass. Both flags on: OpenAPI 27 paid ops, MCP 24 tools, unpaid batch 402 and lockfile 402. Incumbent extract/batch HTTP suites 20/20. |
| Meaningful engine output vs handwritten pins | Pass. fixture-alpha 1.0.0→1.0.1 version/integrity/resolved; beta unchanged. Added/removed names match handwritten expected JSON. |
| Catalog counts | Pass. Production GET 2026-09-11 this session: OpenAPI **26 paid HTTP ops**, `/extract/batch` live, `/lockfile-pin-delta` absent. `/api/actions` 23. Default-off is 25/22. Docs distinguish these. |
| Customer quote / provenance | Pass. Quote meaning has no D26/EC2. Catalog sha `a20232b0f777b0f737cdffefb64a9ca9d9c9ba0e`. Engine sha remains `fba9d14872bc4c04214e527b9edfb30c2123c9e7`. README lockfile MCP resource is `/lockfile-pin-delta`, not `/extract/batch`. |
| Adapter vs vendor | Compare/parse stay in `vendor/lockfile-pin-delta/`. HTTP admission, worker isolation, stdout bound, and receipt envelope stay in the adapter (807 lines). No broad rewrite. |
| Price / cost | `$0.005` is not proven margin. Empirical in-process max-admitted pair (110,145 bytes, 613 pins): **21 ms wall** this host. RSS delta is not a hosting invoice (sign can flip). No Railway invoice. No paid API spend. |

## Tests run this review

```
node --test --test-concurrency=1 lockfile-pin-delta.test.mjs mcp-tool-metadata.test.mjs
# 14 pass (11 lockfile unit + 3 MCP metadata)
```

```
node --test --test-concurrency=1 lockfile-pin-delta.http.test.mjs lockfile-pin-delta.buyer.test.mjs
# 9 pass
```

```
node --test --test-concurrency=1 extract-batch.http.test.mjs extract.http.test.mjs startup-smoke.test.mjs
# 20 pass
```

## Remaining Root decisions

1. Deploy this branch without merging `master`.
2. Set `LOCKFILE_PIN_DELTA_ENABLED=1` **without** unsetting production `EXTRACT_BATCH_ENABLED`.
3. Re-sign the service statement only if the new route must appear in the signed envelope.
4. Margin and facilitator fees stay unknown until a real invoice exists.

Unknown: live Railway RAM/egress bill; live MCP `tools/list` count was not re-fetched this session (OpenAPI 26 paid is confirmed; `/.well-known/mcp.json` is 404).
