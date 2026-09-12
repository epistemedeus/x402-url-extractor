# HTTP response-validation contract

Schema `samedaydesk.wave5.d17.http-response-validation.v1`.

Thin extension of merchant paid-success capture. Not a second ledger. Not MCP
identity. Not usefulness.

## Layers

1. Merchant HTTP status. Completed delivery requires 2xx. A success-schema body
   inside HTTP 500 is `merchant_http_failure`, not `pass`.
2. Declared-schema conformance against live same-repo parsers.
3. Domain capture: source refusal, truncation, typed catch envelopes.

`usefulness` stays `unknown`.

Principal `deliveryClass` is `source_refusal` when `sourceOk === false` on a
completed 2xx success envelope even if truncation marks are also set.

Historical v1 `not_checked` rows remain readable. Extra keys on those rows do
not drop them. New validation is a sibling file joined by method + resource +
responseDigest.
