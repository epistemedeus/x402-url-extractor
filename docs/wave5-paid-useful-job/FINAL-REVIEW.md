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
| Independent supplied pairs, no install/URL job input | Pass. Handwritten expected pins in `fixtures/lockfile-pin-delta/expected-*.json` vs vendor journey and added-removed fixtures. |
| Malformed / oversized refuse before payment | Pass. Unpaid HTML/path/oversize → 400/413, `charged: false`, facilitator settle 0. |
| Replay: changed body / principal | Pass. Same payment, different body or `from` → 409, `charged: false`, settle unchanged. Protocol swap not separately HTTP-tested; store already binds `protocol` + terms. |
| Worker timeout + no leaked children | Pass. `ownedLockfileWorkerCount() === 0` after timeout. HTTP timeout stays `analysis: not-run`, charged. |
| `extract_batch` stays enabled | Pass. Both flags on: OpenAPI 27 paid ops, MCP 24 tools, unpaid batch 402 and lockfile 402. |
| Meaningful engine output vs handwritten pins | Pass. fixture-alpha 1.0.0→1.0.1 version/integrity/resolved; beta unchanged. |
| Catalog counts | Pass. Production GET 2026-09-11: 26 paid HTTP / 23 MCP tools, `/extract/batch` live, lockfile absent. Default-off is 25/22. Docs now distinguish these. |
| Customer quote / provenance | Pass. Quote meaning has no D26/EC2. Catalog sha `a20232b0f777b0f737cdffefb64a9ca9d9c9ba0e`. Engine sha remains `fba9d14872bc4c04214e527b9edfb30c2123c9e7`. |
| Adapter vs vendor | Journey discovery objects now load vendor fixtures instead of a second copy. Compare/parse stay in `vendor/lockfile-pin-delta/`. HTTP admission, worker isolation, and receipt envelope stay in the adapter. No broad rewrite. |
| Price / cost | `$0.005` is not proven margin. Empirical in-process max-admitted pair (~110 KB, 613 pins): **16 ms wall**, **+1.75 MiB RSS**. No Railway invoice. No paid API spend. |

## Tests run this review

```
node --test --test-concurrency=1 lockfile-pin-delta.test.mjs
# 10 pass

node --test --test-concurrency=1 lockfile-pin-delta.http.test.mjs lockfile-pin-delta.buyer.test.mjs
# 8 pass
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

Unknown: live Railway RAM/egress bill; whether protocol-mismatch HTTP is covered beyond the shared replay store.
