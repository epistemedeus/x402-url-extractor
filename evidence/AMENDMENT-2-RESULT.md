# OpenAPI request-example parity amendment 2 result

This is a worker evidence record, not independent acceptance.

## Identity

- Repository: `epistemedeus/x402-url-extractor`
- Worktree: `/workspace/pilot/tmp/cline-merchant-openapi-request-example-parity-20260822`
- Branch: `codex/cline-openapi-request-example-parity-20260822`
- Immutable starting HEAD (amendment parent): `d397805fe37cd7c31e02190401750fc328e24907`
- Immutable starting tree: `18e18ef650bc613399cd6b93fe22ab6237fd6641`
- Merchant 1.23.20 live parent: `fbf3e2c9ce7cdb7ba929b363f9777f7c8970c7cc` / tree `8e65ec42b86d01fdba021732385d4afb264f7b15`
- Amendment-2 head commit: this DCO commit (verify with `git rev-parse HEAD`)
- Amendment-2 head tree: this tree (verify with `git rev-parse HEAD^{tree}`)
- Package / OpenAPI `info.version` remains `1.23.20`. Nothing was bumped, deployed, published, registered, pushed, or paid. No wallet, signer, payment credential, or live paid settlement was used.

The partial dirty continuation was preserved in place (binary-diff SHA-256 `31d1afeead19f49d11c651b89e7f1b19949b0a3e8451fd6824ac621cac702115` over `openapi-request-example-parity.mjs`, `package.json`, and `package-lock.json` against parent `d397805`). The first live probe crash was reproduced and repaired before the rest of the partial was trusted.

## Crash reproduced and repaired

`credentialLikeVariant` called `.some` on the `{ variants, malformed }` object returned by `boundedDecodedVariants` (userinfo and query-value channels). Hostile probes threw `TypeError: variants.some is not a function` for:

- `https://user:pass@example.com/page`
- `https://example.com/extract?url=https://user:pass@evil.example/`
- `https://example.com/?%2574oken=plain-secret-material`
- `https://example.com/?next=https%253A%252F%252Fu%253Ap%2540evil.example%252F`

The helper now accepts either an array or a `{ variants }` object, and every call site passes the decoded result object. After the repair those probes return controlled findings and do not throw.

A second review gap was closed in the same privacy path: nested object string values / keys are inspected under the same bounded decode policy (`%73k-live-abc123`, `%2573k-live-abc123`, encoded keys). Findings do not interpolate secret values.

## Audit findings closed (bounded)

1. **P1.1 direct validator dependency.** `package.json` and `package-lock.json` declare `@cfworker/json-schema` `4.1.1` as an exact direct production dependency. Clean `npm ci` from a git-export overlay resolves it. A packed tarball installed into an empty consumer imports the parity module and boots `server.js`.
2. **P1.2 Circle-disabled boot.** Expected counts are derived from enabled mounted surfaces (`EXPECTED_ENABLED_SURFACE_COUNTS`: AgentCash 25/24, MPP 24). `assertGeneratedOpenApiSurfaceGate` no longer compares a Circle-disabled inventory against the unconditional 25. Live `CIRCLE_GATEWAY_ENABLED=false` startup listens and serves 24/24 paid method-routes with the gateway path absent.
3. **P1.3 missing / boolean-false GET schemas.** JSON Schema 2020-12 booleans are honored (`true` accepts, `false` rejects). Missing, null, array, or otherwise non-schema required GET inputs fail closed in `validateExampleAgainstSchema`, projection (`applyDiscoveryRequestExamples` throws), and the terminal surface audit. Exact negative tests cover all four audit false-success states.
4. **P1.4 obsolete `additionalItems` on 2020-12 tuples.** `additionalItems` is not in the bounded 2020-12 assertion subset. `{ type: "array", prefixItems: [{ type: "number" }], additionalItems: false }` with `[1, "escape"]` fails closed as an unsupported keyword instead of silently passing. Rest-of-tuple assertion uses `unevaluatedItems`, which the locked validator does apply.
5. **P1.5 bounded multi-decode privacy.** Direct, once-encoded, and twice-encoded userinfo/host/path/query/nested-object cases fail closed. Malformed percent encodings (`%ZZ`, truncated `%2`, invalid UTF-8 `%80`) return controlled findings; no unclassified `URIError`. Secret fixtures do not appear in findings.
6. **P2.1 canary labeling.** The live canary is named and commented as credential-free unpaid 402 constructibility. It still asserts 25/25 HTTP 402, no credential/payment headers, no top-level success envelope, no reported charge, and no `Set-Cookie`. It does not claim handler/effect non-execution. Handler spies were not added (product not widened).
7. **P2.2 release identity.** Left at undeployed `1.23.20` per assignment. Not deployable as a distinct public contract under that version.

## Files changed

