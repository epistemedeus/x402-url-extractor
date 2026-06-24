// x402-merchant — a paid HTTP endpoint that charges AI agents in USDC and
// settles directly to OUR OWN Base wallet.
//
// Verified against the x402 v2 package line (June 2026):
//   @x402/express     2.16.0   (paymentMiddleware, x402ResourceServer)
//   @x402/core        2.16.0   (HTTPFacilitatorClient)
//   @x402/evm         2.16.0   (ExactEvmScheme)
//   @x402/extensions  2.16.0   (declareDiscoveryExtension — Bazaar)
//   @coinbase/x402    2.1.0    (createFacilitatorConfig — CDP mainnet auth)
//
// PAYMENT MODEL (important): the "exact" scheme settles USDC via an EIP-3009
// transferWithAuthorization signed by the buyer. Funds move buyer -> payTo
// DIRECTLY on-chain. The facilitator only verifies the signature and broadcasts
// the tx; it never custodies the money. So whichever facilitator we use, the
// USDC lands in OUR payTo wallet. We hold the key to payTo, the facilitator
// does not.

import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createFacilitatorConfig } from "@coinbase/x402";
import { extract, readMarkdown } from "./extract.mjs";
import { scanRepo } from "./scan.mjs";
const SCAN_PRICE = process.env.SCAN_PRICE || "$0.02";

// ---------------------------------------------------------------------------
// 1. CONFIG (all via env so we change facilitator/network with zero code edits)
// ---------------------------------------------------------------------------

// Our wallet — USDC lands here. We hold the key.
const PAY_TO = process.env.PAY_TO || "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";

// Network: "eip155:8453" = Base MAINNET (real USDC). "eip155:84532" = Base Sepolia (testnet).
const NETWORK = process.env.NETWORK || "eip155:8453";

// Price per request (USDC). "$0.01" = one cent.
const PRICE = process.env.PRICE || "$0.01";

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// 2. FACILITATOR SELECTION  (this is the autonomy lever)
//
//   FACILITATOR=xpay  (DEFAULT) -> https://facilitator.xpay.sh
//        * Base MAINNET (eip155:8453) supported, exact scheme.
//        * NO ACCOUNT, NO API KEY. Fully autonomous. Non-custodial.
//        * Tradeoff: NOT listed in the CDP Bazaar (~4,400 buyers). Discovery
//          must come from us advertising the URL (well-known, README, posts).
//
//   FACILITATOR=cdp -> https://api.cdp.coinbase.com/platform/v2/x402
//        * Base MAINNET + automatic CDP Bazaar discovery.
//        * REQUIRES a Coinbase CDP account + CDP_API_KEY_ID / CDP_API_KEY_SECRET.
//        * The moment those two env vars exist, set FACILITATOR=cdp and we get
//          Bazaar reach with no other code change.
//
//   FACILITATOR=testnet -> https://x402.org/facilitator
//        * Base Sepolia ONLY (eip155:84532). No account, no key.
//        * Use to prove the rail end-to-end with fake money before mainnet.
// ---------------------------------------------------------------------------

const FACILITATOR = (process.env.FACILITATOR || "xpay").toLowerCase();

function buildFacilitatorClient() {
  if (FACILITATOR === "cdp") {
    const id = process.env.CDP_API_KEY_ID;
    const secret = process.env.CDP_API_KEY_SECRET;
    if (!id || !secret) {
      throw new Error(
        "FACILITATOR=cdp requires CDP_API_KEY_ID and CDP_API_KEY_SECRET env vars."
      );
    }
    // createFacilitatorConfig returns { url, createAuthHeaders } pointed at
    // https://api.cdp.coinbase.com/platform/v2/x402 and signs CDP requests.
    return new HTTPFacilitatorClient(createFacilitatorConfig(id, secret));
  }

  if (FACILITATOR === "testnet") {
    return new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
  }

  // Default: xpay public mainnet facilitator — no account, no key.
  const url = process.env.FACILITATOR_URL || "https://facilitator.xpay.sh";
  return new HTTPFacilitatorClient({ url });
}

const facilitatorClient = buildFacilitatorClient();

// Register the EVM "exact" scheme for our network. This is what settles USDC.
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  NETWORK,
  new ExactEvmScheme()
);

// ---------------------------------------------------------------------------
// 3. APP + PAID ROUTE
// ---------------------------------------------------------------------------

const app = express();

