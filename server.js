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
// STANDARD BASE PAYMENT MODEL: the "exact" scheme settles USDC via an EIP-3009
// transferWithAuthorization signed by the buyer. Funds move buyer -> payTo
// directly on-chain. The standard facilitator verifies and broadcasts only.
//
// CIRCLE GATEWAY PAYMENT MODEL: the separate /gateway path uses x402 exact with
// GatewayWalletBatched authorization. Circle batches settlement into the
// seller's Gateway balance, which can later be withdrawn to a supported chain.
// It does not change or intercept the standard Base exact or native MPP paths.

import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  declareDiscoveryContract,
  getDiscoveryOutputContract,
  getDiscoveryRequestContract,
  projectDiscoveryRequest,
} from "./discovery-contract.mjs";
import {
  BAZAAR_RESOURCE_METADATA,
  bazaarResourceMetadataFor,
  validateBazaarResourceMetadata,
} from "./bazaar-resource-metadata.mjs";
import {
  PAYMENT_IDENTIFIER,
  declarePaymentIdentifierExtension,
  paymentIdentifierResourceServerExtension,
} from "@x402/extensions/payment-identifier";
import { createFacilitatorConfig } from "@coinbase/x402";
import { createCommerceTrust } from "./commerce-trust.mjs";
import { buildSkillContract } from "./skill-contract.mjs";
import { exposeAgenticTradeProxyDiagnostics } from "./agentictrade-proxy-diagnostics.mjs";
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
  normalizeOpportunityPreflightRequest,
  opportunityPreflight,
  opportunityPreflightTrial,
} from "./opportunity-preflight.mjs";
import {
  createInternalOpportunityPreflightHandler,
  createInternalPaymentOfferPreflightHandler,
  createInternalSolanaTransactionReceiptHandler,
} from "./internal-opportunity-gateway.mjs";
import {
  agentDiscoverabilityAudit,
  normalizeDiscoverabilityAuditInput,
} from "./agent-discoverability-audit.mjs";
import {
  PaymentOfferPreflightError,
  normalizePaymentOfferPreflightInput,
  normalizePaymentTarget,
  paymentOfferPreflightInputSchema,
  paymentOfferPreflightOutputSchema,
  paymentOfferPreflight,
} from "./payment-offer-preflight.mjs";
import {
  SELLER_INTEGRITY_AUDIT_EXAMPLE,
  SellerIntegrityAuditError,
  normalizeSellerIntegrityAuditInput,
  sellerIntegrityAudit,
  sellerIntegrityAuditOutputSchema,
} from "./seller-integrity-audit.mjs";
import {
  CONTRACT_QUALIFIED_SEARCH_EXAMPLE,
  ContractQualifiedSearchError,
  contractQualifiedSearch,
  contractQualifiedSearchOutputSchema,
  normalizeContractQualifiedSearchInput,
} from "./contract-qualified-search.mjs";
import {
  AGENT_SURFACE_BUDGET_AUDIT_EXAMPLE,
  AgentSurfaceBudgetAuditError,
  agentSurfaceBudgetAuditMcpOutputSchema,
  agentSurfaceBudgetAudit,
  agentSurfaceBudgetAuditOutputSchema,
  normalizeAgentSurfaceBudgetAuditInput,
} from "./agent-surface-budget-audit.mjs";
import {
  SettlementProofError,
  normalizeSettlementProofInput,
  settlementProof,
} from "./settlement-proof.mjs";
import {
  TransactionReceiptError,
  normalizeTransactionReceiptInput,
  transactionReceipt,
} from "./transaction-receipt.mjs";
import {
  SolanaTransactionReceiptError,
  normalizeSolanaTransactionReceiptInput,
  solanaTransactionReceipt,
} from "./solana-transaction-receipt.mjs";
import {
  WALLET_POLICY_CASE_NAMES,
  WalletPolicyConformanceError,
  normalizeWalletPolicyConformanceInput,
  walletPolicyConformance,
  walletPolicyConformanceContract,
  walletPolicyConformanceInputSchema,
  walletPolicyConformanceOutputSchema,
} from "./wallet-policy-conformance.mjs";
import {
  STATEFUL_WALLET_POLICY_CASE_NAMES,
  StatefulWalletPolicyConformanceError,
  normalizeStatefulWalletPolicyConformanceInput,
  statefulWalletPolicyConformance,
  statefulWalletPolicyConformanceContract,
  statefulWalletPolicyConformanceInputSchema,
  statefulWalletPolicyConformanceOutputSchema,
} from "./stateful-wallet-policy-conformance.mjs";
import { createReferralResolver } from "./referral.mjs";
import { fulfillThe402Job, verifyThe402Webhook } from "./the402.mjs";
import { createCommerceTelemetry } from "./commerce-events.mjs";
import { createCommerceSettlementReconciler } from "./commerce-settlement-reconciler.mjs";
import { createIdempotencyReplay } from "./idempotency-replay.mjs";
import {
  PURCHASE_EVIDENCE_MANIFEST_PATH,
  PURCHASE_EVIDENCE_RELATION,
  buildPurchaseEvidenceManifest,
  purchaseEvidenceHeaders,
} from "./purchase-evidence-manifest.mjs";
import {
  PAID_ACTION_EFFECT_PROFILE_PATH,
  READ_ONLY_PAID_POST_OPERATIONS,
  attachPaidActionEffectContracts,
  buildPaidActionEffectProfile,
  paidActionEffectHeaders,
} from "./paid-action-effect-profile.mjs";
import { createMppDualStack } from "./mpp-dual-stack.mjs";
import { legacyCompatibleX402Body } from "./x402-legacy-body.mjs";
import {
  VIBES_DISCOVERABILITY_PATH,
  VIBES_DISCOVERABILITY_SLUG,
  createVibesChannel,
} from "./vibes-coded-channel.mjs";
import {
  glamaConnectorVerification,
  x402JobsVerification,
} from "./directory-verification.mjs";
import { renderGatewayLanding, wantsGatewayHtml } from "./gateway-landing.mjs";
import { decorateMcpTool } from "./mcp-tool-metadata.mjs";
import { BUYER_POLICY_REFERENCE } from "./buyer-policy-reference.mjs";
import {
  buildSolanaAgentRegistration,
  SOLANA_AGENT_REGISTRATION,
} from "./solana-agent-registration.mjs";
import {
  CIRCLE_GATEWAY_PATH,
  buildCircleGatewayRoute,
} from "./circle-gateway-route.mjs";
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
import { SERVICE_VERSION } from "./service-version.mjs";
import { loadServiceDeploymentPublication } from "./service-deployment-publication.mjs";
import { SERVICE_DEPLOYMENT_ROUTES } from "./service-deployment-routes.mjs";
import { validateOpenApiOperationIds } from "./openapi-operation-contract.mjs";

// ---------------------------------------------------------------------------
// 1. CONFIG (all via env so we change facilitator/network with zero code edits)
// ---------------------------------------------------------------------------

// Our wallet — USDC lands here. We hold the key.
const PAY_TO = process.env.PAY_TO || "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";

// Network: "eip155:8453" = Base MAINNET (real USDC). "eip155:84532" = Base Sepolia (testnet).
const NETWORK = process.env.NETWORK || "eip155:8453";

// Price per request (USDC). A 2026-08-11 brand-blind live-market screen found
// directly competing extraction and Markdown routes concentrated around
// $0.002-$0.008 and $0.005-$0.030 respectively. Keep the two low-cost commodity
// routes at the shared $0.005 conversion-test price while preserving independent
// environment overrides for every product. PRICE remains the generic fallback.
const PRICE = process.env.PRICE || "$0.05";
const EXTRACT_PRICE = process.env.EXTRACT_PRICE || "$0.005";
const READ_PRICE = process.env.READ_PRICE || "$0.005";
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
// Brand-blind cross-registry rank and coverage audit for machine-service sellers.
const AGENT_DISCOVERABILITY_AUDIT_PRICE = process.env.AGENT_DISCOVERABILITY_AUDIT_PRICE || "$0.05";
// Credential-free x402/MPP offer normalization and parity checks for buyer agents.
// The low price is deliberate: this is a pre-authorization safety primitive.
const PAYMENT_OFFER_PREFLIGHT_PRICE = process.env.PAYMENT_OFFER_PREFLIGHT_PRICE || "$0.005";
const SELLER_INTEGRITY_AUDIT_PRICE = process.env.SELLER_INTEGRITY_AUDIT_PRICE || "$0.01";
const CONTRACT_QUALIFIED_SEARCH_PRICE = process.env.CONTRACT_QUALIFIED_SEARCH_PRICE || "$0.01";
const AGENT_SURFACE_BUDGET_AUDIT_PRICE = process.env.AGENT_SURFACE_BUDGET_AUDIT_PRICE || "$0.01";
const PAYMENT_OFFER_CATALOG_SCHEMA = z.object({
  source: z.string().min(1).max(128).describe("Public catalog or registry name."),
  protocol: z.enum(["x402", "mpp"]).optional().describe("Optional advertised payment protocol."),
  method: z.literal("GET").describe("Catalog request method. The current product inspects exact GET routes."),
  url: z.string().url().max(2048).describe("Exact catalog candidate URL, including all non-secret query values."),
  amountAtomic: z.string().regex(/^(?:0|[1-9][0-9]{0,77})$/).optional().describe("Optional advertised price in atomic currency units."),
  network: z.string().min(1).max(200).optional().describe("Optional advertised network identifier."),
  asset: z.string().min(1).max(200).optional().describe("Optional advertised currency or asset identifier."),
  recipient: z.string().min(1).max(200).optional().describe("Optional advertised payment recipient."),
  expiresAt: z.string().datetime().optional().describe("Optional advertised offer expiry."),
}).strict();
// Independent post-settlement proof for one canonical Base USDC transfer.
const SETTLEMENT_PROOF_PRICE = process.env.SETTLEMENT_PROOF_PRICE || "$0.005";
// Normalized Base or Ethereum receipt evidence. Commodity-priced below the
// observed $0.005 raw-receipt route while adding decoded transfer evidence.
const TRANSACTION_RECEIPT_PRICE = process.env.TRANSACTION_RECEIPT_PRICE || "$0.002";
// Finalized Solana transaction and SPL-token owner-delta evidence.
const SOLANA_TRANSACTION_RECEIPT_PRICE = process.env.SOLANA_TRANSACTION_RECEIPT_PRICE || "$0.002";
// Credential-free analysis of standardized delegated-signer policy observations.
// Priced as a low-cost safety primitive while the first independent paid use is
// still the economic acceptance gate.
const WALLET_POLICY_CONFORMANCE_PRICE = process.env.WALLET_POLICY_CONFORMANCE_PRICE || "$0.01";
const STATEFUL_WALLET_POLICY_CONFORMANCE_PRICE = process.env.STATEFUL_WALLET_POLICY_CONFORMANCE_PRICE || "$0.01";

// "$0.05" -> "50000" atomic USDC units (6 decimals) so the discovery docs
// (/.well-known/x402, /openapi.json) always match the paywall price exactly.
const priceToAtomic = (p) =>
  String(Math.round(parseFloat(String(p).replace(/[^0-9.]/g, "")) * 1e6));

const atomicUsdcToDisplay = (amount) => {
  const atomic = String(amount);
  if (!/^\d+$/.test(atomic)) throw new Error(`Invalid atomic USDC amount: ${amount}`);
  const padded = atomic.padStart(7, "0");
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
};

const PORT = process.env.PORT || 3000;
const THE402_API_KEY = process.env.THE402_API_KEY;
const THE402_WEBHOOK_SECRET = process.env.THE402_WEBHOOK_SECRET;
const THE402_SERVICE_ID = process.env.THE402_SERVICE_ID;
const VIBES_CODED_API_KEY = process.env.VIBES_CODED_API_KEY || "";

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
app.use(legacyCompatibleX402Body);

const commerceTelemetry = createCommerceTelemetry();
app.use(paidActionEffectHeaders);
app.use(commerceTelemetry.middleware);
const idempotencyReplay = createIdempotencyReplay();
let commerceSettlementReconciler;
let purchaseEvidenceManifest;

// A pay.sh Solana gateway injects the existing internal token only after its
// own payment gate succeeds. The exact public path then reaches the same
// deterministic implementation without triggering a second Base payment.
// Missing or incorrect credentials fall through to the ordinary paid route.
app.get("/work/opportunity-preflight", createInternalOpportunityPreflightHandler({
  token: process.env.COMMERCE_INTERNAL_TOKEN,
  getPlatformHealthCard,
  opportunityPreflight,
}));
app.get("/commerce/payment-offer-preflight", createInternalPaymentOfferPreflightHandler({
  token: process.env.COMMERCE_INTERNAL_TOKEN,
  paymentOfferPreflight,
}));
app.get("/chain/solana-transaction-receipt", createInternalSolanaTransactionReceiptHandler({
  token: process.env.COMMERCE_INTERNAL_TOKEN,
  solanaTransactionReceipt,
}));

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

// Vibes-Coded settles the buyer's x402 payment before forwarding the exact
// JSON body to this target. Verify the opaque call ticket and body hash through
// the platform, run the existing read-only product without a second payment
// gate, then consume the ticket with a hash-bound delivery receipt.
const vibesDiscoverabilityChannel = createVibesChannel({
  apiKey: VIBES_CODED_API_KEY,
  expectedSlug: VIBES_DISCOVERABILITY_SLUG,
  expectedPriceCents: 50,
  validateInput: normalizeDiscoverabilityAuditInput,
  product: agentDiscoverabilityAudit,
});

app.head(VIBES_DISCOVERABILITY_PATH, (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.set("X-SameDayDesk-Channel", "vibes-coded");
  return res.status(200).end();
});

app.post(VIBES_DISCOVERABILITY_PATH, async (req, res) => {
  const result = await vibesDiscoverabilityChannel.execute({
    ticket: req.get("x-vibes-call-ticket"),
    rawBody: req.rawBody,
    body: req.body,
  });
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.set("X-SameDayDesk-Channel", "vibes-coded");
  return res.status(result.status).json(result.body);
});

