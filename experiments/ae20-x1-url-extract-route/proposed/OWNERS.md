# Proposed patches

X1 does not apply these patches. Each one names the owner who can apply it.

| Patch | Owner | Why it is not applied here |
| --- | --- | --- |
| `gateway-url-extract.patch` | N2, owner of neo `services/machine-gateway` (read at `7e5078bbf213ae3d1ff8d4638199ff8d1d1d81a8`, moving to `667fba353e9082d8a0842437442dabc42843abf8`) | The patch adds free/test `url.extract.submit`, `url.extract.poll`, and `url.extract.result` to the gateway registry and regenerates `openapi.json`. Apply it on a copy of `667fba35`. The same diff also applies on `7e5078bb`. |
| none new for 242007 | Owner of neo `packages/journey-x402-async` at `1b5fd425408d34be232cd1c2ce059d3571b56c63` | G4's `experiments/ae19-paid-continuation/proposed/242007-extraction-submit.patch` is sufficient for the async adapter and is not modified. This route does not need a second 242007 patch. |
| none for E08 | AE14 Work Network Lead, `experiments/ae14-async-delivery` at `d5c5ab3606ba2f79d5bdfec6afb347b566966573` | The extraction contract stays in the AE19 package. This route consumes it. |
| none for `server.js` | Merchant runtime owner | Terms and the merchant extract kernel are read, not rewritten. |

Apply the gateway patch only in a temporary copy until N2 takes it:

```sh
patch -p1 --forward --batch --directory services/machine-gateway \
  --input experiments/ae20-x1-url-extract-route/proposed/gateway-url-extract.patch
```

The source of `services/machine-gateway/src/url-extract-routes.mjs` in that patch is `gateway/url-extract-routes.mjs` in this package. Bind an `ExtractionService` with `bindUrlExtractService` before the gateway serves traffic. Unbound `run()` fails closed. `test()` and `quote()` stay free and do not fetch or capture.
