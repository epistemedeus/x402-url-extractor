# Maintained Base composition: canonical-host quote comparison

Decision: the one canonical-host observation still does not fit the selected
maintained client. This is a bounded quote/SDK (software development kit)
compatibility result for this fixed request, not a provider-wide payment claim.
Live authorization remains closed. A bounded future one-shot trial may stop on
an unknown outcome without recovering or buying another authorization. It does
not require a universal exactly-once framework.

## Canonical host received

The [official accountless contract](https://docs.nano-gpt.com/api-reference/miscellaneous/x402)
names `https://api.nano-gpt.com` as normal; `https://nano-gpt.com` is its IPv6
alternative. It reports a Base exact payment on the canonical host as of
November 7. That documented success and this client's input compatibility are
separate observations. The original assignment used the alternative.

One stock-executor unsigned POST was made to the canonical host, with the same
synthetic input, `z-ai/glm-5.3-flash`, low effort, 400-token cap, `apiKey:null`
and `x-x402:true`. It returned 402 and the normal `RunError.result`, with zero
selection-hook calls, signer-boundary calls or paid requests.

| Safe observed field | Earlier alternative host | Canonical normal host |
| --- | --- | --- |
| Legacy version / scheme / network | 1 / exact / base | 1 / exact / base |
| Exact atomic amount | 1,000 | 1,000 |
| Legacy `asset` / `maxTimeoutSeconds` present | no / no | no / no |
| Legacy resource equals actual target | no | no |
| Request hash / expiry present | yes / yes | yes / yes |
| SDK selection / authorization calls | 0 / 0 | 0 / 0 |

The canonical stable `payment.accepted[]` `x402-exact` / `base` option also
lacks `asset` and `maxTimeoutSeconds`; its atomic amount is 1,000. It is not a
complete alternate standard input. The cheaper unique-address rail is distinct.
No missing field or provider hash algorithm is inferred.

`evidence/live-01.json`, `live-02.json`, `live-03.json` and the original
20-case TAP remain unchanged. New sanitized evidence is under
`evidence/canonical/`. The single allowed canonical capability GET returned 200,
but this receiver did not recognize its matrix container. It records
`capability_shape_unreceived`, makes no membership claim and was not retried.
There were exactly one capability GET and one quote POST in this follow-up.

## Recommended normal stack

Use stock `nanoodle` 0.13.0 at
[`edd757fe2d5185072a53e43fbfd861c9a5400158`](https://github.com/nanoodlecom/nanoodle-js/tree/edd757fe2d5185072a53e43fbfd861c9a5400158)
with the fetch hook supplied to `Workflow.fromJSON(graphObject, options)`.
Select `@x402/fetch`, `@x402/core` and `@x402/evm` 2.30.0, whose release tags
all resolve to
[`3414a56618e94f5aeff1c03295f7d5879a56157a`](https://github.com/x402-foundation/x402/tree/3414a56618e94f5aeff1c03295f7d5879a56157a).
The exact dependency lock is included. Use
`registerExactEvmScheme(client, {signer, networks:['eip155:8453']})`; this
maintained registrar also registers the v1 `exact` / `base` scheme. Restrict
the asset to native Base USDC and use the SDK's integer atomic per-payment cap.
The fixture's cap is 1,000 atoms, independently of any dollar display estimate.

The stock executor checks that keyless network runs have a payment callback,
and that callback enables `x-x402:true`. Set `apiKey:null` explicitly and give
the stock Nano callback an unconditional refusal. The injected x402 fetch
transport handles a compatible Base quote before stock `parseNanoInvoice`.
Do not translate a direct `base-usdc` deposit or its payment ID into an exact
authorization. Do not replace the graph engine or call the provider manually
instead of executing the graph.

`probe.mjs` is an inert integration fixture, not a live payer. It has no key or
wallet input. Its only signature-shaped output is 65 zero bytes for the fixed
synthetic origin. A payment header targeting the live origin is refused before
transport. All graphs and inputs here are synthetic, not a customer's work.

## Exact remaining compatibility seam

The immediate failure is in the selected `@x402/core` 2.30.0
`findSpendControlAssetEntry`: `requirement.asset.toLowerCase()` cannot consume
an absent legacy asset. It occurs before policies/selection hooks or signer
access. Source: [`x402Client.ts`](https://github.com/x402-foundation/x402/blob/3414a56618e94f5aeff1c03295f7d5879a56157a/typescript/packages/core/src/client/x402Client.ts).
The EVM (Ethereum Virtual Machine) v1 mechanism also needs an explicit asset
and timeout. Disabling spend controls, inferring USDC from `base`, filling a
timeout, or changing the quote's resource would hide the missing contract.
A synthetic structural reproduction exercises this same actual SDK failure.
The provider-ready reproduction and sanitized field inventory are in
[CANONICAL-REPRO.md](CANONICAL-REPRO.md).

The fixture independently requires resource equality, absolute expiry and
request-hash presence. Its mock-server body-hash equality is synthetic, not
NanoGPT's canonicalization. A seller-supported complete Base exact requirement
and request-binding contract, or a maintained documented adapter, is the useful
next input. No additional live probe is needed to restate the present failure.

## One-shot policy, separate from quote compatibility

Invoke the stock workflow once. If authorization or its response is interrupted,
stop and report unknown. Do not rerun that graph or create another authorization
to learn what happened. No recovery guarantee or framework is claimed here.
A new focused control executes one synthetic potentially authorized request,
loses the response and proves no automatic second authorization. The original
explicit-rerun counterexample remains: choosing to run again creates a new nonce.
That is a warning about a retry choice, not a requirement for every bounded trial
to implement durable recovery before it can be considered.

The existing observation that the v1 HTTP path bypasses v2 response hooks also
remains. Exact replay and unique-address quote-and-complete are different rails;
the latter's completion URL is not an exact-result receiving API. These facts do
not change quote conformance or authorize spending. A later separately budgeted
one-shot trial would still need a compatible quote and qualified request binding.

## Other actual clients inspected

| Client | Actual source | Result |
| --- | --- | --- |
| `x402-fetch` 1.2.0 | npm archive integrity in evidence; release tag resolves to `f78b268a76e739dd980ff26a50b981d1d3f0e4ef` | Parses legacy accepts, caps atomic value and creates a header; no durable original-operation store. Source inspected, not selected for execution. |
| `@nanogpt/sdk` 0.1.0 | Exact npm archive and lock, including published `dist/index.js` | Executed with inert transport. Receives 402 and offers quote intent keys; it does not pay. Its published README limits server quote-key deduplication to Lightning. No Base recovery is inferred. |
| x402 payment-identifier extension | `extensions/src/payment-identifier/client.ts` at the selected 2.30.0 commit | Requires a server declaration and describes v2 payload enrichment. Not evidence of supported Base v1 result recovery on this route. |

## Reproduce the native controls

Use Node 24.22.1 and a clean exact public executor checkout. No upstream build
is needed because nanoodle has zero runtime dependencies.

```sh
task_source=$(mktemp -d)
git -C "$task_source" init --quiet
git -C "$task_source" remote add origin https://github.com/nanoodlecom/nanoodle-js.git
git -C "$task_source" fetch --quiet --depth=1 origin edd757fe2d5185072a53e43fbfd861c9a5400158
git -C "$task_source" checkout --quiet --detach FETCH_HEAD
npm --prefix verification/nanoodle-quote/base ci --ignore-scripts --no-audit --no-fund
NANOODLE_SOURCE="$task_source" npm --prefix verification/nanoodle-quote/base test
```

The 27 offline controls execute the actual selected packages and stock graph:
normal Base v1 selection, direct-rail separation, wrong chain/asset, actual
atomic amount above the cap, expiry and authorization window, missing/changed
input/resource bindings, interrupted authorization, unknown-response rerun,
v1 hook behavior and the first-party SDK quote-only boundary. No valid
signature, broadcast, completion URL, live paid route or buyer task runs.

`quote-only.mjs` is an optional, separate one-shot diagnostic, never run by CI.
Its canonical receiving exits 1 with `sdk_missing_legacy_asset` before selection. It
prints sanitized structure and coded refusals, never full quote identity.
This is expected no-fit evidence, not a paid test failure to retry until green.

The original stock receiver and its earlier
[failed result receiver](https://github.com/epistemedeus/x402-url-extractor/actions/runs/43066541750)
and [corrected receiving](https://github.com/epistemedeus/x402-url-extractor/actions/runs/43066895425)
remain preserved. The correction receives `RunError.result`; it does not make
the stock Nano payment callback a Base client.

Next useful step: receive the complete canonical Base exact quote/binding
contract or supported adapter, then replay the inert controls. Root owns any
later separately budgeted one-shot live action. No bid, award, paid completion,
customer benefit or margin is established by this experiment.