// Free health check (NOT behind paywall — used by Railway).
app.get("/healthz", async (_req, res) => {
  const [telemetryStorage, replayStorage, settlementReconciliation] = await Promise.all([
    commerceTelemetry.storageStatus(),
    idempotencyReplay.storageStatus(),
    commerceSettlementReconciler?.status() || Promise.resolve({ enabled: false }),
  ]);
  res.json({
    ok: true,
    payTo: PAY_TO,
    network: NETWORK,
    prices: { extract: EXTRACT_PRICE, read: READ_PRICE, scan: SCAN_PRICE, schemaforge: SCHEMAFORGE_PRICE, enrich: ENRICH_PRICE, "wallet-enrich": WALLET_ENRICH_PRICE, "deep-audit": DEEP_AUDIT_PRICE, "morpho-position": MORPHO_POSITION_PRICE, "morpho-protection": MORPHO_PROTECTION_PRICE, "morpho-market-underwrite": MORPHO_MARKET_UNDERWRITE_PRICE, "morpho-preliquidation-replay": MORPHO_PRELIQUIDATION_REPLAY_PRICE, "opportunity-preflight": OPPORTUNITY_PREFLIGHT_PRICE, "agent-discoverability-audit": AGENT_DISCOVERABILITY_AUDIT_PRICE, "payment-offer-preflight": PAYMENT_OFFER_PREFLIGHT_PRICE, "seller-integrity-audit": SELLER_INTEGRITY_AUDIT_PRICE, "contract-qualified-search": CONTRACT_QUALIFIED_SEARCH_PRICE, "agent-surface-budget-audit": AGENT_SURFACE_BUDGET_AUDIT_PRICE, "settlement-proof": SETTLEMENT_PROOF_PRICE, "transaction-receipt": TRANSACTION_RECEIPT_PRICE, "solana-transaction-receipt": SOLANA_TRANSACTION_RECEIPT_PRICE, "wallet-policy-conformance": WALLET_POLICY_CONFORMANCE_PRICE, "stateful-wallet-policy-conformance": STATEFUL_WALLET_POLICY_CONFORMANCE_PRICE },
    facilitator: FACILITATOR,
    facilitatorUrl: facilitatorClient.url,
    paymentProtocols: {
      x402: { enabled: true, routeCount: RESOURCES.length },
      circleGateway: {
        enabled: circleGateway.enabled,
        facilitatorUrl: circleGateway.facilitatorUrl,
        path: CIRCLE_GATEWAY_PATH,
        routeCount: circleGateway.enabled ? 1 : 0,
        settlement: "gasless batched USDC nanopayments",
      },
      mpp: {
        enabled: mppDualStack.enabled,
        realm: mppDualStack.realm,
        routeCount: mppDualStack.routeCount,
        reason: mppDualStack.enabled ? null : mppDualStack.reason,
      },
    },
    commerceTelemetry: {
      storage: telemetryStorage,
      publicAggregate: "/v0/commerce-demand.json",
      privacy: "aggregate external observations only; raw event data is not exposed",
    },
    settlementReconciliation,
    trustArtifacts: {
      paymentIdentifier: true,
      signedOfferReceipt: commerceTrust.enabled,
      requestBoundReplay: true,
      receiptSigner: commerceTrust.signerAddress,
      receiptKeyId: commerceTrust.keyId,
      serviceDeployment: {
        active: serviceDeploymentPublication.active,
        statement: serviceDeploymentPublication.paths.statement,
        publicKey: serviceDeploymentPublication.paths.publicKey,
        statementId: serviceDeploymentPublication.statementId,
        publicKeyFingerprint: serviceDeploymentPublication.publicKeyFingerprint,
        operationalWallet: serviceDeploymentPublication.operationalWallet,
        expiresAt: serviceDeploymentPublication.expiresAt,
        expiresInMs: serviceDeploymentPublication.expiresInMs,
        routeCount: serviceDeploymentPublication.routeCount,
        settlementCount: serviceDeploymentPublication.settlementCount,
      },
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
    const [snapshot, settlementReconciliation] = await Promise.all([
      commerceTelemetry.snapshot({ days }),
      commerceSettlementReconciler?.status() || Promise.resolve({ enabled: false }),
    ]);
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return res.json({ ...snapshot, settlementReconciliation });
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

// Project-owned verification for claiming the official-registry-propagated
// Glama connector. The maintainer identity is the public SameDayDesk business
// email, not a private login address.
app.get("/.well-known/glama.json", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.json(glamaConnectorVerification());
});

// Public server-ownership proof for the x402.jobs discovery and activity
// registry. This challenge is intentionally public and grants no merchant,
// wallet, API, or payment authority.
app.get("/.well-known/x402-verification.json", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.json(x402JobsVerification());
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
const USDC_BY_NETWORK = {
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};
const USDC_ASSET = USDC_BY_NETWORK[NETWORK];
if (!USDC_ASSET) throw new Error(`Unsupported USDC network: ${NETWORK}`);
const serviceDeploymentPublication = loadServiceDeploymentPublication({
  canonicalOrigin: PUBLIC_URL,
  network: NETWORK,
  asset: USDC_ASSET,
  recipient: PAY_TO,
  operationalWallet: SOLANA_AGENT_REGISTRATION.merchantWallet,
});
commerceSettlementReconciler = createCommerceSettlementReconciler({
  asset: USDC_ASSET,
  eventPaths: [commerceTelemetry.paths.rotatedPath, commerceTelemetry.paths.currentPath],
  network: NETWORK,
  treasury: PAY_TO,
});
const acceptsFor = (amount) => [
  { scheme: "exact", network: NETWORK, asset: USDC_ASSET, amount, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } },
];
const EXTRACT_DISCOVERY_DESCRIPTION = "Extract a public web page into clean structured JSON for agent workflows: title, description, main text, all JSON-LD, Open Graph and Twitter metadata, headings, links, and AI-crawler and structured-data signals. Follows redirects and enforces timeout, response-size, and SSRF safeguards.";
const RESOURCES = [
  { url: `${PUBLIC_URL}/extract`, amount: priceToAtomic(EXTRACT_PRICE), description: EXTRACT_DISCOVERY_DESCRIPTION, mimeType: "application/json" },
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
  { url: `${PUBLIC_URL}/distribution/agent-discoverability-audit`, amount: priceToAtomic(AGENT_DISCOVERABILITY_AUDIT_PRICE), description: "Buyer-intent rank, listing-identity, and catalog-to-runtime price-coherence audit for one x402 or MPP service across ten public machine-service discovery views. Returns registry-native position, dependency-labeled coverage, canonical and alias records, duplicates, competitors, expected-route presence, exact-price drift, evidence-based next actions, and source outages. Optional runtimeUrl derives the reference price from a same-origin unsigned headers-only offer; optional surfaceAudit checks the public Agent Card, ERC-8004 registration document, and action catalog. No catalog credentials, signatures, or payments.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/commerce/payment-offer-preflight`, amount: priceToAtomic(PAYMENT_OFFER_PREFLIGHT_PRICE), description: "Compare x402 and MPP payment challenges and seller-declared success-response readiness before buyer authorization for one exact public HTTPS GET URL. Optionally compare caller-supplied catalog metadata with each live unsigned offer across request, protocol, amount, network, asset, recipient, and expiry. Returns normalized offers, binding and parity findings, catalog coherence, a bounded response-contract report, and an explicit parseable, review-required, or no-offer decision. Uses no target credential, signature, or target payment, follows no redirects, never reads the paid target body, and reads only the same-origin public OpenAPI document under a strict size cap.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/commerce/settlement-proof`, amount: priceToAtomic(SETTLEMENT_PROOF_PRICE), description: "Verify one claimed canonical Base USDC settlement against the successful on-chain transaction receipt. Binds an exact transaction hash, recipient, atomic amount, and optional payer; returns a deterministic verified or not-verified result, block time, mismatch findings, and no private merchant-ledger data. Read-only and performs no wallet, signing, broadcast, custody, or execution action.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/chain/transaction-receipt`, amount: priceToAtomic(TRANSACTION_RECEIPT_PRICE), description: "Get a normalized Base or Ethereum transaction receipt from one hash: success or revert status, block time, gas used, effective gas price, total transaction fee, decoded ERC-20 Transfer events, and canonical USDC transfers. Returns explicit not-found or RPC-unavailable evidence, excludes raw logs, and performs no wallet, signing, broadcast, custody, or execution action.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/chain/solana-transaction-receipt`, amount: priceToAtomic(SOLANA_TRANSACTION_RECEIPT_PRICE), description: "Get a normalized finalized Solana transaction receipt from one signature: success or failure status, slot, block time, fee, SPL-token owner deltas, canonical USDC deltas, and optional exact mint, recipient, amount, and payer verification. Returns explicit not-found or RPC-unavailable evidence, excludes raw instructions and logs, and performs no wallet, signing, broadcast, custody, or execution action.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/security/wallet-policy-conformance`, method: "POST", amount: priceToAtomic(WALLET_POLICY_CONFORMANCE_PRICE), description: "Evaluate a credential-free standardized allow/deny matrix for an agent wallet or delegated signer. Distinguishes explicit provider policy denials from validation and generic provider failures, separates operation allowlisting from exact execution-shape control, and returns conformant, partial, or unsafe without an opaque score. Accepts no credentials, wallet IDs, signatures, transactions, or raw provider responses.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/security/stateful-wallet-policy-conformance`, method: "POST", amount: priceToAtomic(STATEFUL_WALLET_POLICY_CONFORMANCE_PRICE), description: "Evaluate credential-free stateful wallet-policy observations for sequential cumulative limits, signed-but-unbroadcast accounting, ABI extraction integrity, concurrent oversubscription, counter-reference failure, and application serialization. Separates provider-policy enforcement from application guards and returns conformant, partial, or unsafe without an opaque score. Accepts no credentials, wallet or resource IDs, counter values, signatures, transactions, or raw provider responses.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/commerce/seller-integrity-audit`, amount: priceToAtomic(SELLER_INTEGRITY_AUDIT_PRICE), description: "Audit one exact paid GET or POST route before buyers spend: constructible non-secret input, live unpaid GET payment terms, optional Bazaar catalog contract, and recursively guaranteed buyer-required success paths. Returns machine_buyable for live-verified GET, contract_ready for static-safe POST, or repair_required. POST analysis sends no target request. Uses public pinned DNS, no credentials, no target payment, no redirect, no paid target body, and retains no seller schema, body, or query values.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/commerce/contract-qualified-search`, amount: priceToAtomic(CONTRACT_QUALIFIED_SEARCH_PRICE), description: "Search Agent402 and the official MPP catalog for paid machine services that both match a capability intent and guarantee buyer-required JSON output paths. Returns bounded machine-buyable or contract-ready candidates plus controlled rejection reasons. Rejects unresolved routes and owned supply before audit, uses no credentials or wallet, sends no seller POST or target payment, reads no paid response body, and retains only a query digest.", mimeType: "application/json" },
  { url: `${PUBLIC_URL}/distribution/agent-surface-budget-audit`, amount: priceToAtomic(AGENT_SURFACE_BUDGET_AUDIT_PRICE), description: "Measure one public service's free MCP tools/list, OpenAPI, or both declared discovery surfaces before an agent calls or pays for anything. Returns byte counts, comparative byte-derived token estimates, missing selection contracts, heaviest tools and operations, budget decisions, and progressive-discovery fixes. Unselected surfaces are not fetched or judged. Uses pinned public DNS, follows no redirect, sends no credential or target payment, calls no target tool, and returns no target schema, session identifier, or response body.", mimeType: "application/json" },
];

const WALLET_POLICY_DISCOVERY_INPUT = Object.freeze({
  profileId: "privy-solana-lab",
  provider: "Privy",
  network: "solana:mainnet",
  protocol: "x402",
  observations: Object.freeze([
    Object.freeze({ case: "intended", actual: "allowed", denialClass: "none", code: "signed" }),
    Object.freeze({ case: "wrong_operation", actual: "denied", denialClass: "policy", code: "policy_violation" }),
    Object.freeze({ case: "duplicate_approved_action", actual: "allowed", denialClass: "none", code: "signed" }),
  ]),
});
const WALLET_POLICY_CONTRACT = walletPolicyConformanceContract({
  endpoint: `${PUBLIC_URL}/security/wallet-policy-conformance`,
  priceAtomicUsdc: priceToAtomic(WALLET_POLICY_CONFORMANCE_PRICE),
});
const STATEFUL_WALLET_POLICY_DISCOVERY_INPUT = Object.freeze({
  profileId: "privy-base-sepolia-stateful-cap",
  provider: "Privy",
  network: "eip155:11155111",
  protocol: "x402",
  observations: Object.freeze([
    Object.freeze({ case: "first_within_cap", actual: "allowed", enforcementClass: "none", code: "signed" }),
    Object.freeze({ case: "sequential_exceeds_cap", actual: "denied", enforcementClass: "policy", code: "policy_violation" }),
    Object.freeze({ case: "unrecognized_calldata", actual: "allowed", enforcementClass: "none", code: "signed" }),
    Object.freeze({ case: "concurrent_exceeds_cap", actual: "allowed", enforcementClass: "none", code: "oversubscribed" }),
  ]),
});
const STATEFUL_WALLET_POLICY_CONTRACT = statefulWalletPolicyConformanceContract({
  endpoint: `${PUBLIC_URL}/security/stateful-wallet-policy-conformance`,
  priceAtomicUsdc: priceToAtomic(STATEFUL_WALLET_POLICY_CONFORMANCE_PRICE),
});
const circleGateway = buildCircleGatewayRoute({
  sellerAddress: PAY_TO,
  price: PAYMENT_OFFER_PREFLIGHT_PRICE,
  enabled: process.env.CIRCLE_GATEWAY_ENABLED !== "false",
  facilitatorUrl: process.env.CIRCLE_GATEWAY_FACILITATOR_URL,
  description: RESOURCES[13].description,
});
const CIRCLE_GATEWAY_RESOURCE = {
  ...circleGateway.resource,
  url: `${PUBLIC_URL}${circleGateway.resource.urlPath}`,
};

const bazaarResourceMetadataValidation = validateBazaarResourceMetadata();
if (!bazaarResourceMetadataValidation.valid) {
  throw new Error(`Invalid Bazaar resource metadata: ${bazaarResourceMetadataValidation.errors.join("; ")}`);
}
const paidResourceRoutes = new Set(RESOURCES.map((resource) => new URL(resource.url).pathname));
const evidenceLinkedRoutes = new Set([
  ...paidResourceRoutes,
  CIRCLE_GATEWAY_PATH,
  "/.well-known/x402",
  "/.well-known/x402.json",
  "/x402.json",
  "/api/x402",
  "/openapi.json",
  "/openapi.yaml",
  "/swagger.json",
  "/mpp-openapi.json",
  "/openapi.mpp.json",
  "/skill.md",
  "/SKILL.md",
  "/api/actions",
  "/mcp",
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/.well-known/agent-registration.json",
  "/llms.txt",
]);
app.use(purchaseEvidenceHeaders({ origin: PUBLIC_URL, paidRoutes: evidenceLinkedRoutes }));
const metadataRoutes = new Set(Object.keys(BAZAAR_RESOURCE_METADATA));
const missingMetadataRoutes = [...paidResourceRoutes].filter((route) => !metadataRoutes.has(route));
const unknownMetadataRoutes = [...metadataRoutes].filter((route) => !paidResourceRoutes.has(route));
if (missingMetadataRoutes.length || unknownMetadataRoutes.length) {
  throw new Error(`Bazaar resource metadata coverage mismatch: missing=${missingMetadataRoutes.join(",") || "none"}; unknown=${unknownMetadataRoutes.join(",") || "none"}`);
}

const RESOURCE_DISCOVERY_METADATA = {
  "/extract": { operationId: "extractUrl", tags: ["Web Data"] },
  "/read": { operationId: "readUrlAsMarkdown", tags: ["Web Data"] },
  "/scan": { operationId: "scanRepositoryRisk", tags: ["Security"] },
  "/schemaforge": { operationId: "generateStructuredData", tags: ["Company Intelligence"] },
  "/enrich": { operationId: "enrichCompany", tags: ["Company Intelligence"] },
  "/wallet-enrich": { operationId: "enrichWallet", tags: ["Blockchain"] },
  "/deep-audit": { operationId: "auditAiSearchReadiness", tags: ["Company Intelligence"] },
  "/defi/morpho-position": { operationId: "inspectMorphoPosition", tags: ["DeFi"] },
  "/defi/morpho-protection": { operationId: "planMorphoProtection", tags: ["DeFi"] },
  "/defi/morpho-market-underwrite": { operationId: "underwriteMorphoMarket", tags: ["DeFi"] },
  "/defi/morpho-preliquidation-replay": { operationId: "replayMorphoPreLiquidation", tags: ["DeFi"] },
  "/work/opportunity-preflight": { operationId: "preflightAgentOpportunity", tags: ["Agent Operations"] },
  "/distribution/agent-discoverability-audit": { operationId: "auditAgentDiscoverability", tags: ["Distribution"] },
  "/commerce/payment-offer-preflight": { operationId: "preflightPaymentOffer", tags: ["Agent Operations"] },
  "/commerce/seller-integrity-audit": { operationId: "auditSellerIntegrity", tags: ["Agent Operations"] },
  "/commerce/contract-qualified-search": { operationId: "searchContractQualifiedServices", tags: ["Agent Operations"] },
  "/distribution/agent-surface-budget-audit": { operationId: "auditAgentSurfaceBudget", tags: ["Distribution"] },
  "/commerce/settlement-proof": { operationId: "verifyBaseUsdcSettlement", tags: ["Blockchain"] },
  "/chain/transaction-receipt": { operationId: "getTransactionReceipt", tags: ["Blockchain"] },
  "/chain/solana-transaction-receipt": { operationId: "getSolanaTransactionReceipt", tags: ["Blockchain"] },
  "/security/wallet-policy-conformance": { operationId: "evaluateWalletPolicyConformance", tags: ["Security"] },
  "/security/stateful-wallet-policy-conformance": { operationId: "evaluateStatefulWalletPolicyConformance", tags: ["Security"] },
};

const mppDualStack = createMppDualStack({
  facilitatorClient,
  network: NETWORK,
  payTo: PAY_TO,
  publicUrl: PUBLIC_URL,
  realm: new URL(PUBLIC_URL).hostname,
  routes: [
    ...RESOURCES.map((resource) => ({
      amount: atomicUsdcToDisplay(resource.amount),
      description: resource.description,
      method: resource.method || "GET",
      path: new URL(resource.url).pathname,
    })),
    {
      amount: atomicUsdcToDisplay(RESOURCES[11].amount),
      description: RESOURCES[11].description,
      method: "POST",
      path: "/work/opportunity-preflight",
    },
    {
      amount: atomicUsdcToDisplay(RESOURCES[13].amount),
      description: RESOURCES[13].description,
      method: "POST",
      path: "/commerce/payment-offer-preflight",
    },
  ],
  secretKey: process.env.MPP_SECRET_KEY,
});

const agentCashPaymentInfoFor = (resource) => ({
  price: {
    amount: atomicUsdcToDisplay(resource.amount),
    currency: "USD",
    mode: "fixed",
  },
  protocols: [
    {
      x402: {
        asset: USDC_ASSET,
        network: NETWORK,
        scheme: "exact",
      },
    },
    {
      mpp: {
        currency: USDC_ASSET,
        intent: "charge",
        method: "evm",
        network: NETWORK,
      },
    },
  ],
});

const circleGatewayPaymentInfo = () => ({
  price: {
    amount: atomicUsdcToDisplay(CIRCLE_GATEWAY_RESOURCE.amount),
    currency: "USD",
    mode: "fixed",
  },
  protocols: [{
    x402: {
      asset: CIRCLE_GATEWAY_RESOURCE.accepts[0].asset,
      network: CIRCLE_GATEWAY_RESOURCE.accepts[0].network,
      scheme: "exact",
      settlement: "circle-gateway-batched",
    },
  }],
});

const mppPaymentInfoFor = (resource) => ({
  offers: [
    {
      amount: resource.amount,
      currency: USDC_ASSET,
      description: resource.description,
      intent: "charge",
      method: "evm",
      recipient: PAY_TO,
      network: NETWORK,
      methodDetails: {
        chainId: Number(NETWORK.split(":")[1]),
        credentialTypes: ["authorization"],
        decimals: 6,
      },
    },
    {
      amount: resource.amount,
      currency: USDC_ASSET,
      description: resource.description,
      intent: "exact",
      method: "x402",
      network: NETWORK,
      payTo: PAY_TO,
      scheme: "exact",
    },
  ],
});

const machineActionCatalog = () => ({
  schema: "samedaydesk.machine-actions.v2",
  service: "SameDayDesk machine commerce gateway",
  network: NETWORK,
  settlement: "x402 exact or MPP evm/charge USDC on Base",
  paymentProtocols: ["x402", "mpp"],
  alternateAccess: circleGateway.enabled ? {
    product: "payment_offer_preflight",
    route: CIRCLE_GATEWAY_PATH,
    paymentProtocol: "x402",
    settlement: "Circle Gateway gasless batched USDC Nanopayments",
    priceAtomicUsdc: CIRCLE_GATEWAY_RESOURCE.amount,
  } : null,
  payTo: PAY_TO,
  acquisition: {
    directCallRequired: true,
    note: "This free catalog is discovery only. Call the selected action URL directly and satisfy its live x402 or MPP challenge; no marketplace proxy can stand in for the route-bound payment credential.",
    declaredSourceHeader: {
      header: "X-SameDayDesk-Agent-Source",
      allowedValues: ["agent-skills-v1", "agentictrade-v1"],
      boundary: "Optional declared attribution only. It is not authenticated and cannot change price, payment, or access.",
    },
  },
  actions: RESOURCES.map((resource) => {
    const route = new URL(resource.url).pathname;
    const method = resource.method || "GET";
    const response = getDiscoveryOutputContract(`${method} ${route}`);
    const request = getDiscoveryRequestContract(`${method} ${route}`);
    return {
      name: route.replace(/^\//, "").replaceAll("/", "_"),
      method,
      route,
      url: resource.url,
      description: resource.description,
      priceAtomicUsdc: resource.amount,
      priceUsdc: Number(resource.amount) / 1e6,
      paymentProtocols: ["x402", "mpp"],
      mimeType: resource.mimeType,
      tags: BAZAAR_RESOURCE_METADATA[route]?.tags || [],
      request: projectDiscoveryRequest(resource.url, method, request),
      response: response ? { mimeType: "application/json", ...response } : null,
    };
  }),
  discovery: {
    manifest: `${PUBLIC_URL}/.well-known/x402`,
    openapi: `${PUBLIC_URL}/openapi.json`,
    mppOpenapi: `${PUBLIC_URL}/mpp-openapi.json`,
    skill: `${PUBLIC_URL}/skill.md`,
    mcp: `${PUBLIC_URL}/mcp`,
    a2aAgentCard: `${PUBLIC_URL}/.well-known/agent-card.json`,
    glamaVerification: `${PUBLIC_URL}/.well-known/glama.json`,
    solanaAgentRegistration: `${PUBLIC_URL}/.well-known/agent-registration.json`,
    purchaseEvidenceManifest: `${PUBLIC_URL}${PURCHASE_EVIDENCE_MANIFEST_PATH}`,
  },
});

const machineActions = machineActionCatalog().actions;
const currentAgentCard = () => buildAgentCard({
  publicUrl: PUBLIC_URL,
  serviceVersion: SERVICE_VERSION,
  actions: machineActionCatalog().actions,
});
const solanaAgentRegistration = buildSolanaAgentRegistration({
  publicUrl: PUBLIC_URL,
  actions: machineActions,
  ...(process.env.SOLANA_AGENT_ASSET ? { agentAsset: process.env.SOLANA_AGENT_ASSET } : {}),
});

app.get("/.well-known/agent-registration.json", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.json(solanaAgentRegistration);
});

app.get(serviceDeploymentPublication.paths.statement, (_req, res) => {
  res.set("Cache-Control", "public, max-age=300, must-revalidate");
  res.set("X-Agent-Payment-Policy-Statement", serviceDeploymentPublication.statementId);
  res.set("X-Agent-Payment-Policy-Expires", serviceDeploymentPublication.expiresAt);
  res.set("X-Agent-Payment-Policy-Key-Fingerprint", serviceDeploymentPublication.publicKeyFingerprint);
  res.links({
    "agent-payment-policy-key": `${PUBLIC_URL}${serviceDeploymentPublication.paths.publicKey}`,
    "erc8004-registration": `${PUBLIC_URL}/.well-known/agent-registration.json`,
  });
  return res.json(serviceDeploymentPublication.envelope);
});

app.get(serviceDeploymentPublication.paths.publicKey, (_req, res) => {
  res.set("Cache-Control", "public, max-age=300, must-revalidate");
  res.type("application/x-pem-file").send(serviceDeploymentPublication.publicKeyPem);
});

app.get(["/.well-known/x402", "/.well-known/x402.json", "/x402.json", "/api/x402"], (_req, res) => {
  const actionsByRoute = new Map(machineActionCatalog().actions.map((action) => [action.route, action]));
  const items = RESOURCES.map((r) => {
    const route = new URL(r.url).pathname;
    const action = actionsByRoute.get(route);
    return {
      resource: {
        url: action?.request?.exampleUrl || r.url,
        routeTemplate: route,
        description: r.description,
        mimeType: r.mimeType,
      },
      type: "http",
      request: action?.request || null,
      accepts: acceptsFor(r.amount),
    };
  });
  if (circleGateway.enabled) {
    items.push({
      resource: {
        url: CIRCLE_GATEWAY_RESOURCE.url,
        description: CIRCLE_GATEWAY_RESOURCE.description,
        mimeType: CIRCLE_GATEWAY_RESOURCE.mimeType,
      },
      type: "http",
      accepts: CIRCLE_GATEWAY_RESOURCE.accepts,
    });
  }
  res.json({
    x402Version: 2,
    lastUpdated: Math.floor(Date.now() / 1000),
    items,
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
    payment: "x402 USDC on Base per MCP tool call; HTTP actions also accept native MPP",
    manifest: `${PUBLIC_URL}/.well-known/x402`,
    openapi: `${PUBLIC_URL}/openapi.json`,
    purchaseEvidence: `${PUBLIC_URL}${PURCHASE_EVIDENCE_MANIFEST_PATH}`,
  });
});

// Compact skill contract for agents that probe a domain for a directly usable
// instruction file before they parse OpenAPI or start an MCP session.
app.get(["/skill.md", "/SKILL.md"], (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.type("text/markdown").send(buildSkillContract(PUBLIC_URL, machineActionCatalog().actions));
});

app.get("/api/actions", (req, res) => {
  const proxyDiagnostics = exposeAgenticTradeProxyDiagnostics(req, res);
  if (!proxyDiagnostics) res.set("Cache-Control", "public, max-age=300");
  return res.json({ ...machineActionCatalog(), ...(proxyDiagnostics ? { proxyDiagnostics } : {}) });
});

// A2A v1.0 machine-facing storefront. This is intentionally a bounded free
// discovery agent: it returns the exact paid action catalog, then buyers call
// and settle HTTP actions through x402 or MPP. MCP actions remain x402-gated.
app.get(["/.well-known/agent-card.json", "/.well-known/agent.json"], (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.json(currentAgentCard());
});

app.get("/a2a", (_req, res) => {
  const agentCard = currentAgentCard();
  res.set("Cache-Control", "public, max-age=300");
  return res.json({
    protocol: "A2A",
    version: A2A_VERSION,
    agentCard: `${PUBLIC_URL}/.well-known/agent-card.json`,
    sendMessage: `${PUBLIC_URL}/a2a/message:send`,
    skill: agentCard.skills[0].id,
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

> Machine-discoverable HTTP capabilities settle USDC on Base through either x402 or native MPP Payment authentication. Payment-offer preflight also has a Circle Gateway x402 path for gasless batched USDC Nanopayments. MCP remains Base x402-gated. No account or subscription is required. Current standard facilitator: ${FACILITATOR}. payTo ${PAY_TO}.

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
${line("/distribution/agent-discoverability-audit", AGENT_DISCOVERABILITY_AUDIT_PRICE, "public HTTPS service origin plus a brand-blind capability intent -> point-in-time rank, dependency-labeled coverage, canonical-vs-alias identity, duplicate records, expected-route presence, and price drift across ten public machine-service discovery views. Optional runtimeUrl derives the comparison price from a same-origin unsigned x402 or MPP offer; optional surfaceAudit checks the target's public Agent Card, ERC-8004 registration document, and action catalog. No catalog credential, signature, or payment.")}
${line("/commerce/payment-offer-preflight", PAYMENT_OFFER_PREFLIGHT_PRICE, "exact public HTTPS GET URL -> compare and normalize x402 and MPP payment challenges and terms before buyer authorization; check route and realm binding, expiry, and economic parity. Uses no target credential, signature, payment, redirect, or response body.")}
${line("/commerce/seller-integrity-audit", SELLER_INTEGRITY_AUDIT_PRICE, "public seller origin plus exact paid GET or POST path -> live machine-buyability audit for GET, static contract-readiness audit for POST, and recursively guaranteed buyer-required success paths. POST sends no target request. Returns controlled repair actions without target credentials or payment.")}
${line("/commerce/contract-qualified-search", CONTRACT_QUALIFIED_SEARCH_PRICE, "capability intent plus buyer-required JSON paths -> bounded Agent402 and MPP search for services whose exact seller contracts guarantee those outputs. Rejects unresolved routes and owned supply before audit; uses no credential, wallet, seller POST, or target payment.")}
${line("/distribution/agent-surface-budget-audit", AGENT_SURFACE_BUDGET_AUDIT_PRICE, "public service origin plus MCP, OpenAPI, or both mode -> bounded discovery byte budgets, comparative token estimates, heaviest definitions, missing selection contracts, and progressive-discovery fixes. Unselected surfaces are not fetched or judged; no target tool or payment is sent.")}
${line("/security/wallet-policy-conformance", WALLET_POLICY_CONFORMANCE_PRICE, "POST standardized wallet-policy observations -> explicit conformant, partial, or unsafe decision. Distinguishes provider policy denial from validation and generic provider failure, and tests exact execution shape separately from operation allowlisting. Accepts no wallet credentials or raw provider payloads.")}
${line("/security/stateful-wallet-policy-conformance", STATEFUL_WALLET_POLICY_CONFORMANCE_PRICE, "POST standardized stateful wallet-policy observations -> explicit conformant, partial, or unsafe decision for sequential caps, signed-but-unbroadcast accounting, ABI extraction, concurrency, counter references, and application serialization. Accepts no counter values, resource IDs, credentials, or raw provider payloads.")}
${circleGateway.enabled ? line(CIRCLE_GATEWAY_PATH, PAYMENT_OFFER_PREFLIGHT_PRICE, "the same payment-offer preflight product through Circle Gateway x402 Nanopayments, with gasless buyer authorization and batched USDC settlement.") : ""}

## How to pay
1. GET an endpoint such as ${PUBLIC_URL}/enrich?domain=stripe.com. One HTTP 402 advertises both protocols.
2. For x402, use PAYMENT-REQUIRED with an x402 v2 client and replay with PAYMENT-SIGNATURE. A successful response carries PAYMENT-RESPONSE.
3. For MPP, use WWW-Authenticate: Payment with an mppx EVM charge client and replay with Authorization: Payment. A successful response carries Payment-Receipt.
4. The Circle Gateway route advertises GatewayWalletBatched x402 requirements and settles the same quoted amount into the seller's Gateway balance.
5. Runtime payment challenges are authoritative. Enforce the chosen scheme, network, amount, and recipient before signing.

## Discovery
- x402 manifest: ${PUBLIC_URL}/.well-known/x402
- OpenAPI: ${PUBLIC_URL}/openapi.json
- Skill contract: ${PUBLIC_URL}/skill.md
- Action catalog: ${PUBLIC_URL}/api/actions
- A2A agent card: ${PUBLIC_URL}/.well-known/agent-card.json
- Solana Agent Registry metadata: ${PUBLIC_URL}/.well-known/agent-registration.json
- Aggregate demand telemetry: ${PUBLIC_URL}/v0/commerce-demand.json
- Purchase evidence: ${PUBLIC_URL}${PURCHASE_EVIDENCE_MANIFEST_PATH}
- Buyer policy reference: ${BUYER_POLICY_REFERENCE.release}
- Wallet-policy conformance contract: ${PUBLIC_URL}/schemas/wallet-policy-conformance-v1.json
- Stateful wallet-policy conformance contract: ${PUBLIC_URL}/schemas/stateful-wallet-policy-conformance-v1.json
- Source: https://github.com/epistemedeus/x402-url-extractor
`);
});

app.get("/schemas/wallet-policy-conformance-v1.json", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.json(WALLET_POLICY_CONTRACT);
});

app.get("/schemas/stateful-wallet-policy-conformance-v1.json", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.json(STATEFUL_WALLET_POLICY_CONTRACT);
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

app.get(PAID_ACTION_EFFECT_PROFILE_PATH, (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.json(buildPaidActionEffectProfile({ origin: PUBLIC_URL, serviceVersion: SERVICE_VERSION }));
});

app.get(PURCHASE_EVIDENCE_MANIFEST_PATH, (_req, res) => {
  if (!purchaseEvidenceManifest) return res.status(503).json({ error: "purchase_evidence_not_ready" });
  res.set("Cache-Control", "public, max-age=300, must-revalidate");
  res.set("X-Agent-Payment-Evidence-Digest", purchaseEvidenceManifest.manifestDigest);
  return res.json(purchaseEvidenceManifest);
});

app.get("/rels/agent-payment-evidence", (_req, res) => {
  return res.redirect(308, PURCHASE_EVIDENCE_RELATION);
});

app.get("/schemas/platform-health-card-v0.json", (_req, res) => {
  setRadarCache(res);
  return res.json(PLATFORM_HEALTH_SCHEMA);
});

app.get("/alerts", (_req, res) => {
  res.set("Cache-Control", "no-store");
  return res.type("html").send(renderAlertPilot());
});

const buildOpenApiDocument = ({ profile = "agentcash" } = {}) => {
  const document = {
    openapi: "3.1.0",
    info: {
      title: "SameDayDesk machine commerce gateway",
      version: SERVICE_VERSION,
      description: "Deterministic agent APIs for web and company intelligence, repository security, agent-work economics, machine-service discoverability, payment preflight and settlement proof, wallet context, and Morpho decision evidence. Pay per call through Base x402 or native MPP, with a Circle Gateway Nanopayments path for gasless batched USDC.",
      contact: { email: "contact@samedaydesk.com", url: "https://samedaydesk.com" },
      "x-guidance": "Choose the narrowest route that answers the task. Supply required query parameters, inspect the HTTP 402 x402 and MPP offers, enforce your own price and network policy, then retry the identical method, path, and query with one supported payment credential. Treat runtime payment challenges as authoritative.",
    },
    "x-service-info": {
      categories: ["agentic-payments", "machine-commerce", "data", "defi"],
      docs: {
        apiReference: profile === "mpp"
          ? `${PUBLIC_URL}/mpp-openapi.json`
          : `${PUBLIC_URL}/openapi.json`,
        homepage: PUBLIC_URL,
        llms: `${PUBLIC_URL}/llms.txt`,
        buyerPolicyReference: BUYER_POLICY_REFERENCE.repository,
        purchaseEvidence: `${PUBLIC_URL}${PURCHASE_EVIDENCE_MANIFEST_PATH}`,
      },
    },
    servers: [{ url: PUBLIC_URL }],
    tags: [
      { name: "A2A" },
      { name: "Agent Operations" },
      { name: "Blockchain" },
      { name: "Company Intelligence" },
      { name: "DeFi" },
      { name: "Distribution" },
      { name: "Security" },
      { name: "Settlement Radar" },
      { name: "Web Data" },
    ],
    paths: {
      "/v0/cards.json": { get: { summary: "Free incident-backed platform health cards. Categories are not calibrated scores.", responses: { "200": { description: "SameDayDesk platform health index v0" } } } },
      "/v0/commerce-demand.json": { get: { summary: "Privacy-safe aggregate external machine-commerce observations.", parameters: [{ name: "days", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 365, default: 90 } }], responses: { "200": { description: "Aggregate discovery, challenge, paid-success, unmatched-request, and high-precision semantic-candidate counts. Known internal and crawler traffic is excluded; unidentified automation can remain." } } } },
      [PAID_ACTION_EFFECT_PROFILE_PATH]: { get: { summary: "Experimental read-only effect and retry contract for SameDayDesk paid POST operations.", responses: { "200": { description: "Exact method-route effect declarations and payment-response replay boundary" } } } },
      [PURCHASE_EVIDENCE_MANIFEST_PATH]: { get: { summary: "Seller-declared purchase-authorization evidence for every exact paid operation.", responses: { "200": { description: "Bounded operation-level effect, response guarantee, replay, receipt, and signed-deployment pointers" } } } },
      "/.well-known/agent-card.json": { get: { summary: "A2A v1.0 agent card for the free machine-commerce storefront.", responses: { "200": { description: "A2A AgentCard" } } } },
      "/.well-known/glama.json": { get: { summary: "Project-owned Glama connector maintainer verification.", responses: { "200": { description: "Glama connector verification" } } } },
      "/.well-known/x402-verification.json": { get: { summary: "Public server-ownership proof for the x402.jobs resource registry.", responses: { "200": { description: "x402.jobs ownership verification" } } } },
      "/.well-known/agent-registration.json": { get: { summary: "ERC-8004-compatible SameDayDesk registration metadata for the Solana Agent Registry.", responses: { "200": { description: "SameDayDesk agent identity, service endpoints, settlement wallet, and x402 support" } } } },
      "/.well-known/agent-payment-policy-service-deployment.json": { get: { summary: "Signed short-lived binding from the ERC-8004 agent wallet to the canonical SameDayDesk origin, exact paid routes, and exact x402 and MPP settlement identities.", responses: { "200": { description: "Ed25519 JWS deployment statement plus public identity pointers" } } } },
      "/.well-known/agent-payment-policy-service-deployment.pem": { get: { summary: "Ed25519 public key whose raw 32-byte value is the ERC-8004 operational Solana wallet.", responses: { "200": { description: "PEM-encoded Ed25519 public key" } } } },
      "/schemas/wallet-policy-conformance-v1.json": { get: { summary: "Free canonical case matrix and JSON Schemas for the wallet-policy conformance product.", responses: { "200": { description: "Versioned credential-free wallet-policy conformance contract" } } } },
      "/schemas/stateful-wallet-policy-conformance-v1.json": { get: { summary: "Free canonical stateful case matrix and JSON Schemas for cumulative wallet-policy conformance.", responses: { "200": { description: "Versioned credential-free stateful wallet-policy conformance contract" } } } },
      "/a2a/message:send": { post: { summary: "Return the exact-price x402 and MPP action catalog as an A2A direct message.", responses: { "200": { description: "A2A message containing the action catalog" }, "400": { description: "Invalid request or unsupported A2A version" } } } },
      "/platforms": { get: { summary: "Human-readable Settlement Radar health cards.", responses: { "200": { description: "HTML platform health index" } } } },
      "/work/opportunity-preflight": { get: { summary: RESOURCES[11].description, parameters: [{ name: "platform", in: "query", required: false, schema: { type: "string", example: "taskmarket" } }, { name: "rewardUsd", in: "query", required: true, schema: { type: "number", exclusiveMinimum: 0 } }, { name: "hours", in: "query", required: true, schema: { type: "number", minimum: 0 } }, { name: "hourlyCostUsd", in: "query", required: true, schema: { type: "number", minimum: 0 } }, { name: "computeUsd", in: "query", required: false, schema: { type: "number", minimum: 0, default: 0 } }, { name: "mandatorySpendUsd", in: "query", required: false, schema: { type: "number", minimum: 0, default: 0 } }, { name: "reusableValueUsd", in: "query", required: false, schema: { type: "number", minimum: 0, default: 0 } }, { name: "selectionProbabilityPct", in: "query", required: false, schema: { type: "number", minimum: 0, maximum: 100 } }, { name: "competition", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } }, { name: "slots", in: "query", required: false, schema: { type: "integer", minimum: 1, default: 1 } }, { name: "agentAccess", in: "query", required: false, schema: { type: "string", enum: ["agent_allowed", "agent_only", "mixed", "human_only", "unknown"], default: "unknown" } }, { name: "acceptance", in: "query", required: false, schema: { type: "string", enum: ["deterministic", "machine_scored", "timed_review", "discretionary", "unknown"], default: "unknown" } }, { name: "settlement", in: "query", required: false, schema: { type: "string", enum: ["direct", "escrow", "platform_balance", "discretionary", "unfunded", "unknown"], default: "unknown" } }], responses: { "200": { description: "deterministic opportunity economics and evidence preflight" }, "400": { description: "invalid required input, charged nothing" }, "402": { description: `payment required (x402, ${OPPORTUNITY_PREFLIGHT_PRICE} USDC base)` } } } },
      "/distribution/agent-discoverability-audit": { get: { summary: RESOURCES[12].description, parameters: [{ name: "origin", in: "query", required: true, description: "Public HTTPS origin of the machine service, with no path or query.", schema: { type: "string", format: "uri", example: "https://agents.samedaydesk.com" } }, { name: "intent", in: "query", required: true, description: "Brand-blind capability description used as the registry query.", schema: { type: "string", minLength: 20, maxLength: 500, example: "extract a public web page into structured JSON metadata headings links and JSON-LD" } }, { name: "route", in: "query", required: false, description: "Expected exact path whose presence should be checked.", schema: { type: "string", pattern: "^/[^?#]*$", example: "/extract" } }, { name: "runtimeUrl", in: "query", required: false, description: "Optional exact same-origin HTTPS GET URL whose unpaid x402 or MPP offer supplies the runtime price reference. Requires route and an exactly matching pathname. Uses pinned public DNS, reads headers only, follows no redirect, and sends no credential or payment.", schema: { type: "string", format: "uri", maxLength: 2048, example: "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com" } }, { name: "payTo", in: "query", required: false, description: "Optional EVM settlement address used to identify aliased service origins.", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }, { name: "expectedPriceUsd", in: "query", required: false, description: "Optional exact route price expected by the caller, with at most six fractional digits. Requires route. A coherent runtimeUrl offer takes precedence and any caller-to-runtime drift is reported.", schema: { type: "number", minimum: 0, maximum: 1000000, multipleOf: 0.000001, example: 0.005 } }, { name: "surfaceAudit", in: "query", required: false, description: "Set true to inspect the target's public Agent Card, ERC-8004 registration document, and action catalog for the expected route after payment. Uses pinned public DNS, no redirects, a five-second timeout, and a 512-KiB cap per document.", schema: { type: "boolean", default: false } }], responses: { "200": { description: "brand-blind point-in-time discovery ranks, coverage, route presence, runtime-derived or caller-labeled catalog-price drift, optional owned-surface coverage, and method limits" }, "400": { description: "invalid or branded input, charged nothing" }, "402": { description: `payment required (x402, ${AGENT_DISCOVERABILITY_AUDIT_PRICE} USDC base)` } } } },
      "/commerce/payment-offer-preflight": {
        get: { summary: RESOURCES[13].description, parameters: [{ name: "url", in: "query", required: true, description: "Exact public HTTPS GET route to inspect without credentials or payment.", schema: { type: "string", format: "uri", maxLength: 2048, example: "https://agents.samedaydesk.com/defi/morpho-position?address=0x8ee9c15c3e5332cbc6ef39a2bb036c63c6549b6e" } }], responses: { "200": { description: "normalized x402 and MPP offers, binding checks, economic parity, response-contract readiness, and a bounded decision", content: { "application/json": { schema: paymentOfferPreflightOutputSchema() } } }, "400": { description: "invalid or credential-bearing target, charged nothing" }, "402": { description: `payment required (x402, ${PAYMENT_OFFER_PREFLIGHT_PRICE} USDC base)` }, "502": { description: "target DNS, transport, redirect, or challenge failure after the paid attempt" } } },
        post: {
          operationId: "preflightPaymentOfferForWorkflow",
          tags: ["Agent Operations"],
          summary: `${RESOURCES[13].description} JSON-body form for machine workflow builders.`,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  ...paymentOfferPreflightInputSchema(),
                },
              },
            },
          },
          responses: {
            "200": { description: "normalized x402 and MPP offers, binding checks, economic parity, response-contract readiness, and a bounded decision", content: { "application/json": { schema: paymentOfferPreflightOutputSchema() } } },
            "400": { description: "invalid or missing target, charged nothing" },
            "402": { description: `payment required (x402 or MPP, ${PAYMENT_OFFER_PREFLIGHT_PRICE} USDC base)` },
            "502": { description: "target DNS, transport, redirect, or challenge failure after the paid attempt" },
          },
          "x-payment-info": profile === "mpp"
            ? mppPaymentInfoFor(RESOURCES[13])
            : agentCashPaymentInfoFor(RESOURCES[13]),
        },
      },
      "/commerce/seller-integrity-audit": {
        get: {
          summary: RESOURCES[19].description,
          parameters: [
            { name: "origin", in: "query", required: true, description: "Credential-free public HTTPS seller origin on port 443.", schema: { type: "string", format: "uri", example: "https://agents.samedaydesk.com" } },
            { name: "route", in: "query", required: true, description: "Exact paid GET or POST path declared by the seller, without query or template parameters.", schema: { type: "string", pattern: "^/(?!/)[^?#{}]+$", example: "/commerce/payment-offer-preflight" } },
            { name: "method", in: "query", required: false, description: "Paid operation method. POST receives static OpenAPI contract analysis without a target request.", schema: { type: "string", enum: ["GET", "POST"], default: "GET" } },
            { name: "requiredPaths", in: "query", required: false, description: "Comma-separated dotted JSON paths the buyer requires the success schema to guarantee recursively.", schema: { type: "string", example: "decision,offers" } },
            { name: "requireBazaar", in: "query", required: false, description: "When true, missing Bazaar discovery metadata becomes a repair finding.", schema: { type: "boolean", default: false } },
          ],
          responses: {
            "200": { description: "bounded seller machine-buyability report and repair actions", content: { "application/json": { schema: sellerIntegrityAuditOutputSchema() } } },
            "400": { description: "invalid public origin or exact route, charged nothing" },
            "402": { description: `payment required (x402 or MPP, ${SELLER_INTEGRITY_AUDIT_PRICE} USDC base)` },
          },
          "x-payment-info": profile === "mpp"
            ? mppPaymentInfoFor(RESOURCES[19])
            : agentCashPaymentInfoFor(RESOURCES[19]),
        },
      },
      "/commerce/contract-qualified-search": {
        get: {
          summary: RESOURCES[20].description,
          parameters: [
            { name: "query", in: "query", required: true, description: "Capability intent sent to Agent402 search and used locally to rank MPP catalog metadata. Do not include secrets.", schema: { type: "string", minLength: 10, maxLength: 300, example: "service domain ownership code provenance" } },
            { name: "requiredPaths", in: "query", required: true, description: "Comma-separated dotted JSON paths every returned seller contract must guarantee recursively.", schema: { type: "string", pattern: "^[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+){0,7}(?:,[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+){0,7}){0,15}$", example: "data.sourceRepository" } },
            { name: "maxPriceDisplayUnits", in: "query", required: false, description: "Maximum advertised per-call price in each source's display currency.", schema: { type: "number", exclusiveMinimum: 0, maximum: 10, default: 0.1 } },
            { name: "limit", in: "query", required: false, description: "Maximum total candidates audited and returned across both sources.", schema: { type: "integer", minimum: 1, maximum: 8, default: 5 } },
          ],
          responses: {
            "200": { description: "bounded contract-qualified candidates and controlled gap reasons", content: { "application/json": { schema: contractQualifiedSearchOutputSchema() } } },
            "400": { description: "invalid or secret-like search request, charged nothing" },
            "402": { description: `payment required (x402 or MPP, ${CONTRACT_QUALIFIED_SEARCH_PRICE} USDC base)` },
          },
          "x-payment-info": profile === "mpp"
            ? mppPaymentInfoFor(RESOURCES[20])
            : agentCashPaymentInfoFor(RESOURCES[20]),
        },
      },
      "/distribution/agent-surface-budget-audit": {
        get: {
          summary: RESOURCES[21].description,
          parameters: [
            { name: "origin", in: "query", required: true, description: "Credential-free public HTTPS service origin on port 443, with no path or query.", schema: { type: "string", format: "uri", example: "https://agents.samedaydesk.com" } },
            { name: "surfaceMode", in: "query", required: false, description: "Audit MCP only, OpenAPI only, or both declared surfaces. Unselected surfaces are not fetched or judged.", schema: { type: "string", enum: ["mcp", "openapi", "both"], default: "both" } },
            { name: "mcpPath", in: "query", required: false, description: "Exact root-relative MCP streamable-HTTP path.", schema: { type: "string", pattern: "^/(?!/)[^?#{]+$", default: "/mcp" } },
            { name: "openApiPath", in: "query", required: false, description: "Exact root-relative OpenAPI JSON path.", schema: { type: "string", pattern: "^/(?!/)[^?#{]+$", default: "/openapi.json" } },
            { name: "mcpBudgetBytes", in: "query", required: false, description: "Maximum preferred raw MCP tools/list response size in bytes.", schema: { type: "integer", minimum: 8192, maximum: 1000000, default: 65536 } },
            { name: "openApiBudgetBytes", in: "query", required: false, description: "Maximum preferred raw OpenAPI document size in bytes.", schema: { type: "integer", minimum: 32768, maximum: 1000000, default: 524288 } },
          ],
          responses: {
            "200": { description: "bounded MCP and OpenAPI surface measurements, budget decisions, and repair actions", content: { "application/json": { schema: agentSurfaceBudgetAuditOutputSchema() } } },
            "400": { description: "invalid public origin, path, or byte budget, charged nothing" },
            "402": { description: `payment required (x402 or MPP, ${AGENT_SURFACE_BUDGET_AUDIT_PRICE} USDC base)` },
          },
          "x-payment-info": profile === "mpp"
            ? mppPaymentInfoFor(RESOURCES[21])
            : agentCashPaymentInfoFor(RESOURCES[21]),
        },
      },
      "/commerce/settlement-proof": { get: { summary: RESOURCES[14].description, parameters: [{ name: "transactionHash", in: "query", required: true, description: "Base mainnet transaction hash whose canonical USDC Transfer logs should be checked.", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$", example: "0xcfcbb367fecf27052db9ca855e5146e99cacbce1cab94f20f9f95a74170a8987" } }, { name: "recipient", in: "query", required: true, description: "Expected USDC recipient.", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", example: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee" } }, { name: "amountAtomic", in: "query", required: true, description: "Expected positive USDC amount in six-decimal atomic units.", schema: { type: "string", pattern: "^[1-9][0-9]{0,20}$", maxLength: 21, example: "5000" } }, { name: "payer", in: "query", required: false, description: "Optional expected USDC payer.", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }], responses: { "200": { description: "deterministic canonical Base USDC settlement proof or mismatch findings" }, "400": { description: "invalid settlement claim, charged nothing" }, "402": { description: `payment required (x402 or MPP, ${SETTLEMENT_PROOF_PRICE} USDC base)` } } } },
      "/chain/transaction-receipt": { get: { summary: RESOURCES[15].description, parameters: [{ name: "transactionHash", in: "query", required: true, description: "Mined Base or Ethereum transaction hash whose normalized receipt should be returned.", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } }, { name: "network", in: "query", required: false, description: "Receipt network. Defaults to Base mainnet.", schema: { type: "string", enum: ["base", "ethereum"], default: "base" } }], responses: { "200": { description: "normalized transaction receipt with fee and decoded transfer evidence" }, "400": { description: "invalid hash or unsupported network, charged nothing" }, "402": { description: `payment required (x402 or MPP, ${TRANSACTION_RECEIPT_PRICE} USDC base)` } } } },
      "/chain/solana-transaction-receipt": { get: { summary: RESOURCES[16].description, parameters: [{ name: "signature", in: "query", required: true, description: "Finalized Solana mainnet transaction signature.", schema: { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{80,90}$", example: "GKYyX4foVCLRN4b8b7qBTXXf9iEAtrdqzez4U1rwgEhUt99cmyXwPQ4JhsEu4PFbWFNj3ZKZbxTVNwHJKK17ahc" } }, { name: "mint", in: "query", required: false, description: "SPL-token mint to verify. Defaults to canonical Solana USDC.", schema: { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$", default: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" } }, { name: "recipient", in: "query", required: false, description: "Optional expected token recipient owner.", schema: { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$" } }, { name: "amountAtomic", in: "query", required: false, description: "Optional expected positive token amount in atomic units; requires recipient.", schema: { type: "string", pattern: "^[1-9][0-9]{0,19}$" } }, { name: "payer", in: "query", required: false, description: "Optional expected token payer owner; requires recipient and amountAtomic.", schema: { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$" } }], responses: { "200": { description: "normalized finalized Solana receipt and optional exact SPL-token settlement verification" }, "400": { description: "invalid signature or settlement claim, charged nothing" }, "402": { description: `payment required (x402 or MPP, ${SOLANA_TRANSACTION_RECEIPT_PRICE} USDC base)` } } } },
      "/security/wallet-policy-conformance": {
        post: {
          operationId: "evaluateWalletPolicyConformance",
          tags: ["Security"],
          summary: RESOURCES[17].description,
          requestBody: { required: true, content: { "application/json": { schema: walletPolicyConformanceInputSchema() } } },
          responses: {
            "200": { description: "credential-free wallet-policy conformance evidence" },
            "400": { description: "invalid standardized observation matrix, charged nothing" },
            "402": { description: `payment required (x402 or MPP, ${WALLET_POLICY_CONFORMANCE_PRICE} USDC base)` },
          },
          "x-payment-info": profile === "mpp"
            ? mppPaymentInfoFor(RESOURCES[17])
            : agentCashPaymentInfoFor(RESOURCES[17]),
        },
      },
      "/security/stateful-wallet-policy-conformance": {
        post: {
          operationId: "evaluateStatefulWalletPolicyConformance",
          tags: ["Security"],
          summary: RESOURCES[18].description,
          requestBody: { required: true, content: { "application/json": { schema: statefulWalletPolicyConformanceInputSchema() } } },
          responses: {
            "200": { description: "credential-free stateful wallet-policy conformance evidence" },
            "400": { description: "invalid standardized stateful observation matrix, charged nothing" },
            "402": { description: `payment required (x402 or MPP, ${STATEFUL_WALLET_POLICY_CONFORMANCE_PRICE} USDC base)` },
          },
          "x-payment-info": profile === "mpp"
            ? mppPaymentInfoFor(RESOURCES[18])
            : agentCashPaymentInfoFor(RESOURCES[18]),
        },
      },
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
  };
  document.paths["/work/opportunity-preflight"].post = {
    operationId: "preflightAgentOpportunityForWorkflow",
    tags: ["Agent Operations"],
    summary: `${RESOURCES[11].description} JSON-body form for machine workflow builders.`,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              platform: { type: "string", maxLength: 100 },
              rewardUsd: { type: "number", exclusiveMinimum: 0 },
              hours: { type: "number", minimum: 0, maximum: 10000 },
              hourlyCostUsd: { type: "number", minimum: 0, maximum: 100000 },
              computeUsd: { type: "number", minimum: 0, default: 0 },
              mandatorySpendUsd: { type: "number", minimum: 0, default: 0 },
              reusableValueUsd: { type: "number", minimum: 0, default: 0 },
              selectionProbabilityPct: { type: "number", minimum: 0, maximum: 100 },
              competition: { type: "integer", minimum: 0, default: 0 },
              slots: { type: "integer", minimum: 1, default: 1 },
              agentAccess: { type: "string", enum: ["agent_allowed", "agent_only", "mixed", "human_only", "unknown"], default: "unknown" },
              acceptance: { type: "string", enum: ["deterministic", "machine_scored", "timed_review", "discretionary", "unknown"], default: "unknown" },
              settlement: { type: "string", enum: ["direct", "escrow", "platform_balance", "discretionary", "unfunded", "unknown"], default: "unknown" },
            },
            required: ["rewardUsd", "hours", "hourlyCostUsd"],
          },
        },
      },
    },
    responses: {
      "200": { description: "deterministic opportunity economics and evidence preflight" },
      "400": { description: "invalid or missing input, charged nothing" },
      "402": { description: `payment required (x402 or MPP, ${OPPORTUNITY_PREFLIGHT_PRICE} USDC base)` },
    },
    "x-payment-info": profile === "mpp"
      ? mppPaymentInfoFor(RESOURCES[11])
      : agentCashPaymentInfoFor(RESOURCES[11]),
  };
  attachPaidActionEffectContracts(document);
  if (profile === "agentcash" && circleGateway.enabled) {
    document.paths[CIRCLE_GATEWAY_PATH] = {
      get: {
        operationId: "preflightPaymentOfferWithCircleGateway",
        tags: ["Agent Operations"],
        summary: `${CIRCLE_GATEWAY_RESOURCE.description} This access path accepts gasless batched USDC through Circle Gateway Nanopayments.`,
        parameters: [{
          name: "url",
          in: "query",
          required: true,
          description: "Exact public HTTPS GET route to inspect without credentials or payment.",
          schema: {
            type: "string",
            format: "uri",
            maxLength: 2048,
            example: "https://agents.samedaydesk.com/defi/morpho-position?address=0x8ee9c15c3e5332cbc6ef39a2bb036c63c6549b6e",
          },
        }],
        responses: {
          "200": { description: "normalized x402 and MPP offers, binding checks, economic parity, response-contract readiness, and a bounded decision", content: { "application/json": { schema: paymentOfferPreflightOutputSchema() } } },
          "400": { description: "invalid or credential-bearing target, charged nothing" },
          "402": { description: `payment required (Circle Gateway x402 Nanopayments, ${PAYMENT_OFFER_PREFLIGHT_PRICE} USDC)` },
          "502": { description: "target DNS, transport, redirect, or challenge failure after the paid attempt" },
        },
        "x-payment-info": circleGatewayPaymentInfo(),
      },
    };
  }
  for (const resource of RESOURCES) {
    const pathname = new URL(resource.url).pathname;
    const operation = document.paths[pathname]?.get;
    if (!operation) continue;
    const metadata = RESOURCE_DISCOVERY_METADATA[pathname];
    operation.operationId = metadata.operationId;
    operation.tags = metadata.tags;
    operation["x-payment-info"] = profile === "mpp"
      ? mppPaymentInfoFor(resource)
      : agentCashPaymentInfoFor(resource);
    const response = getDiscoveryOutputContract(`GET ${pathname}`);
    operation.responses["200"].content = {
      "application/json": {
        schema: response?.schema || { type: "object", additionalProperties: true },
        ...(response?.example ? { example: response.example } : {}),
      },
    };
  }
  const freeOperationMetadata = {
    "/v0/cards.json": { operationId: "listPlatformHealthCards", tags: ["Settlement Radar"] },
    "/v0/commerce-demand.json": { operationId: "getCommerceDemand", tags: ["Settlement Radar"] },
    [PAID_ACTION_EFFECT_PROFILE_PATH]: { operationId: "getPaidActionEffectProfile", tags: ["Agent Operations"] },
    [PURCHASE_EVIDENCE_MANIFEST_PATH]: { operationId: "getAgentPaymentEvidence", tags: ["Agent Operations"] },
    "/.well-known/agent-card.json": { operationId: "getA2aAgentCard", tags: ["A2A"] },
    "/.well-known/agent-registration.json": { operationId: "getSolanaAgentRegistration", tags: ["A2A"] },
    "/.well-known/glama.json": { operationId: "getGlamaVerification", tags: ["Distribution"] },
    "/.well-known/x402-verification.json": { operationId: "getX402JobsVerification", tags: ["Distribution"] },
    "/.well-known/agent-payment-policy-service-deployment.json": { operationId: "getServiceDeploymentStatement", tags: ["Agent Operations"] },
    "/.well-known/agent-payment-policy-service-deployment.pem": { operationId: "getServiceDeploymentPublicKey", tags: ["Agent Operations"] },
    "/schemas/wallet-policy-conformance-v1.json": { operationId: "getWalletPolicyConformanceSchema", tags: ["Security"] },
    "/schemas/stateful-wallet-policy-conformance-v1.json": { operationId: "getStatefulWalletPolicyConformanceSchema", tags: ["Security"] },
    "/a2a/message:send": { operationId: "sendA2aMessage", tags: ["A2A"] },
    "/platforms": { operationId: "viewSettlementRadar", tags: ["Settlement Radar"] },
  };
  for (const [pathname, metadata] of Object.entries(freeOperationMetadata)) {
    const pathItem = document.paths[pathname];
    const operation = pathItem.get || pathItem.post;
    operation.operationId = metadata.operationId;
    operation.tags = metadata.tags;
  }
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (!operation["x-payment-info"]) operation.security = [];
    }
  }
  validateOpenApiOperationIds(document);
  return document;
};

