# Cline OX amendment 1 result: OpenAPI request-example parity

Verdict: **ACCEPT**

## Identity

- Repository: `epistemedeus/x402-url-extractor`
- Worktree: `/workspace/pilot/tmp/cline-merchant-openapi-request-example-parity-20260822`
- Branch: `codex/cline-openapi-request-example-parity-20260822`
- Merchant 1.23.20 parent commit: `fbf3e2c9ce7cdb7ba929b363f9777f7c8970c7cc`
  (`test: harden live plugin release gate`)
- Merchant 1.23.20 parent tree: `8e65ec42b86d01fdba021732385d4afb264f7b15`
- Amendment-0 candidate commit (this amendment's parent):
  `13616806368c7003ddb56095a00e32e40bf3b4e7`
  (`feat: project discovery request examples into generated OpenAPI`)
- Amendment-0 candidate tree: `82ef2ca414c99a7b83e3794d3c72c2fffb3a5c5c`
- Amendment-1 head commit: recorded as the single DCO commit that introduces
  this file (verify with `git rev-parse HEAD` on the branch above)
- Package version remains `1.23.20`. Nothing was bumped, deployed, published,
  registered, or paid. No credentials, wallets, provider controls, Railway, or
  browser state were touched. Paid live routes were not invoked with a wallet
  or payment credential.

## Blocking findings addressed

1. **Post-discovery-registration, pre-listen generation gate.** After every
   discovery contract is declared and before `app.listen`, both public documents
   are regenerated and `assertGeneratedOpenApiSurfaceGate` fails startup on
   missing/renamed/drifted canonical request contracts, lost request examples,
   lost formal 200 JSON response schemas, unsafe examples, or paid-inventory
   drift. Exact inventories: **25 AgentCash** method-routes and **24 MPP**.
2. **Canonical examples are authoritative.** Authored parameter/media examples
   that are not canonically equal are overwritten deterministically. Silent
   authored precedence is gone. Semantic equality is structural (key-order
   insensitive); `JSON.stringify` order equality is not used.
3. **Circle GET alias.** `GET /gateway/commerce/payment-offer-preflight` maps
   explicitly onto `GET /commerce/payment-offer-preflight`.
4. **Full paid-surface reconciliation.** The parity gate walks every generated
   paid operation (`x-payment-info`), including both POST aliases and Circle
   GET, not only the 22 `/api/actions` catalog entries. Each requires a request
   example, a formal 200 JSON response schema, and safety parity.
5. **Scoped `signature` exception.** Allowed only on GET
   `/chain/solana-transaction-receipt`, exact query field `signature`, with
   canonical public Solana base58 schema
   `^[1-9A-HJ-NP-Za-km-z]{80,90}$`. Rejected everywhere else.
6. **Credential-bearing URL examples rejected.** Userinfo, fragments, sensitive
   query keys/values, nested URL userinfo/fragments, credential-like path
   material, and authorization-like values fail. Ordinary public URLs remain
   valid.
7. **Fail-open private JSON Schema subset removed.** Conformance uses the
   repository's locked `@cfworker/json-schema` validator (JSON Schema 2020-12,
   synchronous, local JSON-pointer `$ref` only). Custom dialects, `$id`
   rebasing, non-local/`$dynamicRef`/`$recursiveRef` references, and any
   assertion keyword the validator does not evaluate fail closed.

## Files changed

| File | Change |
| --- | --- |
| `openapi-request-example-parity.mjs` | Canonical overwrite; Circle GET alias map; scoped Solana `signature` exception; credential-bearing URL rejection; structural equality; `@cfworker/json-schema` 2020-12 validator with local refs only and fail-closed keyword/dialect/`$id`/ref integrity; full paid-surface parity gate; startup generation gate asserting 25/24 inventories and resolvable contracts. |
| `openapi-request-example-parity.test.mjs` | Hostile probes for overwrite, alias mapping, signature scope, credential URLs, fail-closed schemas, inventory drift, and missing contracts; live 25/24 inventory audit; 25/25 unpaid no-wallet loopback canary. |
| `server.js` | Import plus one post-discovery-registration, pre-listen `assertGeneratedOpenApiSurfaceGate(...)` call. No other behavior line touched. |
| `evidence/AMENDMENT-1-RESULT.md` | This file. |

