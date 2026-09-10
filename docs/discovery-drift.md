# Discovery ↔ live unpaid payment drift

Provider-neutral library and CLI. It is **not** a hosted route, MCP tool,
daemon, or paid service. It reuses `payment-offer-preflight`,
`evaluateOfferCoherence`, `evaluateListingIdentity`, Bazaar merchant discovery,
and seller-integrity economics adapters.

It compares registry/catalog discovery with live unpaid 402 requirements for
**resource**, **network**, **asset**, **amountAtomic** (string exact), and
**observation freshness**. Statuses are observations, not resolved causes.

## Operator command

Copy-paste, unpaid, credential-free:

```bash
node discovery-drift.mjs observe --url 'https://agent-economy-signal-x402-mainnet.bronzetti-andrea.workers.dev/premium/agent-brief' --bazaar-pay-to '0xbda48b29607b9dc66ef7e38b68ad53f2b17efb23'
```

Recorded T1 S94 replay (no network, does not claim reindex):

```bash
node discovery-drift.mjs replay-t1
```

Repeat-change of two saved reports (no fetch, no daemon):

```bash
node discovery-drift.mjs change --before before.json --after after.json
```

`--stale-ms` is an explicit freshness horizon. Without it, `lastUpdated` lag
stays **unknown**, not a proved stale-price cause.

## Semantics

- Preserve raw observations and unknowns.
- `observedMatch` is not `resolvedCause`.
- Never convert units across assets or decimals.
- Never follow redirects; never send credentials or payment.
- `stale` means observation freshness vs a caller horizon, not a reindex
  result and not a proved stale-price cause from `lastUpdated` alone.

Offer comparison includes every unambiguously joined offer. Extra offers are a
mismatch; ambiguous joins, truncated inputs, incomplete pages and invalid live
offers cannot establish a match. Atomic zero is known. Missing amounts or
network/asset identifiers remain unknown. Only hexadecimal address identifiers
are compared without case sensitivity.

Catalog acquisition reads one fixed Coinbase merchant page, with no automatic
pagination or source-provided URL traversal. Returned pagination and single-page
coverage are recorded. The response is streamed under a 250,000-byte cap and a
10-second deadline. Redirects, non-200 responses and merchant identity mismatches
fail. Saved JSON inputs have the same byte cap. Live resource probes reuse the
existing public-host and redirect restrictions in payment-offer-preflight.

Missing capture times are not replaced with the current time. A freshness
horizon also checks capture age; absent or future dates remain unknown.
Successive observations compare all offers, source names and resource identities.
Unrelated sources or reverse chronology yield an unknown comparison. Exit zero
means a report was produced, including mismatch/unknown reports; invalid input or
acquisition failure exits nonzero. This is one-shot execution, not a watcher.

## Recorded T1 case

Recorded case for [coinbase/cdp-sdk#813](https://github.com/coinbase/cdp-sdk/issues/813).
These saved captures describe their observation time, not current issue status.

Observed 2026-09-10T07:21:38Z, unpaid public GET only. Exact resource match.

- Live 402 on `…/premium/agent-brief`: amountAtomic **20000**, payTo `0xbda48b29607b9dc66ef7e38b68ad53f2b17efb23`, Base USDC.
- Bazaar merchant discovery for that payTo: same resource URL, amountAtomic **20000**.

The captured indexed amount **matches** captured live 20000. This observation did not reindex Bazaar or verify settlement.

The capture records `lastUpdated=2026-09-09T18:21:18.178Z` (before the issue’s `created_at`). Its lag does not establish a cause. Other discovery surfaces were not exhaustively searched.

The same unpaid compare can be re-run with the operator command above.
