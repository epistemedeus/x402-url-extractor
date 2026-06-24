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
import { schemaforge } from "./schemaforge.mjs";
import { enrich } from "./enrich.mjs";

// ---------------------------------------------------------------------------
// 1. CONFIG (all via env so we change facilitator/network with zero code edits)
// ---------------------------------------------------------------------------

// Our wallet — USDC lands here. We hold the key.
const PAY_TO = process.env.PAY_TO || "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";

// Network: "eip155:8453" = Base MAINNET (real USDC). "eip155:84532" = Base Sepolia (testnet).
const NETWORK = process.env.NETWORK || "eip155:8453";

// Price per request (USDC). Repriced 2026-06-24 off the $0.01 floor toward the
// observed x402 center of gravity (~$0.05-0.50): commodity extract/read at $0.05,
// the differentiated supply-chain /scan at $0.20 (no competitor in the census does
// pre-install repo scanning). Each is independently env-overridable; PRICE is the
// legacy shared fallback for extract/read.
const PRICE = process.env.PRICE || "$0.05";
const EXTRACT_PRICE = process.env.EXTRACT_PRICE || PRICE;
const READ_PRICE = process.env.READ_PRICE || PRICE;
const SCAN_PRICE = process.env.SCAN_PRICE || "$0.20";
// SchemaForge: generates a paste-ready, corpus-tuned JSON-LD bundle + gap diff. Differentiated -> $0.25.
const SCHEMAFORGE_PRICE = process.env.SCHEMAFORGE_PRICE || "$0.25";
// Enrich: domain -> agent-ready company intelligence. ENRICHMENT is the #1 verified-earning x402 category
// (volume model: cheap-per-call x high call-volume). Priced at the transacting micro-band -> $0.05.
const ENRICH_PRICE = process.env.ENRICH_PRICE || "$0.05";

// "$0.05" -> "50000" atomic USDC units (6 decimals) so the discovery docs
// (/.well-known/x402, /openapi.json) always match the paywall price exactly.
const priceToAtomic = (p) =>
  String(Math.round(parseFloat(String(p).replace(/[^0-9.]/g, "")) * 1e6));

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
    prices: { extract: EXTRACT_PRICE, read: READ_PRICE, scan: SCAN_PRICE, schemaforge: SCHEMAFORGE_PRICE, enrich: ENRICH_PRICE },
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
  { url: `${PUBLIC_URL}/extract`, amount: priceToAtomic(EXTRACT_PRICE), description: "URL -> clean structured data: title, description, text, ALL JSON-LD, OpenGraph/Twitter meta, headings, links, AI-readiness signals.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/read`, amount: priceToAtomic(READ_PRICE), description: "URL -> full page content as clean Markdown, ready for LLM context. Strips nav/ads/scripts, preserves headings/links/lists.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/scan`, amount: priceToAtomic(SCAN_PRICE), description: "Static supply-chain security scan of a public GitHub repo before an agent installs/runs it. Flags exfil sinks, obfuscation, credential reads, install-time curl|bash. risk=clean|suspicious|dangerous.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/schemaforge`, amount: priceToAtomic(SCHEMAFORGE_PRICE), description: "Generate a complete, paste-ready JSON-LD structured-data bundle (LocalBusiness/MedicalBusiness + Service/OfferCatalog + FAQPage + Review/AggregateRating + geo/hours) for a business site, tuned to the fields the pages that surface for high-intent vertical queries carry, plus a gap diff vs the live site and a ranked fix list. Makes a page eligible to be cited by AI assistants.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/enrich`, amount: priceToAtomic(ENRICH_PRICE), description: "Domain -> agent-ready company intelligence in one call: identity (name/legal name/description/logo), industry keywords, tech stack (CMS/framework/analytics), social profiles, contact surface (emails/phone/address), DNS + email infrastructure (MX/SPF/DMARC), and AI-search-readiness signals. No auth, no API keys, no subscription. Pay per request in USDC.", mimeType: "application/json" },
];
app.get("/.well-known/x402", (_req, res) => {
  res.json({
    x402Version: 2,
    lastUpdated: Math.floor(Date.now() / 1000),
    items: RESOURCES.map((r) => ({ resource: { url: r.url, description: r.description, mimeType: r.mimeType }, type: "http", accepts: acceptsFor(r.amount) })),
  });
});
// --- /llms.txt: agent/LLM-native discovery surface (llmstxt.org convention).
// Free route. Tells crawling LLM agents what we sell and exactly how to pay (x402),
// the same channel our category peers (Melvea, cryptojp, img402) use to be found.
app.get("/llms.txt", (_req, res) => {
  const line = (path, price, desc) => `- [${path}](${PUBLIC_URL}${path}): ${price} USDC — ${desc}`;
  res.type("text/plain").send(`# x402 URL Extractor — pay-per-call data & enrichment for AI agents

> Agent-native HTTP endpoints that return clean, structured JSON for a few cents of USDC on Base (x402). No API keys, no signup, no subscription: send an x402 payment, get the data. Settlement via the Coinbase CDP facilitator. payTo ${PAY_TO} on Base mainnet (eip155:8453).

## Endpoints
${line("/enrich", ENRICH_PRICE, "domain -> agent-ready company intelligence: identity, industry keywords, tech stack, social profiles, contact surface, DNS + email infra (MX/SPF/DMARC), and an AI-readiness score. The frictionless, pay-per-call alternative to signup-gated Clearbit/Apollo.")}
${line("/extract", EXTRACT_PRICE, "URL -> clean structured data: title, description, text, all JSON-LD, OpenGraph/Twitter meta, headings, links, AI-readiness signals.")}
${line("/read", READ_PRICE, "URL -> full page content as clean Markdown, ready for LLM context.")}
${line("/scan", SCAN_PRICE, "static supply-chain security scan of a public GitHub repo before an agent installs/runs it; flags exfil sinks, credential reads, install-time curl|bash.")}
${line("/schemaforge", SCHEMAFORGE_PRICE, "business site -> paste-ready JSON-LD structured-data bundle + a gap diff vs the live site.")}

## How to pay (x402)
1. GET an endpoint (e.g. ${PUBLIC_URL}/enrich?domain=stripe.com). You receive HTTP 402 with the payment requirements.
2. Pay the quoted USDC amount on Base to ${PAY_TO} with any x402 client (@x402/fetch, x402-axios, Coinbase AgentKit).
3. Replay the request with the X-PAYMENT header. You receive the JSON result.

## Discovery
- x402 manifest: ${PUBLIC_URL}/.well-known/x402
- OpenAPI: ${PUBLIC_URL}/openapi.json
- Source: https://github.com/epistemedeus/x402-url-extractor
`);
});

