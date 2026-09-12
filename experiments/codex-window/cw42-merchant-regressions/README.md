# CW42 merchant admission regression pack

Source baseline: `3cb29f079604071e041a4b794990bb65fc593b3e` of
`epistemedeus/x402-url-extractor`. This pack is self-authored local regression
evidence for F5, F6, and F7. It is neither independent production use nor a
settlement, deployment, or revenue receipt. No historical 66f3 result is used
as the oracle. CW37 owns production integration and repairs.

Run against an explicit checkout with its locked dependencies already installed:

```sh
NODE_OPTIONS=--max-old-space-size=768 npm ci --ignore-scripts --no-audit --no-fund
node --max-old-space-size=768 experiments/codex-window/cw42-merchant-regressions/run.mjs \
  /absolute/path/to/merchant-checkout /absolute/path/to/receipt.json
node experiments/codex-window/cw42-merchant-regressions/summarize.mjs \
  /absolute/path/to/receipt.json /absolute/path/to/witnesses.json
```

Run `npm ci` in the target checkout only when you own it. The pack can live in a
different checkout: supply its absolute `run.mjs` path and the candidate path.
The test runner resolves merchant code and dependencies from that candidate.
It never installs, edits, checks out, resets, or commits candidate source. It
records HEAD plus a digest of current tracked non-experiment file bytes, and
fails its final integrity check if those bytes or HEAD change during execution.
Do not run against a moving integration tree when an immutable candidate is
available. Untracked candidate source is outside the source-digest scope.

Only loopback port **55549** is used. A conflicting listener fails the test; it
is never killed. Tests run serially, use a 768 MiB Node heap, and set the vendor
worker ceiling to one. The fake facilitator lives in an injected fetch adapter
inside each merchant child, so it needs no extra port. Network guards reject
external fetches and socket connections. Children start in owned process
groups and receive TERM in cleanup; all temporary fixtures and merchant data
stay under this pack's ignored `runtime/` directory. Ambient credentials and
provider settings are not inherited. Dummy signature bytes are constants,
with no private key or cryptographic signing. The maintained client's state
labels such as `paymentSigned` refer only to its exercised dummy callback.

An exit code of **1 is expected on the pinned baseline** because assertions
express the desired safety properties. Read per-check results in the JSON
receipt. Node TAP also counts the failed parent suites, so its overall count
differs from the receipt's leaf-check count. `evidence/` contains the retained
baseline receipt and compact failing witnesses. Source fingerprints distinguish
the tested production bytes from the harness commit that generated the run.
The pinned baseline has **41 leaf checks: 26 pass and 15 fail**. The failures
are four dormant-boot witnesses, six numeric-collapse witnesses (including two
maintained-client paths), and five metadata/MCP/attestation witnesses.

## What this pack establishes

F5 uses actual server children with the flag unset and `0`. It checks incumbent
`/healthz` and `/extract`, vendor absence, malformed price, malformed individual
and combined limits, and a physically absent discovery fixture in an owned
copy. Price and missing-fixture boot failures are reproduced. Malformed dormant
limits currently pass; they are not reported as a defect.

F6 sends hand-authored raw JSON over HTTP, avoiding `JSON.stringify` before the
server receives the numeric tokens. It also runs the maintained
`runPreflight` and `runAuthorizedPurchase` functions with canonical-origin to
loopback transport, preserving the exact authorized body bytes. A separate
fake facilitator exercises verification and settlement-shaped success only.
The exact-decimal oracle is the stated numeric value of each short test token,
not the merchant parser or the maintained client's verifier.

The currently admitted numeric domain is a JavaScript **finite Number after
JSON parsing**, within the request/snapshot/row limits. It includes negative
values, zero, negative zero, fractions, subnormals, and unsafe integers. There
is no positivity, safe-integer, fixed decimal scale, or lossless-decimal gate.
Equivalently, raw JSON number tokens are admitted when their binary64 parse is
finite. This includes decimal tokens rounded to zero and tokens just above the
largest finite value that round down to it. Nonfinite parses, string-valued
prices, null, and booleans are rejected before fake verification/settlement;
non-JSON `NaN` and `Infinity` tokens are rejected by JSON admission.

