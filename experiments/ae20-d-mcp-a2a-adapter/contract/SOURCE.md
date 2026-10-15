# Contract source

X1 route schemas in `x1-schemas.json` are the `components.schemas` objects `url_extract_{submit,poll,result}_{input,output}` from the gateway OpenAPI produced by applying `experiments/ae20-x1-url-extract-route/proposed/gateway-url-extract.patch` at X1 `79b5e55f82e3bed9eaaf694ffd74d591160f6616` onto neo `services/machine-gateway` at `667fba353e9082d8a0842437442dabc42843abf8`.

The assignment contract file `ae14-launch/expand/AE20-X1-URL-EXTRACT.md` is sha256 `1f2e54d87cc33ceb92579dc95cd2a94842c60825f4b8a059a9bafcb4b8a963bd`.

X1 head read at builder start: `79b5e55f82e3bed9eaaf694ffd74d591160f6616`. Its tested head is `7e4840f95b424bf5b7d6446d89b9fe94cdc320c3`.

## Adapters

MCP uses `@modelcontextprotocol/sdk` 1.30.0 (MIT). Three tools map onto the three routes. The SDK's experimental task API is not used. Each listed tool sets `execution.taskSupport` to `forbidden`.

Transports: stdio (`bin/mcp-stdio.mjs`) and streamable HTTP (`bin/mcp-http.mjs`).

A2A spec 1.0.0, JSON-RPC binding, Apache-2.0 (https://github.com/a2aproject/A2A/blob/v1.0.0/LICENSE). Source: <https://a2a-protocol.org/v1.0.0/specification> (also published at <https://a2a-protocol.org/latest/specification/>). Normative proto: <https://a2a-protocol.org/latest/spec/a2a.proto>. `message/send` and `tasks/get` are the pre-1.0 method names required here. `SendMessage` and `GetTask` are the 1.0 names and are accepted as aliases. `message/send` returns `{ task }`. `tasks/get` returns the task. The task id is X1's `jobId`.

The only adapter setting is X1's base URL (`X1_BASE_URL` or `--base-url`). `X1_BEARER` overrides the published local unsigned test credential already in X1's `support/gateway.mjs`. Adapters send no payment header and do not execute a quote whose price is not 0.

## Fixture

`test/fixtures/x1-http-fixture.mjs` is a labelled in-memory stand-in for the mounted quote/execute contract. It does not fetch URLs. `test/fixtures/recorded/pairs.json` is a deterministic recording of that fixture.
