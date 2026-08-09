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
import {
  PAYMENT_IDENTIFIER,
  declarePaymentIdentifierExtension,
  paymentIdentifierResourceServerExtension,
} from "@x402/extensions/payment-identifier";
import { createFacilitatorConfig } from "@coinbase/x402";
import { createCommerceTrust } from "./commerce-trust.mjs";
import { extract, readMarkdown } from "./extract.mjs";
import { scanRepo } from "./scan.mjs";
import { schemaforge } from "./schemaforge.mjs";
import { enrich } from "./enrich.mjs";
import { walletEnrich } from "./wallet-enrich.mjs";
import { deepAudit } from "./deep-audit.mjs";
import { morphoPosition } from "./morpho-position.mjs";
import { morphoProtection } from "./morpho-protection.mjs";
import { morphoMarketUnderwrite } from "./morpho-market-underwrite.mjs";
import { morphoPreLiquidationReplay } from "./morpho-preliquidation-replay.mjs";
import {
  normalizeOpportunityPreflightInput,
  opportunityPreflight,
} from "./opportunity-preflight.mjs";
import { createReferralResolver } from "./referral.mjs";
import { fulfillThe402Job, verifyThe402Webhook } from "./the402.mjs";
import { createCommerceTelemetry } from "./commerce-events.mjs";
import { createIdempotencyReplay } from "./idempotency-replay.mjs";
import {
  A2A_VERSION,
  buildAgentCard,
  buildCatalogMessage,
  validateA2aMessage,
  validationProblem,
  versionProblem,
} from "./a2a-storefront.mjs";
import {
  PLATFORM_HEALTH_SCHEMA,
  buildPlatformHealthResponse,
  getPlatformHealthCard,
  listPlatformHealthCards,
} from "./platform-health.mjs";
import {
  renderAlertPilot,
  renderMethodology,
  renderPlatformCard,
  renderPlatformIndex,
  renderRobotsTxt,
} from "./platform-health-page.mjs";
import { z } from "zod";

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
// Wallet-enrich: 0x address -> agent-ready on-chain profile (EOA/contract, native + token holdings,
// token/NFT metadata, proxy + activity). Same ENRICHMENT category, aimed at the crypto-native agents who
// actually transact USDC on Base. Priced at the proven micro-band to maximize first-paid-call odds -> $0.05.
const WALLET_ENRICH_PRICE = process.env.WALLET_ENRICH_PRICE || "$0.05";
// Deep-audit: the bundled "deep" tier (enrich + schemaforge -> one AI-search-readiness audit).
// Premium tier; priced = schemaforge for strictly more value (env-overridable).
const DEEP_AUDIT_PRICE = process.env.DEEP_AUDIT_PRICE || "$0.25";
// Read-only deterministic Morpho position snapshot and stress canary.
const MORPHO_POSITION_PRICE = process.env.MORPHO_POSITION_PRICE || "$0.02";
// Protection quote: deterministic repair amounts plus unsigned approval/action templates.
const MORPHO_PROTECTION_PRICE = process.env.MORPHO_PROTECTION_PRICE || "$0.10";
// Market underwriting: multi-source market integrity, liquidity, concentration,
// health-band, history, and PreLiquidation evidence for agent policy engines.
const MORPHO_MARKET_UNDERWRITE_PRICE = process.env.MORPHO_MARKET_UNDERWRITE_PRICE || "$0.25";
// Historical PreLiquidation economics reconstructed from direct block-state reads.
const MORPHO_PRELIQUIDATION_REPLAY_PRICE = process.env.MORPHO_PRELIQUIDATION_REPLAY_PRICE || "$0.10";
// Work opportunity preflight: deterministic break-even and evidence gates for agents.
const OPPORTUNITY_PREFLIGHT_PRICE = process.env.OPPORTUNITY_PREFLIGHT_PRICE || "$0.05";

// "$0.05" -> "50000" atomic USDC units (6 decimals) so the discovery docs
// (/.well-known/x402, /openapi.json) always match the paywall price exactly.
const priceToAtomic = (p) =>
  String(Math.round(parseFloat(String(p).replace(/[^0-9.]/g, "")) * 1e6));

const PORT = process.env.PORT || 3000;
const THE402_API_KEY = process.env.THE402_API_KEY;
const THE402_WEBHOOK_SECRET = process.env.THE402_WEBHOOK_SECRET;
const THE402_SERVICE_ID = process.env.THE402_SERVICE_ID;

const AGENTHANSA_API_KEY = process.env.AGENTHANSA_API_KEY;
const TOPIFY_OFFER_ID =
  process.env.TOPIFY_OFFER_ID || "cd10af36-7e5b-460e-b74b-73c71fe3cf40";
const resolveTopifyReferral = createReferralResolver({
  apiKey: AGENTHANSA_API_KEY,
  offerId: TOPIFY_OFFER_ID,
});
const MANYCHAT_OFFER_ID =
  process.env.MANYCHAT_OFFER_ID || "1fd74c91-98f5-4b6f-bc1b-74f0d85438c1";
const resolveManyChatReferral = createReferralResolver({
  apiKey: AGENTHANSA_API_KEY,
  offerId: MANYCHAT_OFFER_ID,
});

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
resourceServer.registerExtension(paymentIdentifierResourceServerExtension);
const commerceTrust = createCommerceTrust({
  privateKey: process.env.RECEIPT_SIGNING_PRIVATE_KEY,
  network: NETWORK,
  includeTxHash: true,
});
if (commerceTrust.enabled) {
  resourceServer.registerExtension(commerceTrust.resourceServerExtension);
}
const COMMON_COMMERCE_EXTENSIONS = {
  [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(false),
  ...commerceTrust.routeExtensions,
};

// ---------------------------------------------------------------------------
// 3. APP + PAID ROUTE
// ---------------------------------------------------------------------------

const app = express();
// Railway terminates TLS before forwarding to Express. Trust exactly one proxy
// hop so x402 payment requirements preserve the public https:// resource URL.
app.set("trust proxy", 1);
app.use(express.json({
  limit: "16kb",
  type: ["application/json", "application/*+json"],
  verify(req, _res, buffer) {
    req.rawBody = Buffer.from(buffer);
  },
}));

const commerceTelemetry = createCommerceTelemetry();
app.use(commerceTelemetry.middleware);
const idempotencyReplay = createIdempotencyReplay();

// the402 marketplace bridge. Unlike the public x402 routes, the marketplace
// owns buyer payment and escrow. We authenticate signed dispatches, acknowledge
// immediately, run the audit, and post structured delivery to the official
// callback URL. Keys live only in Railway environment variables.
app.head("/integrations/the402/webhook", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  return res.status(200).end();
});

app.post("/integrations/the402/webhook", (req, res) => {
  const verification = verifyThe402Webhook({
    headers: req.headers,
    rawBody: req.rawBody,
    apiKey: THE402_API_KEY,
    webhookSecret: THE402_WEBHOOK_SECRET,
  });
  if (!verification.ok) {
    return res.status(verification.status).json({ ok: false, error: verification.error });
  }

  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.status(200).json({ ok: true, accepted: true, type: req.body?.type || null });

  setImmediate(() => {
    fulfillThe402Job(req.body, {
      apiKey: THE402_API_KEY,
      serviceId: THE402_SERVICE_ID,
      deepAudit,
    }).catch((error) => console.error(`the402 fulfillment failed: ${error.message}`));
  });
});

// Agoragentic distribution bridge. Agoragentic performs buyer routing,
// settlement, and seller accounting; this callback performs the actual audit.
// Keep it outside the x402 middleware so the marketplace can sandbox-verify and
// invoke it. A small per-IP limiter bounds unauthenticated direct use while the
// normal public product remains paid at GET /deep-audit.
const agoraWindows = new Map();
function allowAgoraBridge(req) {
  const key = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const current = agoraWindows.get(key);
  if (!current || current.resetAt <= now) {
    agoraWindows.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= 12) return false;
  current.count += 1;
  return true;
}

app.head("/integrations/agoragentic/ai-readiness-audit", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  return res.status(200).end();
});

