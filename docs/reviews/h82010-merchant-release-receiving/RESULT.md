# H82010 RESULT

Source-correct merchant release receiving on `epistemedeus/x402-url-extractor`. Base `7138c170c7c5d06dae0568466b7a93b77439bbda`. Branch `codex/h82010-merchant-release-receiving-20261031`. The export is the tip of that branch after the commit that adds this file. No merge, deploy, account change, or production call.

## Causal finding

`startMerchant({ sourceBase })` in `page-change-http.mounted.test.mjs` is the fixture producer. It copies Git members and symlinks the rest. Node ESM resolves a symlinked module from its real path, so a symlinked `operation-identity.mjs` binds HEAD.

October 25 `server.js` at `a6978f989a3bc754421884a3d260be834a84c73a` and `d9e5cde379cf7798f473d0cc6bf2139c9ec857d9` calls `supportedRailsForRoute(route)` with one argument. At both commits that function returns `["x402","mpp"]` except `["x402"]` for `/lockfile-pin-delta`. Those two identity files are identical. HEAD `supportedRailsForRoute(route, { method, mpp })` since `ab5bf51b60c7fa6e2d3587fcac23b26f00872b65` (2026-10-29, "Project configured MPP availability across machine discovery") returns `mpp` only when `mpp.enabled` and `mpp.supportsRoute(method, route)`. A call with no runtime returns `["x402"]`.

The hybrid fixture therefore publishes an x402-only catalog while the copied October 25 server still emits `GET /extract` on `/mpp-openapi.json`. It has no availability omit loop. Current `machine-surface-parity.mjs` rejects startup with `GET /extract must not appear on MPP OpenAPI`. That kill is `902a7335` (2026-09-12, line 333). `ab5bf51` did not add the kill. Empty `MPP_SECRET_KEY` is not what makes the one-argument historical function return x402. The missing runtime argument is. Restoring `commerce-events.mjs` does not close this import.

The closure copies `operation-identity.mjs` from the same `sourceBase` as `server.js`. `machine-surface-parity.mjs` stays the HEAD symlink and remains the startup judge. The historical server is not retargeted at HEAD. After the closure both servers boot (`construction: 23 actions`, `protocols: x402 + MPP (disabled)`). The remaining difference is the identified availability revision: with `MPP_SECRET_KEY=""`, HEAD projects configured availability, and the October 25 revisions statically advertise x402 and MPP. Prices, x402 challenge economics, and human HTML bytes stay equal. `ab5bf51` stays named. It does not become the historical HEAD.

## Old, red, and new controls

Old red, hybrid fixture, both named tests: process exit 1 during startup, `Machine surface parity invalid: GET /extract must not appear on MPP OpenAPI`.

Red after closing identity, before projection: both servers boot, then `assert.deepEqual` fails. Preserved: human HTML, favicon, `/.well-known/extraction-trial`, x402 challenge body and `payment-required` (both `www-authenticate` null), action price and billing basis. Availability delta: MPP OpenAPI paid operations including `GET /extract` versus none; rail arrays that HEAD dropped to `["x402"]`; eight exact sentences in OpenAPI description, guidance, A2A summary, settlement, catalog note, MCP payment line, and two `/llms.txt` lines; `trial_read` inserted immediately before `recover_paid_result`. `x-paid-effect.paymentProtocols` stays `["x402","mpp"]` on both sides. Bazaar tags that still say `mpp` stay. A 402 description rewrite from `x402 or MPP` to `x402` is accepted only when that exact string equals the current description.

New controls, assertions kept:

- `assertIdentifiedHistoricalRevision` requires the source base to be an ancestor of HEAD, and `ab5bf51` to be an ancestor of HEAD and not of the source base, with that subject.
- `projectClosedMppDocument` requires historical `GET /extract` on the MPP profile, current paid operations `[]`, and current `/extract` absent, then deep-equals the remaining document after the identified projection.
- `assertCatalogEconomics` and `assertExtractStaysPriced` require equal price and billing basis. Historical rails stay `["x402","mpp"]` except the lockfile route. Current rails stay `["x402"]`.
- Human routes, extraction-trial, and paid-action effects stay raw `assert.deepEqual`.
- Challenge stays `assert.deepEqual` after both MPP headers are null.
- `assertEquivalentOpenApi` and `assertEquivalentTool` are unchanged. Local-ref negatives still throw on unresolved, cyclic, wrong-target, and external refs. The behavior oracle still rejects a schema-valid example whose verdict is `unchanged` when the annotation says changed. The throw predicate reads `error.actual === "unchanged"` and `error.expected === "changed"` because `FORCE_COLOR` splits that word inside the assertion message.

## Owner QA receiver

`scripts/merchant-release-receiving.mjs` accepts an exact origin and a 40-hex expected source. There is no default origin. Observations are `ownerQa: true`. It checks:

- `GET /recipes/page-change/health` for product `samedaydesk-page-change-http`, schema `samedaydesk.page-change-http.v0`, and `commit` equal to the expected source. Disabled is HTTP 404 `page_change_http_disabled` with no commit field, and the receive stays unsuccessful for that reason.
- `GET /healthz` for HTTP 200, `ok`, and `paymentProtocols.x402.enabled`. `paymentProtocols.mpp.enabled` is a separate fact.
- `GET /mpp-openapi.json` paid operations, defined as methods that carry `x-payment-info`. Enabled MPP with no paid operation fails. Disabled MPP with a paid operation fails. The general OpenAPI document is not fetched and is not searched for the text `mpp`.
- The configured free SDK route, default `POST` path from `PAGE_CHANGE_MCP_PATH`. GET must be 405. The SDK must list only `compare_page_observations` with the source annotations. `extract` and `trial_read` must fail as unknown tools (`-32602`) before a payment challenge. When health is disabled, `compare_page_observations` must return `page_change_http_disabled` and `charged: false`.

