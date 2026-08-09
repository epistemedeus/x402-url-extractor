# SameDayDesk x402 and MPP Data Gateway

[![Smithery listing](https://smithery.ai/badge/epistemedeus/x402-data-gateway)](https://smithery.ai/servers/epistemedeus/x402-data-gateway)

Twelve pay-per-call tools for deterministic agent-work opportunity preflight,
Morpho borrower and market decisions, protection plans, URL extraction,
Markdown reading, repository security scans, company and wallet enrichment,
structured data generation, and AI-search readiness audits.

- Product page: https://samedaydesk.com/x402
- Smithery: https://smithery.ai/servers/epistemedeus/x402-data-gateway
- Remote MCP: https://agents.samedaydesk.com/mcp
- Live resource manifest: https://agents.samedaydesk.com/.well-known/x402
- OpenAPI: https://agents.samedaydesk.com/openapi.json
- Skill contract: https://agents.samedaydesk.com/skill.md
- Action catalog: https://agents.samedaydesk.com/api/actions
- A2A agent card: https://agents.samedaydesk.com/.well-known/agent-card.json
- Global A2A Registry: https://www.a2a-registry.org/agent/9cb0b8e6-cb1f-422b-a604-861d0a79e24b
- Settlement Radar: https://agents.samedaydesk.com/platforms
- Platform health JSON: https://agents.samedaydesk.com/v0/cards.json
- Aggregate machine-demand telemetry: https://agents.samedaydesk.com/v0/commerce-demand.json
- Morpho position risk: `GET /defi/morpho-position?address=0x...&shocks=-10,-20,-30`
- Morpho protection quote: `GET /defi/morpho-protection?address=0x...&targetHealthFactor=1.25&protectAgainstShockPct=-10`
- Morpho market underwriting: `GET /defi/morpho-market-underwrite?marketId=0x...`
- Morpho PreLiquidation replay: `GET /defi/morpho-preliquidation-replay?transactionHash=0x...`
- Opportunity preflight: `GET /work/opportunity-preflight?rewardUsd=10&hours=0.25&hourlyCostUsd=4&selectionProbabilityPct=20`
- Material-change alert probe: https://agents.samedaydesk.com/alerts
- Agoragentic seller callback: `POST /integrations/agoragentic/ai-readiness-audit`
- the402 signed fulfillment webhook: `POST /integrations/the402/webhook`

No API key or subscription is required. Every paid HTTP route advertises x402
and native MPP Payment authentication in the same 402 response. Both protocols
settle the same exact USDC amount to the same Base mainnet merchant wallet. MCP
tool calls remain x402-gated.

The Morpho route is read-only. It calculates LTV, LLTV, health factor,
liquidation headroom, and collateral-price shock scenarios from integer protocol
values, then cross-checks indexed collateral, borrow shares, and oracle price
against direct Base RPC state. Scenarios are calculations rather than
probabilities or transaction recommendations. The separate protection route
uses a fresh direct-RPC oracle read and direct confirmation of collateral and
borrow shares to calculate exact partial-repay and add-collateral amounts. It
returns unsigned token-approval and Morpho-call templates, explicit execution
buffers, revalidation requirements, and economic postconditions. It never
accesses a wallet, signs, broadcasts, or takes custody.

The service also keeps a privacy-safe demand telescope on a persistent Railway
volume. It records route families, query key names, challenge/success classes,
and pseudonymous repeat-use signals. External fetches are acquisition signals,
not verified buyers, because unidentified automated indexers can remain.
Unmatched requests are reported separately from a conservative semantic-candidate
subset; neither becomes demand until an independent caller repeats or converts.
It does not record raw IP addresses, user
agents, URLs, query values, bodies, payment headers, marketplace payloads, or
credentials. Public output is aggregate only; owner and crawler traffic are
excluded. Common exploit probes such as `.env`, `.git`, and WordPress discovery
paths are classified as scanner traffic and excluded as well.

Version 1.9 adds same-route MPP `evm/charge` support to all twelve paid HTTP
capabilities without replacing the existing x402 middleware. An unpaid request
now carries both `WWW-Authenticate: Payment` and `PAYMENT-REQUIRED`. Native MPP
credentials use `Authorization: Payment` and successful calls return
`Payment-Receipt`; x402 keeps its Bazaar, payment-identifier, signed
offer/receipt, and `PAYMENT-RESPONSE` extensions. MPP challenges are bound to the
canonical method, path, and sorted query. Both protocols participate in
privacy-safe telemetry and request replay, and OpenAPI 3.1 exposes valid
per-operation `x-payment-info` offers.

Version 1.9.1 keeps those official MPP offers and adds the structured USD price,
protocol declarations, agent guidance, public-route auth declarations, and
truthful response schemas used by AgentCash, MPPScan, and x402-oriented
discovery clients. Runtime 402 challenges remain authoritative for settlement
terms.

Version 1.8 adds a deterministic paid opportunity preflight. The caller supplies
reward, execution time, hourly opportunity cost, compute, mandatory spend,
reusable value, competition, and an explicit selection probability. The result
returns `attempt`, `verify_first`, or `abandon`, transparent break-even economics,
hard access and funding gates, and an optional dated Settlement Radar card. It
does not scrape a restricted board or touch a source-platform account, claim,
bid, payment, or submission. Version 1.7 added request-bound idempotent replay
for HTTP buyers that supply the
x402 payment-identifier extension. A successful JSON response is cached for 15
minutes on the private Railway volume. The cache key is an HMAC of the logical
payment ID, and the binding covers the full canonical URL, HTTP method, payer,
network, asset, amount, and recipient. Raw payment IDs, payer addresses, and
request URLs are not stored. An exact retry receives the original response and
signed settlement receipt without a second payment; changed input, payer, or
payment terms return an uncharged HTTP 409. Replays are counted separately from
new paid-success events.

Observed agent crawlers use several discovery conventions. The canonical
manifest remains `/.well-known/x402`, with compatible aliases at
`/.well-known/x402.json`, `/x402.json`, and `/api/x402`. The canonical OpenAPI
document remains `/openapi.json`, with `/openapi.yaml` and `/swagger.json`
returning the same JSON document. `GET /mcp` returns a free transport descriptor;
actual MCP discovery and paid tool calls use streamable HTTP at `POST /mcp`.
Agents that prefer a compact instruction contract can read `/skill.md` (or
`/SKILL.md`), while `/api/actions` returns the twelve canonical GET actions with
their URL, description, exact atomic USDC price, MIME type, network, and payTo.
The A2A v1.0 card at `/.well-known/agent-card.json` advertises one bounded free
skill, `discover-x402-paid-actions`. `POST /a2a/message:send` returns that exact
catalog as an A2A direct message, giving A2A clients a standards-based path from
agent discovery to the existing paid x402 actions without claiming arbitrary
task execution.

The repository-root `agent-card.json` is a compatibility manifest for the
Global A2A Registry's current GitHub importer. It points back to the canonical
v1.0 Agent Card and OpenAPI document; it does not replace the production card.
The registry's own generated ownership manifest is hosted separately at
`https://samedaydesk.com/.well-known/agent-card.json`; the standards-compliant
A2A v1.0 card remains canonical on `agents.samedaydesk.com`.

## PreLiquidation shadow watcher

`morpho-preliquidation-shadow.mjs` is the observation-only forward evidence
lane selected by the complete Base census. It watches the five markets that
concentrate historical execution, derives each market's actual PreLiquidation
health threshold from LLTV and pre-LLTV, checks every observed authorization
directly at one explicit Base block, and uses per-contract event cursors.

New execution transactions are replayed through the deterministic archive-RPC
engine, up to 20 per run. The record includes detection latency, gross
loan-asset incentive, and native gas while retaining the explicit boundary that
swap, funding, failure, competition, and MEV costs remain outside the replay.
Positions below the explicit 1 USD debt observation floor are classified as
dust rather than opportunities.

```bash
node morpho-preliquidation-shadow.mjs \
  --state /data/morpho-preliquidation-shadow-state.json \
  --history /data/morpho-preliquidation-shadow-history.ndjson
```

State and history files are forced to mode 0600. A material change means a new
or removed authorization, a transition into or out of the protocol-specific
risk window, a large liquidity or utilization move, or a new verified
PreLiquidation execution. No wallet, signer, authorization, custody, or
principal is part of the watcher.

The Agoragentic callback is a separate marketplace distribution bridge. The
marketplace handles buyer routing, settlement, and seller accounting, while the
callback performs the same production AI-search-readiness audit behind a small
per-IP safety cap. Direct agent customers continue to use the paid x402 route.

The the402 bridge is a second marketplace distribution path. It authenticates
signed job dispatches with timestamped HMAC verification, accepts callbacks only
on the official API origin, and submits a structured audit deliverable for
automatic settlement. `THE402_API_KEY`, `THE402_WEBHOOK_SECRET`, and
`THE402_SERVICE_ID` are Railway-only environment variables.

The same service also hosts two free, disclosed affiliate handoffs used by
fact-checked SameDayDesk guides: `/go/topify` and `/go/manychat`. They mint and
cache Agent Hansa's expiring signed links server-side, validate the redirect
host, expose no API key, and return `noindex, nofollow` plus `no-store`.

## Original rail implementation

A Node/Express server that returns **HTTP 402 Payment Required** when unpaid and
serves the resource after payment, settling **USDC on Base mainnet** straight to
our own wallet:

```
payTo = 0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee
```

Verified live (June through August 2026). The server boots and returns correct
402 responses with machine-readable payment requirements. The Morpho canary is
`amount=20000` = 0.02 USDC, `network=eip155:8453`, and
`asset=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` = Base USDC,
`payTo` equal to our wallet, plus a Bazaar discovery extension with input and
output schemas.

---

## Current production decision

| Path | Account/API key? | Base mainnet? | Discovery reach |
|---|---|---|---|
| **CDP facilitator** (`api.cdp.coinbase.com/platform/v2/x402`) | **Yes**, Coinbase CDP account plus `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` | Yes | **Production default.** CDP Bazaar catalog, merchant lookup, and semantic search after first settlement |
| **xpay public facilitator** (`facilitator.xpay.sh`) | **None** | **Yes** (`eip155:8453`, exact scheme) | Fallback settlement path with self-published discovery only |
| **x402.org public facilitator** (`x402.org/facilitator`) | None | **No**, Base Sepolia testnet only | Separate test catalog at `x402.org/facilitator/discovery/resources` |

Production uses CDP. The first eleven routes passed live CDP verification and
completed a real settlement. The original eight appear in Bazaar merchant
discovery. The three newer Morpho decision routes have successful settlement
receipts, and a distinct funded payer produced `isValid: true` plus Bazaar
extension status `processing` for all three. They still did not enter merchant
discovery after the documented cache window and a fresh settlement, so this is
tracked as a downstream CDP indexing incident rather than a route-metadata
failure. The secret-free reproduction is attached to
[x402 issue #2156](https://github.com/x402-foundation/x402/issues/2156#issuecomment-5229812482).
Keep xpay as the no-key continuity fallback, not as the normal production
facilitator.

The twelfth route, `/work/opportunity-preflight`, is live in version 1.8.0 and
advertises a 0.05 USDC Base payment challenge. It has not been self-paid merely
to manufacture a catalog or demand signal.

---

## How the rail works (why "no account" is safe)

The `exact` scheme settles USDC via an **EIP-3009 `transferWithAuthorization`**:
the buyer (agent) signs an authorization that moves USDC **directly from their
wallet to our `payTo`** on-chain. The facilitator only **verifies the signature
and broadcasts the transaction**; it never holds the money. So:

- Whatever facilitator we pick, the USDC lands in **our** `payTo` wallet.
- We hold the key to `payTo`; the facilitator does not.
- CDP and xpay are non-custodial facilitator paths. CDP relayed the eight live
  seller canaries and the exact USDC amounts reached our wallet.

This is the same rail Frantic used to pay real mainnet USDC to this wallet, so we
already know settlement to `0x8904…3Cee` works.

---

## Answers to the five questions

### 1. Facilitator + autonomy
- The **public x402.org facilitator supports Base Sepolia testnet only**
  (`eip155:84532`); its `/supported` endpoint does **not** list `eip155:8453`.
  Mainnet via x402.org is impossible.
- **Base mainnet settlement does not strictly require a Coinbase CDP account.**
  The **xpay public facilitator (`https://facilitator.xpay.sh`) supports Base
  mainnet `eip155:8453` exact scheme with no account and no API key** (verified
  against its live `/supported` endpoint). This is the fully-autonomous mainnet
  path.
- The **CDP facilitator** requires a CDP account and API keys. Its advantage is
  Bazaar merchant discovery, semantic search, and the Bazaar MCP buyer surface.
- Production chose CDP after a live verify-only matrix and eight successful
  settlements. xpay remains the no-key fallback.

### 2. Exact seller code
See `server.js`. Current package line (NOT the legacy flat `x402-express@1.x`):

```
@x402/express     2.16.0   paymentMiddleware, x402ResourceServer
@x402/core        2.16.0   HTTPFacilitatorClient   (import from @x402/core/server)
@x402/evm         2.16.0   ExactEvmScheme          (import from @x402/evm/exact/server)
@x402/extensions  2.16.0   declareDiscoveryExtension (import from @x402/extensions/bazaar)
@coinbase/x402    2.1.0    createFacilitatorConfig (only needed for CDP mainnet)
mppx              0.8.15   native MPP EVM charge challenge, credential, and receipt support
```

Core wiring:

```js
const facilitatorClient = new HTTPFacilitatorClient(
  createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET)
);
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register("eip155:8453", new ExactEvmScheme());

app.use(paymentMiddleware(
  { "GET /premium": { accepts: [{ scheme: "exact", price: "$0.01",
      network: "eip155:8453", payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee" }],
      description: "...", mimeType: "application/json", extensions: { ... } } },
  resourceServer
));
```

### 3. Bazaar discovery
The route's `extensions` uses `declareDiscoveryExtension({ input, inputSchema,
output, outputSchema })` (already in `server.js`). This advertises the route and
its JSON schemas in the 402 payload (verified present in the live response).
**Surfacing in the CDP Bazaar requires the CDP facilitator**: CDP catalogs a
route after its first successful settlement. The production merchant lookup
returns the original eight SameDayDesk routes; all three newer Morpho decision
routes have successful CDP settlements and accepted `processing` Bazaar
extensions, but remain absent beyond the documented cache window. CDP also
finds the original Morpho and deep-audit routes through semantic search. Use the
merchant lookup as evidence of CDP catalog state, not as the canonical count of
SameDayDesk capabilities; the owned manifest, MCP, A2A, and OpenAPI surfaces
remain complete at twelve.

CDP rejected three older route payloads whose discovery descriptions were 535,
581, and 629 characters even though local extension validation passed. Concise
rewrites of 294, 258, and 301 characters passed. Keep new discovery descriptions
under 400 characters and run live CDP verify before a funded canary.

### 4. Settlement verification
After a paid call, confirm USDC landed at `payTo` on Base mainnet. The 402/200
flow also returns a `PAYMENT-RESPONSE` header with settlement data. Independently:

```bash
# USDC balanceOf(payTo) on Base mainnet via public RPC, no key:
curl -s -X POST https://mainnet.base.org -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{
    "to":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "data":"0x70a082310000000000000000000000008904df3de6dfee6a7c8cc38619d2f17806213cee"
  },"latest"]}'