app.post("/integrations/agoragentic/ai-readiness-audit", async (req, res) => {
  if (!allowAgoraBridge(req)) {
    res.set("Retry-After", "60");
    return res.status(429).json({ ok: false, error: "rate_limit_exceeded" });
  }

  const input = req.body?.input && typeof req.body.input === "object"
    ? req.body.input
    : req.body;
  const domain = input?.domain || input?.url;
  if (!domain || typeof domain !== "string" || domain.length > 253) {
    return res.status(400).json({
      ok: false,
      error: "domain is required and must be at most 253 characters",
    });
  }

  try {
    const result = await deepAudit(domain, {
      vertical: typeof input.vertical === "string" ? input.vertical : undefined,
      city: typeof input.city === "string" ? input.city : undefined,
    });
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
    return res.json(result);
  } catch (error) {
    return res.status(200).json({
      ok: false,
      domain,
      error: String(error?.message || error),
    });
  }
});

// Free health check (NOT behind paywall — used by Railway).
app.get("/healthz", async (_req, res) => {
  const telemetryStorage = await commerceTelemetry.storageStatus();
  const replayStorage = await idempotencyReplay.storageStatus();
  res.json({
    ok: true,
    payTo: PAY_TO,
    network: NETWORK,
    prices: { extract: EXTRACT_PRICE, read: READ_PRICE, scan: SCAN_PRICE, schemaforge: SCHEMAFORGE_PRICE, enrich: ENRICH_PRICE, "wallet-enrich": WALLET_ENRICH_PRICE, "deep-audit": DEEP_AUDIT_PRICE, "morpho-position": MORPHO_POSITION_PRICE, "morpho-protection": MORPHO_PROTECTION_PRICE, "morpho-market-underwrite": MORPHO_MARKET_UNDERWRITE_PRICE, "morpho-preliquidation-replay": MORPHO_PRELIQUIDATION_REPLAY_PRICE },
    facilitator: FACILITATOR,
    facilitatorUrl: facilitatorClient.url,
    commerceTelemetry: {
      storage: telemetryStorage,
      publicAggregate: "/v0/commerce-demand.json",
      privacy: "aggregate external observations only; raw event data is not exposed",
    },
    trustArtifacts: {
      paymentIdentifier: true,
      signedOfferReceipt: commerceTrust.enabled,
      requestBoundReplay: true,
      receiptSigner: commerceTrust.signerAddress,
      receiptKeyId: commerceTrust.keyId,
    },
    idempotencyReplay: replayStorage,
    the402: {
      configured: Boolean(THE402_API_KEY && THE402_WEBHOOK_SECRET),
      serviceConfigured: Boolean(THE402_SERVICE_ID),
    },
  });
});

app.get("/v0/commerce-demand.json", async (req, res) => {
  try {
    const days = typeof req.query.days === "string" ? Number(req.query.days) : 90;
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return res.json(await commerceTelemetry.snapshot({ days }));
  } catch (error) {
    return res.status(503).json({ ok: false, error: "commerce_telemetry_unavailable" });
  }
});

// Domain-verification file for x402 directories (402 Index instant approval).
// Free route (declared before the paywall). Hash set via env so it's editable without code changes.
app.get("/.well-known/402index-verify.txt", (_req, res) => {
  res.type("text/plain").send(
    process.env.INDEX402_VERIFY_HASH ||
      "a1d5312d7ee9189ae3cbb1eb74f0f3903001e373dab8dfb209a942a41be5a80b"
  );
});

// Durable, disclosed affiliate redirect used by SameDayDesk's AI-visibility
// tool guide. Agent Hansa referral URLs expire after 30 days, so resolve and
// cache a fresh signed URL server-side without exposing the agent API key.
app.get("/go/topify", async (_req, res) => {
  if (!AGENTHANSA_API_KEY) {
    return res.status(503).json({ error: "referral_not_configured" });
  }

  try {
    const referral = await resolveTopifyReferral();
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
    return res.redirect(302, referral.url);
  } catch {
    return res.status(502).json({ error: "referral_temporarily_unavailable" });
  }
});

// Same durable referral pattern for the practical social-DM automation guide.
// The public guide contains the recommendation and disclosure; this endpoint
// only keeps Agent Hansa's signed 30-day tracking URL fresh and secret-safe.
app.get("/go/manychat", async (_req, res) => {
  if (!AGENTHANSA_API_KEY) {
    return res.status(503).json({ error: "referral_not_configured" });
  }

  try {
    const referral = await resolveManyChatReferral();
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
    return res.redirect(302, referral.url);
  } catch {
    return res.status(502).json({ error: "referral_temporarily_unavailable" });
  }
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
  { url: `${PUBLIC_URL}/wallet-enrich`, amount: priceToAtomic(WALLET_ENRICH_PRICE), description: "Base/EVM address -> agent-ready on-chain profile in one call: EOA vs contract, native ETH + curated Base token holdings, token/NFT contract metadata (ERC-20/721/1155, name/symbol/decimals/supply), EIP-1967 proxy detection, activity (outbound tx count), and a single derived profile label. Pure Base-mainnet RPC, public data only; no keys, no subscription. The frictionless, pay-per-call way for an agent to size up a wallet/contract before it sends funds, swaps, or calls it.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/deep-audit`, amount: priceToAtomic(DEEP_AUDIT_PRICE), description: "Domain -> ONE complete AI-search-readiness audit: firmographics + tech stack + contact + DNS/email infra + a 0-100 AI-readiness score, PLUS a structured-data gap analysis with a paste-ready JSON-LD fix list and a combined letter grade. The bundled deep tier (enrich + schemaforge in one call). No auth, no API keys; pay-per-call USDC.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/defi/morpho-position`, amount: priceToAtomic(MORPHO_POSITION_PRICE), description: "Base address -> deterministic Morpho borrower position snapshot and collateral-price stress scenarios. Returns LTV, LLTV, health factor, liquidation headroom, source freshness, and scenario outcomes. Read-only indexed observation; direct RPC verification is required before execution.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/defi/morpho-protection`, amount: priceToAtomic(MORPHO_PROTECTION_PRICE), description: "Base Morpho borrower -> exact partial-repay and add-collateral amounts for a chosen stress and target health factor, plus unsigned approval/action templates and explicit invariants. Deterministic and read-only; no wallet, signing, broadcast, or custody.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/defi/morpho-market-underwrite`, amount: priceToAtomic(MORPHO_MARKET_UNDERWRITE_PRICE), description: "Base Morpho market -> deterministic underwriting facts: parameter integrity, direct-chain checks, liquidity, utilization, APY history, borrower concentration and health bands, bad debt, and PreLiquidation supply. Read-only evidence flags; no opaque score or capital action.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/defi/morpho-preliquidation-replay`, amount: priceToAtomic(MORPHO_PRELIQUIDATION_REPLAY_PRICE), description: "Base transaction -> deterministic Morpho PreLiquidation replay: strict event decode, block-time contract parameters and oracle price, repaid debt, seized collateral, gross incentive, and gas. Historical evidence only; no profitability claim or execution.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/work/opportunity-preflight`, amount: priceToAtomic(OPPORTUNITY_PREFLIGHT_PRICE), description: "Agent work opportunity -> deterministic attempt, verify-first, or abandon preflight using caller-supplied cost and selection assumptions plus dated platform evidence. Returns break-even probability, expected surplus, hard gates, and source-linked evidence. No claim, bid, payment, or submission.", mimeType: "application/json" },
];

const machineActionCatalog = () => ({
  schema: "samedaydesk.machine-actions.v1",
  service: "SameDayDesk machine commerce gateway",
  network: NETWORK,
  settlement: "x402 exact USDC on Base",
  payTo: PAY_TO,
  actions: RESOURCES.map((resource) => {
    const route = new URL(resource.url).pathname;
    return {
      name: route.replace(/^\//, "").replaceAll("/", "_"),
      method: "GET",
      route,
      url: resource.url,
      description: resource.description,
      priceAtomicUsdc: resource.amount,
      priceUsdc: Number(resource.amount) / 1e6,
      mimeType: resource.mimeType,
    };
  }),
  discovery: {
    manifest: `${PUBLIC_URL}/.well-known/x402`,
    openapi: `${PUBLIC_URL}/openapi.json`,
    skill: `${PUBLIC_URL}/skill.md`,
    mcp: `${PUBLIC_URL}/mcp`,
    a2aAgentCard: `${PUBLIC_URL}/.well-known/agent-card.json`,
  },
});

const agentCard = buildAgentCard({ publicUrl: PUBLIC_URL });

app.get(["/.well-known/x402", "/.well-known/x402.json", "/x402.json", "/api/x402"], (_req, res) => {
  res.json({
    x402Version: 2,
    lastUpdated: Math.floor(Date.now() / 1000),
    items: RESOURCES.map((r) => ({ resource: { url: r.url, description: r.description, mimeType: r.mimeType }, type: "http", accepts: acceptsFor(r.amount) })),
  });
});

// A browser or indexer sometimes probes MCP with GET before opening the
// streamable-HTTP POST transport. Return a free machine descriptor instead of
// a 405; actual tool discovery and calls remain on POST /mcp.
app.get("/mcp", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.json({
    name: "x402-data-gateway",
    transport: "streamable-http",
    endpoint: `${PUBLIC_URL}/mcp`,
    method: "POST",
    toolCount: RESOURCES.length,
    payment: "x402 USDC on Base per tool call",
    manifest: `${PUBLIC_URL}/.well-known/x402`,
    openapi: `${PUBLIC_URL}/openapi.json`,
  });
});

// Compact skill contract for agents that probe a domain for a directly usable
// instruction file before they parse OpenAPI or start an MCP session.
app.get(["/skill.md", "/SKILL.md"], (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.type("text/markdown").send(`# SameDayDesk machine commerce gateway

Use this service when an agent needs deterministic web, company, wallet, AI-search-readiness, repository-risk, agent-work opportunity economics, Morpho borrower-risk, market-underwriting evidence, historical PreLiquidation replay, or unsigned Morpho protection plans and can pay exact USDC on Base through x402.

## Discover

- x402 manifest: ${PUBLIC_URL}/.well-known/x402
- OpenAPI: ${PUBLIC_URL}/openapi.json
- Action catalog: ${PUBLIC_URL}/api/actions
- MCP transport: POST ${PUBLIC_URL}/mcp
- A2A agent card: ${PUBLIC_URL}/.well-known/agent-card.json

## Call and pay

1. Choose an action from the manifest or action catalog.
2. Send the declared GET request. An unpaid call returns HTTP 402 with x402 v2 payment requirements.
3. Verify the HTTPS resource, exact amount, Base network, canonical USDC asset, and payTo wallet.
4. Sign the exact payment authorization and replay the same request with the payment header.
5. Reconcile the payment response and result before continuing a workflow.

## Boundaries

- Morpho output is a read-only indexed snapshot with deterministic stress calculations. Verify direct RPC state before any financial action.
- Morpho protection output is a deterministic quote plus unsigned templates. Re-read, simulate, and apply caller policy before signing elsewhere.
- Morpho market underwriting exposes separate evidence flags rather than one opaque risk score. The caller owns policy and any capital decision.
- Morpho PreLiquidation replay reconstructs gross historical event economics. It does not infer net profit or future executability.
- Repository scan output is static evidence, not permission to execute untrusted code.
- Opportunity preflight uses caller-supplied cost and selection assumptions plus dated categorical platform evidence. It makes no claim, bid, payment, or submission on the source platform.
- Demand telemetry is aggregate and does not expose buyer identities or raw request data.
`);
});

app.get("/api/actions", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.json(machineActionCatalog());
});