// Fail startup before the listener opens when any public OpenAPI operation
// lacks one unique stable operation ID.
buildOpenApiDocument({ profile: "agentcash" });

app.get(["/favicon.ico", "/favicon.svg"], (req, res) => {
  const filename = req.path.endsWith(".svg") ? "favicon.svg" : "favicon.ico";
  return res.redirect(302, `https://samedaydesk.com/${filename}`);
});

app.get(["/openapi.json", "/openapi.yaml", "/swagger.json"], (_req, res) => {
  return res.json(buildOpenApiDocument({ profile: "agentcash" }));
});

app.get(["/mpp-openapi.json", "/openapi.mpp.json"], (_req, res) => {
  return res.json(buildOpenApiDocument({ profile: "mpp" }));
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
// incomplete required inputs return an uncharged 400. Empty credential-free
// HEAD and POST requests may reach the payment challenge so machine registries
// can inspect the route without manufacturing a paid attempt.
const hasPaymentCredential = (req) => Boolean(
  req.get("payment-signature") ||
  req.get("x-payment") ||
  req.get("x-payment-signature") ||
  /^Payment\s+/i.test(req.get("authorization") || "")
);

// Machine catalogs can exercise one fixed, cost-free example before buying a
// custom result. This branch accepts exactly `trial=1`, performs no external
// work, and cannot bypass a credential-bearing or caller-supplied paid call.
app.get("/work/opportunity-preflight", (req, res, next) => {
  const keys = Object.keys(req.query || {});
  if (keys.length !== 1 || keys[0] !== "trial" || req.query.trial !== "1" || hasPaymentCredential(req)) {
    return next();
  }
  res.set("Cache-Control", "public, max-age=300");
  return res.json(opportunityPreflightTrial());
});

const validateOpportunityPreflightRequest = (req, res, next) => {
  try {
    normalizeOpportunityPreflightRequest({
      method: req.method,
      query: req.query,
      body: req.body,
      hasPaymentCredential: hasPaymentCredential(req),
    });
    return next();
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: String(error?.message || error),
      charged: false,
    });
  }
};
app.head("/work/opportunity-preflight", validateOpportunityPreflightRequest);
app.get("/work/opportunity-preflight", validateOpportunityPreflightRequest);
app.post("/work/opportunity-preflight", validateOpportunityPreflightRequest);