```
Result is hex atomic USDC (divide by 1e6). Or use our existing Base-mainnet
balance checker. Or view the wallet on https://basescan.org/address/0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee

### 5. Cleanest recommended path
**Deploy on CDP for the production storefront.** It preserves direct USDC
settlement and adds the catalog, semantic search, merchant lookup, and Bazaar MCP
buyer surface. Keep xpay configured as the no-key recovery path.

---

## Deploy steps (Railway)

The repo is a no-config Node app: `npm start` runs `node server.js` and binds
`process.env.PORT` (Railway sets it).

1. Deploy this directory directly or push the repository source.
2. **Set env vars** on the Railway service:
   ```
   PAY_TO=0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee
   NETWORK=eip155:8453
   PRICE=$0.05
   FACILITATOR=cdp
   CDP_API_KEY_ID=<CDP API key ID>
   CDP_API_KEY_SECRET=<CDP API key secret>
   MPP_SECRET_KEY=<random secret of at least 32 bytes>
   COMMERCE_DATA_DIR=/data
   COMMERCE_ACTOR_SECRET=<random 32-byte secret>
   COMMERCE_INTERNAL_TOKEN=<random owner-canary token>
   COMMERCE_EXTERNAL_SINCE=<ISO timestamp after controlled launch canaries>
   ```
   Core payment settings have safe defaults. Production telemetry uses a Railway
   volume mounted at `/data` plus the two secret variables above.
3. **Generate a public domain** for the service.
4. **Verify:**
   ```bash
   curl https://<your-domain>/healthz          # -> {ok:true, network:eip155:8453, ...}
   curl -i 'https://<your-domain>/defi/morpho-position?address=0x...' # -> HTTP 402 + WWW-Authenticate and PAYMENT-REQUIRED
   ```
5. **Complete one bounded settlement per discoverable route**, then confirm the
   merchant lookup and semantic search. Record owner settlements as test flow,
   not revenue.

### Fall back to xpay without changing route code
If CDP is unavailable and continuity matters more than central discovery, set:
```
FACILITATOR=xpay
```
Redeploy. Base mainnet settlement continues, but new calls no longer feed the
CDP Bazaar quality and activity signals.

### Prove the rail on testnet first (optional)
```
FACILITATOR=testnet
NETWORK=eip155:84532
```
Uses x402.org + Base Sepolia (fake USDC) to validate the full 402→pay→200 loop
before taking mainnet money.

---

## Local run

```bash
npm install
npm start
# then:
curl -i 'http://localhost:3000/defi/morpho-position?address=0x...' # HTTP 402
```

## Files
- `server.js` — the server (env-driven facilitator/network/price).
- `commerce-events.mjs` — privacy-safe durable demand telemetry.
- `mpp-dual-stack.mjs` — same-route native MPP authorization and receipt adapter.
- `morpho-position.mjs` — deterministic Morpho snapshot, stress, and RPC checks.
- `morpho-protection.mjs` — exact stressed repair amounts and unsigned action templates.
- `morpho-market-underwrite.mjs` — multi-source market integrity, liquidity, concentration, borrower-health, history, bad-debt, and PreLiquidation evidence.
- `morpho-preliquidation-replay.mjs` — historical PreLiquidate event economics from direct block-state reads.
- `morpho-preliquidation-census.mjs` — repeatable Base supply, authorization, and execution census for internal market selection.
- `package.json` — exact pinned deps (verified to install & boot).
- `README.md` — this guide.
- `extract.mjs` — pre-existing zero-dependency "URL → clean structured data"
  service. This is a natural **paid resource** to put behind `/premium`: in the
  route handler, call its extractor on a `?url=` query param and return the
  structured result instead of the placeholder `{value:42}`. Add `?url` to the
  Bazaar `inputSchema` when you wire it up.

## Sources (primary, verified August 2026)
- x402 seller quickstart: https://docs.x402.org/getting-started/quickstart-for-sellers
- CDP x402 docs: https://docs.cdp.coinbase.com/x402/welcome
- CDP network support (x402.org = testnet only; CDP = mainnet + keys): https://docs.cdp.coinbase.com/x402/network-support
- CDP Bazaar: https://docs.cdp.coinbase.com/x402/bazaar
- x402 monorepo: https://github.com/coinbase/x402
- npm: `@x402/express`, `@x402/core`, `@x402/evm`, `@x402/extensions`, `@coinbase/x402`
- xpay public facilitator live `/supported` (Base mainnet, no key): https://facilitator.xpay.sh/supported