// A2A v1.0 machine-facing storefront. This is intentionally a bounded free
// discovery agent: it returns the exact paid action catalog, then buyers call
// and settle the chosen x402 HTTP or MCP action through the existing routes.
app.get(["/.well-known/agent-card.json", "/.well-known/agent.json"], (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.json(agentCard);
});

app.get("/a2a", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.json({
    protocol: "A2A",
    version: A2A_VERSION,
    agentCard: `${PUBLIC_URL}/.well-known/agent-card.json`,
    sendMessage: `${PUBLIC_URL}/a2a/message:send`,
    skill: "discover-x402-paid-actions",
  });
});

app.post("/a2a/message:send", (req, res) => {
  const requestedVersion = String(req.get("A2A-Version") || A2A_VERSION);
  if (requestedVersion !== A2A_VERSION) {
    return res.status(400).type("application/problem+json").send(versionProblem(requestedVersion));
  }
  const invalid = validateA2aMessage(req.body);
  if (invalid) {
    return res.status(400).type("application/problem+json").send(validationProblem(invalid));
  }
  res.set("Cache-Control", "no-store");
  return res.type("application/a2a+json").send(buildCatalogMessage({
    request: req.body,
    catalog: machineActionCatalog(),
  }));
});
// --- /llms.txt: agent/LLM-native discovery surface (llmstxt.org convention).
// Free route. Tells crawling LLM agents what we sell and exactly how to pay (x402),
// the same channel our category peers (Melvea, cryptojp, img402) use to be found.
app.get("/llms.txt", (_req, res) => {
  const line = (path, price, desc) => `- [${path}](${PUBLIC_URL}${path}): ${price} USDC - ${desc}`;
  res.type("text/plain").send(`# SameDayDesk machine commerce gateway

> Machine-discoverable HTTP and MCP capabilities that settle USDC on Base through x402. No account or subscription is required. Current facilitator: ${FACILITATOR}. payTo ${PAY_TO} on Base mainnet (eip155:8453).

## Endpoints
${line("/defi/morpho-position", MORPHO_POSITION_PRICE, "Base borrower address -> deterministic Morpho LTV, LLTV, health factor, liquidation headroom, direct-RPC cross-check, and collateral-price stress scenarios. Read-only; scenarios are not probabilities.")}
${line("/defi/morpho-market-underwrite", MORPHO_MARKET_UNDERWRITE_PRICE, "Base market ID -> independently cross-checked parameters, liquidity, utilization, trailing APY, borrower concentration and health bands, bad debt, PreLiquidation supply, and explicit evidence flags. No opaque score.")}
${line("/defi/morpho-preliquidation-replay", MORPHO_PRELIQUIDATION_REPLAY_PRICE, "Base transaction hash -> strict PreLiquidate event replay with block-time parameters and oracle, repaid debt, seized collateral, gross protocol incentive, and gas. Gross evidence is not net profit.")}
${line("/enrich", ENRICH_PRICE, "domain -> agent-ready company intelligence: identity, industry keywords, tech stack, social profiles, contact surface, DNS + email infra (MX/SPF/DMARC), and an AI-readiness score. The frictionless, pay-per-call alternative to signup-gated Clearbit/Apollo.")}
${line("/wallet-enrich", WALLET_ENRICH_PRICE, "Base/EVM 0x address -> agent-ready on-chain profile: EOA vs contract, native ETH + token holdings, token/NFT contract metadata, proxy + activity signals, and a derived profile label. Pure Base RPC, no keys. Size up a wallet/contract before sending funds, swapping, or calling it.")}
${line("/extract", EXTRACT_PRICE, "URL -> clean structured data: title, description, text, all JSON-LD, OpenGraph/Twitter meta, headings, links, AI-readiness signals.")}
${line("/read", READ_PRICE, "URL -> full page content as clean Markdown, ready for LLM context.")}
${line("/scan", SCAN_PRICE, "static supply-chain security scan of a public GitHub repo before an agent installs/runs it; flags exfil sinks, credential reads, install-time curl|bash.")}
${line("/schemaforge", SCHEMAFORGE_PRICE, "business site -> paste-ready JSON-LD structured-data bundle + a gap diff vs the live site.")}
${line("/deep-audit", DEEP_AUDIT_PRICE, "domain -> bundled AI-search-readiness audit with firmographics, technical signals, structured-data gaps, and a paste-ready fix list.")}

## How to pay (x402)
1. GET an endpoint (e.g. ${PUBLIC_URL}/enrich?domain=stripe.com). You receive HTTP 402 with the payment requirements.
2. Pay the quoted USDC amount on Base to ${PAY_TO} with any x402 client (@x402/fetch, x402-axios, Coinbase AgentKit).
3. Replay the request with the X-PAYMENT header. You receive the JSON result.

## Discovery
- x402 manifest: ${PUBLIC_URL}/.well-known/x402
- OpenAPI: ${PUBLIC_URL}/openapi.json
- Skill contract: ${PUBLIC_URL}/skill.md
- Action catalog: ${PUBLIC_URL}/api/actions
- A2A agent card: ${PUBLIC_URL}/.well-known/agent-card.json
- Aggregate demand telemetry: ${PUBLIC_URL}/v0/commerce-demand.json
- Source: https://github.com/epistemedeus/x402-url-extractor
`);
});