Exit 0 when every check passes, 1 on an observation failure, 2 when origin, source, or route configuration is refused before any network call. A dropped free-route connection is `free_route_transport`. An origin that accepts no connection is `origin_unreachable`.

```bash
node scripts/merchant-release-receiving.mjs --origin <exact-origin> --expected-source <40-hex>
```

Optional `--free-route /mcp/page-change`. This build did not call a production host. `PUBLIC_URL=https://agents.samedaydesk.com` in the local servers is the advertised document origin. The mounted receiver test rejects any fetch URL that contains that host.

## Commands and counts

Serial, `NODE_OPTIONS=--max-old-space-size=512`, `UV_THREADPOOL_SIZE=1`, `OMP_NUM_THREADS=1`, `--test-concurrency=1`. No `npm ci`. Declared aggregate 2GiB. The full `npm test` suite was not run.

Named historical pair, exit 0, 8 tests, 8 pass, 0 fail, `duration_ms` 7408.587272:

```bash
node --test --test-concurrency=1 --test-name-pattern='exact source base preserves paid contracts|ROOT9560 exact mounted byte qualification' page-change-http.mounted.test.mjs
```

Affected union, exit 0, 209 tests, 209 pass, 0 fail, `duration_ms` 78739.715992. Historical cases are `ok 128` and `ok 130` (six local-ref and behavior subtests). Receiver cases are `ok 170` through `ok 173`.

```bash
node --test --test-concurrency=1 page-change-mcp.http.test.mjs plugins/samedaydesk-page-compare/plugin.test.mjs free-page-change-outcomes.test.mjs page-change-http.test.mjs page-change-http.mounted.test.mjs trial-measurement-continuity.test.mjs commerce-events.test.mjs scripts/merchant-release-receiving.test.mjs
```

Receiver file alone, exit 0, 4 pass, 0 fail, `duration_ms` 5380.813208. Cases: configuration with zero fetches, stubbed MPP present and absent, wrong tool list, free-route transport drop, mounted match, wrong source, `/health` and `/mcp` method refusal, closed port, CLI match, disabled HTTP with the free route still mounted, and a later enabled receive.

Current MPP availability regressions, exit 0, 83 pass, 0 fail, `duration_ms` 13913.383951. Local facilitator calls 2, both `GET /supported`. verify 0, settle 0:

```bash
node experiments/oct29-mpp-availability/regressions.mjs
```

That run includes `payment-availability.test.mjs` (3): configured runtime, preserved rails, unusable startup. It also includes operation identity, construction, machine-surface parity, A2A, skills, discovery, and paid-action effect profile.

Separate dual-stack and JSON-RPC payment files, exit 0, 19 pass, 0 fail, `duration_ms` 3660.69224:

```bash
node --test --test-concurrency=1 mpp-dual-stack.test.mjs mcp-json-rpc-limit.http.test.mjs mcp-payment-header.test.mjs mcp-payment-challenge-contract.test.mjs
```

Split: `mcp-json-rpc-limit.http.test.mjs` 2, `mcp-payment-challenge-contract.test.mjs` 2, `mcp-payment-header.test.mjs` 7, `mpp-dual-stack.test.mjs` 8. The inherited 42/42 figure was not reused.

## Inventory

- `page-change-http.mounted.test.mjs`: historical closure adds `operation-identity.mjs`; availability projection and preserved economics, challenges, tools, and human assets.
- `scripts/merchant-release-receiving.mjs`: owner QA receiver.
- `scripts/merchant-release-receiving.test.mjs`: configuration, stub, mounted, disabled, recovery, and CLI cases.
- `docs/reviews/h82010-merchant-release-receiving/RESULT.md`: this note.

Unchanged: `server.js`, `operation-identity.mjs`, `machine-surface-parity.mjs`, prices, paid tools, journal semantics, ZIP and old release bytes, and human assets. `node_modules` is a local symlink and is not part of the commit.

## NEXT

Root owns default merge, deployment, the live canary, and account or directory publication. Use the receiver above against the expected deployment source and the exact origin. Read `/healthz` and `/recipes/page-change/health`. Read paid operations from `/mpp-openapi.json`. Keep free SDK transport separate from MPP availability. There is no `/health` route. A disabled page-change HTTP flag is an owner-QA failure, and recovery is a later enabled receive. Do not retarget the October 25 server copies at HEAD.

## Root receiving amendment

Root received all four original source buffers and the original terminal at9e316084. The native export retains complete:false because one untracked dependency symlink remains; independent Root state receiving establishes no tracked changes and exactly that reproducible symlink, without deleting it.

Root corrects exact-origin free-route validation before any network request, explicit boolean MPP-state receiving (unknown is not disabled), and semantic annotation equality independent of JSON property order. Regressions include off-origin backslash routes, normalized/query/fragment/control routes, malformed or absent MPP enabled fields, and reordered valid annotations. The full affected union plus current payment files and separate MPP-availability runner pass on the unchanged enrolled remote runtime. Exact counts/logs are retained in the Root amendment receipt. No production calls or deployment occur. HTTP fetches use8-second deadlines; that is not an overall SDK/receiver deadline.