app.get("/openapi.json", (_req, res) => {
  res.json({
    openapi: "3.0.3",
    info: { title: "x402 URL Extractor", version: "1.0.0", description: `Pay USDC (Base mainnet, x402) per call: /enrich ${ENRICH_PRICE}, /extract ${EXTRACT_PRICE}, /read ${READ_PRICE}, /scan ${SCAN_PRICE}, /schemaforge ${SCHEMAFORGE_PRICE}. payTo ${PAY_TO}` },
    servers: [{ url: PUBLIC_URL }],
    paths: {
      "/extract": { get: { summary: RESOURCES[0].description, parameters: [{ name: "url", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "structured data" }, "402": { description: `payment required (x402, ${EXTRACT_PRICE} USDC base)` } } } },
      "/read": { get: { summary: RESOURCES[1].description, parameters: [{ name: "url", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "markdown" }, "402": { description: `payment required (x402, ${READ_PRICE} USDC base)` } } } },
      "/scan": { get: { summary: RESOURCES[2].description, parameters: [{ name: "repo", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "security risk report" }, "402": { description: `payment required (x402, ${SCAN_PRICE} USDC base)` } } } },
      "/schemaforge": { get: { summary: RESOURCES[3].description, parameters: [{ name: "site", in: "query", required: true, schema: { type: "string" } }, { name: "vertical", in: "query", required: false, schema: { type: "string" } }, { name: "city", in: "query", required: false, schema: { type: "string" } }], responses: { "200": { description: "paste-ready JSON-LD bundle + gap diff + fix list" }, "402": { description: `payment required (x402, ${SCHEMAFORGE_PRICE} USDC base)` } } } },
      "/enrich": { get: { summary: RESOURCES[4].description, parameters: [{ name: "domain", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "agent-ready company intelligence (identity, tech, social, contact, DNS, AI-readiness)" }, "402": { description: `payment required (x402, ${ENRICH_PRICE} USDC base)` } } } },
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
            price: EXTRACT_PRICE,
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
        accepts: [{ scheme: "exact", price: READ_PRICE, network: NETWORK, payTo: PAY_TO }],
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
      "GET /schemaforge": {
        accepts: [{ scheme: "exact", price: SCHEMAFORGE_PRICE, network: NETWORK, payTo: PAY_TO }],
        description:
          "Generate a complete, paste-ready JSON-LD structured-data bundle for a business site (LocalBusiness/MedicalBusiness + Service/OfferCatalog + FAQPage + Review/AggregateRating + geo/openingHours), tuned to the field set that the pages which surface for high-intent vertical queries carry. Also returns a gap diff vs the live site's current structured data and a ranked fix list. Makes a page eligible to be cited by AI assistants. Deterministic, valid by construction; rating/review fields are placeholders for the business's real values.",
        mimeType: "application/json",
        extensions: {
          ...declareDiscoveryExtension({
            input: { site: "https://example-clinic.com", vertical: "med-spas", city: "Austin" },
            inputSchema: {
              type: "object",
              properties: {
                site: { type: "string", description: "Public http(s) URL of the business site to generate structured data for." },
                vertical: { type: "string", description: "Business vertical (currently: med-spas)." },
                city: { type: "string", description: "City the business serves (optional, used in the markup)." },
              },
              required: ["site"],
            },
            output: {
              example: { ok: true, site: "https://example-clinic.com", vertical: "med-spas", missing: ["faqPage", "review", "service"], fixList: ["1. Add FAQPage markup ..."], jsonLd: { "@context": "https://schema.org", "@graph": [] } },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                site: { type: "string" },
                vertical: { type: "string" },
                missing: { type: "array" },
                fixList: { type: "array" },
                jsonLd: { type: "object" },
                pasteAs: { type: "string" },
              },
              required: ["ok", "site", "jsonLd"],
            },
          }),
        },
      },
      "GET /enrich": {
        accepts: [{ scheme: "exact", price: ENRICH_PRICE, network: NETWORK, payTo: PAY_TO }],
        description:
          "Domain -> agent-ready company intelligence in one call. Hand it a bare domain; get back clean structured firmographics (name, legal name, description, logo, keywords), tech stack (CMS/framework/analytics fingerprint), social profiles, contact surface (emails, phone, postal address), DNS + email infrastructure (A/MX/NS, SPF/DMARC presence), and AI-search-readiness signals (JSON-LD schema types, OpenGraph, robots/sitemap/llms.txt, a 0-100 score). Public data only; no auth, no API keys, no subscription. The frictionless, pay-per-call alternative to signup-gated enrichment APIs.",
        mimeType: "application/json",
        extensions: {
          ...declareDiscoveryExtension({
            input: { domain: "stripe.com" },
            inputSchema: {
              type: "object",
              properties: { domain: { type: "string", description: "A domain or URL, e.g. stripe.com or https://stripe.com" } },
              required: ["domain"],
            },
            output: {
              example: {
                ok: true,
                domain: "stripe.com",
                company: { name: "Stripe", legalName: "Stripe, LLC", description: "Financial services platform...", logo: "https://.../favicon.svg", keywords: [] },
                contact: { emails: [], phones: [], address: null },
                social: { twitter: "https://twitter.com/stripe", linkedin: "https://www.linkedin.com/company/stripe/", github: "https://github.com/stripe" },
                tech: ["Next.js"],
                dns: { host: "stripe.com", mx: ["aspmx.l.google.com"], hasSPF: true, hasDMARC: true, emailInfra: true },
                aiReadiness: { hasJsonLd: true, schemaTypes: ["Organization", "WebSite"], hasLlmsTxt: true, score: 84 },
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                domain: { type: "string" },
                company: { type: "object" },
                contact: { type: "object" },
                social: { type: "object" },
                tech: { type: "array" },
                dns: { type: "object" },
                aiReadiness: { type: "object" },
              },
              required: ["ok", "domain", "company"],
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

// Paid: generate a paste-ready JSON-LD bundle + gap diff for a business site.
app.get("/schemaforge", async (req, res) => {
  const site = req.query.site;
  if (!site || typeof site !== "string") {
    return res.status(400).json({ ok: false, error: "missing required query param: site (https URL of the business)" });
  }
  try {
    const vertical = typeof req.query.vertical === "string" ? req.query.vertical : undefined;
    const city = typeof req.query.city === "string" ? req.query.city : undefined;
    res.json(await schemaforge({ site, vertical, city }));
  } catch (e) {
    res.status(200).json({ ok: false, site, error: String(e.message || e) });
  }
});

// Paid: domain -> agent-ready company intelligence (enrichment, the #1 x402 earning category).
app.get("/enrich", async (req, res) => {
  const domain = req.query.domain || req.query.url;
  if (!domain || typeof domain !== "string") {
    return res.status(400).json({ ok: false, error: "missing required query param: domain (e.g. stripe.com)" });
  }
  try {
    res.json(await enrich(domain));
  } catch (e) {
    res.status(200).json({ ok: false, domain, error: String(e.message || e) });
  }
});

// Free landing so a human/agent hitting the root learns what this is + how to pay.
app.get("/", (_req, res) => {
  res.json({
    service: "x402 data + security gateway",
    what: "Pay USDC (Base mainnet, x402) per call. Three paid endpoints settle directly to our wallet.",
    paidRoutes: {
      "GET /extract?url=": `${EXTRACT_PRICE} — URL -> clean structured JSON (text, JSON-LD, OG, headings, links, AI-readiness signals).`,
      "GET /read?url=": `${READ_PRICE} — URL -> LLM-ready Markdown.`,
      "GET /scan?repo=": `${SCAN_PRICE} — static supply-chain security scan of a public GitHub repo before install.`,
      "GET /schemaforge?site=&vertical=&city=": `${SCHEMAFORGE_PRICE} — generate a paste-ready JSON-LD structured-data bundle + gap diff so a business page is eligible to be cited by AI assistants.`,
      "GET /enrich?domain=": `${ENRICH_PRICE} — domain -> agent-ready company intelligence: identity, tech stack, social, contact, DNS/email-infra, AI-readiness. No auth, pay-per-call.`,
    },
    network: NETWORK,
    payTo: PAY_TO,
    docs: "/healthz for config; /openapi.json for the spec; send an x402 payment to any paid route.",
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