app.get("/robots.txt", (_req, res) => {
  res.set("Cache-Control", "public, max-age=86400");
  return res.type("text/plain").send(renderRobotsTxt(PUBLIC_URL));
});

app.get("/sitemap.xml", (_req, res) => {
  const locations = [
    "/",
    "/platforms",
    "/platforms/methodology",
    ...listPlatformHealthCards().map((card) => `/platforms/${card.platform_id}`),
    "/alerts",
  ];
  const urls = locations
    .map((pathname) => `  <url><loc>${PUBLIC_URL}${pathname}</loc></url>`)
    .join("\n");
  res.set("Cache-Control", "public, max-age=3600");
  return res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

// Free Settlement Radar v0. This is evidence-backed discovery, not a paid
// score API. Keep it before the x402 middleware so users can inspect the proof
// asset before joining the alert demand test.
const setRadarCache = (res) => res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=900");

app.get(["/radar", "/platforms"], (_req, res) => {
  setRadarCache(res);
  return res.type("html").send(renderPlatformIndex(listPlatformHealthCards()));
});

app.get("/platforms/methodology", (_req, res) => {
  setRadarCache(res);
  return res.type("html").send(renderMethodology());
});

app.get("/platforms/:platformId", (req, res) => {
  const card = getPlatformHealthCard(req.params.platformId);
  if (!card) return res.status(404).json({ ok: false, error: "platform_card_not_found" });
  setRadarCache(res);
  return res.type("html").send(renderPlatformCard(card));
});

app.get("/v0/cards.json", (_req, res) => {
  setRadarCache(res);
  return res.json(buildPlatformHealthResponse());
});

app.get("/schemas/platform-health-card-v0.json", (_req, res) => {
  setRadarCache(res);
  return res.json(PLATFORM_HEALTH_SCHEMA);
});

app.get("/alerts", (_req, res) => {
  res.set("Cache-Control", "no-store");
  return res.type("html").send(renderAlertPilot());
});

app.get(["/openapi.json", "/openapi.yaml", "/swagger.json"], (_req, res) => {
  res.json({
    openapi: "3.0.3",
    info: { title: "SameDayDesk machine commerce gateway", version: "1.8.0", description: `Twelve machine-discoverable paid capabilities on Base: work opportunity preflight ${OPPORTUNITY_PREFLIGHT_PRICE}, AI-search readiness audit ${DEEP_AUDIT_PRICE}, Morpho position risk ${MORPHO_POSITION_PRICE}, protection plans ${MORPHO_PROTECTION_PRICE}, market underwriting ${MORPHO_MARKET_UNDERWRITE_PRICE}, PreLiquidation replay ${MORPHO_PRELIQUIDATION_REPLAY_PRICE}, company enrichment ${ENRICH_PRICE}, wallet enrichment ${WALLET_ENRICH_PRICE}, URL extraction ${EXTRACT_PRICE}, Markdown reading ${READ_PRICE}, repository scan ${SCAN_PRICE}, and structured data ${SCHEMAFORGE_PRICE}. payTo ${PAY_TO}` },
    servers: [{ url: PUBLIC_URL }],
    paths: {
      "/v0/cards.json": { get: { summary: "Free incident-backed platform health cards. Categories are not calibrated scores.", responses: { "200": { description: "SameDayDesk platform health index v0" } } } },
      "/v0/commerce-demand.json": { get: { summary: "Privacy-safe aggregate external machine-commerce observations.", parameters: [{ name: "days", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 365, default: 90 } }], responses: { "200": { description: "Aggregate discovery, challenge, paid-success, unmatched-request, and high-precision semantic-candidate counts. Known internal and crawler traffic is excluded; unidentified automation can remain." } } } },
      "/.well-known/agent-card.json": { get: { summary: "A2A v1.0 agent card for the free machine-commerce storefront.", responses: { "200": { description: "A2A AgentCard" } } } },
      "/a2a/message:send": { post: { summary: "Return the exact-price x402 action catalog as an A2A direct message.", responses: { "200": { description: "A2A message containing the action catalog" }, "400": { description: "Invalid request or unsupported A2A version" } } } },
      "/platforms": { get: { summary: "Human-readable Settlement Radar health cards.", responses: { "200": { description: "HTML platform health index" } } } },
      "/work/opportunity-preflight": { get: { summary: RESOURCES[11].description, parameters: [{ name: "platform", in: "query", required: false, schema: { type: "string", example: "taskmarket" } }, { name: "rewardUsd", in: "query", required: true, schema: { type: "number", exclusiveMinimum: 0 } }, { name: "hours", in: "query", required: true, schema: { type: "number", minimum: 0 } }, { name: "hourlyCostUsd", in: "query", required: true, schema: { type: "number", minimum: 0 } }, { name: "computeUsd", in: "query", required: false, schema: { type: "number", minimum: 0, default: 0 } }, { name: "mandatorySpendUsd", in: "query", required: false, schema: { type: "number", minimum: 0, default: 0 } }, { name: "reusableValueUsd", in: "query", required: false, schema: { type: "number", minimum: 0, default: 0 } }, { name: "selectionProbabilityPct", in: "query", required: false, schema: { type: "number", minimum: 0, maximum: 100 } }, { name: "competition", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } }, { name: "slots", in: "query", required: false, schema: { type: "integer", minimum: 1, default: 1 } }, { name: "agentAccess", in: "query", required: false, schema: { type: "string", enum: ["agent_allowed", "agent_only", "mixed", "human_only", "unknown"], default: "unknown" } }, { name: "acceptance", in: "query", required: false, schema: { type: "string", enum: ["deterministic", "machine_scored", "timed_review", "discretionary", "unknown"], default: "unknown" } }, { name: "settlement", in: "query", required: false, schema: { type: "string", enum: ["direct", "escrow", "platform_balance", "discretionary", "unfunded", "unknown"], default: "unknown" } }], responses: { "200": { description: "deterministic opportunity economics and evidence preflight" }, "400": { description: "invalid required input, charged nothing" }, "402": { description: `payment required (x402, ${OPPORTUNITY_PREFLIGHT_PRICE} USDC base)` } } } },
      "/extract": { get: { summary: RESOURCES[0].description, parameters: [{ name: "url", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "structured data" }, "402": { description: `payment required (x402, ${EXTRACT_PRICE} USDC base)` } } } },
      "/read": { get: { summary: RESOURCES[1].description, parameters: [{ name: "url", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "markdown" }, "402": { description: `payment required (x402, ${READ_PRICE} USDC base)` } } } },
      "/scan": { get: { summary: RESOURCES[2].description, parameters: [{ name: "repo", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "security risk report" }, "402": { description: `payment required (x402, ${SCAN_PRICE} USDC base)` } } } },
      "/schemaforge": { get: { summary: RESOURCES[3].description, parameters: [{ name: "site", in: "query", required: true, schema: { type: "string" } }, { name: "vertical", in: "query", required: false, schema: { type: "string" } }, { name: "city", in: "query", required: false, schema: { type: "string" } }], responses: { "200": { description: "paste-ready JSON-LD bundle + gap diff + fix list" }, "402": { description: `payment required (x402, ${SCHEMAFORGE_PRICE} USDC base)` } } } },
      "/enrich": { get: { summary: RESOURCES[4].description, parameters: [{ name: "domain", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "agent-ready company intelligence (identity, tech, social, contact, DNS, AI-readiness)" }, "402": { description: `payment required (x402, ${ENRICH_PRICE} USDC base)` } } } },
      "/wallet-enrich": { get: { summary: RESOURCES[5].description, parameters: [{ name: "address", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "agent-ready on-chain profile (type, native + token holdings, contract/token metadata, proxy, activity, profile label)" }, "402": { description: `payment required (x402, ${WALLET_ENRICH_PRICE} USDC base)` } } } },
      "/deep-audit": { get: { summary: RESOURCES[6].description, parameters: [{ name: "domain", in: "query", required: true, schema: { type: "string", example: "example.com" } }, { name: "vertical", in: "query", required: false, schema: { type: "string" } }, { name: "city", in: "query", required: false, schema: { type: "string" } }], responses: { "200": { description: "bundled AI-search-readiness audit with firmographics, infrastructure, structured-data gaps, and a fix list" }, "402": { description: `payment required (x402, ${DEEP_AUDIT_PRICE} USDC base)` } } } },
      "/defi/morpho-position": { get: { summary: RESOURCES[7].description, parameters: [{ name: "address", in: "query", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }, { name: "shocks", in: "query", required: false, description: "Comma-separated collateral price shocks in percent, from -99 through 100.", schema: { type: "string", example: "-10,-20,-30" } }], responses: { "200": { description: "read-only Morpho position snapshot and deterministic stress scenarios" }, "402": { description: `payment required (x402, ${MORPHO_POSITION_PRICE} USDC base)` } } } },
      "/defi/morpho-protection": { get: { summary: RESOURCES[8].description, parameters: [{ name: "address", in: "query", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }, { name: "targetHealthFactor", in: "query", required: false, description: "Target Morpho health factor after the stress scenario.", schema: { type: "number", exclusiveMinimum: 1, maximum: 5, default: 1.25 } }, { name: "protectAgainstShockPct", in: "query", required: false, description: "Collateral-price shock percentage to withstand.", schema: { type: "number", minimum: -99, maximum: 0, default: -10 } }, { name: "executionBufferBps", in: "query", required: false, description: "Explicit amount buffer for debt accrual and integer rounding.", schema: { type: "integer", minimum: 0, maximum: 500, default: 25 } }], responses: { "200": { description: "deterministic protection quote with unsigned transaction templates" }, "400": { description: "invalid request, charged nothing" }, "402": { description: `payment required (x402, ${MORPHO_PROTECTION_PRICE} USDC base)` } } } },
      "/defi/morpho-market-underwrite": { get: { summary: RESOURCES[9].description, parameters: [{ name: "marketId", in: "query", required: true, description: "Morpho market ID on Base mainnet.", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } }], responses: { "200": { description: "deterministic multi-source Morpho market underwriting evidence" }, "400": { description: "invalid request, charged nothing" }, "402": { description: `payment required (x402, ${MORPHO_MARKET_UNDERWRITE_PRICE} USDC base)` } } } },
      "/defi/morpho-preliquidation-replay": { get: { summary: RESOURCES[10].description, parameters: [{ name: "transactionHash", in: "query", required: true, description: "Successful Base transaction containing a Morpho PreLiquidate event.", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } }], responses: { "200": { description: "historical deterministic Morpho PreLiquidation event replay" }, "400": { description: "invalid request, charged nothing" }, "402": { description: `payment required (x402, ${MORPHO_PRELIQUIDATION_REPLAY_PRICE} USDC base)` } } } },
    },
  });
});

