# Root-sends-only drafts

Do not post these from this session. Root owns contact. Prefer the packets if a reply would be noise.

## aibtcdev/aibtc-mcp-server#666 (optional)

Issue #666 is still open on `main`. `execute_x402_endpoint` still takes `txid` only from body `txid` / `payment_txid` and `x-transaction-id` (checked 2026-09-10 against current `src/tools/endpoint.tools.ts`). That misses x402 V2 `payment-response` (`transaction`) and the Vibewatch `payment.txid` envelope.

PR #667 already adds those two locations and is not merged. This session did not open a competing PR.

A portable offline decoder (SameDayDesk experiment tree, no payment) recovers:

- V2 `payment-response` and V1 `x-payment-response`
- body `txid`, `payment_txid`, `payment.txid`, `payment.transaction`
- MCP `_meta["x402/payment-response"]`

It labels **provided-report** vs **independently observed**, and reports **conflict** when header and body disagree. Against the published #666 shape, `aibtc_main` stays `null` while the portable lookup returns the reported txid. Independently, an unpaid GET to the Vibewatch URL in the issue still returns HTTP 402 x402 v2 with `maxTimeoutSeconds` 45. This session did not pay and did not observe settlement.

If #667 merges, the remaining gaps vs the portable lookup are V1 `X-PAYMENT-RESPONSE`, MCP meta, and conflicting body-vs-header txids (PR #667 prefers body `txid`).

No purchase, no budget, and no request for merge authority is implied.

## coinbase/cdp-sdk#806 (optional, only if root is already in that thread)

Independently re-checked 2026-09-10T09:14:12Z, unpaid:

`POST https://api.cdp.coinbase.com/platform/v2/x402/validate` for `https://fractalai.net.co/api/x402/sign` returned `valid: true`, `simulation.outcome: accepted`, Bazaar present, `index: null`. An unsigned POST to the resource still returns HTTP 402 with a Bazaar extension.

That matches the issue’s “validates but never indexed” report. It does not prove or repeat a paid settlement. Valid is not indexed. No catalog insertion is claimed.