| Path | Change |
| --- | --- |
| `package.json` | Exact direct production dependency `@cfworker/json-schema` `4.1.1`. Version unchanged. |
| `package-lock.json` | Root `packages[""].dependencies` records the same exact direct dependency. |
| `openapi-request-example-parity.mjs` | Enabled-surface counts; boolean/missing schema fail-closed; `additionalItems` removed from the supported subset; bounded repeated-decode privacy; crash repair on `credentialLikeVariant`; nested object decode; canary/gate comments. |
| `openapi-request-example-parity.test.mjs` | Hostile regressions for the crash, missing/false GET schemas, `additionalItems` vs `unevaluatedItems`, multi-decode/malformed/nested-object privacy, Circle-disabled live boot, and unpaid-402 canary labeling. |
| `evidence/AMENDMENT-2-RESULT.md` | This file. |

`server.js` was not modified. Default 25 AgentCash / 24 MPP parity, request price/network/route behavior, and unrelated source are unchanged.

## Verification performed

| Gate | Result |
| --- | --- |
| Crash reproduction | `TypeError: variants.some is not a function` on userinfo/query-value probes before the repair; controlled findings after |
| `node --check` on changed JS modules | pass |
| `git diff --check` | pass |
| Focused parity suite `node --test openapi-request-example-parity.test.mjs` | **19 pass / 0 fail** |
| Construction/machine-surface pretest `npm run pretest` | **12 pass / 0 fail** |
| Full merchant suite `npm test` | **398 total: 397 pass, 1 pre-existing skip (`plugins/samedaydesk-x402/plugin.test.mjs` live-version skip), 0 fail** |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| Clean git-export overlay `npm ci --no-audit --no-fund` | pass; `@cfworker/json-schema@4.1.1` is a direct dependency |
| `npm pack` from that overlay | **151 files**, tarball SHA-256 `056ef8aa249599ec4bc048753a468cbc660f0d4632a763bf598821d4e4f74c27`, size 428279 bytes, `x402-merchant-1.23.20.tgz` |
| Empty-consumer `npm install` of that tarball | **228 packages**; `@cfworker/json-schema@4.1.1` listed under `x402-merchant` |
| Empty-consumer import of `x402-merchant/openapi-request-example-parity.mjs` | pass |
| Empty-consumer `server.js` boot (default) | `x402-merchant listening on :0`; `price: $0.05`; version `1.23.20` |
| Empty-consumer `CIRCLE_GATEWAY_ENABLED=false` boot | `x402-merchant listening on :0` |
| Default live generated inventory | AgentCash **25**, MPP **24**, zero parity findings, OpenAPI `3.1.0` / `info.version` `1.23.20` |
| Circle-disabled live generated inventory | AgentCash **24**, MPP **24**, gateway path absent, zero parity findings |
| Credential-free unpaid 402 canary | **25/25 HTTP 402**; no credentials, wallet, signer, or payment sent |

Pinned Node/npm observed: `v22.23.2` / `10.9.8`.

## Route / canary facts

- Default AgentCash paid method-routes: 20 GET + 4 POST + Circle GET alias = 25.
- Default MPP paid method-routes: 24 (Circle GET not mounted).
- `CIRCLE_GATEWAY_ENABLED=false` AgentCash: 24 (Circle GET not mounted).
- Canary boundary: constructibility from generated examples + unpaid HTTP 402 transport envelope. Not proof of business-handler or outbound-effect non-execution. Commerce telemetry may still run.

## Commit provenance

- DCO trailer: `Signed-off-by: epistemedeus <epistemedeus@users.noreply.github.com>`
- Cryptographic signature: **unsigned**. No usable non-interactive `user.signingkey` / `gpg.format` / secret key was configured in this environment (`gpg --list-secret-keys` empty; `commit.gpgsign` unset).

## Remaining risks

- The public documents and startup gate still advertise `1.23.20` while differing from live merchant 1.23.20. A version bump remains required before any integration intended for deployment; this assignment forbade that bump.
- The 25/25 canary remains a transport constructibility check. Application-effect freedom would need injected counters/tripwires at every paid handler and outbound seam.
- A local supported-keyword / dialect / `$id` / ref policy layer still wraps `@cfworker/json-schema`. It is now a documented fail-closed subset (obsolete `additionalItems` rejected) rather than a second semantics implementation, but it is not a full meta-schema replacement.
- `npm pack` from a dirty worktree still includes untracked `assignment.md` because `.npmignore` only excludes `assignment/`. Release packaging must use a fresh exact checkout or git-export overlay (151 files, as above).
- Optional (non-required) query examples are not independently audited.
- `$id` rebasing, `$dynamicRef`, `$recursiveRef`, and non-local `$ref` still fail closed by product policy.

No credentials, wallets, payment, deploy, publish, register, push, or price/version change were used.