// Validate public targeting and brand-blind intent before payment. The paid
// The default audit never fetches the target origin and uses no marketplace
// credentials. An explicit surfaceAudit flag enables only three fixed public
// same-origin JSON documents after settlement.
app.get("/distribution/agent-discoverability-audit", (req, res, next) => {
  try {
    normalizeDiscoverabilityAuditInput(req.query);
    return next();
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: String(error?.message || error),
      charged: false,
    });
  }
});

// Reject malformed, credential-bearing, non-HTTPS, or local targets before a
// payment challenge. DNS resolution and the headers-only target request happen
// only after settlement because they are the work this route sells.
const validatePaymentOfferPreflightRequest = (req, res, next) => {
  try {
    const input = req.method === "POST" ? req.body : { url: req.query.url };
    // Permit the empty unauthenticated POST used by registry discovery to
    // reach the payment challenge. A paid request still requires a valid URL
    // before the facilitator is asked to verify or settle anything.
    if (req.method === "POST" && !input?.url && !hasPaymentCredential(req)) return next();
    normalizePaymentOfferPreflightInput(input);
    return next();
  } catch (error) {
    return res.status(400).json({
      ok: false,
      code: error?.code || "invalid_url",
      error: String(error?.message || error),
      charged: false,
    });
  }
};
app.get(["/commerce/payment-offer-preflight", CIRCLE_GATEWAY_PATH], validatePaymentOfferPreflightRequest);
app.post("/commerce/payment-offer-preflight", validatePaymentOfferPreflightRequest);

