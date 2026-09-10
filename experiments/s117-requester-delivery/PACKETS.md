# S117 packets

Ranked requester → need → working artifact → delivery channel → next measurable event. Dates are source dates. Evidence classes are `provided_report` (public thread, this session did not execute the paid call) vs `independently_observed` (this session obtained the artifact without paying).

A local green test is not an upstream merge, a paid delivery, or consent.

## 1. aibtcdev/aibtc-mcp-server#666 — V2 settlement txid reported as null

- **Requester / date:** sonic-mast, 2026-09-09. License unknown.
- **Source:** https://github.com/aibtcdev/aibtc-mcp-server/issues/666
- **Need:** `execute_x402_endpoint` currently reads only body `txid` / `payment_txid` and header `x-transaction-id` on `main` (verified 2026-09-10 against https://raw.githubusercontent.com/aibtcdev/aibtc-mcp-server/main/src/tools/endpoint.tools.ts). x402 V2 puts settlement in `PAYMENT-RESPONSE` (`transaction`). Vibewatch also returns `payment.txid`. The tool therefore emits `txid: null` plus a recovery hint that sends the agent looking for a txid already in the same response.
- **Current thread:** OPEN. PR https://github.com/aibtcdev/aibtc-mcp-server/pull/667 (2026-09-09, not merged) already claims the two-location fix with tests. This session did not open a competing PR.
- **Working artifact:** `src/settlement-txid.mjs` + `fixtures/settlement/aibtc666-provided-report.json`. Recovers V2 `payment-response`, V1 `x-payment-response`, body `txid` / `payment_txid` / `payment.txid` / `payment.transaction`, MCP `_meta["x402/payment-response"]`, and `x-transaction-id`. Labels evidence class. Reports **conflict** when sources disagree. Simulates `aibtc_main` (misses) vs `aibtc_pr667` (recovers V2 header + `payment.txid`, still misses V1 header and MCP meta, prefers body `txid` over a conflicting header).
- **Independently observed (unpaid):** 2026-09-10T09:14:12Z GET https://api.vibewatch.io/api/v1/public/stacks-index/pro/projects/bitflow-finance-af3b → HTTP 402, `PAYMENT-REQUIRED` x402 v2, `maxTimeoutSeconds` 45, stacks:1 sBTC/STX. Well-known https://api.vibewatch.io/.well-known/x402.json is live. Settlement was **not** independently observed (no payment).
- **Delivery channel:** packet + optional `LUMEN_OR_REQUESTER_REPLY.md` (root sends).
- **Next measurable event:** maintainer merge of #667, or aibtc `main` lookup returning a non-null txid on a V2 `payment-response` fixture.
- **Free vs paid:** free local diagnostic. Not a substitute for the pending PR. No budget or payout is claimed.

## 2. Merit-Systems/x402scan#922 — V1-only settlement header

- **Requester / date:** chenshj73, 2026-05-23 (older than the 2026-09-07 cutoff; kept because it is still OPEN with no linked PR and is the inverse miss of packet 1). License unknown.
- **Source:** https://github.com/Merit-Systems/x402scan/issues/922
- **Need:** `use-fetch.ts` reads `x-payment-response` only. V2 `PAYMENT-RESPONSE` is a different header name (`x-` prefix is not case-folding). V2 settlements can yield `paymentResponse: null`.
- **Working artifact:** same decoder. `merit_x402scan_v1_only` recovers V1 and misses V2; portable recovers both.
- **Delivery channel:** packet. Root owns contact.
- **Next measurable event:** x402scan reads `payment-response` as well as `x-payment-response`.
- **Free vs paid:** free diagnostic. Issue is stale relative to the cutoff; do not spam.

## 3. x402-foundation/x402#3439 — Go/Python routeTemplate still single-pass

- **Requester / date:** PhilBot402, 2026-09-10. Apache-2.0 upstream.
- **Source:** https://github.com/x402-foundation/x402/issues/3439
- **Need:** TypeScript `isValidRouteTemplate` now decodes to a fixed point before `..` / `://` checks (merged https://github.com/x402-foundation/x402/pull/3213 on 2026-09-09). Go/Python still do one `PathUnescape` / `unquote` pass, so `%252e%252e` can catalog-poison.
- **Current thread:** OPEN. https://github.com/x402-foundation/x402/pull/3440 (Python) and https://github.com/x402-foundation/x402/pull/3441 (Go) already claim the port. Do not compete.
- **Working artifact:** `src/route-template.mjs`. Same bounded 5-pass algorithm as TS main. Compares single-pass vs fixed-point on the public #3213 payloads.
- **Delivery channel:** packet. SameDayDesk `bazaar-contract-audit.mjs` can consume the comparison later; not wired into live routes.
- **Next measurable event:** #3440/#3441 merge, or Go/Python rejecting `/foo/%252e%252e%252fsecret`.
- **Free vs paid:** free checker. Upstream ports already exist.

## 4. x402-foundation/x402#3439 + public timeout/retry note — paid call abort then retry

- **Requester / date:** same #3439 MCP half, 2026-09-10; public note https://x.com/jrcrypto_dev/status/2097948157153869918 (2026-09-10).
- **Need:** TypeScript `@x402/mcp` sizes paid tool-call timeouts from `accept.maxTimeoutSeconds` (default 300s). Go/Python still forwarded the MCP SDK 60s default, so slow-finality settlements abort. A timeout is not proof that settlement failed; unguarded retry can pay twice.
- **Current thread:** https://github.com/x402-foundation/x402/pull/3442 (Go) and https://github.com/x402-foundation/x402/pull/3443 (Python) already claim the timeout port. Do not compete.
- **Working artifact:** `src/paid-call-timeout.mjs`. Independently observed Vibewatch `maxTimeoutSeconds=45` is covered by a 60s default; the 300s vs 60s case is still abort-before-window. Retry is unsafe until settlement is observed.
- **Delivery channel:** packet. SameDayDesk already has `idempotency-replay.mjs`; this classifier does not replace it.
- **Next measurable event:** #3442/#3443 merge.
- **Free vs paid:** free classifier. Not a wallet-layer idempotency product.

## 5. openclaw/clawhub#3621 — hung well-known agent-skills fetch

- **Requester / date:** SebTardif, 2026-09-07. License unknown.
- **Source:** https://github.com/openclaw/clawhub/pull/3621
- **Need:** GET/HEAD `/{owner}/skills/{slug}/.well-known/agent-skills/index.json` fetched Convex with no abort signal. PR adds `AbortSignal.timeout(10s)`. ClawSweeper blocked merge: supplied Bun trace used an 80ms stand-in and did not prove a real stalled HTTP origin.
- **Working artifact:** `src/hung-upstream.mjs`. Local HTTP server accepts and never responds; `AbortSignal.timeout` rejects with `TimeoutError` inside the budget. Successful GET against a completing origin is unchanged.
- **Delivery channel:** packet. Do not comment on the PR.
- **Next measurable event:** clawhub merge after they attach their own transport proof.
- **Free vs paid:** free proof recipe. SameDayDesk `well-known-skills.mjs` is a different surface.

## 6. JustaName-id/jaw-mono#319 — unreadable spend limit skipped

- **Requester / date:** mariano-aguero, 2026-09-07. Owner PR in review. License unknown.
- **Source:** https://github.com/JustaName-id/jaw-mono/pull/319
- **Need:** `jaw x402 status` ranked an unreadable allowance out and printed the next healthy remaining as `ready: true` while `checkPolicy` refused every payment. The binding limit is the unreadable one (zero room).
- **Working artifact:** `src/tightest-spend-limit.mjs`. Unreadable remaining binds as `0`; `ready` is false if any limit is unreadable.
- **Delivery channel:** packet. Do not compete with the owner PR. Maps to SameDayDesk wallet-policy conformance as a later optional observation, not a live-route change.
- **Next measurable event:** #319 merge.
- **Free vs paid:** free reduction of the published rule.

## 7. coinbase/cdp-sdk#806 — validates, settles (reported), still not indexed

- **Requester / date:** johnInarti, 2026-09-05 (two days before cutoff; independently re-observed 2026-09-10). License unknown.
- **Source:** https://github.com/coinbase/cdp-sdk/issues/806
- **Need:** FractalAI `https://fractalai.net.co/api/x402/sign` (and `/witness`) pass CDP `/validate` including Bazaar checks and (per requester) have settled via the CDP facilitator, but `index` stays empty.
- **Independently observed 2026-09-10T09:14:12Z (unpaid):** POST `/validate` for `/api/x402/sign` → `valid: true`, `simulation.outcome: accepted`, bazaar present, **`index: null`**. Unsigned POST to the resource returns HTTP 402 with a Bazaar extension. This session did not pay and did not see a settlement.
- **Working artifact:** `src/validate-index.mjs` + `fixtures/unpaid-observations/fractalai-validate-summary.json`. Decision `validates_but_not_indexed`. Valid is not indexed.
- **Delivery channel:** packet. Root owns contact. SameDayDesk bazaar-contract-audit already checks 402 shape; it cannot force CDP catalog insertion.
- **Next measurable event:** `/validate` for that resource returns a non-null `index`, or CDP documents a longer initial-index window / allowlist.
- **Free vs paid:** free unpaid classifier. Indexing is a CDP process; do not sell a fake index repair.

## 8. KG-NINJA/HyperXosist-Agent#32 — Bazaar 402 repaired, still not indexed

- **Requester / date:** KG-NINJA, 2026-09-07. Draft PR.
- **Source:** https://github.com/KG-NINJA/HyperXosist-Agent/pull/32
- **Need (original):** live `POST https://api.kgninja.dev/hyperxosist-query` 402 lacked the Bazaar extension. The draft stages a seller-side fix and explicitly says a local test is not production repair.
- **Current thread:** owner later reported an out-of-repo seller repair; official validation accepted; index still missing. Do not merge/deploy the draft as a second repair.
- **Independently observed 2026-09-10T09:14:12Z (unpaid):** HTTP 402 with Bazaar extension present. CDP `/validate` → `valid: true`, bazaar present, **`index: null`**.
- **Working artifact:** same validate-vs-index classifier + `fixtures/unpaid-observations/hyperxosist-validate-summary.json`.
- **Delivery channel:** packet. Residual is catalog insertion, not another 402 rewrite.
- **Next measurable event:** non-null `index` for that resource.
- **Free vs paid:** free observation. Paid follow-on would require seller/CDP authority; none is claimed.

## Negatives / already covered (do not redo)

| Source | Status | Why not a new delivery |
| --- | --- | --- |
| Basepay composition / MetaMask agent-skills#17 | Delivered (merchant PR51 / comment 5615432739) | Do not redo |
| coinbase/agentkit#813 | Delivered | Do not redo |
| modelcontextprotocol/servers#4785 | OPEN; wants maintainer string updates | Not another 214369 download report |
| langchain-ai/langchain#40333 | OPEN; WalletForge adapter awaiting maintainer | Do not compete |
| Tracer#125 | Covered by maintainer PR#126 | Do not compete |
| Merit#13 signed selection | Waiting provider key/fixture | Blocked |
| Agensi/Grexal/Dealwork seller setup | S109 / Bot team | Do not duplicate |
| InterAILabs/ai-risk-oracle#18 | Owner draft PR 2026-09-10 | Not an external ask for us |
| Abuchtela/BasePulse#54 | Owner PR for their buyer module | Not an external residual |
| x402-foundation/x402#3442/#3443 | Open PRs for MCP timeout ports | Recorded under packet 4; do not compete |
| x402-foundation/x402#3208 | OPEN feature (Aug 19) | Vocabulary request; packet 1 already distinguishes settled / pending / unobservable / conflict without claiming a spec change |
| Old archived 2025 EIN Reddit lead | Not current | Dropped |
| Old galleries | Closed | Dropped |