// Return a short-lived response for an exact logical retry before validation or
// settlement. Changed request bindings fail with an uncharged 409.
app.use(idempotencyReplay.middleware);

// Validate the higher-value quote before the x402 middleware so malformed calls
// fail with HTTP 400 and are never challenged for payment.
app.get("/defi/morpho-protection", (req, res, next) => {
  const address = req.query.address || req.query.wallet || req.query.borrower;
  const target = req.query.targetHealthFactor ?? "1.25";
  const shock = req.query.protectAgainstShockPct ?? "-10";
  const buffer = req.query.executionBufferBps ?? "25";
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ ok: false, error: "address must be a 0x-prefixed 40-hex EVM address", charged: false });
  }
  if (!Number.isFinite(Number(target)) || Number(target) <= 1 || Number(target) > 5) {
    return res.status(400).json({ ok: false, error: "targetHealthFactor must be greater than 1 and at most 5", charged: false });
  }
  if (!Number.isFinite(Number(shock)) || Number(shock) < -99 || Number(shock) > 0) {
    return res.status(400).json({ ok: false, error: "protectAgainstShockPct must be from -99 through 0", charged: false });
  }
  if (!Number.isInteger(Number(buffer)) || Number(buffer) < 0 || Number(buffer) > 500) {
    return res.status(400).json({ ok: false, error: "executionBufferBps must be an integer from 0 through 500", charged: false });
  }
  return next();
});

// Validate the market identifier before payment so malformed calls are free.
app.get("/defi/morpho-market-underwrite", (req, res, next) => {
  const marketId = req.query.marketId || req.query.market || req.query.id;
  if (typeof marketId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(marketId)) {
    return res.status(400).json({ ok: false, error: "marketId must be a 0x-prefixed 32-byte hex value", charged: false });
  }
  return next();
});

app.get("/defi/morpho-preliquidation-replay", (req, res, next) => {
  const transactionHash = req.query.transactionHash || req.query.tx || req.query.hash;
  if (typeof transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
    return res.status(400).json({ ok: false, error: "transactionHash must be a 0x-prefixed 32-byte hex value", charged: false });
  }
  return next();
});