// Reject malformed seller origins and paths before either payment rail runs.
app.get("/commerce/seller-integrity-audit", (req, res, next) => {
  try {
    res.locals.sellerIntegrityAuditInput = normalizeSellerIntegrityAuditInput(req.query);
    return next();
  } catch (error) {
    const message = error instanceof SellerIntegrityAuditError
      ? error.message
      : "invalid seller-integrity audit request";
    res.set("Cache-Control", "no-store");
    return res.status(400).json({
      ok: false,
      product: "samedaydesk-seller-integrity-audit",
      error: message,
      charged: false,
      boundary: { credentialsUsed: false, targetPaymentSigned: false, targetPaymentSent: false },
    });
  }
});

// Validate the capability intent and buyer-required output paths before either
// rail charges. Directory search and bounded seller audits happen only after
// settlement.
app.get("/commerce/contract-qualified-search", (req, res, next) => {
  try {
    res.locals.contractQualifiedSearchInput = normalizeContractQualifiedSearchInput(req.query);
    return next();
  } catch (error) {
    const message = error instanceof ContractQualifiedSearchError
      ? error.message
      : "invalid contract-qualified search request";
    res.set("Cache-Control", "no-store");
    return res.status(400).json({
      ok: false,
      product: "samedaydesk-contract-qualified-search",
      error: message,
      charged: false,
      boundary: { credentialsUsed: false, walletAccessed: false, targetPaymentSigned: false, targetPaymentSent: false },
    });
  }
});

// Validate the exact public discovery surfaces and budgets before either rail
// charges. DNS, MCP initialize/tools-list, and OpenAPI acquisition happen only
// after settlement.
app.get("/distribution/agent-surface-budget-audit", (req, res, next) => {
  try {
    res.locals.agentSurfaceBudgetAuditInput = normalizeAgentSurfaceBudgetAuditInput(req.query);
    return next();
  } catch (error) {
    const message = error instanceof AgentSurfaceBudgetAuditError
      ? error.message
      : "invalid agent-surface budget audit request";
    res.set("Cache-Control", "no-store");
    return res.status(400).json({
      ok: false,
      product: "samedaydesk-agent-surface-budget-audit",
      error: message,
      charged: false,
      boundary: { credentialsUsed: false, toolsCalled: false, targetPaymentSigned: false, targetPaymentSent: false },
    });
  }
});

// Reject malformed settlement claims before payment. Receipt and block reads
// happen only after settlement because they are the work this route sells.
app.get("/commerce/settlement-proof", (req, res, next) => {
  try {
    normalizeSettlementProofInput(req.query);
    return next();
  } catch (error) {
    return res.status(400).json({
      ok: false,
      product: "samedaydesk-base-usdc-settlement-proof",
      code: error instanceof SettlementProofError ? error.code : "invalid_settlement_request",
      error: String(error?.message || error),
      charged: false,
    });
  }
});

// Reject malformed receipt requests before payment. Public RPC reads happen
// only after settlement because the normalized receipt is the sold work.
app.get("/chain/transaction-receipt", (req, res, next) => {
  try {
    normalizeTransactionReceiptInput(req.query);
    return next();
  } catch (error) {
    return res.status(400).json({
      ok: false,
      product: "samedaydesk-transaction-receipt",
      code: error instanceof TransactionReceiptError ? error.code : "invalid_transaction_receipt_request",
      error: String(error?.message || error),
      charged: false,
    });
  }
});

app.get("/chain/solana-transaction-receipt", (req, res, next) => {
  try {
    normalizeSolanaTransactionReceiptInput(req.query);
    return next();
  } catch (error) {
    return res.status(400).json({
      ok: false,
      product: "samedaydesk-solana-transaction-receipt",
      code: error instanceof SolanaTransactionReceiptError ? error.code : "invalid_solana_transaction_receipt_request",
      error: String(error?.message || error),
      charged: false,
    });
  }
});

function declareOpportunityPreflightContract(routeKey) {
  const post = routeKey.startsWith("POST ");
  return declareDiscoveryContract({
    routeKey,
    ...(post ? { method: "POST", bodyType: "json" } : {}),
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
        version: "1.0.0",
        decision: "abandon",
        input: { platform: "taskmarket", rewardUsd: 10, hours: 0.25, hourlyCostUsd: 4, selectionProbabilityPct: 2 },
        economics: {
          totalAtRiskUsd: 1.5,
          expectedSurplusUsd: -0.3,
          breakEvenSelectionProbabilityPct: 5,
          equalEntryShareReferencePct: 1.25,
        },
        gates: { hardBlocks: [], requiredChecks: [], warnings: ["platform_has_observed_oversupply_or_selection_dilution"] },
        platformEvidence: null,
        boundary: "Deterministic preflight only; this call does not claim, bid, pay, or submit.",
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
  });
}