// Free health check (NOT behind paywall — used by Railway).
app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    payTo: PAY_TO,
    network: NETWORK,
    price: PRICE,
    facilitator: FACILITATOR,
    facilitatorUrl: facilitatorClient.url,
  });
});

// Domain-verification file for x402 directories (402 Index instant approval).
// Free route (declared before the paywall). Hash set via env so it's editable without code changes.
app.get("/.well-known/402index-verify.txt", (_req, res) => {
  res.type("text/plain").send(
    process.env.INDEX402_VERIFY_HASH ||
      "a1d5312d7ee9189ae3cbb1eb74f0f3903001e373dab8dfb209a942a41be5a80b"
  );
});

// --- x402 discovery document (/.well-known/x402) so agents + indexes (x402scan,
// domain crawlers) self-discover our paid resources. Free route, before the paywall.
const PUBLIC_URL = process.env.PUBLIC_URL || "https://x402-url-extractor-production.up.railway.app";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const acceptsFor = (amount) => [
  { scheme: "exact", network: NETWORK, asset: USDC_BASE, amount, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } },
];
const RESOURCES = [
  { url: `${PUBLIC_URL}/extract`, amount: "10000", description: "URL -> clean structured data: title, description, text, ALL JSON-LD, OpenGraph/Twitter meta, headings, links, AI-readiness signals.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/read`, amount: "10000", description: "URL -> full page content as clean Markdown, ready for LLM context. Strips nav/ads/scripts, preserves headings/links/lists.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/scan`, amount: "20000", description: "Static supply-chain security scan of a public GitHub repo before an agent installs/runs it. Flags exfil sinks, obfuscation, credential reads, install-time curl|bash. risk=clean|suspicious|dangerous.", mimeType: "application/json" },
];
app.get("/.well-known/x402", (_req, res) => {
  res.json({
    x402Version: 2,
    lastUpdated: Math.floor(Date.now() / 1000),
    items: RESOURCES.map((r) => ({ resource: { url: r.url, description: r.description, mimeType: r.mimeType }, type: "http", accepts: acceptsFor(r.amount) })),
  });
});
app.get("/openapi.json", (_req, res) => {
  res.json({
    openapi: "3.0.3",
    info: { title: "x402 URL Extractor", version: "1.0.0", description: "Pay $0.01 USDC (Base mainnet, x402) per call. payTo " + PAY_TO },
    servers: [{ url: PUBLIC_URL }],
    paths: {
      "/extract": { get: { summary: RESOURCES[0].description, parameters: [{ name: "url", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "structured data" }, "402": { description: "payment required (x402, $0.01 USDC base)" } } } },
      "/read": { get: { summary: RESOURCES[1].description, parameters: [{ name: "url", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "markdown" }, "402": { description: "payment required (x402, $0.01 USDC base)" } } } },
      "/scan": { get: { summary: RESOURCES[2].description, parameters: [{ name: "repo", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "security risk report" }, "402": { description: "payment required (x402, $0.02 USDC base)" } } } },
    },
  });
});

// The paid route. Unpaid request -> HTTP 402 with payment requirements.
// Paid request (X-PAYMENT header with a valid signed authorization) -> 200 + body.
app.use(
  paymentMiddleware(
    {
      "GET /extract": {
        accepts: [
          {
            scheme: "exact",
            price: PRICE,
            network: NETWORK,
            payTo: PAY_TO,
          },
        ],
        description:
          "URL -> clean structured data in one call: title, description, full text excerpt, ALL JSON-LD, OpenGraph/Twitter meta, headings, links, and AI-crawler/structured-data signals. Handles redirects, timeouts, size caps, and SSRF safely.",
        mimeType: "application/json",
        // --- Bazaar / discovery metadata: tells agents exactly how to call us ---
        extensions: {
          ...declareDiscoveryExtension({
            input: { url: "https://example.com" },
            inputSchema: {
              type: "object",
              properties: {
                url: { type: "string", description: "Public http(s) URL to extract." },
              },
              required: ["url"],
            },
            output: {
              example: {
                ok: true,
                url: "https://example.com",
                title: "Example Domain",
                description: null,
                jsonLd: [],
                aiReadiness: { hasJsonLd: false, schemaTypes: [] },
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                url: { type: "string" },
                title: { type: "string" },
                description: { type: ["string", "null"] },
                jsonLd: { type: "array" },
                openGraph: { type: "object" },
                headings: { type: "object" },
                links: { type: "array" },
                text: { type: "string" },
                aiReadiness: { type: "object" },
              },
              required: ["ok", "url", "title"],
            },
          }),
        },
      },
      "GET /read": {
        accepts: [{ scheme: "exact", price: PRICE, network: NETWORK, payTo: PAY_TO }],
        description:
          "URL -> full page content as clean Markdown, ready for LLM context. Strips nav/ads/scripts, preserves headings/links/lists. Handles redirects, timeouts, size caps, SSRF. The reliable web-reader agents need before feeding a page to a model.",
        mimeType: "application/json",
        extensions: {
          ...declareDiscoveryExtension({
            input: { url: "https://example.com" },
            inputSchema: {
              type: "object",
              properties: { url: { type: "string", description: "Public http(s) URL to read as Markdown." } },
              required: ["url"],
            },
            output: {
              example: { ok: true, url: "https://example.com", title: "Example Domain", markdown: "# Example Domain\n\n...", wordCount: 28 },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                url: { type: "string" },
                title: { type: "string" },
                markdown: { type: "string" },
                wordCount: { type: "number" },
                truncated: { type: "boolean" },
              },
              required: ["ok", "url", "markdown"],
            },
          }),
        },
      },
      "GET /scan": {
        accepts: [{ scheme: "exact", price: SCAN_PRICE, network: NETWORK, payTo: PAY_TO }],
        description:
          "Static supply-chain SECURITY scan of a public GitHub repo BEFORE an agent installs/runs it (a dependency, a Claude/MCP skill, an MCP server). Flags exfil sinks, obfuscated code execution, credential-file reads, env-harvest+network, install-time curl|bash. Returns risk = clean|suspicious|dangerous + findings. Static only, never runs the code. Low false positives.",
        mimeType: "application/json",
        extensions: {
          ...declareDiscoveryExtension({
            input: { repo: "owner/name" },
            inputSchema: {
              type: "object",
              properties: { repo: { type: "string", description: "Public GitHub repo: owner/name or https://github.com/owner/name" } },
              required: ["repo"],
            },
            output: {
              example: { ok: true, repo: "owner/name", risk: "clean", filesScanned: 12, summary: "No known malware/exfil/obfuscation patterns found.", findings: [] },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                repo: { type: "string" },
                risk: { type: "string", enum: ["clean", "suspicious", "dangerous"] },
                filesScanned: { type: "number" },
                summary: { type: "string" },
                findings: { type: "array" },
              },
              required: ["ok", "repo", "risk"],
            },
          }),
        },
      },
    },
    resourceServer
  )
);

// Handler runs ONLY after payment is verified/settled by the middleware.
app.get("/extract", async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ ok: false, error: "missing required query param: url" });
  }
  try {
    const data = await extract(url);
    res.json(data);
  } catch (e) {
    // Paid but extraction failed (bad/unreachable URL): return a clean, useful error.
    res.status(200).json({ ok: false, url, error: String(e.message || e) });
  }
});

// Paid: full page content as clean Markdown (LLM-ready).
app.get("/read", async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ ok: false, error: "missing required query param: url" });
  }
  try {
    res.json(await readMarkdown(url));
  } catch (e) {
    res.status(200).json({ ok: false, url, error: String(e.message || e) });
  }
});

// Paid: static supply-chain security scan of a public GitHub repo.
app.get("/scan", async (req, res) => {
  const repo = req.query.repo;
  if (!repo || typeof repo !== "string") {
    return res.status(400).json({ ok: false, error: "missing required query param: repo (owner/name)" });
  }
  try {
    res.json(await scanRepo(repo));
  } catch (e) {
    res.status(200).json({ ok: false, repo, error: String(e.message || e) });
  }
});

// Free landing so a human/agent hitting the root learns what this is + how to pay.
app.get("/", (_req, res) => {
  res.json({
    service: "x402 URL Extractor",
    what: "Pay $0.01 USDC (Base mainnet, x402) -> GET /extract?url=<public-url> -> clean structured JSON (text, JSON-LD, OG, headings, links, AI-readiness signals).",
    paidRoute: "GET /extract?url=",
    price: PRICE,
    network: NETWORK,
    payTo: PAY_TO,
    docs: "/healthz for config; send an x402 payment to /extract.",
  });
});

app.listen(PORT, () => {
  console.log(`x402-merchant listening on :${PORT}`);
  console.log(`  payTo:       ${PAY_TO}`);
  console.log(`  network:     ${NETWORK}`);
  console.log(`  price:       ${PRICE}`);
  console.log(`  facilitator: ${FACILITATOR} (${facilitatorClient.url})`);
  console.log(`  paid route:  GET /extract`);
});
