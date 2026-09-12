# Consumer recipe: construct, then inspect, then approve

Use `examples/customer-x402`. Default commands never open a wallet.

Supported paid routes only: `GET /extract`, `POST /extract/batch`,
`POST /lockfile-pin-delta`. No arbitrary `POST /payments`.

## GET /extract

Live OpenAPI and live MCP `extract` require query `url`.
`GET https://agents.samedaydesk.com/extract` without that query is unsigned
discovery (HTTP 402). It is not a purchase.

1. Bind a public HTTP(S) page URL:

From `examples/customer-x402`:

```js
import { bindGetExtractResourceUrl } from "./src/request-construction.mjs";
bindGetExtractResourceUrl("https://example.com");
// https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com
```

2. Unpaid inspect (`npm run preflight -- --get --url <bound>`). Expect
   `construction.kind=bound_request`, `walletAccessed=false`.
3. Only then `--approve` with an authorization file whose `url` equals that
   bound resource.

Empty, missing, duplicate, or malformed `url` is `authorization_refused`
before wallet lookup, signing, facilitator verify, or settle.

## POST /lockfile-pin-delta

OpenAPI and MCP `lockfile_pin_delta` require JSON objects `before` and
`after`. Empty `{}` is unsigned discovery (HTTP 402). JSON `null` and
unrelated objects are HTTP 400, `charged:false`, before the facilitator.

Use `fixtures/authorization-lockfile.json` as the inspect/approve shape.
Do not send filesystem paths, URLs, or commands.

## MCP Registry

Official latest listing remains `1.23.45`. Live OpenAPI/MCP are `1.23.49`.
The registry JSON has no tool schemas. Clients that connect to the listed
remote `https://agents.samedaydesk.com/mcp` already see `lockfile_pin_delta`.
A version-only republish is not a new product. Root may publish the packet
in `registration/` if the label should match; this worker does not publish.