// The paid route. Native MPP challenges are merged into the same unpaid 402,
// while the existing extension-rich x402 middleware remains authoritative for
// x402 credentials. A settled MPP credential bypasses only the duplicate gate.
const x402Paywall = paymentMiddleware(
    {
      "GET /extract": {
        ...bazaarResourceMetadataFor("/extract"),
        accepts: [
          {
            scheme: "exact",
            price: EXTRACT_PRICE,
            network: NETWORK,
            payTo: PAY_TO,
          },
        ],
        description: EXTRACT_DISCOVERY_DESCRIPTION,
        mimeType: "application/json",
        // --- Bazaar / discovery metadata: tells agents exactly how to call us ---
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /extract",
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
        ...bazaarResourceMetadataFor("/read"),
        accepts: [{ scheme: "exact", price: READ_PRICE, network: NETWORK, payTo: PAY_TO }],
        description:
          "URL -> full page content as clean Markdown, ready for LLM context. Strips nav/ads/scripts, preserves headings/links/lists. Handles redirects, timeouts, size caps, SSRF. The reliable web-reader agents need before feeding a page to a model.",
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /read",
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
        ...bazaarResourceMetadataFor("/scan"),
        accepts: [{ scheme: "exact", price: SCAN_PRICE, network: NETWORK, payTo: PAY_TO }],
        description:
          "Static supply-chain SECURITY scan of a public GitHub repo BEFORE an agent installs/runs it (a dependency, a Claude/MCP skill, an MCP server). Flags exfil sinks, obfuscated code execution, credential-file reads, env-harvest+network, install-time curl|bash. Returns risk = clean|suspicious|dangerous + findings. Static only, never runs the code. Low false positives.",
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /scan",
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
        ...bazaarResourceMetadataFor("/schemaforge"),
        accepts: [{ scheme: "exact", price: SCHEMAFORGE_PRICE, network: NETWORK, payTo: PAY_TO }],
        description:
          "Business website -> deterministic, paste-ready JSON-LD bundle plus a live structured-data gap analysis and ranked fixes. Covers local business and service, FAQ, offer catalog, reviews, geo, and opening hours. Rating and review fields remain explicit placeholders for the business's real values.",
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /schemaforge",
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
        ...bazaarResourceMetadataFor("/enrich"),
        accepts: [{ scheme: "exact", price: ENRICH_PRICE, network: NETWORK, payTo: PAY_TO }],
        description:
          "Public domain -> structured company intelligence for agents: identity, keywords, tech stack, social and contact surface, DNS and email infrastructure, and AI-search-readiness signals with a 0-100 score. Public data only; no account, API key, or subscription.",
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /enrich",
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
        ...bazaarResourceMetadataFor("/deep-audit"),
        accepts: [{ scheme: "exact", price: DEEP_AUDIT_PRICE, network: NETWORK, payTo: PAY_TO }],
        description:
          "Domain -> one complete AI-search-readiness audit (firmographics + tech + contact + DNS/email infra + a 0-100 AI-readiness score + a structured-data gap analysis with a paste-ready JSON-LD fix list + a combined letter grade). The bundled deep tier = enrich + schemaforge in one call. Public data only; no auth, no API keys, no subscription.",
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /deep-audit",
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
        ...bazaarResourceMetadataFor("/wallet-enrich"),
        accepts: [{ scheme: "exact", price: WALLET_ENRICH_PRICE, network: NETWORK, payTo: PAY_TO }],
        description:
          "Base address -> agent-ready on-chain profile: EOA or contract, ETH and major-token holdings, token or NFT metadata, EIP-1967 proxy detection, activity, and a derived profile label. Uses public Base mainnet RPC with no account or API key. Useful before an agent sends funds, swaps, or calls a contract.",
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /wallet-enrich",
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
        ...bazaarResourceMetadataFor("/defi/morpho-position"),
        accepts: [{ scheme: "exact", price: MORPHO_POSITION_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[7].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /defi/morpho-position",
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
                address: "0x4352Cc849b33a936Ad93bB109aFDec1c89653b4f",
                chain: { id: 8453, name: "Base mainnet" },
                positionCount: 1,
                positions: [{ marketId: "0x...", risk: { currentLtvPct: 72, liquidationLtvPct: 86, healthFactor: 1.194, liquidatableAtIndexedState: false }, scenarios: [{ collateralPriceShockPct: -10, healthFactor: 1.075, liquidatable: false }] }],
                source: { indexed: "Morpho API", directRpc: "required before execution" },
                boundary: "Read-only indexed observation; verify against direct RPC before execution.",
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
        ...bazaarResourceMetadataFor("/defi/morpho-protection"),
        accepts: [{ scheme: "exact", price: MORPHO_PROTECTION_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[8].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /defi/morpho-protection",
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
                address: "0x4352Cc849b33a936Ad93bB109aFDec1c89653b4f",
                inputs: { targetHealthFactor: 1.25, protectAgainstShockPct: -10, executionBufferBps: 25 },
                positionCount: 1,
                actionableCount: 1,
                unverifiedCount: 0,
                quotes: [{ status: "protection_available", plans: [{ id: "partial_repay", amount: "125.4", transactions: [{ to: "0x...", value: "0", data: "0x..." }] }] }],
                invariants: { signing: "none", broadcasting: "none", custody: "none" },
                boundary: "Unsigned planning output only; re-verify state and simulate before execution.",
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
        ...bazaarResourceMetadataFor("/defi/morpho-market-underwrite"),
        accepts: [{ scheme: "exact", price: MORPHO_MARKET_UNDERWRITE_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[9].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /defi/morpho-market-underwrite",
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
                chain: { id: 8453, name: "Base mainnet" },
                market: { listed: true, state: { utilizationPct: 72, liquidityAssetsUsd: 500000 } },
                borrowers: { totalCount: 24, concentration: { top1BorrowPct: 18, top5BorrowPct: 51 }, healthBands: { below1_05: 0 } },
                verification: { marketParamsHashMatches: true, restMatchesGraphql: true, directRpc: { verdict: "stored_state_exact_match" } },
                decisionChecks: [{ id: "market_params_integrity", status: "pass" }],
                boundary: "Read-only underwriting evidence; not an allocation instruction or execution authorization.",
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
        ...bazaarResourceMetadataFor("/defi/morpho-preliquidation-replay"),
        accepts: [{ scheme: "exact", price: MORPHO_PRELIQUIDATION_REPLAY_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[10].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /defi/morpho-preliquidation-replay",
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
                chain: { id: 8453, name: "Base mainnet" },
                transaction: { hash: "0x...", status: "success", gasCostEth: "0.00014" },
                eventCount: 1,
                events: [{ assets: { repaid: { symbol: "USDC", amount: "26.27" }, seized: { symbol: "cbBTC", amount: "0.000427" } }, grossEconomics: { incentiveInLoanAmount: "1.15", incentivePct: 4.38 } }],
                verification: { receiptStatus: "success", eventDecoded: true },
                boundary: "Historical deterministic replay; not a forward profit forecast or execution instruction.",
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
        ...bazaarResourceMetadataFor("/work/opportunity-preflight"),
        accepts: [{ scheme: "exact", price: OPPORTUNITY_PREFLIGHT_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[11].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareOpportunityPreflightContract("GET /work/opportunity-preflight"),
        },
      },
      "HEAD /work/opportunity-preflight": {
        ...bazaarResourceMetadataFor("/work/opportunity-preflight"),
        accepts: [{ scheme: "exact", price: OPPORTUNITY_PREFLIGHT_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[11].description,
        mimeType: "application/json",
        extensions: { ...COMMON_COMMERCE_EXTENSIONS },
      },
      "POST /work/opportunity-preflight": {
        ...bazaarResourceMetadataFor("/work/opportunity-preflight"),
        accepts: [{ scheme: "exact", price: OPPORTUNITY_PREFLIGHT_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[11].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareOpportunityPreflightContract("POST /work/opportunity-preflight"),
        },
      },
      "GET /distribution/agent-discoverability-audit": {
        ...bazaarResourceMetadataFor("/distribution/agent-discoverability-audit"),
        accepts: [{ scheme: "exact", price: AGENT_DISCOVERABILITY_AUDIT_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[12].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /distribution/agent-discoverability-audit",
            input: {
              origin: "https://agents.samedaydesk.com",
              intent: "extract a public web page into structured JSON metadata headings links and JSON-LD",
              route: "/extract",
              runtimeUrl: "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com",
              payTo: PAY_TO,
              expectedPriceUsd: 0.005,
            },
            inputSchema: {
              type: "object",
              properties: {
                origin: { type: "string", minLength: 9, maxLength: 253, description: "Public HTTPS service origin with no path, query, fragment, or credentials." },
                intent: { type: "string", minLength: 20, maxLength: 500, description: "Brand-blind capability description. Do not include the target hostname." },
                route: { type: "string", pattern: "^/[^?#]*$", description: "Optional exact expected path." },
                runtimeUrl: { type: "string", format: "uri", maxLength: 2048, description: "Optional exact same-origin HTTPS GET URL whose unsigned x402 or MPP offer supplies the runtime price reference. Requires route and an exactly matching pathname." },
                payTo: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "Optional EVM payTo used to identify service aliases." },
                expectedPriceUsd: { type: "number", minimum: 0, maximum: 1000000, multipleOf: 0.000001, description: "Optional exact route price expected by the caller. A coherent runtimeUrl offer takes precedence and caller drift is reported." },
              },
              required: ["origin", "intent"],
            },
            output: {
              example: {
                ok: true,
                product: "samedaydesk-agent-discoverability-audit",
                version: "1.10.0",
                generatedAt: "2026-08-09T00:00:00.000Z",
                input: { origin: "https://agents.samedaydesk.com", intent: "extract a public web page into structured JSON metadata headings links and JSON-LD", route: "/extract", runtimeUrl: "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com", expectedPriceUsd: 0.005, expectedPriceAtomic: "5000" },
                summary: { sourceCount: 10, availableSourceCount: 10, targetFoundSourceCount: 4, expectedRouteFoundSourceCount: 4, sourceFamilyCount: 9, targetFoundSourceFamilyCount: 4, priceReference: { basis: "live_unsigned_offer", amountAtomic: "5000", amountUsd: 0.005, protocols: ["mpp", "x402"] }, matchedPriceSourceCount: 3, driftedPriceSourceCount: 1, identityObservationSourceCount: 10, identityConflictSourceCount: 1, identityConflictSources: ["agent402-router"] },
                sources: { "coinbase-bazaar": { status: "ok", targetFound: true, bestTargetRank: 9, priceObservation: { status: "matched", expectedPriceAtomic: "5000", observedPricesAtomic: ["5000"] }, identityObservation: { schemaVersion: "agent-payment-policy.listing-identity-report.v1", decision: "canonical", status: "canonical", exactRouteRecordCount: 1, canonicalRecordCount: 1, canonicalOriginMatched: true, aliasCandidateCount: 0, aliasOrigins: [], identityBasis: "agent-payment-policy@0.8.0", ownershipProven: false, evidenceBoundary: "An observed record uses the caller-supplied canonical origin. This does not prove marketplace ownership or control." } } },
                runtimeOfferAudit: { requested: true, status: "ok", decision: "parseable_offer", protocols: ["mpp", "x402"], offerCount: 2 },
                findings: [{ code: "target_not_top_three", source: "coinbase-bazaar" }],
                nextActions: [{ action: "clarify_semantic_description", evidence: "target ranked below three competitors" }],
                method: "Brand-blind point-in-time catalog query with registry-native ordering.",
                safety: { credentialsUsed: false, paymentSentToCatalogs: false, targetOriginFetched: false },
                boundary: "Point-in-time discovery evidence; not buyer demand, conversion, reliability, or future-rank proof.",
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                product: { type: "string", const: "samedaydesk-agent-discoverability-audit" },
                version: { type: "string" },
                generatedAt: { type: "string" },
                input: { type: "object" },
                summary: { type: "object" },
                sources: { type: "object" },
                runtimeOfferAudit: { type: "object" },
                findings: { type: "array" },
                nextActions: { type: "array" },
                method: { type: "string" },
                safety: { type: "object" },
                boundary: { type: "string" },
              },
              required: ["ok", "product", "version", "generatedAt", "input", "summary", "sources", "runtimeOfferAudit", "findings", "nextActions", "method", "safety", "boundary"],
            },
          }),
        },
      },
      "GET /commerce/payment-offer-preflight": {
        ...bazaarResourceMetadataFor("/commerce/payment-offer-preflight"),
        accepts: [{ scheme: "exact", price: PAYMENT_OFFER_PREFLIGHT_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[13].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /commerce/payment-offer-preflight",
            input: {
              url: "https://agents.samedaydesk.com/defi/morpho-position?address=0x8ee9c15c3e5332cbc6ef39a2bb036c63c6549b6e",
            },
            inputSchema: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  format: "uri",
                  maxLength: 2048,
                  description: "Exact public HTTPS GET URL to inspect. Credential-like query keys, fragments, unresolved parameters, local hosts, redirects, and non-public IPs are rejected.",
                },
              },
              required: ["url"],
              additionalProperties: false,
            },
            output: {
              example: {
                ok: true,
                product: "samedaydesk-payment-offer-preflight",
                version: "1.2.0",
                checkedAt: "2026-08-10T20:00:00.000Z",
                target: { method: "GET", url: "https://agents.samedaydesk.com/defi/morpho-position?address=0x8ee9c15c3e5332cbc6ef39a2bb036c63c6549b6e", httpStatus: 402 },
                decision: "parseable_offer",
                protocols: ["mpp", "x402"],
                offerCount: 2,
                offers: [{ protocol: "x402", scheme: "exact", intent: "exact", network: "eip155:8453", amountAtomic: "20000", valid: true }],
                parity: { compared: true, consistent: true, driftFields: [] },
                catalogCoherence: [],
                responseContract: { decision: "admissible", requiredFields: ["ok", "title", "url"], requiredPaths: ["ok", "title", "url"], exampleStatus: "structurally_consistent", runtimeResponseVerified: false },
                responseContractAcquisition: { attempted: true, sameOrigin: true, path: "/openapi.json", maxBytes: 1000000, documentRead: true, targetResponseBodyRead: false, credentialsUsed: false, redirectsFollowed: false },
                findings: [],
                boundary: { credentialsUsed: false, paymentSigned: false, paymentSent: false, targetResponseBodyRead: false, openApiDocumentRead: true, redirectsFollowed: false },
              },
            },
            outputSchema: paymentOfferPreflightOutputSchema(),
          }),
        },
      },
      "POST /commerce/payment-offer-preflight": {
        ...bazaarResourceMetadataFor("/commerce/payment-offer-preflight"),
        accepts: [{ scheme: "exact", price: PAYMENT_OFFER_PREFLIGHT_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[13].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "POST /commerce/payment-offer-preflight",
            method: "POST",
            bodyType: "json",
            input: {
              url: "https://agents.samedaydesk.com/defi/morpho-position?address=0x8ee9c15c3e5332cbc6ef39a2bb036c63c6549b6e",
            },
            inputSchema: paymentOfferPreflightInputSchema(),
            output: {
              example: {
                ok: true,
                product: "samedaydesk-payment-offer-preflight",
                version: "1.2.0",
                checkedAt: "2026-08-10T20:00:00.000Z",
                target: { method: "GET", url: "https://agents.samedaydesk.com/defi/morpho-position?address=0x8ee9c15c3e5332cbc6ef39a2bb036c63c6549b6e", httpStatus: 402 },
                decision: "parseable_offer",
                protocols: ["mpp", "x402"],
                offerCount: 2,
                offers: [{ protocol: "x402", scheme: "exact", intent: "exact", network: "eip155:8453", amountAtomic: "20000", valid: true }],
                parity: { compared: true, consistent: true, driftFields: [] },
                catalogCoherence: [],
                responseContract: { decision: "admissible", requiredFields: ["ok", "title", "url"], requiredPaths: ["ok", "title", "url"], exampleStatus: "structurally_consistent", runtimeResponseVerified: false },
                responseContractAcquisition: { attempted: true, sameOrigin: true, path: "/openapi.json", maxBytes: 1000000, documentRead: true, targetResponseBodyRead: false, credentialsUsed: false, redirectsFollowed: false },
                findings: [],
                boundary: { credentialsUsed: false, paymentSigned: false, paymentSent: false, targetResponseBodyRead: false, openApiDocumentRead: true, redirectsFollowed: false },
              },
            },
            outputSchema: paymentOfferPreflightOutputSchema(),
          }),
        },
      },
      "GET /commerce/seller-integrity-audit": {
        ...bazaarResourceMetadataFor("/commerce/seller-integrity-audit"),
        accepts: [{ scheme: "exact", price: SELLER_INTEGRITY_AUDIT_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[19].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /commerce/seller-integrity-audit",
            input: {
              origin: "https://agents.samedaydesk.com",
              route: "/commerce/payment-offer-preflight",
              method: "GET",
              requiredPaths: "decision,offers",
              requireBazaar: true,
            },
            inputSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                origin: { type: "string", format: "uri", description: "Credential-free public HTTPS seller origin on port 443." },
                route: { type: "string", pattern: "^/(?!/)[^?#{}]+$", description: "Exact paid GET or POST path declared by the seller." },
                method: { type: "string", enum: ["GET", "POST"], default: "GET", description: "POST is analyzed from OpenAPI without sending a target request." },
                requiredPaths: { type: "string", pattern: "^[A-Za-z0-9_.-]+(?:,[A-Za-z0-9_.-]+){0,15}$", description: "Optional comma-separated buyer-required dotted success paths." },
                requireBazaar: { type: "boolean", default: false, description: "Whether Bazaar catalog eligibility is a required gate." },
              },
              required: ["origin", "route"],
            },
            output: { example: SELLER_INTEGRITY_AUDIT_EXAMPLE },
            outputSchema: sellerIntegrityAuditOutputSchema(),
          }),
        },
      },
      "GET /commerce/contract-qualified-search": {
        ...bazaarResourceMetadataFor("/commerce/contract-qualified-search"),
        accepts: [{ scheme: "exact", price: CONTRACT_QUALIFIED_SEARCH_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[20].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /commerce/contract-qualified-search",
            input: {
              query: "service domain ownership code provenance",
              requiredPaths: "data.sourceRepository",
              maxPriceDisplayUnits: 0.1,
              limit: 5,
            },
            inputSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                query: { type: "string", minLength: 10, maxLength: 300, description: "Capability intent sent to Agent402 search and used locally to rank MPP catalog metadata. Do not include secrets." },
                requiredPaths: { type: "string", pattern: "^[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+){0,7}(?:,[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+){0,7}){0,15}$", description: "Buyer-required dotted JSON paths every returned seller schema must guarantee recursively." },
                maxPriceDisplayUnits: { type: "number", exclusiveMinimum: 0, maximum: 10, default: 0.1, description: "Maximum advertised per-call price in each source's display currency." },
                limit: { type: "integer", minimum: 1, maximum: 8, default: 5, description: "Maximum total candidates audited across Agent402 and MPP." },
              },
              required: ["query", "requiredPaths"],
            },
            output: { example: CONTRACT_QUALIFIED_SEARCH_EXAMPLE },
            outputSchema: contractQualifiedSearchOutputSchema(),
          }),
        },
      },
      "GET /distribution/agent-surface-budget-audit": {
        ...bazaarResourceMetadataFor("/distribution/agent-surface-budget-audit"),
        accepts: [{ scheme: "exact", price: AGENT_SURFACE_BUDGET_AUDIT_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[21].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /distribution/agent-surface-budget-audit",
            input: { origin: "https://agents.samedaydesk.com", surfaceMode: "both", mcpPath: "/mcp", openApiPath: "/openapi.json", mcpBudgetBytes: 65536, openApiBudgetBytes: 524288 },
            inputSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                origin: { type: "string", format: "uri", description: "Credential-free public HTTPS service origin on port 443." },
                surfaceMode: { type: "string", enum: ["mcp", "openapi", "both"], default: "both", description: "Audit MCP only, OpenAPI only, or both. Unselected surfaces are not fetched or judged." },
                mcpPath: { type: "string", pattern: "^/(?!/)[^?#{]+$", default: "/mcp", description: "Exact root-relative MCP streamable-HTTP path." },
                openApiPath: { type: "string", pattern: "^/(?!/)[^?#{]+$", default: "/openapi.json", description: "Exact root-relative OpenAPI JSON path." },
                mcpBudgetBytes: { type: "integer", minimum: 8192, maximum: 1000000, default: 65536 },
                openApiBudgetBytes: { type: "integer", minimum: 32768, maximum: 1000000, default: 524288 },
              },
              required: ["origin"],
            },
            output: { example: AGENT_SURFACE_BUDGET_AUDIT_EXAMPLE },
            outputSchema: agentSurfaceBudgetAuditOutputSchema(),
          }),
        },
      },
      "GET /commerce/settlement-proof": {
        ...bazaarResourceMetadataFor("/commerce/settlement-proof"),
        accepts: [{ scheme: "exact", price: SETTLEMENT_PROOF_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[14].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /commerce/settlement-proof",
            input: {
              transactionHash: "0xcfcbb367fecf27052db9ca855e5146e99cacbce1cab94f20f9f95a74170a8987",
              recipient: PAY_TO,
              amountAtomic: "5000",
              payer: "0x990CC4f469dfe854c16C601c7B8eE6534B267f17",
            },
            inputSchema: {
              type: "object",
              properties: {
                transactionHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$", description: "Base mainnet transaction hash containing the claimed canonical USDC transfer." },
                recipient: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "Expected canonical Base USDC recipient." },
                amountAtomic: { type: "string", pattern: "^[1-9][0-9]{0,20}$", maxLength: 21, description: "Expected positive USDC amount in six-decimal atomic units." },
                payer: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "Optional expected canonical Base USDC payer." },
              },
              required: ["transactionHash", "recipient", "amountAtomic"],
              additionalProperties: false,
            },
            output: {
              example: {
                ok: true,
                product: "samedaydesk-base-usdc-settlement-proof",
                version: "1.0.0",
                checkedAt: "2026-08-11T08:30:00.000Z",
                decision: "verified",
                request: { transactionHash: "0xcfcbb3...a8987", recipient: PAY_TO, amountAtomic: "5000", payer: "0x990C...7f17" },
                chain: { id: 8453, name: "Base mainnet", network: "eip155:8453" },
                asset: { address: USDC_ASSET, symbol: "USDC", decimals: 6 },
                transaction: { hash: "0xcfcbb3...a8987", status: "success", blockNumber: "49823378", blockTimestamp: "2026-08-11T08:15:03.000Z" },
                settlement: { verified: true, exactTransferCount: 1, recipientTransferCount: 1, observed: { payer: "0x990C...7f17", recipient: PAY_TO, amountAtomic: "5000", amountUsdc: "0.005" } },
                findings: [],
                boundary: { source: "public Base mainnet receipt and logs", privateLedgerRead: false, auditedTransactionModified: false, walletAccessed: false, executionAuthorized: false },
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                product: { type: "string", const: "samedaydesk-base-usdc-settlement-proof" },
                version: { type: "string" },
                checkedAt: { type: "string" },
                decision: { type: "string", enum: ["verified", "not_verified", "receipt_unavailable"] },
                request: { type: "object" },
                chain: { type: "object" },
                asset: { type: "object" },
                transaction: { type: "object" },
                settlement: { type: "object" },
                findings: { type: "array" },
                boundary: { type: "object" },
              },
              required: ["ok", "product", "version", "checkedAt", "decision", "request", "chain", "asset", "transaction", "settlement", "findings", "boundary"],
            },
          }),
        },
      },
      "GET /chain/transaction-receipt": {
        ...bazaarResourceMetadataFor("/chain/transaction-receipt"),
        accepts: [{ scheme: "exact", price: TRANSACTION_RECEIPT_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[15].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /chain/transaction-receipt",
            input: {
              transactionHash: "0xcfcbb367fecf27052db9ca855e5146e99cacbce1cab94f20f9f95a74170a8987",
              network: "base",
            },
            inputSchema: {
              type: "object",
              properties: {
                transactionHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$", description: "Mined Base or Ethereum transaction hash." },
                network: { type: "string", enum: ["base", "ethereum"], default: "base", description: "Receipt network. Defaults to Base mainnet." },
              },
              required: ["transactionHash"],
              additionalProperties: false,
            },
            output: {
              example: {
                ok: true,
                product: "samedaydesk-transaction-receipt",
                version: "1.0.0",
                checkedAt: "2026-08-11T13:50:00.000Z",
                decision: "found",
                request: { transactionHash: "0xcfcbb3...a8987", network: "base" },
                chain: { id: 8453, name: "Base mainnet", network: "eip155:8453" },
                transaction: { hash: "0xcfcbb3...a8987", status: "success", blockNumber: "49823378", blockTimestamp: "2026-08-11T08:15:03.000Z", gasUsedAtomic: "128761", effectiveGasPriceWei: "10000000", transactionFeeWei: "1287610000000" },
                receipt: { found: true, logCount: 2, decodedTransferCount: 1, canonicalUsdcTransferCount: 1, transfersTruncated: false },
                transfers: [{ token: USDC_ASSET, from: "0x990C...7f17", to: PAY_TO, amountAtomic: "5000", canonicalUsdc: true, amountUsdc: "0.005", logIndex: "1" }],
                canonicalUsdcTransfers: [{ token: USDC_ASSET, from: "0x990C...7f17", to: PAY_TO, amountAtomic: "5000", canonicalUsdc: true, amountUsdc: "0.005", logIndex: "1" }],
                findings: [],
                boundary: { source: "bounded public Base mainnet receipt and block RPC", rawLogsReturned: false, privateLedgerRead: false, walletAccessed: false, transactionSigned: false, transactionBroadcast: false, transactionModified: false },
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                product: { type: "string", const: "samedaydesk-transaction-receipt" },
                version: { type: "string" },
                checkedAt: { type: "string" },
                decision: { type: "string", enum: ["found", "not_found", "rpc_unavailable"] },
                request: { type: "object" },
                chain: { type: "object" },
                transaction: { type: "object" },
                receipt: { type: "object" },
                transfers: { type: "array" },
                canonicalUsdcTransfers: { type: "array" },
                findings: { type: "array" },
                boundary: { type: "object" },
              },
              required: ["ok", "product", "version", "checkedAt", "decision", "request", "chain", "transaction", "receipt", "transfers", "canonicalUsdcTransfers", "findings", "boundary"],
            },
          }),
        },
      },
      "GET /chain/solana-transaction-receipt": {
        ...bazaarResourceMetadataFor("/chain/solana-transaction-receipt"),
        accepts: [{ scheme: "exact", price: SOLANA_TRANSACTION_RECEIPT_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[16].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "GET /chain/solana-transaction-receipt",
            input: {
              signature: "3CjY38avdggKZbKfu2BmFYN4MUTiiNX27c8dHzPW79PrAx3huB9Pa6AfwW6sT4biax3y22z8toyLzmjtCc2QGNZn",
              mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            },
            inputSchema: {
              type: "object",
              properties: {
                signature: { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{80,90}$", description: "Finalized Solana mainnet transaction signature." },
                mint: { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$", default: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", description: "SPL-token mint; defaults to canonical Solana USDC." },
                recipient: { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$", description: "Optional expected token recipient owner." },
                amountAtomic: { type: "string", pattern: "^[1-9][0-9]{0,19}$", description: "Optional expected atomic amount; requires recipient." },
                payer: { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$", description: "Optional expected payer owner; requires recipient and amountAtomic." },
              },
              required: ["signature"],
              additionalProperties: false,
            },
            output: {
              example: {
                ok: true,
                product: "samedaydesk-solana-transaction-receipt",
                version: "1.0.0",
                checkedAt: "2026-08-11T21:12:00.000Z",
                decision: "found",
                request: { signature: "3CjY...GNZn", mint: "EPjF...Dt1v", recipient: null, amountAtomic: null, payer: null },
                chain: { name: "Solana mainnet", network: "solana:mainnet", canonicalUsdc: "EPjF...Dt1v" },
                transaction: { signature: "3CjY...GNZn", status: "success", slot: "438431606", blockTime: "2026-08-11T14:40:00.000Z", feeLamports: "5000" },
                receipt: { found: true, finalized: true, tokenOwnerDeltaCount: 2, canonicalUsdcDeltaCount: 2 },
                tokenOwnerDeltas: [],
                canonicalUsdcOwnerDeltas: [],
                verification: { requested: false, matched: false },
                findings: [],
                boundary: { source: "bounded public Solana mainnet finalized transaction RPC", rawInstructionsReturned: false, rawLogsReturned: false, privateLedgerRead: false, walletAccessed: false, transactionSigned: false, transactionBroadcast: false, transactionModified: false },
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                product: { type: "string", const: "samedaydesk-solana-transaction-receipt" },
                version: { type: "string" },
                checkedAt: { type: "string" },
                decision: { type: "string", enum: ["found", "verified", "not_verified", "not_found", "rpc_unavailable"] },
                request: { type: "object" },
                chain: { type: "object" },
                transaction: { type: "object" },
                receipt: { type: "object" },
                tokenOwnerDeltas: { type: "array" },
                canonicalUsdcOwnerDeltas: { type: "array" },
                verification: { type: "object" },
                findings: { type: "array" },
                boundary: { type: "object" },
              },
              required: ["ok", "product", "version", "checkedAt", "decision", "request", "chain", "transaction", "receipt", "tokenOwnerDeltas", "canonicalUsdcOwnerDeltas", "verification", "findings", "boundary"],
            },
          }),
        },
      },
      "POST /security/wallet-policy-conformance": {
        ...bazaarResourceMetadataFor("/security/wallet-policy-conformance"),
        accepts: [{ scheme: "exact", price: WALLET_POLICY_CONFORMANCE_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[17].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "POST /security/wallet-policy-conformance",
            method: "POST",
            bodyType: "json",
            input: WALLET_POLICY_DISCOVERY_INPUT,
            inputSchema: walletPolicyConformanceInputSchema(),
            output: { example: walletPolicyConformance(WALLET_POLICY_DISCOVERY_INPUT) },
            outputSchema: walletPolicyConformanceOutputSchema(),
          }),
        },
      },
      "POST /security/stateful-wallet-policy-conformance": {
        ...bazaarResourceMetadataFor("/security/stateful-wallet-policy-conformance"),
        accepts: [{ scheme: "exact", price: STATEFUL_WALLET_POLICY_CONFORMANCE_PRICE, network: NETWORK, payTo: PAY_TO }],
        description: RESOURCES[18].description,
        mimeType: "application/json",
        extensions: {
          ...COMMON_COMMERCE_EXTENSIONS,
          ...declareDiscoveryContract({
            routeKey: "POST /security/stateful-wallet-policy-conformance",
            method: "POST",
            bodyType: "json",
            input: STATEFUL_WALLET_POLICY_DISCOVERY_INPUT,
            inputSchema: statefulWalletPolicyConformanceInputSchema(),
            output: { example: statefulWalletPolicyConformance(STATEFUL_WALLET_POLICY_DISCOVERY_INPUT) },
            outputSchema: statefulWalletPolicyConformanceOutputSchema(),
          }),
        },
      },
    },
    resourceServer
  );