// Validate explicit opportunity economics before payment. Malformed or
// incomplete required inputs return an uncharged 400.
app.get("/work/opportunity-preflight", (req, res, next) => {
  try {
    normalizeOpportunityPreflightInput(req.query);
    return next();
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: String(error?.message || error),
      charged: false,
    });
  }
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
          ...COMMON_COMMERCE_EXTENSIONS,
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
          ...COMMON_COMMERCE_EXTENSIONS,
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
          ...COMMON_COMMERCE_EXTENSIONS,
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
          "Business website -> deterministic, paste-ready JSON-LD bundle plus a live structured-data gap analysis and ranked fixes. Covers local business and service, FAQ, offer catalog, reviews, geo, and opening hours. Rating and review fields remain explicit placeholders for the business's real values.",
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
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
          "Public domain -> structured company intelligence for agents: identity, keywords, tech stack, social and contact surface, DNS and email infrastructure, and AI-search-readiness signals with a 0-100 score. Public data only; no account, API key, or subscription.",
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
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
                company: { name: "Stripe", legalName: "Stripe, LLC", description: "Financial services platform...", logo: "https://.../favicon.svg", keywords: ["stripe", "financial", "infrastructure", "payments", "revenue"], keywordsSource: "derived" },
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
      "GET /deep-audit": {
        accepts: [{ scheme: "exact", price: DEEP_AUDIT_PRICE, network: NETWORK, payTo: PAY_TO }],
        description:
          "Domain -> one complete AI-search-readiness audit (firmographics + tech + contact + DNS/email infra + a 0-100 AI-readiness score + a structured-data gap analysis with a paste-ready JSON-LD fix list + a combined letter grade). The bundled deep tier = enrich + schemaforge in one call. Public data only; no auth, no API keys, no subscription.",
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryExtension({
            input: { domain: "stripe.com", vertical: "fintech", city: "San Francisco" },
            inputSchema: {
              type: "object",
              properties: {
                domain: { type: "string", description: "A public domain or URL, for example stripe.com." },
                vertical: { type: "string", description: "Optional business vertical used to tune the structured-data gap analysis." },
                city: { type: "string", description: "Optional city used to tune local-business structured data." },
              },
              required: ["domain"],
            },
            output: {
              example: {
                ok: true,
                product: "deep-audit",
                domain: "stripe.com",
                summary: {
                  aiReadinessScore: 84,
                  structuredDataGaps: 2,
                  hasJsonLd: true,
                  grade: "B (78/100)",
                },
                components: { enrich: true, schemaforge: true },
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                product: { type: "string", const: "deep-audit" },
                domain: { type: "string" },
                summary: { type: "object" },
                identity: { type: ["object", "null"] },
                structuredData: { type: ["object", "null"] },
                components: { type: "object" },
              },
              required: ["ok", "product", "domain", "summary", "components"],
            },
          }),
        },
      },
      "GET /wallet-enrich": {
        accepts: [{ scheme: "exact", price: WALLET_ENRICH_PRICE, network: NETWORK, payTo: PAY_TO }],
        description:
          "Base address -> agent-ready on-chain profile: EOA or contract, ETH and major-token holdings, token or NFT metadata, EIP-1967 proxy detection, activity, and a derived profile label. Uses public Base mainnet RPC with no account or API key. Useful before an agent sends funds, swaps, or calls a contract.",
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryExtension({
            input: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
            inputSchema: {
              type: "object",
              properties: { address: { type: "string", description: "A Base/EVM address (0x + 40 hex), e.g. 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } },
              required: ["address"],
            },
            output: {
              example: {
                ok: true,
                address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                network: "base-mainnet (eip155:8453)",
                type: "contract",
                native: { symbol: "ETH", balance: "0.0098" },
                tokenHoldings: [{ symbol: "USDC", amount: "1000.0", kind: "stable" }],
                holdingsSummary: { distinctTokens: 1, stablecoinUnits: 1000, hasStablecoins: true },
                contract: { standard: "ERC-20 (token)", token: { symbol: "USDC", name: "USD Coin", decimals: 6, totalSupply: "4157703919.56" } },
                profile: "token-contract:USDC",
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                address: { type: "string" },
                type: { type: "string", enum: ["eoa", "contract"] },
                native: { type: "object" },
                tokenHoldings: { type: "array" },
                holdingsSummary: { type: "object" },
                contract: { type: "object" },
                activity: { type: "object" },
                profile: { type: "string" },
              },
              required: ["ok", "address", "type"],
            },
          }),
        },
      },
      "GET /defi/morpho-position": {
        accepts: [{ scheme: "exact", price: MORPHO_POSITION_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[7].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryExtension({
            input: {
              address: "0x4352Cc849b33a936Ad93bB109aFDec1c89653b4f",
              shocks: "-10,-20,-30",
            },
            inputSchema: {
              type: "object",
              properties: {
                address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "Borrower EVM address on Base mainnet." },
                shocks: { type: "string", description: "Optional comma-separated collateral-price shocks in percent." },
              },
              required: ["address"],
            },
            output: {
              example: {
                ok: true,
                chain: { id: 8453, name: "Base mainnet" },
                positionCount: 1,
                positions: [{ marketId: "0x...", risk: { currentLtvPct: 72, liquidationLtvPct: 86, healthFactor: 1.194, liquidatableAtIndexedState: false }, scenarios: [{ collateralPriceShockPct: -10, healthFactor: 1.075, liquidatable: false }] }],
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                address: { type: "string" },
                chain: { type: "object" },
                fetchedAt: { type: "string" },
                latestIndexedAt: { type: "string", nullable: true },
                positionCount: { type: "integer" },
                positions: { type: "array" },
                source: { type: "object" },
                boundary: { type: "string" },
              },
              required: ["ok", "address", "chain", "positionCount", "positions", "source", "boundary"],
            },
          }),
        },
      },
      "GET /defi/morpho-protection": {
        accepts: [{ scheme: "exact", price: MORPHO_PROTECTION_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[8].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryExtension({
            input: {
              address: "0x4352Cc849b33a936Ad93bB109aFDec1c89653b4f",
              targetHealthFactor: 1.25,
              protectAgainstShockPct: -10,
              executionBufferBps: 25,
            },
            inputSchema: {
              type: "object",
              properties: {
                address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "Borrower EVM address on Base mainnet." },
                targetHealthFactor: { type: "number", exclusiveMinimum: 1, maximum: 5, default: 1.25 },
                protectAgainstShockPct: { type: "number", minimum: -99, maximum: 0, default: -10 },
                executionBufferBps: { type: "integer", minimum: 0, maximum: 500, default: 25 },
              },
              required: ["address"],
            },
            output: {
              example: {
                ok: true,
                product: "morpho-protection-quote",
                positionCount: 1,
                actionableCount: 1,
                quotes: [{ status: "protection_available", plans: [{ id: "partial_repay", amount: "125.4", transactions: [{ to: "0x...", value: "0", data: "0x..." }] }] }],
                invariants: { signing: "none", broadcasting: "none", custody: "none" },
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                product: { type: "string", const: "morpho-protection-quote" },
                address: { type: "string" },
                inputs: { type: "object" },
                positionCount: { type: "integer" },
                actionableCount: { type: "integer" },
                unverifiedCount: { type: "integer" },
                quotes: { type: "array" },
                invariants: { type: "object" },
                boundary: { type: "string" },
              },
              required: ["ok", "product", "address", "inputs", "positionCount", "actionableCount", "unverifiedCount", "quotes", "invariants", "boundary"],
            },
          }),
        },
      },
      "GET /defi/morpho-market-underwrite": {
        accepts: [{ scheme: "exact", price: MORPHO_MARKET_UNDERWRITE_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[9].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryExtension({
            input: {
              marketId: "0xbd9754505799c229af1b85a02e4f5cda74603411ba7edb585025eefd7ef9e5f4",
            },
            inputSchema: {
              type: "object",
              properties: {
                marketId: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$", description: "Morpho market ID on Base mainnet." },
              },
              required: ["marketId"],
            },
            output: {
              example: {
                ok: true,
                product: "morpho-market-underwrite",
                marketId: "0x...",
                market: { listed: true, state: { utilizationPct: 72, liquidityAssetsUsd: 500000 } },
                borrowers: { totalCount: 24, concentration: { top1BorrowPct: 18, top5BorrowPct: 51 }, healthBands: { below1_05: 0 } },
                verification: { marketParamsHashMatches: true, restMatchesGraphql: true, directRpc: { verdict: "stored_state_exact_match" } },
                decisionChecks: [{ id: "market_params_integrity", status: "pass" }],
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                product: { type: "string", const: "morpho-market-underwrite" },
                marketId: { type: "string" },
                chain: { type: "object" },
                market: { type: "object" },
                trailingApy: { type: "object" },
                history: { type: "object" },
                borrowers: { type: "object" },
                preLiquidation: { type: "object" },
                verification: { type: "object" },
                decisionChecks: { type: "array" },
                boundary: { type: "string" },
              },
              required: ["ok", "product", "marketId", "chain", "market", "borrowers", "verification", "decisionChecks", "boundary"],
            },
          }),
        },
      },
      "GET /defi/morpho-preliquidation-replay": {
        accepts: [{ scheme: "exact", price: MORPHO_PRELIQUIDATION_REPLAY_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[10].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryExtension({
            input: {
              transactionHash: "0xa8d73ec64db7a9e801ab78956133db0799e54e1a9c4a58231cd31ec3b90d9dc6",
            },
            inputSchema: {
              type: "object",
              properties: {
                transactionHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$", description: "Successful Base transaction containing a Morpho PreLiquidate event." },
              },
              required: ["transactionHash"],
            },
            output: {
              example: {
                ok: true,
                product: "morpho-preliquidation-replay",
                transaction: { hash: "0x...", status: "success", gasCostEth: "0.00014" },
                eventCount: 1,
                events: [{ assets: { repaid: { symbol: "USDC", amount: "26.27" }, seized: { symbol: "cbBTC", amount: "0.000427" } }, grossEconomics: { incentiveInLoanAmount: "1.15", incentivePct: 4.38 } }],
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                product: { type: "string", const: "morpho-preliquidation-replay" },
                chain: { type: "object" },
                transaction: { type: "object" },
                eventCount: { type: "integer" },
                events: { type: "array" },
                verification: { type: "object" },
                boundary: { type: "string" },
              },
              required: ["ok", "product", "chain", "transaction", "eventCount", "events", "verification", "boundary"],
            },
          }),
        },
      },
      "GET /work/opportunity-preflight": {
        accepts: [{ scheme: "exact", price: OPPORTUNITY_PREFLIGHT_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[11].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryExtension({
            input: {
              platform: "taskmarket",
              rewardUsd: 10,
              hours: 0.25,
              hourlyCostUsd: 4,
              computeUsd: 0.5,
              mandatorySpendUsd: 0,
              reusableValueUsd: 1,
              selectionProbabilityPct: 2,
              competition: 80,
              slots: 1,
              agentAccess: "agent_allowed",
              acceptance: "discretionary",
              settlement: "escrow",
            },
            inputSchema: {
              type: "object",
              properties: {
                platform: { type: "string", description: "Optional platform ID from the free Settlement Radar, such as gofrantic or taskmarket." },
                rewardUsd: { type: "number", exclusiveMinimum: 0, description: "Gross reward in USD or stablecoin-equivalent units." },
                hours: { type: "number", minimum: 0, description: "Expected execution and QA hours." },
                hourlyCostUsd: { type: "number", minimum: 0, description: "Caller's fully loaded hourly opportunity cost." },
                computeUsd: { type: "number", minimum: 0, default: 0 },
                mandatorySpendUsd: { type: "number", minimum: 0, default: 0 },
                reusableValueUsd: { type: "number", minimum: 0, default: 0, description: "Conservative value retained even if the reward is not selected." },
                selectionProbabilityPct: { type: "number", minimum: 0, maximum: 100, description: "Caller-supplied overall reward probability. Omit to receive verify_first." },
                competition: { type: "integer", minimum: 0, default: 0 },
                slots: { type: "integer", minimum: 1, default: 1 },
                agentAccess: { type: "string", enum: ["agent_allowed", "agent_only", "mixed", "human_only", "unknown"], default: "unknown" },
                acceptance: { type: "string", enum: ["deterministic", "machine_scored", "timed_review", "discretionary", "unknown"], default: "unknown" },
                settlement: { type: "string", enum: ["direct", "escrow", "platform_balance", "discretionary", "unfunded", "unknown"], default: "unknown" },
              },
              required: ["rewardUsd", "hours", "hourlyCostUsd"],
            },
            output: {
              example: {
                ok: true,
                product: "samedaydesk-opportunity-preflight",
                decision: "abandon",
                economics: {
                  totalAtRiskUsd: 1.5,
                  expectedSurplusUsd: -0.3,
                  breakEvenSelectionProbabilityPct: 5,
                  equalEntryShareReferencePct: 1.25,
                },
                gates: { hardBlocks: [], requiredChecks: [], warnings: ["platform_has_observed_oversupply_or_selection_dilution"] },
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                product: { type: "string", const: "samedaydesk-opportunity-preflight" },
                version: { type: "string" },
                decision: { type: "string", enum: ["attempt", "verify_first", "abandon"] },
                input: { type: "object" },
                economics: { type: "object" },
                gates: { type: "object" },
                platformEvidence: { type: ["object", "null"] },
                boundary: { type: "string" },
              },
              required: ["ok", "product", "version", "decision", "input", "economics", "gates", "platformEvidence", "boundary"],
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

// Paid: domain -> ONE bundled AI-search-readiness audit (enrich + schemaforge). The premium "deep" tier.
app.get("/deep-audit", async (req, res) => {
  const domain = req.query.domain || req.query.url;
  if (!domain || typeof domain !== "string") {
    return res.status(400).json({ ok: false, error: "missing required query param: domain (e.g. stripe.com)" });
  }
  try {
    res.json(await deepAudit(domain, { vertical: req.query.vertical, city: req.query.city }));
  } catch (e) {
    res.status(200).json({ ok: false, domain, error: String(e.message || e) });
  }
});

// Paid: Base/EVM address -> agent-ready on-chain profile (enrichment, aimed at crypto-native agent buyers).
app.get("/wallet-enrich", async (req, res) => {
  const address = req.query.address || req.query.wallet || req.query.addr;
  if (!address || typeof address !== "string") {
    return res.status(400).json({ ok: false, error: "missing required query param: address (a 0x EVM address)" });
  }
  try {
    res.json(await walletEnrich(address));
  } catch (e) {
    res.status(200).json({ ok: false, address, error: String(e.message || e) });
  }
});

// Paid: Base borrower address -> read-only Morpho position snapshot and deterministic stress scenarios.
app.get("/defi/morpho-position", async (req, res) => {
  const address = req.query.address || req.query.wallet || req.query.borrower;
  if (!address || typeof address !== "string") {
    return res.status(400).json({ ok: false, error: "missing required query param: address (a 0x EVM address)" });
  }
  const shocks = typeof req.query.shocks === "string"
    ? req.query.shocks.split(",").map((value) => value.trim()).filter(Boolean)
    : undefined;
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await morphoPosition(address, { shocks }));
  } catch (error) {
    return res.status(200).json({
      ok: false,
      address,
      error: String(error?.message || error),
      boundary: "No transaction was prepared or executed.",
    });
  }
});

// Paid: deterministic Morpho protection quote plus unsigned transaction plans.
app.get("/defi/morpho-protection", async (req, res) => {
  const address = req.query.address || req.query.wallet || req.query.borrower;
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await morphoProtection(address, {
      targetHealthFactor: req.query.targetHealthFactor ?? "1.25",
      protectAgainstShockPct: req.query.protectAgainstShockPct ?? -10,
      executionBufferBps: Number(req.query.executionBufferBps ?? 25),
    }));
  } catch (error) {
    return res.status(503).json({
      ok: false,
      address,
      error: String(error?.message || error),
      boundary: "No wallet was accessed and no transaction was signed or broadcast.",
    });
  }
});

// Paid: deterministic, multi-source Morpho market underwriting evidence.
app.get("/defi/morpho-market-underwrite", async (req, res) => {
  const marketId = req.query.marketId || req.query.market || req.query.id;
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await morphoMarketUnderwrite(marketId));
  } catch (error) {
    return res.status(503).json({
      ok: false,
      marketId,
      error: String(error?.message || error),
      boundary: "No wallet was accessed, no capital was allocated, and no transaction was prepared, signed, or broadcast.",
    });
  }
});

app.get("/defi/morpho-preliquidation-replay", async (req, res) => {
  const transactionHash = req.query.transactionHash || req.query.tx || req.query.hash;
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await morphoPreLiquidationReplay(transactionHash));
  } catch (error) {
    return res.status(503).json({
      ok: false,
      transactionHash,
      error: String(error?.message || error),
      boundary: "No wallet was accessed and no transaction was prepared, signed, broadcast, or funded.",
    });
  }
});

// Paid: deterministic opportunity economics and evidence preflight. This route
// reads no account and performs no claim, bid, submission, or payment action on
// the source platform.
app.get("/work/opportunity-preflight", async (req, res) => {
  try {
    const platform = typeof req.query.platform === "string" ? req.query.platform.trim().toLowerCase() : null;
    const platformCard = platform ? getPlatformHealthCard(platform) : null;
    res.set("Cache-Control", "no-store");
    return res.json(opportunityPreflight(req.query, { platformCard }));
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: String(error?.message || error),
      boundary: "No source-platform account, claim, bid, payment, or submission was touched.",
    });
  }
});

