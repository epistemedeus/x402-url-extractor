# x402-merchant — paid HTTP endpoint that charges AI agents in USDC

A Node/Express server that returns **HTTP 402 Payment Required** when unpaid and
serves the resource after payment, settling **USDC on Base mainnet** straight to
our own wallet:

```
payTo = 0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee
```

Verified live (June 2026). The server boots, returns a correct 402 with
machine-readable payment requirements (`network=eip155:8453`, `amount=10000`
= $0.01, `asset=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` = Base USDC,
`payTo=`our wallet), and a Bazaar discovery extension with input/output schemas.

---

## TL;DR — the decision

| Path | Account/API key? | Base mainnet? | Discovery reach |
|---|---|---|---|
| **xpay public facilitator** (`facilitator.xpay.sh`) — **DEFAULT** | **None** (fully autonomous) | **Yes** (`eip155:8453`, exact scheme, live) | We advertise the URL ourselves (no central catalog) |
| **CDP facilitator** (`api.cdp.coinbase.com/platform/v2/x402`) | **Yes** — Coinbase CDP account + `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | Yes | **CDP Bazaar** (~4,400 buyers), auto-listed after first settlement |
| **x402.org public facilitator** (`x402.org/facilitator`) | None | **No — Base Sepolia testnet only** | Its own small catalog at `x402.org/facilitator/discovery/resources` |

**Recommended path: ship now on xpay (mainnet, no account, non-custodial).** The
moment a CDP key is available, flip `FACILITATOR=cdp` (no code change) to also get
Bazaar reach.

---

## How the rail works (why "no account" is safe)

The `exact` scheme settles USDC via an **EIP-3009 `transferWithAuthorization`**:
the buyer (agent) signs an authorization that moves USDC **directly from their
wallet to our `payTo`** on-chain. The facilitator only **verifies the signature
and broadcasts the transaction** — it never holds the money. So:

- Whatever facilitator we pick, the USDC lands in **our** `payTo` wallet.
- We hold the key to `payTo`; the facilitator does not.
- xpay is **non-custodial** and pays the gas, so we receive the full USDC amount.

This is the same rail Frantic used to pay real mainnet USDC to this wallet, so we
already know settlement to `0x8904…3Cee` works.

---

## Answers to the five questions

### 1. Facilitator + autonomy
- The **public x402.org facilitator supports Base Sepolia testnet ONLY**
  (`eip155:84532`); its `/supported` endpoint does **not** list `eip155:8453`.
  Mainnet via x402.org is impossible.
- **Base mainnet settlement does NOT strictly require a Coinbase CDP account.**
  The **xpay public facilitator (`https://facilitator.xpay.sh`) supports Base
  mainnet `eip155:8453` exact scheme with no account and no API key** (verified
  against its live `/supported` endpoint). This is the fully-autonomous mainnet
  path.
- The **CDP facilitator** also does mainnet, but **requires a CDP account +
  API keys**. Its advantage is **Bazaar discovery (~4,400 buyers)**: routes are
  auto-catalogued after their first CDP-settled payment.
- **Tradeoff:** xpay = full autonomy + real mainnet money, but **no central
  discovery catalog** (we drive demand by publishing the URL). CDP = an operator
  must create the account once, in exchange for Bazaar reach.

### 2. Exact seller code
See `server.js`. Current package line (NOT the legacy flat `x402-express@1.x`):

```
@x402/express     2.16.0   paymentMiddleware, x402ResourceServer
@x402/core        2.16.0   HTTPFacilitatorClient   (import from @x402/core/server)
@x402/evm         2.16.0   ExactEvmScheme          (import from @x402/evm/exact/server)
@x402/extensions  2.16.0   declareDiscoveryExtension (import from @x402/extensions/bazaar)
@coinbase/x402    2.1.0    createFacilitatorConfig (only needed for CDP mainnet)
```

Core wiring:

```js
const facilitatorClient = new HTTPFacilitatorClient({ url: "https://facilitator.xpay.sh" });
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
route the first time it **settles** a payment for it. On xpay/testnet the same
metadata is still emitted (so any client can read the schema), but there is no
central CDP catalog — discovery is via the URL we publish. The x402.org
facilitator keeps its own separate catalog at `/facilitator/discovery/resources`.

### 4. Settlement verification
After a paid call, confirm USDC landed at `payTo` on Base mainnet. The 402/200
flow also returns an `X-PAYMENT-RESPONSE` header with the tx hash. Independently:

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
**Deploy on xpay (mainnet, zero account) right now.** It is the only path that is
both fully autonomous and real mainnet money. Keep CDP as a one-env-flip upgrade
for Bazaar reach if/when an operator provides a CDP key.

---

## Deploy steps (Railway)

The repo is a no-config Node app: `npm start` runs `node server.js` and binds
`process.env.PORT` (Railway sets it).

1. **Push these three files** (`server.js`, `package.json`, `README.md`) to the
   service source, or deploy this directory directly.
2. **Set env vars** on the Railway service:
   ```
   PAY_TO=0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee
   NETWORK=eip155:8453
   PRICE=$0.01
   FACILITATOR=xpay
   ```
   (All have safe defaults baked in, so even with zero env vars it runs on
   xpay/mainnet/$0.01 to our wallet.)
3. **Generate a public domain** for the service.
4. **Verify:**
   ```bash
   curl https://<your-domain>/healthz          # -> {ok:true, network:eip155:8453, ...}
   curl -i https://<your-domain>/premium        # -> HTTP 402 + PAYMENT-REQUIRED header
   ```
5. **Advertise the endpoint** so agents find it (the URL, a `/.well-known`
   pointer, README, posts). On xpay there is no central catalog.

### Upgrade to CDP Bazaar later (one flip, no code change)
When a CDP key exists, set on the same service:
```
FACILITATOR=cdp
CDP_API_KEY_ID=<id>
CDP_API_KEY_SECRET=<secret>
```
Redeploy. Mainnet settlement continues; the route now auto-lists in the Bazaar
after its first CDP-settled payment.

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
curl -i http://localhost:3000/premium   # HTTP 402 with payment requirements
```

## Files
- `server.js` — the server (env-driven facilitator/network/price).
- `package.json` — exact pinned deps (verified to install & boot).
- `README.md` — this guide.
- `extract.mjs` — pre-existing zero-dependency "URL → clean structured data"
  service. This is a natural **paid resource** to put behind `/premium`: in the
  route handler, call its extractor on a `?url=` query param and return the
  structured result instead of the placeholder `{value:42}`. Add `?url` to the
  Bazaar `inputSchema` when you wire it up.

## Sources (primary, verified June 2026)
- x402 seller quickstart: https://docs.x402.org/getting-started/quickstart-for-sellers
- CDP x402 docs: https://docs.cdp.coinbase.com/x402/welcome
- CDP network support (x402.org = testnet only; CDP = mainnet + keys): https://docs.cdp.coinbase.com/x402/network-support
- CDP Bazaar: https://docs.cdp.coinbase.com/x402/bazaar
- x402 monorepo: https://github.com/coinbase/x402
- npm: `@x402/express`, `@x402/core`, `@x402/evm`, `@x402/extensions`, `@coinbase/x402`
- xpay public facilitator live `/supported` (Base mainnet, no key): https://facilitator.xpay.sh/supported