const evidenceResources = [];
for (const { method, path } of SERVICE_DEPLOYMENT_ROUTES) {
  const resource = RESOURCES.find((entry) => (entry.method || "GET") === method && new URL(entry.url).pathname === path)
    || RESOURCES.find((entry) => new URL(entry.url).pathname === path);
  if (!resource) throw new Error(`Missing purchase evidence resource for ${method} ${path}`);
  evidenceResources.push({ ...resource, method, url: `${PUBLIC_URL}${path}` });
}
purchaseEvidenceManifest = buildPurchaseEvidenceManifest({
  origin: PUBLIC_URL,
  serviceVersion: SERVICE_VERSION,
  resources: evidenceResources,
  responseContractFor: getDiscoveryOutputContract,
  readOnlyPaidPosts: READ_ONLY_PAID_POST_OPERATIONS,
  serviceDeployment: {
    statement: serviceDeploymentPublication.paths.statement,
    publicKey: serviceDeploymentPublication.paths.publicKey,
    statementId: serviceDeploymentPublication.statementId,
    expiresAt: serviceDeploymentPublication.expiresAt,
    paidActionEffects: PAID_ACTION_EFFECT_PROFILE_PATH,
  },
  replay: idempotencyReplay.publicProfile,
});

const servePaymentOfferPreflight = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const input = req.method === "POST" ? req.body : { url: req.query.url };
    return res.json(await paymentOfferPreflight(input));
  } catch (error) {
    const status = error instanceof PaymentOfferPreflightError
      ? Math.max(400, Math.min(599, Number(error.statusCode) || 502))
      : 502;
    return res.status(status).json({
      ok: false,
      product: "samedaydesk-payment-offer-preflight",
      code: error?.code || "preflight_failed",
      error: String(error?.message || error),
      boundary: {
        credentialsUsed: false,
        paymentSigned: false,
        paymentSent: false,
        responseBodyRead: false,
        redirectsFollowed: false,
      },
    });
  }
};

const serveSellerIntegrityAudit = async (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json(await sellerIntegrityAudit(res.locals.sellerIntegrityAuditInput));
};

const serveContractQualifiedSearch = async (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json(await contractQualifiedSearch(res.locals.contractQualifiedSearchInput));
};

const serveAgentSurfaceBudgetAudit = async (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json(await agentSurfaceBudgetAudit(res.locals.agentSurfaceBudgetAuditInput));
};

const serveSettlementProof = async (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json(await settlementProof(req.query));
};

const serveTransactionReceipt = async (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json(await transactionReceipt(req.query));
};

const serveSolanaTransactionReceipt = async (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json(await solanaTransactionReceipt(req.query));
};

if (circleGateway.enabled) {
  app.get(CIRCLE_GATEWAY_PATH, circleGateway.middleware, (req, res) => {
    res.set("X-SameDayDesk-Payment-Rail", "circle-gateway-nanopayments");
    return servePaymentOfferPreflight(req, res);
  });
}

// Reject malformed or secret-bearing matrices before either payment rail runs.
// The normalized value is retained only in request-local memory for the paid
// handler and is never written to telemetry or a credential store.
app.post("/security/wallet-policy-conformance", (req, res, next) => {
  try {
    res.locals.walletPolicyConformanceInput = normalizeWalletPolicyConformanceInput(req.body);
    return next();
  } catch (error) {
    const message = error instanceof WalletPolicyConformanceError
      ? error.message
      : "invalid wallet-policy conformance request";
    res.set("Cache-Control", "no-store");
    return res.status(400).json({
      ok: false,
      product: "samedaydesk-wallet-policy-conformance",
      error: message,
      charged: false,
      boundary: { credentialsAccepted: false, walletAccessed: false, transactionBroadcast: false },
    });
  }
});

app.post("/security/stateful-wallet-policy-conformance", (req, res, next) => {
  try {
    res.locals.statefulWalletPolicyConformanceInput = normalizeStatefulWalletPolicyConformanceInput(req.body);
    return next();
  } catch (error) {
    const message = error instanceof StatefulWalletPolicyConformanceError
      ? error.message
      : "invalid stateful wallet-policy conformance request";
    res.set("Cache-Control", "no-store");
    return res.status(400).json({
      ok: false,
      product: "samedaydesk-stateful-wallet-policy-conformance",
      error: message,
      charged: false,
      boundary: { credentialsAccepted: false, walletAccessed: false, transactionBroadcast: false },
    });
  }
});

app.use(mppDualStack.middleware);
app.use((req, res, next) => {
  if (res.locals?.samedaydeskPayment?.protocol === "mpp") return next();
  return x402Paywall(req, res, next);
});

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
const serveOpportunityPreflight = async (req, res) => {
  try {
    const input = req.method === "POST" ? req.body : req.query;
    const platform = typeof input?.platform === "string" ? input.platform.trim().toLowerCase() : null;
    const platformCard = platform ? getPlatformHealthCard(platform) : null;
    res.set("Cache-Control", "no-store");
    return res.json(opportunityPreflight(input, { platformCard }));
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: String(error?.message || error),
      boundary: "No source-platform account, claim, bid, payment, or submission was touched.",
    });
  }
};
app.get("/work/opportunity-preflight", serveOpportunityPreflight);
app.post("/work/opportunity-preflight", serveOpportunityPreflight);

// Paid: brand-blind cross-registry discovery audit for machine-service sellers.
app.get("/distribution/agent-discoverability-audit", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await agentDiscoverabilityAudit(req.query));
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: String(error?.message || error),
      boundary: "No catalog credential or catalog payment was used. Target-origin fetching occurs only when surfaceAudit was explicitly enabled.",
    });
  }
});

// Paid: credential-free, headers-only x402 and MPP payment-offer inspection.
// URL syntax and obvious local targets were already rejected before payment.
app.get("/commerce/payment-offer-preflight", servePaymentOfferPreflight);
app.post("/commerce/payment-offer-preflight", servePaymentOfferPreflight);
app.get("/commerce/seller-integrity-audit", serveSellerIntegrityAudit);
app.get("/commerce/contract-qualified-search", serveContractQualifiedSearch);
app.get("/distribution/agent-surface-budget-audit", serveAgentSurfaceBudgetAudit);
app.get("/commerce/settlement-proof", serveSettlementProof);
app.get("/chain/transaction-receipt", serveTransactionReceipt);
app.get("/chain/solana-transaction-receipt", serveSolanaTransactionReceipt);
app.post("/security/wallet-policy-conformance", (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json(walletPolicyConformance(res.locals.walletPolicyConformanceInput));
});
app.post("/security/stateful-wallet-policy-conformance", (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json(statefulWalletPolicyConformance(res.locals.statefulWalletPolicyConformanceInput));
});

// One root, negotiated by audience. Browser navigation gets a fast human map;
// API clients, curl, and agents retain the stable JSON descriptor.
app.get("/", (req, res) => {
  const gateway = {
    service: "SameDayDesk agent evidence + machine payment gateway",
    what: "Free incident-backed platform health plus pay-per-call data tools that accept Base USDC and Circle Gateway Nanopayments.",
    settlementRadar: {
      pages: "/platforms",
      json: "/v0/cards.json",
      methodology: "/platforms/methodology",
      alertPilot: "/alerts",
      boundary: "Categories are dated observations, not calibrated reliability scores or payout guarantees.",
    },
    machineCommerce: {
      paymentProtocols: ["x402", "mpp", "circle-gateway-x402"],
      circleGateway: circleGateway.enabled ? {
        path: CIRCLE_GATEWAY_PATH,
        facilitator: circleGateway.facilitatorUrl,
        settlement: "gasless batched USDC Nanopayments",
        product: "payment_offer_preflight",
      } : { enabled: false },
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
      glamaVerification: "/.well-known/glama.json",
      x402JobsVerification: "/.well-known/x402-verification.json",
      solanaAgentRegistration: "/.well-known/agent-registration.json",
      serviceDeploymentStatement: serviceDeploymentPublication.paths.statement,
      serviceDeploymentPublicKey: serviceDeploymentPublication.paths.publicKey,
      purchaseEvidenceManifest: PURCHASE_EVIDENCE_MANIFEST_PATH,
      aggregateDemand: "/v0/commerce-demand.json",
      declaredAgentSourceHeader: {
        header: "X-SameDayDesk-Agent-Source",
        value: "agent-skills-v1",
        source: "agent-skills",
        boundary: "Optional declared attribution only. It is not authenticated and does not affect price, payment, or access.",
      },
      declaredAgentSources: [
        { value: "agent-skills-v1", source: "agent-skills" },
        { value: "agentictrade-v1", source: "agentictrade" },
      ],
      buyerPolicyReference: BUYER_POLICY_REFERENCE,
      walletPolicyConformance: {
        route: "POST /security/wallet-policy-conformance",
        priceUsdc: Number(priceToAtomic(WALLET_POLICY_CONFORMANCE_PRICE)) / 1e6,
        contract: "/schemas/wallet-policy-conformance-v1.json",
      },
      statefulWalletPolicyConformance: {
        route: "POST /security/stateful-wallet-policy-conformance",
        priceUsdc: Number(priceToAtomic(STATEFUL_WALLET_POLICY_CONFORMANCE_PRICE)) / 1e6,
        contract: "/schemas/stateful-wallet-policy-conformance-v1.json",
      },
      flow: "discover -> validate schema and price -> pay -> call -> receive deterministic result and receipt -> safely replay the same logical request",
    },
    paidRoutes: {
      "GET /extract?url=": `${EXTRACT_PRICE} - ${EXTRACT_DISCOVERY_DESCRIPTION}`,
      "GET /read?url=": `${READ_PRICE} - URL -> LLM-ready Markdown.`,
      "GET /scan?repo=": `${SCAN_PRICE} - static supply-chain security scan of a public GitHub repo before install.`,
      "GET /schemaforge?site=&vertical=&city=": `${SCHEMAFORGE_PRICE} - generate a paste-ready JSON-LD structured-data bundle + gap diff so a business page is eligible to be cited by AI assistants.`,
      "GET /enrich?domain=": `${ENRICH_PRICE} - domain -> agent-ready company intelligence: identity, tech stack, social, contact, DNS/email-infra, AI-readiness. No auth, pay-per-call.`,
      "GET /wallet-enrich?address=": `${WALLET_ENRICH_PRICE} - Base/EVM 0x address -> agent-ready on-chain profile: EOA/contract, native + token holdings, token/NFT metadata, proxy + activity, profile label. Pure Base RPC, no keys.`,
      "GET /deep-audit?domain=": `${DEEP_AUDIT_PRICE} - bundled AI-search-readiness audit with firmographics, infrastructure, structured-data gaps, and a paste-ready fix list.`,
      "GET /defi/morpho-position?address=&shocks=": `${MORPHO_POSITION_PRICE} - Base borrower address -> deterministic Morpho LTV, health, liquidation headroom, and collateral-price stress scenarios. Read-only.`,
      "GET /defi/morpho-protection?address=&targetHealthFactor=&protectAgainstShockPct=&executionBufferBps=": `${MORPHO_PROTECTION_PRICE} - deterministic Morpho repair amounts plus unsigned approval/action templates.`,
      "GET /defi/morpho-market-underwrite?marketId=": `${MORPHO_MARKET_UNDERWRITE_PRICE} - deterministic Morpho market integrity, liquidity, concentration, health-band, history, bad-debt, and PreLiquidation evidence.`,
      "GET /defi/morpho-preliquidation-replay?transactionHash=": `${MORPHO_PRELIQUIDATION_REPLAY_PRICE} - reconstruct a historical PreLiquidation event, protocol-oracle gross incentive, and gas from direct Base reads.`,
      "GET /work/opportunity-preflight?rewardUsd=&hours=&hourlyCostUsd=": `${OPPORTUNITY_PREFLIGHT_PRICE} - deterministic attempt, verify-first, or abandon economics with optional dated platform evidence.`,
      "GET /distribution/agent-discoverability-audit?origin=&intent=&route=&runtimeUrl=&payTo=&surfaceAudit=": `${AGENT_DISCOVERABILITY_AUDIT_PRICE} - brand-blind agent discovery rank, dependency-labeled coverage, canonical-vs-alias identity, duplicate records, expected-route presence, runtime-derived catalog-price coherence, optional seller-owned surface coverage, and competing results across ten machine-service views.`,
      "GET /commerce/payment-offer-preflight?url=": `${PAYMENT_OFFER_PREFLIGHT_PRICE} - compare and normalize x402 and MPP payment challenges and terms, binding checks, expiry, and economic parity before buyer authorization.`,
      "GET /commerce/seller-integrity-audit?origin=&route=&method=&requiredPaths=&requireBazaar=": `${SELLER_INTEGRITY_AUDIT_PRICE} - audit one paid GET or POST seller route for buyer-required response paths. GET verifies live unpaid terms; POST is static-safe and sends no target request.`,
      "GET /commerce/contract-qualified-search?query=&requiredPaths=&maxPriceDisplayUnits=&limit=": `${CONTRACT_QUALIFIED_SEARCH_PRICE} - search Agent402 and MPP for services whose exact seller contract guarantees buyer-required output paths before authorization.`,
      "GET /distribution/agent-surface-budget-audit?origin=&surfaceMode=&mcpPath=&openApiPath=&mcpBudgetBytes=&openApiBudgetBytes=": `${AGENT_SURFACE_BUDGET_AUDIT_PRICE} - measure MCP, OpenAPI, or both agent-context surfaces, rank the heaviest definitions, and return fixes without calling a target tool.`,
      "GET /commerce/settlement-proof?transactionHash=&recipient=&amountAtomic=&payer=": `${SETTLEMENT_PROOF_PRICE} - verify one claimed canonical Base USDC transfer against the successful on-chain receipt, with exact recipient, amount, and optional payer binding.`,
      "GET /chain/transaction-receipt?transactionHash=&network=": `${TRANSACTION_RECEIPT_PRICE} - normalized Base or Ethereum receipt status, block time, gas fee, decoded ERC-20 transfers, and canonical USDC transfer evidence.`,
      "GET /chain/solana-transaction-receipt?signature=&mint=&recipient=&amountAtomic=&payer=": `${SOLANA_TRANSACTION_RECEIPT_PRICE} - normalized finalized Solana receipt, SPL-token owner deltas, canonical USDC deltas, and optional exact settlement verification.`,
      "POST /security/wallet-policy-conformance": `${WALLET_POLICY_CONFORMANCE_PRICE} - evaluate safe standardized delegated-signer allow/deny observations, distinguish provider policy from validation failure, and test exact execution shape without accepting credentials.`,
      "POST /security/stateful-wallet-policy-conformance": `${STATEFUL_WALLET_POLICY_CONFORMANCE_PRICE} - evaluate safe standardized cumulative-cap, ABI extraction, concurrency, counter-reference, and application-serialization observations without accepting credentials or raw provider payloads.`,
      ...(circleGateway.enabled ? {
        [`GET ${CIRCLE_GATEWAY_PATH}?url=`]: `${PAYMENT_OFFER_PREFLIGHT_PRICE} - the same preflight through Circle Gateway gasless batched USDC Nanopayments.`,
      } : {}),
    },
    network: NETWORK,
    payTo: PAY_TO,
    docs: "/platforms for free health cards; /healthz for config; /openapi.json for x402 discovery including Circle Gateway; /mpp-openapi.json for native MPP discovery.",
  };
  res.vary("Accept");
  res.set("X-Content-Type-Options", "nosniff");
  if (wantsGatewayHtml(req.get("accept"))) {
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    return res.type("html").send(renderGatewayLanding(gateway));
  }
  return res.json(gateway);
});