// Free landing so a human/agent hitting the root learns what this is + how to pay.
app.get("/", (_req, res) => {
  res.json({
    service: "SameDayDesk agent evidence + x402 gateway",
    what: "Free incident-backed platform health plus pay-per-call data tools that settle USDC on Base.",
    settlementRadar: {
      pages: "/platforms",
      json: "/v0/cards.json",
      methodology: "/platforms/methodology",
      alertPilot: "/alerts",
      boundary: "Categories are dated observations, not calibrated reliability scores or payout guarantees.",
    },
    machineCommerce: {
      manifest: "/.well-known/x402",
      manifestAliases: ["/.well-known/x402.json", "/x402.json", "/api/x402"],
      openapi: "/openapi.json",
      openapiAliases: ["/openapi.yaml", "/swagger.json"],
      skill: "/skill.md",
      actions: "/api/actions",
      llms: "/llms.txt",
      mcp: "POST /mcp",
      a2aAgentCard: "/.well-known/agent-card.json",
      a2aSendMessage: "POST /a2a/message:send",
      aggregateDemand: "/v0/commerce-demand.json",
      flow: "discover -> validate schema and price -> pay -> call -> receive deterministic result and receipt -> safely replay the same logical request",
    },
    paidRoutes: {
      "GET /extract?url=": `${EXTRACT_PRICE} - URL -> clean structured JSON (text, JSON-LD, OG, headings, links, AI-readiness signals).`,
      "GET /read?url=": `${READ_PRICE} - URL -> LLM-ready Markdown.`,
      "GET /scan?repo=": `${SCAN_PRICE} - static supply-chain security scan of a public GitHub repo before install.`,
      "GET /schemaforge?site=&vertical=&city=": `${SCHEMAFORGE_PRICE} - generate a paste-ready JSON-LD structured-data bundle + gap diff so a business page is eligible to be cited by AI assistants.`,
      "GET /enrich?domain=": `${ENRICH_PRICE} - domain -> agent-ready company intelligence: identity, tech stack, social, contact, DNS/email-infra, AI-readiness. No auth, pay-per-call.`,
      "GET /wallet-enrich?address=": `${WALLET_ENRICH_PRICE} - Base/EVM 0x address -> agent-ready on-chain profile: EOA/contract, native + token holdings, token/NFT metadata, proxy + activity, profile label. Pure Base RPC, no keys.`,
      "GET /defi/morpho-position?address=&shocks=": `${MORPHO_POSITION_PRICE} - Base borrower address -> deterministic Morpho LTV, health, liquidation headroom, and collateral-price stress scenarios. Read-only.`,
      "GET /defi/morpho-protection?address=&targetHealthFactor=&protectAgainstShockPct=&executionBufferBps=": `${MORPHO_PROTECTION_PRICE} - deterministic Morpho repair amounts plus unsigned approval/action templates.`,
      "GET /defi/morpho-market-underwrite?marketId=": `${MORPHO_MARKET_UNDERWRITE_PRICE} - deterministic Morpho market integrity, liquidity, concentration, health-band, history, bad-debt, and PreLiquidation evidence.`,
      "GET /defi/morpho-preliquidation-replay?transactionHash=": `${MORPHO_PRELIQUIDATION_REPLAY_PRICE} - reconstruct a historical PreLiquidation event, protocol-oracle gross incentive, and gas from direct Base reads.`,
      "GET /work/opportunity-preflight?rewardUsd=&hours=&hourlyCostUsd=": `${OPPORTUNITY_PREFLIGHT_PRICE} - deterministic attempt, verify-first, or abandon economics with optional dated platform evidence.`,
    },
    network: NETWORK,
    payTo: PAY_TO,
    docs: "/platforms for free health cards; /healthz for config; /openapi.json for the spec; send an x402 payment to any paid route.",
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

// --- Paid MCP server at POST /mcp (streamable-HTTP), x402-gated ---------------
// Reaches MCP-enabled agent clients (Claude Desktop, Cursor, Windsurf) — a buyer
// pool the HTTP / x402scan / Bazaar channels don't touch. `tools/list` is FREE
// (discovery); `tools/call` is paid in USDC to the SAME payTo via the SAME
// facilitator. Mounted AFTER listen, async + NON-FATAL: any MCP setup failure
// leaves the 6 HTTP paid routes fully intact (logged, never thrown).
import("./mcp-server.mjs")
  .then(({ mountMcp }) =>
    mountMcp(app, {
      facilitatorClient,
      network: NETWORK,
      payTo: PAY_TO,
      serverInfo: { name: "x402-data-gateway", version: "1.8.0" },
      tools: [
        { name: "extract", description: RESOURCES[0].description, price: EXTRACT_PRICE, inputSchema: { url: z.string().describe("Public http(s) URL to extract") }, run: (a) => extract(a.url), tags: ["web", "extract", "structured-data"] },
        { name: "read", description: RESOURCES[1].description, price: READ_PRICE, inputSchema: { url: z.string().describe("Public http(s) URL to read as Markdown") }, run: (a) => readMarkdown(a.url), tags: ["web", "markdown", "llm-context"] },
        { name: "scan", description: RESOURCES[2].description, price: SCAN_PRICE, inputSchema: { repo: z.string().describe("Public GitHub repo: owner/name or URL") }, run: (a) => scanRepo(a.repo), tags: ["security", "supply-chain", "github"] },
        { name: "schemaforge", description: RESOURCES[3].description, price: SCHEMAFORGE_PRICE, inputSchema: { site: z.string().describe("Public business site URL"), vertical: z.string().optional().describe("Vertical, e.g. med-spas"), city: z.string().optional().describe("City the business serves") }, run: (a) => schemaforge({ site: a.site, vertical: a.vertical, city: a.city }), tags: ["seo", "json-ld", "geo"] },
        { name: "enrich", description: RESOURCES[4].description, price: ENRICH_PRICE, inputSchema: { domain: z.string().describe("A domain or URL, e.g. stripe.com") }, run: (a) => enrich(a.domain), tags: ["enrichment", "company-data", "firmographics"] },
        { name: "wallet_enrich", description: RESOURCES[5].description, price: WALLET_ENRICH_PRICE, inputSchema: { address: z.string().describe("Base/EVM 0x address") }, run: (a) => walletEnrich(a.address), tags: ["enrichment", "onchain", "wallet"] },
        { name: "deep_audit", description: RESOURCES[6].description, price: DEEP_AUDIT_PRICE, inputSchema: { domain: z.string().describe("A domain or URL, e.g. stripe.com") }, run: (a) => deepAudit(a.domain), tags: ["audit", "ai-readiness", "geo", "enrichment"] },
        { name: "morpho_position", description: RESOURCES[7].description, price: MORPHO_POSITION_PRICE, inputSchema: { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Borrower EVM address on Base mainnet"), shocks: z.array(z.number().min(-99).max(100)).max(8).optional().describe("Collateral price shocks in percent") }, run: (a) => morphoPosition(a.address, { shocks: a.shocks }), tags: ["defi", "morpho", "risk", "borrower-protection"] },
        { name: "morpho_protection", description: RESOURCES[8].description, price: MORPHO_PROTECTION_PRICE, inputSchema: { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Borrower EVM address on Base mainnet"), targetHealthFactor: z.number().gt(1).max(5).default(1.25), protectAgainstShockPct: z.number().min(-99).max(0).default(-10), executionBufferBps: z.number().int().min(0).max(500).default(25) }, run: (a) => morphoProtection(a.address, a), tags: ["defi", "morpho", "protection", "unsigned-transaction-plan"] },
        { name: "morpho_market_underwrite", description: RESOURCES[9].description, price: MORPHO_MARKET_UNDERWRITE_PRICE, inputSchema: { marketId: z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("Morpho market ID on Base mainnet") }, run: (a) => morphoMarketUnderwrite(a.marketId), tags: ["defi", "morpho", "underwriting", "risk", "preliquidation"] },
        { name: "morpho_preliquidation_replay", description: RESOURCES[10].description, price: MORPHO_PRELIQUIDATION_REPLAY_PRICE, inputSchema: { transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("Successful Base transaction containing a Morpho PreLiquidate event") }, run: (a) => morphoPreLiquidationReplay(a.transactionHash), tags: ["defi", "morpho", "preliquidation", "replay", "economics"] },
        { name: "opportunity_preflight", description: RESOURCES[11].description, price: OPPORTUNITY_PREFLIGHT_PRICE, inputSchema: { platform: z.string().max(100).optional(), rewardUsd: z.number().positive(), hours: z.number().min(0).max(10000), hourlyCostUsd: z.number().min(0).max(100000), computeUsd: z.number().min(0).default(0), mandatorySpendUsd: z.number().min(0).default(0), reusableValueUsd: z.number().min(0).default(0), selectionProbabilityPct: z.number().min(0).max(100).optional(), competition: z.number().int().min(0).default(0), slots: z.number().int().min(1).default(1), agentAccess: z.enum(["agent_allowed", "agent_only", "mixed", "human_only", "unknown"]).default("unknown"), acceptance: z.enum(["deterministic", "machine_scored", "timed_review", "discretionary", "unknown"]).default("unknown"), settlement: z.enum(["direct", "escrow", "platform_balance", "discretionary", "unfunded", "unknown"]).default("unknown") }, run: (a) => opportunityPreflight(a, { platformCard: a.platform ? getPlatformHealthCard(a.platform.toLowerCase()) : null }), tags: ["work", "bounty", "economics", "preflight", "settlement-evidence"] },
      ],
    })
  )
  .then((r) => console.log(`  MCP server:  POST /mcp (${r.toolCount} paid tools)`))
  .catch((e) => console.error(`  /mcp mount FAILED (HTTP routes unaffected): ${e.message}`));
