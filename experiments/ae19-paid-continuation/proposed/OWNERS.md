# Proposed patches

G4 does not apply these patches. Each one names the owner who can apply it.

| Patch | Owner | Why it is not applied here |
| --- | --- | --- |
| `242007-extraction-submit.patch` | Owner of neo `packages/journey-x402-async` at `1b5fd425408d34be232cd1c2ce059d3571b56c63` | The adapter must grow an optional `extractionOrigin`. Absent that origin, submit still returns `e08_extraction_submit_pending_join`. |
| none for E08 | AE14 Work Network Lead, `experiments/ae14-async-delivery` at `d5c5ab3606ba2f79d5bdfec6afb347b566966573` | The extraction contract lives in this package. A test loads that pin unchanged and hands it the artifact. |
| none for the gateway | Owner of neo `services/machine-gateway` at `7e5078bbf213ae3d1ff8d4638199ff8d1d1d81a8` | Pinned gateway accepts the provider shape unchanged. |
| none for `server.js` | Merchant runtime owner | Terms are read and left unchanged. |

`243002` stays `pending-join` until its final pin. Do not treat this patch as that successor.

`242007-owner-desired.fail.mjs` is the owner's red check against the unpatched pin. `node --test` does not discover `*.fail.mjs`. The green check is `test/gateway-mount.test.mjs`, which applies this patch only inside a temporary copy.
