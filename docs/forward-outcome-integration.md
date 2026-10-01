# Forward outcome integration

Producer: `createCommerceTelemetry` in this repository. Consumer: Pilot `tools/ops/three-site-settlement-join/measure` on `heavy/s17-measure-collect-093066`.

## Planes

Transport observation is the paid-success response digest. Its validator state stays `not_checked` / `none`. Schema-valid delivery is only the existing HTTP response contract record when `validatorVerdict` is `pass`, authority is `merchant_declared_schema`, source is `caller_observed_http_bytes`, class is `full_bounded_capture`, and usefulness stays `unknown`. Economic settlement is a separate stage. It is written only by `observeRuntimeSettlementReadback` from a reconciliation record, or by `observeMockedSettlementBoundary` when that delivery's settlement class is the existing `unpaid` or `simulated` test boundary. Response headers are not settlement authority. Retained use is `observeRetainedUse` after the internal token check and only for a schema-valid delivery of the same operation and receipt digest. HTTP finish does not infer it.

## Binding

The forward file is `commerce-outcome-binding.ndjson`, rotated once to `commerce-outcome-binding.1.ndjson`, mode `0600`, on the commerce telemetry queue. A row is written only after `x-samedaydesk-internal` matches a configured token of at least 32 bytes and both `x-samedaydesk-outcome-operation` and `x-samedaydesk-outcome-cohort` are valid. Those identifiers are pseudonyms. A missing or forged header writes no bound claim. Historical commerce events are not backfilled.

Schema: `samedaydesk.outcome-binding.forward.v2`. `producerBaseCommit` is `ebd6834f3501ace0948b2ad5b7a3df9ab5c6b048`. `writerId` is `x402-url-extractor.createCommerceTelemetry.forward-v2`. v1 rows remain readable by the consumer and cannot satisfy schema-valid delivery.

Recognized revenue stays 0. A controlled evidence join is not external customer demand. The closed H15 sponsored expense stays closed. No public endpoint was added.
