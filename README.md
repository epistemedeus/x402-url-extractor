# SameDayDesk x402 and MPP Data Gateway

[![Smithery listing](https://smithery.ai/badge/epistemedeus/x402-data-gateway)](https://smithery.ai/servers/epistemedeus/x402-data-gateway)

Fourteen pay-per-call tools for deterministic agent-work opportunity preflight,
machine-service discoverability, payment-offer preflight, Morpho borrower and
market decisions, protection plans, URL extraction, Markdown reading,
repository security scans, company and wallet enrichment, structured data
generation, and AI-search readiness audits.

- Product page: https://samedaydesk.com/x402
- Smithery: https://smithery.ai/servers/epistemedeus/x402-data-gateway
- Remote MCP: https://agents.samedaydesk.com/mcp
- Live resource manifest: https://agents.samedaydesk.com/.well-known/x402
- OpenAPI: https://agents.samedaydesk.com/openapi.json
- Official MPP OpenAPI: https://agents.samedaydesk.com/mpp-openapi.json
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
- Agent discoverability audit: `GET /distribution/agent-discoverability-audit?origin=https://example.com&intent=extract+a+public+website+into+structured+JSON&route=/extract`
- Payment offer preflight: `GET /commerce/payment-offer-preflight?url=https://example.com/paid-route`
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
Recognized crawler and agent-indexer user agents are reduced at ingestion to a
controlled source label and reported in a separate machine-discovery lens with
source and route coverage. Those observations measure fetches, not authenticated
catalog referrals, intent, or demand.
Unmatched requests are reported separately from a conservative semantic-candidate
subset; neither becomes demand until an independent caller repeats or converts.
It does not record raw IP addresses, user
agents, URLs, query values, bodies, payment headers, marketplace payloads, or
credentials. Public output is aggregate only; owner traffic is excluded and
crawler traffic remains excluded from demand even when its controlled discovery
counts are reported separately. Common exploit probes such as `.env`, `.git`,
and WordPress discovery paths are classified as scanner traffic and excluded as
well.

Version 1.9.4 adds explicit paid-traffic classes without exposing buyer
addresses. `COMMERCE_PAYER_CLASSES` accepts a JSON array of `{ "address",
"class" }` records. Controlled classes are `internal`, `validation`,
`incentivized`, `affiliated`, and `independent`. Addresses are converted to the
same secret-keyed payer pseudonyms already used by telemetry and classified at
read time, which also permits retroactive correction without storing a raw
address. Unknown payers remain `unclassified`; unfamiliar wallets never become
independent demand by inference. The public snapshot reports paid success by
class plus independent and repeat-independent actor counts.

Version 1.9.5 adds route-level paid-success counts inside each evidence class.
This lets downstream monitors treat marketplace validation as accounting and
transport evidence, alert on unclassified paid use for investigation, and
advance the demand thesis only for explicitly independent or repeat-independent
buyers.

Version 1.9.6 privately captures a valid Base transaction hash from successful
x402 `PAYMENT-RESPONSE` or MPP `Payment-Receipt` headers after an explicit
evidence baseline. Public telemetry exposes only proof coverage, distinct-count,
and missing-reference counts by payment class. Raw headers and transaction
references stay on the private volume. A missing reference becomes a material
settlement-integrity event without exposing the reference itself.

Version 1.11.2 content-negotiates the root without changing its machine
contract. Browser navigation with an explicit `Accept: text/html` receives a
responsive human map of the fourteen tools, payment flow, and authoritative
discovery links. JSON clients, curl's wildcard accept header, and agents keep
the stable JSON descriptor. The response varies on `Accept`, and the human page
duplicates no payment schema.

Version 1.11.2 also adds the source-attributed machine-discovery lens. It keeps
raw user agents and network addresses out of the public snapshot, reports exact
future indexer observations by controlled source and route, and gives the radar
only first-source and first-route coverage changes as material events. Repeated
crawl volume remains visible data without becoming an attention alert or demand.

Version 1.11.3 makes that reach lens prospective and self-excluding. A distinct
`COMMERCE_AGENT_DISCOVERY_SINCE` baseline prevents pre-instrumentation crawler
history from becoming attributed reach, while SameDayDesk-owned monitor user
agents are excluded from both discovery and external-demand observations. This
keeps integrity sweeps, brand-blind benchmarks, and radar probes from creating
their own acquisition signal.

Version 1.11.4 preserves paying agents even when their user agent identifies as
a crawler or indexer. A valid submitted x402 or MPP credential moves the event
into economic telemetry before crawler classification, while the controlled
user-agent label records source-to-paid conversion by source and route. Channel
labels are still self-declared rather than authenticated referral proof, and
independent demand still requires the explicit payer-class policy.

Version 1.11.5 separates paid-route reach from challenge delivery. Prospective
agent/indexer observations now report paid-route probes, HTTP 402 challenges,
distinct and repeat challenge actors, challenge rate, and controlled source and
route breakdowns. This identifies whether the machine funnel stops before the
paywall, at the challenge, or after a submitted credential without treating an
indexer probe as purchase intent.

Version 1.11.6 adds a conservative challenge-to-payment cohort. A paid success
counts as continuation only when the same secret-keyed network-and-user-agent
actor returns after its first prospective challenge. The public snapshot
reports converted calls, converted actors, independent converted actors,
conversion rate, and controlled source and evidence-class totals without actor
IDs. Network or user-agent drift can only create false negatives, so the metric
is a lower bound rather than an identity claim.

Version 1.11.7 adds project-owned Glama connector verification at
`/.well-known/glama.json` using the public SameDayDesk business email. Glama
requests have their own controlled discovery-source label, so a propagated
directory claim can be measured without becoming demand.

Version 1.11.8 starts a separate credential-attempt funnel. After a declared
baseline, a parseable attempt must include a syntactically complete x402 v2
exact binding or MPP evm/charge credential. Signature validity and settlement
remain later outcomes. Public aggregates separate header noise from parseable
attempts and report protocol, result, route, controlled source, and explicit
payer class without raw credentials, actor IDs, or addresses.

Version 1.11.9 improves MCP tool selection without renaming or duplicating any
tool. Every tool now has a unique action-oriented title. The overlapping web
and company tools explicitly say when to choose `extract` versus `read`,
`enrich` versus `schemaforge`, and the combined `deep_audit`; `wallet_enrich`
also states that its input is an EVM address rather than a company domain. The
payment routes, names, prices, schemas, and handlers are unchanged.

Version 1.11.10 adds explicit descriptions to every `opportunity_preflight`
input and to the three Morpho protection controls. This improves machine call
construction while leaving names, routes, prices, required inputs, defaults,
payment gates, and execution behavior unchanged.

Version 1.11.11 gives all four Morpho MCP tools explicit sibling-selection
guidance. Borrower diagnosis, future protection planning, market underwriting,
and historical PreLiquidation replay are now distinct machine choices without
renaming a tool or changing its route, price, schema, payment gate, or handler.

Version 1.11.12 starts a prospective MCP transport-friction probe. It separates
four common client expectations, `/mcp/sse`, `/mcp/messages`, `/mcp/tools`, and
`/mcp/events`, from arbitrary `/mcp/*` misses without serving a guessed alias.
Public aggregates expose only route counts and secret-keyed actor totals. A
compatibility route is justified only by repeated independent use or conversion.

Version 1.11.13 repairs the pre-payment response contract exposed to machine
buyers. All thirteen routes already authored explicit JSON output schemas, but
the Bazaar v2 helper expects that schema under `output.schema`; the previous
top-level `outputSchema` field was silently ignored. A single tested adapter now
places each authored schema at the protocol-defined location, so an unpaid 402
challenge exposes both the example and the concrete required response fields
before an agent authorizes payment. Routes, inputs, prices, settlement, and
handlers are unchanged.

Version 1.11.14 projects the same thirteen response contracts into the free
OpenAPI and action catalog. Discovery agents can now inspect concrete required
fields and an example before probing a paid route; `/read` is also described as
the JSON object its handler actually returns rather than a raw Markdown string.
One route-keyed contract map drives the x402 challenge, OpenAPI, and action
catalog to prevent the three machine surfaces from drifting apart.

Version 1.11.16 links the versioned, credential-free
[`agent-payment-policy`](https://github.com/epistemedeus/agent-payment-policy)
reference from the machine root, OpenAPI service metadata, and `llms.txt`. The
reference has no wallet executor, payment signer, custody, or hosted paid
verifier. It gives machine buyers a stable policy and evidence primitive without
changing the merchant's routes, prices, payment requirements, or settlement.

Version 1.11.15 validates every Bazaar declaration against its own JSON Schema
before startup. Six newer routes previously settled successfully while Coinbase
rejected their discovery metadata because their output examples omitted fields
marked required by the same schemas. The examples now conform, and
`bazaar-contract-audit.mjs` checks every live paid route through credential-free
HTTP 402 probes without retaining headers or query values.

Version 1.11.18 adds a source-quality funnel to the public aggregate. Each
controlled discovery source now reports observations alongside distinct and
repeat actors at discovery, paid-route, challenge, credential-attempt, and paid
success stages. Challenge rates are available both per request and per actor,
so one high-frequency crawler no longer looks like broad machine reach.
Challenge-to-payment conversions are attributed to the source of the first
observed challenge. Raw user agents, network addresses, and actor identifiers
remain private and are not returned.

Version 1.11.19 starts a separate prospective AI-provider source cohort. It
uses exact provider-published HTTP tokens to distinguish OpenAI, Anthropic, and
Perplexity search, user-fetch, and training traffic plus Google Cloud Vertex
agent crawls. `Google-Extended` is intentionally excluded because Google states
that it has no distinct HTTP user-agent string. The detail cohort has its own
baseline, preserves historical generic records, reports the same actor funnel,
and treats every label as an unauthenticated observation rather than referral
proof.

Version 1.11.20 repairs the resource metadata consumed by payment-capable
wallet agents. Every one of the fourteen x402 v2 challenges now carries the
validated provider-level `serviceName` and five bounded route capability tags
in the standard top-level resource object. Startup fails closed if paid-route
coverage and metadata coverage diverge. The Bazaar contract audit now rejects
a route whose extension is valid but whose resource name or tags are absent or
invalid.
Prices, outputs, settlement, privacy, routes, and native MPP terms are unchanged.

Version 1.11.23 adds a narrow compatibility bridge for MCP clients that retry a
paid `tools/call` with the x402 `PAYMENT-SIGNATURE` HTTP header but fail to copy
the same signed payload into `_meta["x402/payment"]`. The merchant decodes only
a bounded, object-shaped header on `tools/call`, never overrides canonical MCP
metadata, and passes the result to the existing `@x402/mcp` verifier. The bridge
does not trust the header, change payment terms, or bypass signature, amount,
asset, network, nonce, or settlement validation.

Version 1.11.24 publishes each tool's exact live x402 payment options in MCP
`tools/list` metadata. Compatible clients can inspect price, asset, network,
recipient, and scheme before calling, then attach a fresh signed payload to the
first `tools/call` instead of relying on a challenge retry. Runtime verification
and settlement remain authoritative, and the unpaid challenge path is unchanged.

Version 1.11.26 sharpens the machine-facing selection contract for
`/commerce/payment-offer-preflight`: compare x402 and MPP payment challenges and
terms before buyer authorization. The 0.005-USDC product still accepts one exact
public HTTPS GET URL and returns normalized offers, URL and realm binding checks,
expiry findings, and economic parity. It rejects credentials, local or
non-public targets, unresolved parameters, and redirects, pins a public DNS
result, reads only response headers, never signs or sends a target payment, and
returns no opaque challenge state.

Version 1.11.27 keeps the compact `/skill.md` agent contract synchronized with
the fourteen-route action catalog. It now names payment-offer preflight in its
selection vocabulary and states the target-inspection boundary: no credential,
target signature or payment, redirect, or response-body read. A regression test
keeps this focused buyer-authorization product present in future releases.

Version 1.11.28 removes the manual route-inventory failure mode. The compact
contract now renders and validates every paid action, exact price, and supported
protocol from the canonical machine action catalog. Empty, malformed, or
duplicate action contracts fail closed, so a future route addition cannot leave
the compact agent surface silently stale.

Version 1.11.29 adds a free machine-catalog handoff for AgenticTrade without
placing a second payment gate in front of SameDayDesk. The catalog tells buyers
to call the selected action URL directly, satisfy its route-bound x402 or MPP
challenge, and optionally carry the declared `agentictrade-v1` source label.
That label enters the measured discovery-to-payment funnel, stores no raw token,
and cannot change price, payment, or access.

Version 1.11.30 adds a value-free AgenticTrade proxy diagnostic on the catalog
response. It reports only which `X-ACF-*` header names reached the origin and
whether signature, timestamp, and usage proof fields are present. It never
returns their values, and proxied responses are marked `private, no-store`.

Version 1.11.31 includes the same value-free diagnostic in the proxied catalog
body because AgenticTrade intentionally returns only its own billing headers to
the caller. Direct catalog responses remain unchanged and publicly cacheable.

Version 1.9.7 privately reconciles each post-baseline reference against its
canonical Base receipt. A record is accepted only when the transaction
succeeded, exactly one canonical Base USDC transfer reached the configured
treasury, the atomic amount matches the paid response, and the transfer sender
matches the request payer pseudonym when available. Duplicate references and
all mismatches fail closed. The private mode-0600 ledger retains the reference;
public health and demand output expose only aggregate settlement counts, atomic
amounts by evidence class and route, issue counts, and a generic error state.

Version 1.9 adds same-route MPP `evm/charge` support to all twelve paid HTTP
capabilities without replacing the existing x402 middleware. An unpaid request
now carries both `WWW-Authenticate: Payment` and `PAYMENT-REQUIRED`. Native MPP
credentials use `Authorization: Payment` and successful calls return
`Payment-Receipt`; x402 keeps its Bazaar, payment-identifier, signed
offer/receipt, and `PAYMENT-RESPONSE` extensions. MPP challenges are bound to the
canonical method, path, and sorted query. Both protocols participate in
privacy-safe telemetry and request replay, and OpenAPI 3.1 exposes valid
per-operation `x-payment-info` offers.

Version 1.9.3 generates two registry-specific discovery views from the same
route and price source. `/openapi.json` carries the structured USD price,
protocol declarations, agent guidance, public-route auth declarations, and
truthful response schemas used by AgentCash and MPPScan.
`/mpp-openapi.json` carries official MPP `offers[]` without incompatible flat
fields. Stable operation IDs and capability tags make the public catalog easier
for agents to search, rank, and invoke. Runtime 402 challenges remain
authoritative for both views.

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
`/.well-known/x402.json`, `/x402.json`, and `/api/x402`. The AgentCash-compatible
OpenAPI document remains `/openapi.json`, with `/openapi.yaml` and
`/swagger.json` returning the same JSON document. Official MPP discovery uses
`/mpp-openapi.json`, with `/openapi.mpp.json` as an alias. `GET /mcp` returns a free transport descriptor;
actual MCP discovery and paid tool calls use streamable HTTP at `POST /mcp`.
Agents that prefer a compact instruction contract can read `/skill.md` (or
`/SKILL.md`), while `/api/actions` returns the thirteen canonical GET actions with
their URL, description, exact atomic USDC price, MIME type, network, and payTo.
Agent Skills clients may send
`X-SameDayDesk-Agent-Source: agent-skills-v1` on the initial request and paid
replay. Telemetry reduces that exact allowlisted value to the public-safe
`agent-skills` label and never stores the raw header. This is declared,
spoofable attribution rather than authentication, and it cannot change price,
payment, or access.
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

The twelfth route, `/work/opportunity-preflight`, is live at 0.05 USDC and
completed an owner-excluded settlement for integration and indexing QA. The
thirteenth route, `/distribution/agent-discoverability-audit`, is live at 0.05
USDC and productizes the brand-blind catalog benchmark used on SameDayDesk
itself. It queries Bazaar, Agentic Market, Agent402, Circle, AgenticTrade, the official MPP
catalog, MPPScan, PayanAgent, x402.jobs, and 8004Market public search without catalog credentials or payments,
preserves registry-native order, and reports coverage, rank, competitors above the target, and
evidence-based next actions as point-in-time observations rather than a
composite score. Bazaar and Agentic Market are explicitly one Coinbase source
family, so the output does not inflate independent reach by counting both views
as separate acquisition channels. PayanAgent is labeled as a dependent
aggregator surface because its catalog includes ecosystem records such as
Coinbase-origin supply; its retrieval rank is useful, but is not independent
underlying supply. 8004Market is labeled as an identity-propagation surface
because it indexes on-chain Solana Agent Registry identities; retrieval there
proves public identity and capability propagation, not a buyer call, settlement,
or independent demand.

Version 1.11.40 adds x402.jobs as a tenth public search view. The adapter uses a
deterministic, disclosed compact keyword query because x402.jobs search is
lexical rather than semantic, then preserves its public popularity order and
checks the expected target route. SameDayDesk's verified owned server now lists
all fourteen Base routes with a zero-call, zero-value baseline, so later
activity can be measured without calling validation or listing traffic demand.

Version 1.11.39 adds the public x402.jobs server-ownership proof at
`/.well-known/x402-verification.json`. The challenge is a public directory
claim only and grants no API, wallet, or payment authority.

Version 1.11.38 adds a distinct Circle Gateway Nanopayments access path for
payment-offer preflight at the same 0.005-USDC price. It uses the official
`@circle-fin/x402-batching` 3.3.0 seller middleware, advertises
`GatewayWalletBatched` x402 requirements across the networks Circle reports at
runtime, and settles into the seller's Gateway balance. The existing Base
exact, native MPP, MCP, product implementation, and direct routes are unchanged,
so a Gateway outage cannot block them. The main OpenAPI and x402 manifest expose
the alternative path; the MPP OpenAPI does not mislabel it as an MPP route.

Version 1.11.37 adds 8004Market as a ninth public search view in the paid
discoverability audit. It matches the target by durable service origins and
routes embedded in the indexed Solana identity metadata while preserving
8004Market's server-native semantic order.

Version 1.11.36 expands the Solana identity metadata with the real route-level
capabilities and the Base and Solana OpenAPI, skill, x402, and MPP discovery
surfaces after the first frozen 8004Market benchmark exposed zero capability
retrieval from the broader launch description.

Version 1.11.35 adds `/.well-known/agent-registration.json`, a durable
ERC-8004-compatible registration document for the Solana Agent Registry. It
binds the existing MCP and A2A surfaces, the Solana x402 and MPP storefront,
the dedicated Solana settlement wallet, and explicit x402 support. The
on-chain asset identifier is injected only after successful registration, so
the URI stays stable and the document never invents an identity before it
exists.

Version 1.11.34 adds PayanAgent public search as an eighth registry view with an
explicit dependency label. Version 1.11.33 added MPPScan public search; its
public text-search order remains separate from the direct-listing state.
Version 1.11.32 added AgenticTrade; the official MPP flat catalog remains
locally ranked.

The fourteenth route, `/commerce/payment-offer-preflight`, is live at 0.005
USDC. It productizes the buyer-side authorization boundary: fetch the unpaid
headers of one exact public GET route, normalize x402 and MPP offers, verify URL
and realm binding, detect expiry and cross-protocol drift, and return a bounded
decision before the buyer signs the target payment.

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
remain complete at fourteen.

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
   COMMERCE_AGENT_SOURCE_DETAIL_SINCE=<ISO timestamp after provider taxonomy release>
   COMMERCE_SETTLEMENT_EVIDENCE_SINCE=<ISO timestamp after settlement-proof release>
   COMMERCE_PAYER_CLASSES='[{"address":"0x...","class":"validation"}]'
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
