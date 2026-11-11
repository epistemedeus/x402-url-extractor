# Base deposit: conditional source fit, no live financial qualification

The documented `base-usdc` deposit/complete sequence can feed the unchanged
stock executor through its normal fetch injection. The synthetic normal caller
reaches `result.get('n2') === 'base-transport-control'`. No Nano invoice is
fabricated. This fixture has no wallet, signing, transfer or live effect port.

The actual canonical quote is received, but a funded trial remains unqualified:
its asset is declared as USDC by the documented rail and formatted amount; the
option itself supplies no token contract or chain-ID metadata. The fixture's
stronger independent asset-identity gate cannot pass that live input. This is
not a claim that an `asset` property is mandatory in the documented deposit
format or that the provider cannot accept deposits. The positive synthetic quote
explicitly supplies identity that the live observation did not receive.

## Actual sources and maintained client choice

- Official current [accountless contract](https://docs.nano-gpt.com/api-reference/miscellaneous/x402):
  primary `payment.accepted[]`; choose the Base deposit option and its own
  status/completion URLs. Status polling is distinct from exact endpoint replay.
  Its November 7 note reports no completed canonical-host Base deposit payment.
- Stock nanoodle 0.13.0, Node 24.22.1, Git
  [`edd757fe2d5185072a53e43fbfd861c9a5400158`](https://github.com/nanoodlecom/nanoodle-js/tree/edd757fe2d5185072a53e43fbfd861c9a5400158).
  Actual `src/client.mjs`, `src/x402.mjs`, `src/workflow.mjs` and
  `tests/x402.test.mjs` were read. Its maintained settlement helper is Nano-only;
  its fetch hook accepts a replayed normal response without changing the graph.
- First-party `@nanogpt/sdk` 0.1.0, exact archive/lock already received in
  `../base/evidence/source-receiving.json`. Its actual published implementation
  receives quotes but never pays them. It has no Base deposit completion adapter.
  No new package is installed or maintained SDK reimplemented here.
- The older official [direct-transfer shell example](https://cake.nano-gpt.com/blog/blog-x402-nanogpt)
  identifies the legacy `usdc-base` option and completion sequence. It is an
  example, not a maintained graph transport or proof of a canonical paid result.
  The current primary envelope takes precedence; old missing opt-in examples
  are not copied as executable instructions.

## What the one allowed quote actually received

The original synthetic graph/input/model, low effort and 400-token cap were used,
with explicit `apiKey:null` and `x-x402:true`. One unsigned stock-graph POST to
`https://api.nano-gpt.com/api/v1/chat/completions` returned 402. No capability GET,
status call, completion call or deposit callback was made in this task.

| Field | Actual safe observation |
| --- | --- |
| Primary rail / protocol / network | base-usdc / usdc-base / base |
| Atomic amount / formatted units | 135 / 0.000135 USDC |
| Destination | Present, valid Ethereum address shape; value not exported |
| Option payment ID | Present; value not exported |
| Status and completion URLs | Canonical origin, each exact path bound to that option's ID |
| Option expiry | String, present and future at observation |
| Primary request hash | Present, hash shape; value/algorithm not exported or invented |
| Generic primary ID versus Base ID | Different |
| Primary versus legacy top-level hash | Different |
| Explicit token contract / chain ID / token decimals | Absent |
| Paid status and completion result | Unreceived |

Do not borrow the generic primary payment ID/URLs for the Base option. Do not
compare two different hash envelopes as if they had a received shared algorithm.
The fixture carries `payment.requestHash` as an opaque primary value alongside
the exact original method, URL and body captured by fetch. Its own body digest
binds the inert acknowledgement to that captured request; it is not advertised
as the provider's hash algorithm. The server-side stored-request association is
a documented contract, not independently verified by this unsigned quote.

## Smallest composition and normal native command

Prepare the same exact clean public executor checkout described in
[the existing recipe](../base/README.md). Reuse the existing locked dependencies:

```sh
npm --prefix verification/nanoodle-quote/base ci --ignore-scripts --no-audit --no-fund
NANOODLE_SOURCE="$EXACT_NANOODLE_CHECKOUT" node --test --test-reporter=tap verification/nanoodle-quote/deposit/fixture.test.mjs
```

To receive only the positive normal caller and its actual text output:

```sh
NANOODLE_SOURCE="$EXACT_NANOODLE_CHECKOUT" node --test --test-name-pattern='stock text graph consumes' verification/nanoodle-quote/deposit/fixture.test.mjs
```

`fixture.test.mjs` contains the complete disposable transport and inert
acknowledgement. The actual composition is:

```js
const fixture = createDepositFixture({transport, acknowledgeDeposit, budgetAtomic:'1000'});
const workflow = Workflow.fromJSON(structuredClone(graph), fixture.workflowOptions);
const result = await workflow.run({Idea: INPUT});
const text = result.get('n2');
```

The adapter uses the existing public synthetic graph and stock fetch injection.
The ordinary Nano callback remains an unconditional refusal, never the Base
acknowledgement. The injected transport returns the completion's validated chat
response directly to `NanoClient.chat`, which produces the stock graph output.
Only the fixed synthetic origin can enter this fixture's effect path. The live
quote-only executable has no status/completion port.

The 43 native cases cover valid pending/paid/completion, option separation,
wrong or duplicate rail/network/asset, integer and formatted units, budget,
option expiry, destination shape, exact URL/operation binding, input binding,
malformed output, unknown acknowledgement/status/completion, underpayment,
processing/already-completed states, bounded polling, expiry during acknowledgement
and attempted rerun. The exact original graph checkout must be clean and pinned.

## One-shot boundary and remaining receiving

A deposit acknowledgement is only an inert synthetic callback result. It is not
a chain receipt or spend authorization. Unknown acknowledgement or completion
ends this invocation. The same fixture rejects another graph fetch. No second
payment, original-endpoint replay, retry of completion, new graph, process restart
recovery, ledger or durable exactly-once claim is supplied. Retain the original
operation privately for Root's receiving if any later admitted live trial ends
unknown; do not create a fresh authorization to discover its outcome.

For this conservative boundary, Root must first receive authoritative mapping of
the declared Base-USDC deposit rail to the intended token contract, and qualify
the status/complete response contract for the original option. Any supported
adapter for a label-only quote must preserve provenance rather than invent an
`asset` wire field. A future source amendment would belong in this small parser,
not the executor, retired financial sender or a new ledger. Root alone owns any
separately budgeted funded trial and actual wallet authority.

Evidence includes the full sanitized quote, complete final TAP (Test Anything
Protocol), original failed assertion log and command/exit receipt. The first
native run had 41/42 passing: the success assertion counted both stock output
aliases as distinct outputs. It was corrected to the normal `get('n2')`
accessor. No transport or payment behavior was changed to make that case pass.
The finite existing workflow adds only this synthetic suite. All exact-rail
source, failed observations and earlier evidence remain byte-identical.