`package.json` version untouched (`1.23.20`). No lockfile or dependency declaration change; the validator is the already-locked transitive `@cfworker/json-schema@4.1.1` (MCP SDK / mppx).

## Verification performed

| Gate | Command | Result |
| --- | --- | --- |
| Syntax | `node --check` on the three touched JS files | pass |
| Focused hostile probes + live surface + canary | `node --test openapi-request-example-parity.test.mjs` | **14 pass / 0 fail** |
| Construction & machine-surface pretests | `npm run pretest` | **12 pass / 0 fail** |
| Full merchant suite | `npm test` | exit 0 — **393 tests, 392 pass, 1 pre-existing skip, 0 fail** |
| Production surface audit | `machine-surface-parity.http.test.mjs`, `startup-smoke.test.mjs`, seller-integrity / discoverability / surface-budget suites (inside `npm test`) | pass |
| 25/25 unpaid loopback canary | live test in the parity suite | **25/25 HTTP 402**; no credentials, wallet, signer, settlement, or payment sent; no application-success envelope; no `Set-Cookie` |
| Package | `package.json` JSON parse (`1.23.20`), `npm ls --depth=0` | pass |
| Whitespace | `git diff --check` | clean |
| Privacy | diff scan for live credential material | only synthetic rejection fixtures (`sk-live-abc123`, `Bearer zz`) in tests |

## Generated-surface proof (observed)

- `/openapi.json`: `openapi: "3.1.0"`, `info.version: "1.23.20"`; **25** paid
  method-routes (20 GET + 4 POST + Circle GET alias), each with `x-payment-info`,
  a formal 200 JSON response schema, and a constructible request example.
- `/mpp-openapi.json`: same version; **24** paid method-routes (Circle GET
  killed); zero parity findings.
- Circle GET `url` example is canonically equal to
  `GET /commerce/payment-offer-preflight`.
- Solana receipt `signature` example is the canonical public base58 value
  `3CjY38avdggKZbKfu2BmFYN4MUTiiNX27c8dHzPW79PrAx3huB9Pa6AfwW6sT4biax3y22z8toyLzmjtCc2QGNZn`
  under the canonical schema pattern.
- Unpaid canary constructed every AgentCash paid method-route from generated
  examples and received 402 (Circle carries the offer in `PAYMENT-REQUIRED`
  with an empty JSON body; other routes return an x402 JSON challenge).

## Semantics preserved

No version bump; no deploy/publish/register; no paid route called with a
credential; no wallet, signer, or settlement. Payment info, prices, accepts
arrays, Bazaar metadata, MCP tool schemas, A2A card, llms.txt, catalog,
manifest, effect profiles, and typed telemetry were not modified — verified by
the unchanged full suite including the live HTTP surface-parity audit.

The original 25/25 credential-free unpaid loopback constructibility canary is
preserved as a regression (now an explicit test).

## Limitations

- The early pre-registration `buildOpenApiDocument` call (operation-id check)
  still sees no declared contracts and remains a no-op for example projection.
  The new post-registration gate is the fail-closed serving boundary.
- `@cfworker/json-schema` is imported as an already-locked transitive
  dependency; it is not added to `package.json`. Missing/unresolvable import
  fails closed at process start.
- `$id` base-URI rebasing, `$dynamicRef`, `$recursiveRef`, and any `$ref` that
  is not a local JSON pointer (`#` or `#/...`) fail closed even if a future
  validator could resolve them.
- Optional (non-required) query examples are not independently audited; required
  GET inputs and POST JSON bodies are.
- Circle Gateway unpaid 402 may place the offer in the `PAYMENT-REQUIRED`
  header with body `{}`; the canary accepts that as an unpaid challenge, not as
  application success.
- Nothing was pushed, deployed, or registered.

## Result

Every required gate passed. Verdict: **ACCEPT** — one DCO-signed amendment
commit on `codex/cline-openapi-request-example-parity-20260822`; not pushed;
not deployed.