`9007199254740992` versus `9007199254740993`, `0.1` versus
`0.10000000000000001`, and `0` versus `1e-400` collapse. The service returns
synthetic `charged:true`, informational analysis, zero field changes, and one
unchanged row. The first two are also accepted by the maintained client as
`valid_delivered` with `outputValid:true`. The client preserves the raw bytes,
then independently repeats the same lossy `JSON.parse` in its verifier. These
are false no-change results relative to the original exact decimal customer
values. They are internally consistent with the already-rounded admitted
binary64 values. Equivalent spellings `0.10`/`1e-1` and `-0`/`0` are controls,
not claimed defects. A representably distinct decimal control produces a delta.

F7 exercises live OpenAPI, MPP OpenAPI, catalog, purchase evidence, actual MCP
SDK initialize/list/call, actual exported Zod output validation, and existing
Ed25519 deployment verification. It separates successful schema construction
from schema completeness and client delivery. It checks a synthetic paid MCP
round trip as a positive control. It does not create or modify an attestation.

## Exact proposed repair pointers for CW37

* **F5:** `vendor-budget-impact-config.mjs`, module-level
  `VENDOR_BUDGET_IMPACT_PRICE = vendorBudgetImpactPrice()`, and
  `vendor-budget-impact.mjs`, module-level `JOURNEY_BEFORE/JOURNEY_AFTER` reads;
  these execute through `server.js`'s static vendor import before the feature
  guard. Defer active configuration and fixture materialization until enabled,
  or use safe dormant constants and a lazy discovery input. Preserve enabled
  invalid-configuration refusal. Limits are already deferred on this baseline.
* **F6:** `server.js` JSON-body admission before
  `validateVendorBudgetImpactRequest`; `vendor-budget-impact.mjs`
  `admitPricingRow` and `admitSnapshot`; maintained
  `examples/customer-x402/src/authorization.mjs` `admitVendorBudgetBody`; and
  `src/vendor-budget-output.mjs`'s `JSON.parse(authorization.bodyRaw)` comparison.
  Define a lossless accepted decimal domain and validate raw numeric tokens
  before their distinctions disappear, or represent prices as bounded decimal
  strings/integers with exact comparison end to end. A safe-integer check alone
  does not repair fractional collapse. Comparing raw spelling with
  `String(Number(token))` also rejects equivalent decimal spellings; normalize
  exact decimal value before a round-trip check. Do not merely relabel the
  resulting informational response after charging.
* **F7 metadata:** `purchase-evidence-manifest.mjs`
  `buildPurchaseEvidenceManifest` unconditionally adds `replay.mppRequirement`
  and `receipt.mpp` to each operation. Carry per-operation protocols from
  `readOnlyPaidPosts`/resources and condition these fields accordingly. The
  current OpenAPI payment info, MPP exclusion, catalog, and paid-effect
  extension already correctly say x402 only. Separately,
  `a2a-storefront.mjs` `buildPaidActionSkills` unconditionally inserts an `mpp`
  tag and an `x402/MPP invocation contract` into each action skill. The live
  vendor A2A skill reproduces both claims; derive them from that action's
  `paymentProtocols` instead of the service-wide protocol union.
* **F7 MCP:** `server.js`'s `vendor_budget_impact.inputSchema` uses
  `z.record(z.any())`; replace it with a bounded pricing snapshot schema that
  agrees with HTTP admission. Actual current Zod 3.25.76 construction works.
  Separately, `mcp-server.mjs` `httpRouteToolHandler` attaches error/challenge
  payloads as `structuredContent` under a success-only output schema.
  SDK 1.30.0 `Client.callTool` validates any present structured content even
  when `isError:true`, producing `-32602` and hiding the normal challenge from
  the caller. Keep the existing challenge metadata/content and make error
  output compatible, for example by omitting success-shaped structured content
  on non-2xx results. Preserve the typed-telemetry payment-required classifier,
  which currently reads `structuredContent`; changing that carrier requires
  updating the classifier too. Do not remove successful output validation.
* **F7 attestation:** `service-deployment-routes.mjs` omits
  `POST /vendor-budget-impact`; the live served statement therefore cannot
  verify that route, while `GET /extract` verifies with the same key/offer/time.
  `service-deployment-publication.mjs` validates only the static declared set
  and assumes its routes all share both protocols. Define exact route/protocol
  coverage for the enabled vendor feature, fail release acceptance when its
  advertised statement lacks that coverage, and have the authorized owner
  regenerate the signed statement in the separate signing workflow. Merely
  adding the route to the static list invalidates the existing envelope and
  overstates MPP coverage if it keeps the dual-protocol cross product.

No production repair is included in this branch.
