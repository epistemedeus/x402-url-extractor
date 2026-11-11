# Maintained Base composition: inert compatibility, live no-fit

Decision: keep live authorization closed. The stock graph executor and current
official payment transport compose on a standard, complete legacy Base quote.
The actual observed NanoGPT quote is not that complete SDK input, and the
maintained caller does not durably recover the original authorization after a
lost response. This fixture adds neither a signer nor a financial state machine.

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

## Why live admission remains closed

1. **Actual quote shape.** Three bounded unsigned diagnostic invocations each
   made one stock-graph POST to the assigned chat endpoint and received 402,
   with zero signer-boundary calls or paid retries. The final safe field
   inventory records legacy `exact` / `base` at 1,000 atoms, but no `asset` or
   `maxTimeoutSeconds` fields in that legacy option. Its resource string does
   not equal the requested target. No resource URL, pay-to address, payment ID,
   token or full quote is published. Current `@x402/core` spend filtering and
   the EVM v1 mechanism need those fields. A synthetic structural reproduction
   refuses before the hook/signer. No fields are invented from labels or a
   cheaper direct-deposit amount.
2. **Request binding.** The fixture checks the actual method, URL, body bytes,
   graph input, model, low effort and 400-token maximum, plus quote resource,
   expiry and input-hash presence. Mock-server body-hash equality is explicitly
   synthetic. It is not the provider's canonical hash algorithm or proof that
   an arbitrary advertised hash binds this body. The live probe cannot pass
   that final binding gate. NanoGPT's [current contract](https://docs.nano-gpt.com/api-reference/miscellaneous/x402)
   distinguishes exact replay from unique-address quote-and-complete flows.
   The latter's completion URL is not a recovery API for the exact rail.
3. **Original-operation recovery.** In the real maintained v1 mechanism,
   `createNonce()` runs for every new payload. A synthetic paid-response loss
   ends in the stock `RunError.result`; rerunning that same Workflow creates
   another nonce and another dummy authorized request. The v1 HTTP result
   path also bypasses v2 response-recovery hooks. SDK spend controls are per
   payment, not a durable graph-wide reservation or pay-once authority.
   Reconstructing a client or rerunning a graph is not readback.

The shortest missing owning integration is a seller-supported, complete Base
exact quote/binding contract (or a maintained documented adapter), plus the
caller's existing durable boundary that seals the exact request, quote and
authorization before dispatch and receives the original outcome after loss.
The seller's exact-result recovery semantics must also be received. Do not
implement another ledger here or use a new authorization to discover what the
old one did. Paid fulfillment and recovery remain unreceived.

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

The 20 offline controls execute the actual selected packages and stock graph:
normal Base v1 selection, direct-rail separation, wrong chain/asset, actual
atomic amount above the cap, expiry and authorization window, missing/changed
input/resource bindings, interrupted authorization, unknown-response rerun,
v1 hook behavior and the first-party SDK quote-only boundary. No valid
signature, broadcast, completion URL, live paid route or buyer task runs.

`quote-only.mjs` is an optional, separate one-shot diagnostic, never run by CI.
Its current receiving exits 1 because the composition is not admitted. It
prints sanitized structure and coded refusals, never full quote identity.
This is expected no-fit evidence, not a paid test failure to retry until green.

The original stock receiver and its earlier
[failed result receiver](https://github.com/epistemedeus/x402-url-extractor/actions/runs/43066541750)
and [corrected receiving](https://github.com/epistemedeus/x402-url-extractor/actions/runs/43066895425)
remain preserved. The correction receives `RunError.result`; it does not make
the stock Nano payment callback a Base client.

Next useful step: receive the missing Base exact quote/adapter and
same-original-operation recovery contracts, then replay these inert controls.
A later separately admitted live test needs its own original-request budget
and receiving. No bid, award, paid completion, customer benefit or margin is
established by this experiment.
