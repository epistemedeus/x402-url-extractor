# task-discoverability 0.3.0

Installable measurement for one discovery response. Give it a captured discovery document and your service URL. It returns source, time, coverage, rank, filter honor, and request constructibility, then states the strongest next acquisition action.

The default is offline. Install and test do not repeat a historic search. One free search runs only when you pass `--collect` with your own query and your service URL.

The core reading is provider-neutral: counts, atomic amounts, and constructibility do not assume a marketplace. The network adapter is one supported provider and one maintained API, CDP x402 discovery search. It is not a global market, a ranking engine, or a payment client.

## Install

Node 22 or later. From a clean directory:

```
mkdir task-discoverability
tar -xzf task-discoverability-0.3.0.tar.gz -C task-discoverability
cd task-discoverability
npm ci --ignore-scripts
npm test
```

The lockfile installs `ajv@8.20.0` (MIT, https://github.com/ajv-validator/ajv). Validation uses `ajv/dist/2020.js` and JSON Schema draft 2020-12 (`https://json-schema.org/draft/2020-12/schema`). `coerceTypes` and `useDefaults` are off.

## Offline measurement

```
node src/cli.mjs --fixture fixtures/full-get-constructible.json \
  --service https://seller.example/extract
```

A captured receipt is the same command with `--receipt path.json`. A missing file exits 2 with `fixture-absent` or `receipt-absent`. Invalid JSON exits 2 with `fixture-invalid` or `receipt-invalid`. A missing `--service` exits 2 with `service-required`.

Library:

```
import { measure } from "task-discoverability";

const document = await measure({
  serviceUrl: "https://seller.example/extract",
  body: capturedResponse,
});
```

`document.ok` is true only when the body is a supported discovery document. `document.nextAction` is the acquisition sentence. A supplied body keeps `provenance.officialLiveRead` and `provenance.networkSent` false, including when its URL is the pinned CDP route. `rows[].invoked` and `rows[].paid` stay false. The package does not call your service.

## One explicit free search

```
node src/cli.mjs --collect --query "your task" --service https://seller.example/extract
```

That sends one bounded GET to `https://api.cdp.coinbase.com/platform/v2/x402/discovery/search` with `accept: application/json` and no credential. The production read counts bytes on the response stream and stops at 262144 bytes. Timeout is 8000 ms. At most 3 redirects may keep the same host, path, and query. `--live` exits 2 with `live-query-refused` and does not send a request. `--collect` without `--query` exits 2 with `query-required` before any request. Invalid parameters, an unverified origin, a non-object body, an HTTP error, and a timeout each return a closed failure and do not call your service.

## Reading the result

Schema `pilot.task-discoverability.166000.v1`. Count and amount checks follow `pilot.observatory-measurement.v1`. Internal row decoding remains `pilot.task-discoverability.164000.v1`.

Coverage keeps the declared count separate from the inspected rows. `0` and `"0"` are measured. A missing count is unknown. An invalid count is the string `invalid`. Exact atomic amounts stay canonical integer strings. A declared symbol `USD` or `USDC`, and a quoted decimal in that unit, stay money fields. They are not copied from the atomic amount.

Filter honor is not assumed. Honor is false only when an inspected `payTo` string falls outside the requested filter. An unchanged page with no `payTo` string stays unknown. `collector.declaredOursCount` is that collector declaration. `collector.globalDemand` stays `unknown`. Buyer stays `not-supplied`. Use and revenue stay `unknown`.

Maintained discovery client: `x402-foundation/x402` commit `f8f83309706b14cc696962f0a002eeeb66c3dc26`, package `@x402/extensions` 2.28.0, Apache-2.0, file `typescript/packages/extensions/src/bazaar/facilitatorClient.ts`.
