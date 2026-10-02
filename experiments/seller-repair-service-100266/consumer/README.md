# seller-repair-external-consumer 0.2.0

Portable caller-owned receiver for one seller-repair case. The retained catalog
fixture remains a deterministic loopback example. A visiting agent supplies the
operation, the observable expected output, the SDK, and probe consent for its
own authorized target.

This candidate is unlaunched. `productionHosted` and `hostedAcquisitionVerified`
stay false. Unpacking it does not publish the public acquisition index, change
a price, or create revenue, savings, adoption, or paid authority.

## Runtime dependencies

- Node.js `>=22.22.0` (`engines.node`).
- Standard library only: `node:crypto`, `node:dns/promises`, `node:fs`, `node:fs/promises`, `node:http`, `node:https`, and `node:net`.
- No npm packages, no `npm install`, and no `agent-payment-integrity` install. The scanner is absent. Its coverage is `unknown` and is not useful execution.
- System `tar` and `gzip` to unpack the archive. They are not imported by the program.
- No private Git remote and no `.git`, `node_modules`, or `.grok` directory.
- Loopback `127.0.0.1` for the catalog example, `deliver`'s direct baseline, and a caller-supplied pair of services.
- `public-https` for one caller-named public origin. The address check matches the merchant public-target boundary. A portable install uses the vendored copy of that check when `payment-offer-preflight.mjs` is absent.
- Optional unpaid network: one GET of `https://agents.samedaydesk.com/.well-known/public-acquisition/index.json` under `public-read-only`. Redirects are not followed.

The privacy modules under `task-linked-delivery/` are vendored byte-for-byte from the MIT sources in this repository. `package/references/pins.json` records their sha256.

## Limits on every stage

`maxEffort` must name all of these. The shared budget starts when the journey starts and is not reset for the retest.

| Field | Bound | Meaning |
| --- | --- | --- |
| probes | 1–8 | Declaration plus resource probes. A public read-only case skips `/openapi.json`. |
| bodyBytes | 1–65536 | Per-response body ceiling. Extra bytes are discarded. |
| deadlineMs | 20–5000 | Absolute whole-response deadline. Body trickle does not renew it. |
| totalBodyBytes | 1–524288 | Sum of body bytes across probes. |
| totalResponseMs | 20–20000 | Shared wall clock for every stage. |
| redirects | 0 | Redirects are counted and never followed. |

`probeConsent` is `{ "class": "loopback" \| "public-read-only" \| "public-https", "confirmed": true }`. The field is not named `authorization` because that key is private evidence. `callerId` matches `^[a-z0-9][a-z0-9-]{0,63}$`. `operation.operationId` must equal `METHOD resource`. A similar path is a different operation. `diagnose` accepts the shorter machine object: `callerId`, `origin`, `operation`, `sdk`, and `expect`. A long task string is optional.

## Commands

Run from the extract root.

```bash
node package/bin/seller-repair.mjs deliver
node package/bin/seller-repair.mjs diagnose --case package/cases/supplied-health.json
node package/bin/seller-repair.mjs reproduce --case package/cases/retained-case.json
node package/bin/seller-repair.mjs retest --case package/cases/retained-case.json --mode repaired
node package/bin/cold-later.mjs package/cases/retained-case.json --resource /catalog/items
node package/bin/seller-repair.mjs reject-seeded package/fixtures/seeded-false-useful.json
node package/bin/seller-repair.mjs readonly --case package/cases/public-readonly.json
node package/bin/seller-repair.mjs receive --case CASE.json --base http://127.0.0.1:PORT --retest-base http://127.0.0.1:PORT
```

`reproduce` and a useful `receive` exit 0. `reject-seeded` exits 2. A later call whose SDK, task, origin, method, or resource differs exits 2 and does not probe. The same binding with another `--caller` retests independently. `usefulTransferred` stays false. `trustedPriorUseful` stays false.

A loopback repair is `loopback_fix` with `deployedCounterpartyRepair` false and `counterpartyMutated` false. The public index observation is not a deployed repair. Same-input QA is the original caller's retest. A later caller is a different `callerId` on the same binding.

Cash, tokens, included quota, API-equivalent effort, and total engineering cost stay separate. `recognizedRevenueAtomic` is `0`. `revenueFromFixtureOrDownload` is `0`. `paidAuthority` is `none`. `actualSourceCoverage` is `unknown`.

The existing seller-integrity audit remains `GET /commerce/seller-integrity-audit` at `$0.01` / atomic `10000`. This package does not buy it. An incomplete local report does not answer the caller's useful body.