app.listen(PORT, () => {
  commerceSettlementReconciler.schedule(process.env.COMMERCE_RECONCILIATION_INTERVAL_MS || 60_000);
  console.log(`x402-merchant listening on :${PORT}`);
  console.log(`  payTo:       ${PAY_TO}`);
  console.log(`  network:     ${NETWORK}`);
  console.log(`  price:       ${PRICE}`);
  console.log(`  facilitator: ${FACILITATOR} (${facilitatorClient.url})`);
  console.log(`  protocols:   x402 + MPP (${mppDualStack.enabled ? "enabled" : "disabled"})`);
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
      serverInfo: { name: "x402-data-gateway", version: SERVICE_VERSION },
      tools: [
        { name: "extract", description: RESOURCES[0].description, price: EXTRACT_PRICE, inputSchema: { url: z.string().describe("Public HTTP(S) URL. Choose extract for metadata, JSON-LD, headings, links, and a text excerpt; use read for cleaned full-body Markdown. Content is fetched without JavaScript rendering.") }, run: (a) => extract(a.url), tags: ["web", "extract", "structured-data"] },
        { name: "read", description: RESOURCES[1].description, price: READ_PRICE, inputSchema: { url: z.string().describe("Public HTTP(S) URL whose readable body is needed as Markdown. Content is fetched without JavaScript rendering and may be truncated at 40,000 characters.") }, run: (a) => readMarkdown(a.url), tags: ["web", "markdown", "llm-context"] },
        { name: "scan", description: RESOURCES[2].description, price: SCAN_PRICE, inputSchema: { repo: z.string().describe("Public GitHub repo: owner/name or URL") }, run: (a) => scanRepo(a.repo), tags: ["security", "supply-chain", "github"] },
        { name: "schemaforge", description: RESOURCES[3].description, price: SCHEMAFORGE_PRICE, inputSchema: { site: z.string().describe("Public business homepage or representative landing-page URL. Live HTML must be directly fetchable; JavaScript is not executed."), vertical: z.string().optional().describe("Optional structured-data template profile. med-spas is currently the specialized profile; unsupported values fall back to it."), city: z.string().optional().describe("Optional city the business serves; used to contextualize the generated structured-data template.") }, run: (a) => schemaforge({ site: a.site, vertical: a.vertical, city: a.city }), tags: ["seo", "json-ld", "geo"] },
        { name: "enrich", description: RESOURCES[4].description, price: ENRICH_PRICE, inputSchema: { domain: z.string().describe("Public company domain or URL, for example stripe.com. Use enrich for company evidence; use wallet_enrich for an EVM address.") }, run: (a) => enrich(a.domain), tags: ["enrichment", "company-data", "firmographics"] },
        { name: "wallet_enrich", description: RESOURCES[5].description, price: WALLET_ENRICH_PRICE, inputSchema: { address: z.string().describe("Public Base or EVM 0x address. Use wallet_enrich for on-chain evidence; use enrich for a company domain.") }, run: (a) => walletEnrich(a.address), tags: ["enrichment", "onchain", "wallet"] },
        { name: "deep_audit", description: RESOURCES[6].description, price: DEEP_AUDIT_PRICE, inputSchema: { domain: z.string().describe("Public business domain or URL. The hostname is normalized and the audit starts at its HTTPS homepage; any supplied path or query is ignored."), vertical: z.string().optional().describe("Optional structured-data template profile. med-spas is currently specialized; unsupported values fall back to it."), city: z.string().optional().describe("Optional city the business serves; used only to contextualize the generated structured-data template.") }, run: (a) => deepAudit(a.domain, { vertical: a.vertical, city: a.city }), tags: ["audit", "ai-readiness", "geo", "enrichment"] },
        { name: "morpho_position", description: RESOURCES[7].description, price: MORPHO_POSITION_PRICE, inputSchema: { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Borrower EVM address on Base mainnet"), shocks: z.array(z.number().min(-99).max(100)).max(8).optional().describe("Collateral price shocks in percent") }, run: (a) => morphoPosition(a.address, { shocks: a.shocks }), tags: ["defi", "morpho", "risk", "borrower-protection"] },
        { name: "morpho_protection", description: RESOURCES[8].description, price: MORPHO_PROTECTION_PRICE, inputSchema: { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Borrower EVM address on Base mainnet."), targetHealthFactor: z.number().gt(1).max(5).default(1.25).describe("Target Morpho health factor after the selected collateral-price shock; must be greater than 1 and at most 5."), protectAgainstShockPct: z.number().min(-99).max(0).default(-10).describe("Collateral-price shock percentage to withstand, from -99 through 0; for example -10 models a 10% price decline."), executionBufferBps: z.number().int().min(0).max(500).default(25).describe("Additional repayment or collateral amount buffer in basis points for debt accrual and integer rounding; 25 means 0.25%.") }, run: (a) => morphoProtection(a.address, a), tags: ["defi", "morpho", "protection", "unsigned-transaction-plan"] },
        { name: "morpho_market_underwrite", description: RESOURCES[9].description, price: MORPHO_MARKET_UNDERWRITE_PRICE, inputSchema: { marketId: z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("Morpho market ID on Base mainnet") }, run: (a) => morphoMarketUnderwrite(a.marketId), tags: ["defi", "morpho", "underwriting", "risk", "preliquidation"] },
        { name: "morpho_preliquidation_replay", description: RESOURCES[10].description, price: MORPHO_PRELIQUIDATION_REPLAY_PRICE, inputSchema: { transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("Successful Base transaction containing a Morpho PreLiquidate event") }, run: (a) => morphoPreLiquidationReplay(a.transactionHash), tags: ["defi", "morpho", "preliquidation", "replay", "economics"] },
        { name: "opportunity_preflight", description: RESOURCES[11].description, price: OPPORTUNITY_PREFLIGHT_PRICE, inputSchema: { platform: z.string().max(100).optional().describe("Optional platform slug used to attach dated platform-health evidence when a matching card exists."), rewardUsd: z.number().positive().describe("Maximum gross reward in USD if the opportunity is selected and paid."), hours: z.number().min(0).max(10000).describe("Estimated human and agent work time in hours for one complete attempt."), hourlyCostUsd: z.number().min(0).max(100000).describe("Internal opportunity cost per hour in USD."), computeUsd: z.number().min(0).default(0).describe("Expected model, API, hosting, and compute spend in USD for one attempt."), mandatorySpendUsd: z.number().min(0).default(0).describe("Non-recoverable cash spend in USD required before the opportunity can settle."), reusableValueUsd: z.number().min(0).default(0).describe("Conservative USD value of reusable code, research, distribution, or other assets created by the attempt."), selectionProbabilityPct: z.number().min(0).max(100).optional().describe("Caller-supplied probability, from 0 to 100, of receiving the reward; omit to receive a verify-first decision."), competition: z.number().int().min(0).default(0).describe("Known number of competing submissions or workers; use 0 when unknown."), slots: z.number().int().min(1).default(1).describe("Number of independently paid winner or worker slots."), agentAccess: z.enum(["agent_allowed", "agent_only", "mixed", "human_only", "unknown"]).default("unknown").describe("Whether the platform explicitly allows agent participation, is agent-only, mixes agents and humans, is human-only, or remains unknown."), acceptance: z.enum(["deterministic", "machine_scored", "timed_review", "discretionary", "unknown"]).default("unknown").describe("How completion is accepted: deterministic proof, machine score, review deadline, discretionary judgment, or unknown."), settlement: z.enum(["direct", "escrow", "platform_balance", "discretionary", "unfunded", "unknown"]).default("unknown").describe("How the reward is funded and paid: direct, escrow, platform balance, discretionary, unfunded, or unknown.") }, run: (a) => opportunityPreflight(a, { platformCard: a.platform ? getPlatformHealthCard(a.platform.toLowerCase()) : null }), tags: ["work", "bounty", "economics", "preflight", "settlement-evidence"] },
        { name: "agent_discoverability_audit", description: RESOURCES[12].description, price: AGENT_DISCOVERABILITY_AUDIT_PRICE, inputSchema: { origin: z.string().url().describe("Public HTTPS service origin"), intent: z.string().min(20).max(500).describe("Brand-blind capability description"), route: z.string().regex(/^\/[^?#]*$/).optional().describe("Optional expected exact path"), runtimeUrl: z.string().url().max(2048).optional().describe("Optional exact same-origin HTTPS GET URL whose unpaid x402 or MPP offer supplies the runtime price reference. Requires route and an exactly matching pathname."), payTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe("Optional EVM payTo for alias matching"), expectedPriceUsd: z.union([z.number().min(0).max(1000000), z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/)]).optional().describe("Optional exact route price expected by the caller. A coherent runtimeUrl offer takes precedence and caller drift is reported."), surfaceAudit: z.boolean().optional().describe("When true, inspect the target's public Agent Card, ERC-8004 registration document, and action catalog for the expected route through bounded same-origin fetches.") }, run: (a) => agentDiscoverabilityAudit(a), tags: ["distribution", "discovery", "x402", "mpp", "agent402", "catalog-price", "runtime-coherence", "a2a", "erc-8004"] },
        { name: "payment_offer_preflight", description: RESOURCES[13].description, price: PAYMENT_OFFER_PREFLIGHT_PRICE, inputSchema: { url: z.string().url().max(2048).describe("Exact public HTTPS GET route whose unpaid x402 and MPP challenge headers and same-origin OpenAPI success-response declaration should be inspected before buyer authorization. Credential-like query keys, fragments, unresolved parameters, local hosts, redirects, and non-public IPs are rejected."), catalog: PAYMENT_OFFER_CATALOG_SCHEMA.optional().describe("Optional caller-supplied catalog candidate. When present, the tool compares it with every live unsigned offer across request, protocol, amount, network, asset, recipient, and expiry.") }, run: (a) => paymentOfferPreflight(a), tags: ["payments", "x402", "mpp", "buyer-safety", "preflight", "catalog-coherence", "response-contract"] },
        { name: "seller_integrity_audit", description: RESOURCES[19].description, price: SELLER_INTEGRITY_AUDIT_PRICE, inputSchema: { origin: z.string().url().describe("Credential-free public HTTPS seller origin on port 443."), route: z.string().regex(/^\/(?!\/)[^?#{}]+$/).describe("Exact paid GET or POST path declared by the seller, without query or template parameters."), method: z.enum(["GET", "POST"]).default("GET").describe("POST receives static OpenAPI response-contract analysis without sending a target request."), requiredPaths: z.array(z.string().regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,7}$/)).max(16).default([]).describe("Buyer-required dotted success-response paths that the seller schema must guarantee recursively."), requireBazaar: z.boolean().default(false).describe("When true, missing Bazaar discovery metadata becomes a repair finding for live-probed GET routes.") }, run: (a) => sellerIntegrityAudit(a), tags: ["payments", "seller-ci", "x402", "mpp", "response-contract", "machine-buyability", "post-contract"] },
        { name: "contract_qualified_search", description: RESOURCES[20].description, price: CONTRACT_QUALIFIED_SEARCH_PRICE, inputSchema: { query: z.string().min(10).max(300).describe("Capability intent sent to Agent402 and used locally to rank MPP catalog metadata. Do not include credentials or private values."), requiredPaths: z.array(z.string().regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,7}$/)).min(1).max(16).describe("Buyer-required dotted success-response paths that every returned seller schema must guarantee recursively."), maxPriceDisplayUnits: z.number().gt(0).max(10).default(0.1).describe("Maximum advertised per-call price in each source's display currency."), limit: z.number().int().min(1).max(8).default(5).describe("Maximum candidates audited and returned across Agent402 and MPP.") }, run: (a) => contractQualifiedSearch(a), tags: ["payments", "service-discovery", "agent402", "mpp", "response-contract", "buyer-safety"] },
        { name: "agent_surface_budget_audit", description: RESOURCES[21].description, price: AGENT_SURFACE_BUDGET_AUDIT_PRICE, inputSchema: { origin: z.string().url().describe("Credential-free public HTTPS service origin on port 443, with no path or query."), surfaceMode: z.enum(["mcp", "openapi", "both"]).default("both").describe("Audit MCP only, OpenAPI only, or both. Unselected surfaces are not fetched or judged."), mcpPath: z.string().regex(/^\/(?!\/)[^?#{]+$/).default("/mcp").describe("Exact root-relative MCP streamable-HTTP path."), openApiPath: z.string().regex(/^\/(?!\/)[^?#{]+$/).default("/openapi.json").describe("Exact root-relative OpenAPI JSON path."), mcpBudgetBytes: z.number().int().min(8192).max(1000000).default(65536).describe("Maximum preferred raw MCP tools/list response size in bytes."), openApiBudgetBytes: z.number().int().min(32768).max(1000000).default(524288).describe("Maximum preferred raw OpenAPI document size in bytes.") }, outputSchema: agentSurfaceBudgetAuditMcpOutputSchema, run: (a) => agentSurfaceBudgetAudit(a), tags: ["distribution", "mcp", "openapi", "context-budget", "tool-discovery", "agent-finops"] },
        { name: "settlement_proof", description: RESOURCES[14].description, price: SETTLEMENT_PROOF_PRICE, inputSchema: { transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("Base mainnet transaction hash containing the claimed canonical USDC transfer."), recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Expected canonical Base USDC recipient."), amountAtomic: z.string().regex(/^[1-9][0-9]{0,20}$/).describe("Expected positive USDC amount in six-decimal atomic units."), payer: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe("Optional expected canonical Base USDC payer.") }, run: (a) => settlementProof(a), tags: ["payments", "x402", "settlement", "reconciliation", "base-usdc"] },
        { name: "transaction_receipt", description: RESOURCES[15].description, price: TRANSACTION_RECEIPT_PRICE, inputSchema: { transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("Mined Base or Ethereum transaction hash whose normalized receipt should be returned."), network: z.enum(["base", "ethereum"]).default("base").describe("Receipt network. Defaults to Base mainnet.") }, run: (a) => transactionReceipt(a), tags: ["blockchain", "receipt", "gas", "erc20", "usdc"] },
        { name: "solana_transaction_receipt", description: RESOURCES[16].description, price: SOLANA_TRANSACTION_RECEIPT_PRICE, inputSchema: { signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/).describe("Finalized Solana mainnet transaction signature."), mint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).optional().describe("Optional SPL-token mint; defaults to canonical Solana USDC."), recipient: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).optional().describe("Optional expected token recipient owner."), amountAtomic: z.string().regex(/^[1-9][0-9]{0,19}$/).optional().describe("Optional expected positive token amount in atomic units; requires recipient."), payer: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).optional().describe("Optional expected token payer owner; requires recipient and amountAtomic.") }, run: (a) => solanaTransactionReceipt(a), tags: ["blockchain", "solana", "receipt", "spl-token", "usdc"] },
        { name: "wallet_policy_conformance", description: RESOURCES[17].description, price: WALLET_POLICY_CONFORMANCE_PRICE, inputSchema: { profileId: z.string().min(1).max(128).describe("Caller-defined policy profile identifier with no credential or wallet secret."), provider: z.string().min(1).max(128).describe("Wallet or delegated-signer provider name."), network: z.string().min(1).max(128).describe("Network identifier used by the tested profile."), protocol: z.string().min(1).max(128).describe("Payment or execution protocol bound by the tested profile."), observations: z.array(z.object({ case: z.enum(WALLET_POLICY_CASE_NAMES).describe("Standardized mutation or control case."), actual: z.enum(["allowed", "denied", "error"]).describe("Observed high-level outcome."), denialClass: z.enum(["none", "policy", "validation", "provider"]).describe("Where the denial or error occurred; only policy earns provider-native coverage."), code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/).optional().describe("Optional safe provider code only, never a raw message or payload.") }).strict()).min(1).max(16).describe("Unique standardized observations. Raw provider responses, signatures, transactions, credentials, and wallet IDs are rejected.") }, run: (a) => walletPolicyConformance(a), tags: ["security", "wallet-policy", "delegated-signer", "conformance", "execution-shape"] },
        { name: "stateful_wallet_policy_conformance", description: RESOURCES[18].description, price: STATEFUL_WALLET_POLICY_CONFORMANCE_PRICE, inputSchema: { profileId: z.string().min(1).max(128).describe("Caller-defined stateful policy profile identifier with no credential, wallet, or counter secret."), provider: z.string().min(1).max(128).describe("Wallet or delegated-signer provider name."), network: z.string().min(1).max(128).describe("Network identifier used by the tested stateful profile."), protocol: z.string().min(1).max(128).describe("Payment or execution protocol bound by the tested stateful profile."), observations: z.array(z.object({ case: z.enum(STATEFUL_WALLET_POLICY_CASE_NAMES).describe("Standardized cumulative, extraction, concurrency, reference, or application-serialization case."), actual: z.enum(["allowed", "denied", "error"]).describe("Observed high-level outcome."), enforcementClass: z.enum(["none", "policy", "application", "validation", "provider"]).describe("Where enforcement occurred. Provider policy and application guards remain separate."), code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/).optional().describe("Optional safe provider code only, never a raw message, counter value, or payload.") }).strict()).min(1).max(7).describe("Unique standardized stateful observations. Raw provider responses, signatures, transactions, counter values, credentials, wallet IDs, and resource IDs are rejected.") }, run: (a) => statefulWalletPolicyConformance(a), tags: ["security", "wallet-policy", "stateful-policy", "spend-cap", "concurrency"] },
      ].map(decorateMcpTool),
    })
  )
  .then((r) => console.log(`  MCP server:  POST /mcp (${r.toolCount} paid tools)`))
  .catch((e) => console.error(`  /mcp mount FAILED (HTTP routes unaffected): ${e.message}`));
