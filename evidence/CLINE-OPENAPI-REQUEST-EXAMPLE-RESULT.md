# Cline OX result: merchant OpenAPI request-example parity

Verdict: **ACCEPT**

## Identity

- Repository: `epistemedeus/x402-url-extractor`, fresh assigned clone
  (`/workspace/pilot/tmp/cline-merchant-openapi-request-example-parity-20260822`)
- Exact parent commit: `fbf3e2c9ce7cdb7ba929b363f9777f7c8970c7cc`
  (`test: harden live plugin release gate`)
- Exact parent tree: `8e65ec42b86d01fdba021732385d4afb264f7b15`
- Branch: `codex/cline-openapi-request-example-parity-20260822`
- Recovery context: prior OpenCode Zen attempt ended before reading source with
  terminal reason `unknown`, changed no tracked file. This run read source,
  made a minimal change on the exact untouched tree above, and is not a replay.
- Typed-telemetry baseline: package version remains `1.23.20`; nothing bumped,
  deployed, published, registered, or paid. No credentials, wallets, provider
  controls, Railway, or browser state were touched.

## Live gap addressed

The x402 discovery manifest carries accepted construction examples for all 22
canonical paid actions plus the labeled Circle alternate, while generated
OpenAPI lacked examples for 12 required GET query inputs and all 4 canonical
paid JSON-body POST request bodies. This change projects those authoritative
examples into the generated document at standards-valid OpenAPI 3.1 locations
(parameter-level `example`, media-type-level `example`) and adds a parity gate
so the loss cannot recur silently.

## Files changed

| File | Change |
| --- | --- |
| `openapi-request-example-parity.mjs` | New module. `applyDiscoveryRequestExamples(document, resolveRequestContract)` deterministically projects `getDiscoveryRequestContract` examples onto every operation carrying `x-payment-info`: required GET query inputs receive a scalar parameter example from `contract.example.queryParams`; POST operations receive `contract.example.body` at `requestBody.content["application/json"].example`. Authored examples are never overridden; undeclared contracts are skipped (the pre-listener startup build runs before payment-middleware registration declares contracts); declared-but-drifted contracts throw instead of dropping an example. Also exports the parity gate `collectOpenApiRequestExampleFindings({document, actions})` and safety validators rejecting credential-like keys or values, unresolved `{...}` templates, prototype names (`__proto__`/`constructor`/`prototype`), non-scalar query values, and body/schema mismatches (type/enum/const/pattern/bounds/length/format/items/properties/required/additionalProperties). |
| `server.js` | +2 lines of behavior: import plus one call to `applyDiscoveryRequestExamples(document, ...)` inside `buildOpenApiDocument` immediately before `validateOpenApiOperationIds`. No other line touched. |
| `openapi-request-example-parity.test.mjs` | New parity suite (7 tests). Unit gates over projection idempotence, loud drift failures, credential/template/prototype/non-scalar rejection, and schema-conformance validation; plus a live gate that boots `server.js`, reads `/api/actions` (22 actions), and asserts for BOTH `/openapi.json` and `/mpp-openapi.json`: `info.version === "1.23.20"`, all 22 canonical paid operations keep `x-payment-info` and a formal 200 JSON response schema, zero parity findings across GET and POST, every listed gap input has a scalar example, and every paid POST has a JSON-body example. |
| `package.json` | Test script registers `openapi-request-example-parity.test.mjs`. Version untouched (`1.23.20`). |
| `evidence/CLINE-OPENAPI-REQUEST-EXAMPLE-RESULT.md` | This file. |

## Verification performed

| Gate | Command | Result |
| --- | --- | --- |
| Syntax checks | `node --check` on all three touched JS files | pass |
| Focused new tests | `node --test openapi-request-example-parity.test.mjs` | 7 pass / 0 fail |
| Construction & machine-surface parity pretests | `npm run pretest` | 12 pass / 0 fail |
| Full merchant suite | `npm test` | exit 0 — 386 tests, 385 pass, 1 pre-existing skip, 0 fail |
| Production surface audit | `machine-surface-parity.http.test.mjs`, startup smoke, seller-integrity / discoverability / surface-budget audit suites (inside `npm test`) | pass |
| Package checks | `package.json` JSON parse, `npm ls --depth=0`, clean `npm ci` | pass |
| Whitespace hygiene | `git diff --check` | clean |

## Generated-surface proof (observed directly)

- `/openapi.json`: `openapi: "3.1.0"`, `info.version: "1.23.20"`; 22 canonical
  paid operations each with formal 2xx JSON response schema;
  `/extract` `url` → `"https://example.com"`;
  `/work/opportunity-preflight` GET required inputs → `rewardUsd: 10`,
  `hours: 0.25`, `hourlyCostUsd: 4`;
  `/security/wallet-policy-conformance` POST body example present
  (`profileId,provider,network,protocol,observations`). Zero parity findings.
- `/mpp-openapi.json`: same version and parity-clean surface.
- Document size grew only by the projected examples (agentcash ~108 KB →
  ~110 KB locally); method/path/request/response/price/network/asset/recipient/
  middleware/settlement/delivery/telemetry/MCP/MPP/A2A/catalog semantics are
  untouched because the helper only fills missing example fields.

## Semantics preserved

No version bump; no deploy/publish/register; no paid route called; no
credential access. Payment info, prices, accepts arrays, Bazaar metadata, MCP
tool schemas, A2A card, llms.txt, catalog, manifest, effect profiles, and
typed telemetry producer were not modified — verified by the unchanged full
suite including the live HTTP surface-parity audit.

## Limitations

- The projection runs when `/openapi.json` is served; the pre-listener startup
  `buildOpenApiDocument` call still sees no declared contracts and is a no-op
  (execution order unchanged). Declared-but-drifted contracts fail loudly at
  generation time rather than silently emitting an example-less required input.
- `isSensitiveExampleName` mirrors `discovery-contract.mjs` sensitivity classes
  but treats the bare key `signature` as a public chain identifier (Solana
  transaction signatures are public ledger data, the same class as an EVM
  `transactionHash`); compound forms such as `requestSignature` remain rejected.
- The embedded schema validator covers the constraint vocabulary this document
  emits; exotic keywords (e.g. `allOf`, `$ref`) are ignored rather than guessed.
- Nothing was pushed; the commit exists only on the local branch.

## Result

Every gate passed. Verdict: **ACCEPT** — one DCO-signed commit created on
`codex/cline-openapi-request-example-parity-20260822`; not pushed.
