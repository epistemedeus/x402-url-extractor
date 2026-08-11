import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Credential } from "mppx";

const CRAWLER_PATTERN = /bot|crawler|spider|slurp|uptime|monitor|observer|probe|indexer|headless|preview|liveness|healthcheck|sentineloracle|mcpbeat|agentreeve|agent402|trust[- ]?oracle/i;
const EXPLOIT_PROBE_PATH_PATTERN = /(?:^|\/)\.(?:env|git)(?:[./]|$)|^\/(?:wp-admin|wp-login\.php|wp-json|xmlrpc\.php)(?:\/|$)|^\/(?:api\/)?(?:config|env|settings)(?:[./]|$)|^\/js\/(?:config|env)\.js$/i;
const PAYMENT_HEADERS = ["payment-signature", "x-payment", "x-payment-signature"];
const PAYMENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const PAYMENT_CLASSES = new Set(["internal", "validation", "incentivized", "affiliated", "independent"]);
const SEMANTIC_UNMATCHED_ROUTE_PATTERN = /(?:morpho|liquidat|underwrit|protect|risk|readiness|audit|schema|enrich|extract|wallet|payment|settle|receipt|bount|opportunit|reputation|research|scan)/i;
const OWNER_MONITOR_USER_AGENT_PATTERN = /^SameDayDesk(?:[- /]|[A-Z])/i;
const MCP_TRANSPORT_PROBE_ROUTES = new Set(["/mcp/sse", "/mcp/messages", "/mcp/tools", "/mcp/events"]);
const AI_PROVIDER_SOURCE_PATTERNS = [
  ["openai-search", /\bOAI-SearchBot\b/i],
  ["openai-user", /\bChatGPT-User\b/i],
  ["openai-training", /\bGPTBot\b/i],
  ["anthropic-search", /\bClaude-SearchBot\b/i],
  ["anthropic-user", /\bClaude-User\b/i],
  ["anthropic-training", /\bClaudeBot\b/i],
  ["perplexity-search", /\bPerplexityBot\b/i],
  ["perplexity-user", /\bPerplexity-User\b/i],
  ["google-vertex-agent", /\bGoogle-CloudVertexBot\b/i],
];
const AGENT_DISCOVERY_SOURCE_PATTERNS = [
  ["agent402", /agent402/i],
  ["coinbase-bazaar", /(?:coinbase|\bcdp\b).*(?:x402|bazaar)|(?:x402|bazaar).*(?:coinbase|\bcdp\b)/i],
  ["circle-agent-marketplace", /circle.*(?:agent|x402)|(?:agent|x402).*circle/i],
  ["mcp-registry", /mcp[- /]?registry|modelcontextprotocol/i],
  ["smithery", /smithery/i],
  ["glama", /glama/i],
  ["mppscan", /mppscan/i],
  ["mpp-ecosystem", /(?:^|[^a-z])mpp(?:[^a-z]|$)|tempo.*payment/i],
  ["agentcash", /agentcash/i],
  ["a2a-ecosystem", /(?:^|[^a-z0-9])a2a(?:[^a-z0-9]|$)|agent[- ]?card/i],
  ...AI_PROVIDER_SOURCE_PATTERNS,
];
const DECLARED_AGENT_DISCOVERY_SOURCES = new Map([
  ["agent-skills-v1", "agent-skills"],
  ["agentictrade-v1", "agentictrade"],
  ["aws-agentcore-v1", "aws-agentcore"],
]);

const EXACT_ROUTES = new Map([
  ["/", { route: "/", kind: "discovery" }],
  ["/healthz", { route: "/healthz", kind: "excluded" }],
  ["/.well-known/x402", { route: "/.well-known/x402", kind: "discovery" }],
  ["/.well-known/x402.json", { route: "/.well-known/x402", kind: "discovery" }],
  ["/x402.json", { route: "/.well-known/x402", kind: "discovery" }],
  ["/api/x402", { route: "/.well-known/x402", kind: "discovery" }],
  ["/.well-known/402index-verify.txt", { route: "/.well-known/402index-verify.txt", kind: "excluded" }],
  ["/.well-known/glama.json", { route: "/.well-known/glama.json", kind: "discovery" }],
  ["/.well-known/agent-card.json", { route: "/.well-known/agent-card.json", kind: "discovery" }],
  ["/.well-known/agent.json", { route: "/.well-known/agent-card.json", kind: "discovery" }],
  ["/llms.txt", { route: "/llms.txt", kind: "discovery" }],
  ["/skill.md", { route: "/skill.md", kind: "discovery" }],
  ["/SKILL.md", { route: "/skill.md", kind: "discovery" }],
  ["/robots.txt", { route: "/robots.txt", kind: "discovery" }],
  ["/sitemap.xml", { route: "/sitemap.xml", kind: "discovery" }],
  ["/openapi.json", { route: "/openapi.json", kind: "discovery" }],
  ["/openapi.yaml", { route: "/openapi.json", kind: "discovery" }],
  ["/swagger.json", { route: "/openapi.json", kind: "discovery" }],
  ["/v0/cards.json", { route: "/v0/cards.json", kind: "discovery" }],
  ["/api/actions", { route: "/api/actions", kind: "discovery" }],
  ["/a2a", { route: "/a2a", kind: "discovery" }],
  ["/a2a/message:send", { route: "/a2a/message:send", kind: "discovery" }],
  ["/v0/commerce-demand.json", { route: "/v0/commerce-demand.json", kind: "excluded" }],
  ["/schemas/platform-health-card-v0.json", { route: "/schemas/platform-health-card-v0.json", kind: "discovery" }],
  ["/radar", { route: "/radar", kind: "discovery" }],
  ["/platforms", { route: "/platforms", kind: "discovery" }],
  ["/platforms/methodology", { route: "/platforms/methodology", kind: "discovery" }],
  ["/alerts", { route: "/alerts", kind: "discovery" }],
  ["/extract", { route: "/extract", kind: "paid" }],
  ["/read", { route: "/read", kind: "paid" }],
  ["/scan", { route: "/scan", kind: "paid" }],
  ["/schemaforge", { route: "/schemaforge", kind: "paid" }],
  ["/enrich", { route: "/enrich", kind: "paid" }],
  ["/wallet-enrich", { route: "/wallet-enrich", kind: "paid" }],
  ["/deep-audit", { route: "/deep-audit", kind: "paid" }],
  ["/defi/morpho-position", { route: "/defi/morpho-position", kind: "paid" }],
  ["/defi/morpho-protection", { route: "/defi/morpho-protection", kind: "paid" }],
  ["/defi/morpho-market-underwrite", { route: "/defi/morpho-market-underwrite", kind: "paid" }],
  ["/defi/morpho-preliquidation-replay", { route: "/defi/morpho-preliquidation-replay", kind: "paid" }],
  ["/work/opportunity-preflight", { route: "/work/opportunity-preflight", kind: "paid" }],
  ["/distribution/agent-discoverability-audit", { route: "/distribution/agent-discoverability-audit", kind: "paid" }],
  ["/commerce/payment-offer-preflight", { route: "/commerce/payment-offer-preflight", kind: "paid" }],
  ["/commerce/settlement-proof", { route: "/commerce/settlement-proof", kind: "paid" }],
  ["/chain/transaction-receipt", { route: "/chain/transaction-receipt", kind: "paid" }],
  ["/chain/solana-transaction-receipt", { route: "/chain/solana-transaction-receipt", kind: "paid" }],
  ["/gateway/commerce/payment-offer-preflight", { route: "/gateway/commerce/payment-offer-preflight", kind: "paid" }],
  ["/mcp", { route: "/mcp", kind: "paid" }],
]);

function safePathSegment(value) {
  const segment = String(value || "").toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(segment)) return ":opaque";
  return segment;
}

export function classifyCommerceRoute(rawPath) {
  const pathname = String(rawPath || "/").split("?", 1)[0] || "/";
  const exact = EXACT_ROUTES.get(pathname);
  if (exact) return { ...exact, matched: true };
  if (/^\/platforms\/[^/]+$/.test(pathname)) {
    return { route: "/platforms/:platformId", kind: "discovery", matched: true };
  }
  if (/^\/go\/(topify|manychat)$/.test(pathname)) {
    return { route: "/go/:offer", kind: "referral", matched: true };
  }
  if (pathname.startsWith("/integrations/")) {
    return { route: "/integrations/:private", kind: "excluded", matched: true };
  }
  if (MCP_TRANSPORT_PROBE_ROUTES.has(pathname)) {
    return { route: pathname, kind: "unmatched", matched: false };
  }
  const first = pathname.split("/").filter(Boolean)[0];
  return {
    route: first ? `/${safePathSegment(first)}/*` : "/:opaque",
    kind: "unmatched",
    matched: false,
  };
}

function headerValue(headers, name) {
  const value = headers?.[name];
  return Array.isArray(value) ? value.join(",") : String(value || "");
}

export function classifyAgentDiscoverySource(userAgent) {
  const value = String(userAgent || "").slice(0, 1000);
  for (const [source, pattern] of AGENT_DISCOVERY_SOURCE_PATTERNS) {
    if (pattern.test(value)) return source;
  }
  return CRAWLER_PATTERN.test(value) ? "generic-agent-indexer" : null;
}

export function classifyDeclaredAgentDiscoverySource(value) {
  return DECLARED_AGENT_DISCOVERY_SOURCES.get(String(value || "").trim().toLowerCase()) || null;
}

function hasMppAuthorization(headers) {
  return /(?:^|,)\s*Payment\s+[A-Za-z0-9_-]+/i.test(headerValue(headers, "authorization"));
}

function paymentProtocol(headers) {
  if (hasMppAuthorization(headers)) return "mpp";
  if (PAYMENT_HEADERS.some((name) => Boolean(headerValue(headers, name)))) return "x402";
  return null;
}

function offeredPaymentProtocols(res) {
  const offered = [];
  if (/(?:^|,)\s*Payment\s+/i.test(String(res.getHeader?.("www-authenticate") || ""))) {
    offered.push("mpp");
  }
  if (res.getHeader?.("payment-required") || res.getHeader?.("x-payment-required")) {
    offered.push("x402");
  }
  return offered;
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeCommercePayerClasses(value) {
  if (value === undefined || value === null || value === "") return new Map();
  let entries = value;
  if (typeof entries === "string") {
    try {
      entries = JSON.parse(entries);
    } catch {
      throw new Error("COMMERCE_PAYER_CLASSES must be valid JSON");
    }
  }
  if (!Array.isArray(entries) || entries.length > 100) {
    throw new Error("commerce payer classes must be an array of at most 100 entries");
  }
  const normalized = new Map();
  for (const entry of entries) {
    const address = String(entry?.address || "").toLowerCase();
    const paymentClass = String(entry?.class || "").toLowerCase();
    if (!EVM_ADDRESS_PATTERN.test(address)) throw new Error("commerce payer class address is invalid");
    if (!PAYMENT_CLASSES.has(paymentClass)) throw new Error("commerce payer class is invalid");
    if (normalized.has(address) && normalized.get(address) !== paymentClass) {
      throw new Error("commerce payer address has conflicting classes");
    }
    normalized.set(address, paymentClass);
  }
  return normalized;
}

function decodePaymentMetadata(headers) {
  const encoded = PAYMENT_HEADERS.map((name) => headerValue(headers, name)).find(Boolean);
  if (encoded) {
    try {
      const payload = JSON.parse(Buffer.from(encoded.trim(), "base64").toString("utf8"));
      const payerCandidate = payload?.payload?.authorization?.from || payload?.payload?.from || null;
      const paymentIdCandidate = payload?.extensions?.["payment-identifier"]?.info?.id || null;
      const accepted = payload?.accepted;
      const payer = EVM_ADDRESS_PATTERN.test(String(payerCandidate || ""))
        ? String(payerCandidate).toLowerCase()
        : null;
      const credentialParsed = payload?.x402Version === 2
        && accepted?.scheme === "exact"
        && typeof accepted?.network === "string"
        && /^eip155:\d+$/.test(accepted.network)
        && /^\d+$/.test(String(accepted?.amount || ""))
        && EVM_ADDRESS_PATTERN.test(String(accepted?.asset || ""))
        && EVM_ADDRESS_PATTERN.test(String(accepted?.payTo || ""))
        && Boolean(payer);
      return {
        credentialParsed,
        payer: credentialParsed ? payer : null,
        paymentId: credentialParsed && PAYMENT_ID_PATTERN.test(String(paymentIdCandidate || ""))
          ? String(paymentIdCandidate)
          : null,
      };
    } catch {
      return { credentialParsed: false, payer: null, paymentId: null };
    }
  }

  const serialized = Credential.extractPaymentScheme(headerValue(headers, "authorization"));
  if (!serialized) return { credentialParsed: false, payer: null, paymentId: null };
  try {
    const credential = Credential.deserialize(serialized);
    const request = credential?.challenge?.request;
    const chainId = Number(request?.methodDetails?.chainId);
    const payerCandidate = credential?.payload?.from;
    const payer = EVM_ADDRESS_PATTERN.test(String(payerCandidate || ""))
      ? String(payerCandidate).toLowerCase()
      : null;
    const credentialParsed = credential?.challenge?.method === "evm"
      && credential?.challenge?.intent === "charge"
      && Number.isSafeInteger(chainId)
      && chainId > 0
      && /^\d+$/.test(String(request?.amount || ""))
      && EVM_ADDRESS_PATTERN.test(String(request?.currency || ""))
      && EVM_ADDRESS_PATTERN.test(String(request?.recipient || ""))
      && EVM_ADDRESS_PATTERN.test(String(credential?.payload?.to || ""))
      && String(credential.payload.to).toLowerCase() === String(request.recipient).toLowerCase()
      && String(credential?.payload?.value || "") === String(request.amount)
      && Boolean(payer);
    return {
      credentialParsed,
      payer: credentialParsed ? payer : null,
      paymentId: null,
    };
  } catch {
    return { credentialParsed: false, payer: null, paymentId: null };
  }
}

function decodeResponseSettlement(res) {
  const candidates = [
    ["x402", res.getHeader?.("payment-response") || res.getHeader?.("x-payment-response")],
    ["mpp", res.getHeader?.("payment-receipt")],
  ];
  for (const [protocol, header] of candidates) {
    if (!header || String(header).length > 65_536) continue;
    try {
      const payload = JSON.parse(Buffer.from(String(header).trim(), "base64url").toString("utf8"));
      const successful = protocol === "x402" ? payload?.success === true : payload?.status === "success";
      if (!successful) continue;
      const reference = protocol === "x402"
        ? payload?.transaction || payload?.txHash
        : payload?.reference;
      if (!TRANSACTION_HASH_PATTERN.test(String(reference || ""))) continue;
      const amount = protocol === "x402" ? payload?.amount : payload?.settlement?.amount;
      const currency = protocol === "x402" ? payload?.asset || payload?.currency : payload?.settlement?.currency;
      return {
        protocol,
        reference: String(reference).toLowerCase(),
        amountAtomic: /^\d+$/.test(String(amount ?? "")) ? String(amount) : null,
        network: typeof payload?.network === "string" ? payload.network.slice(0, 100) : null,
        currency: typeof currency === "string" ? currency.slice(0, 200) : null,
      };
    } catch {
      // An unreadable optional response proof must not expose or retain the raw header.
    }
  }
  return null;
}

export function classifyCommerceResult({ route, kind, matched, paymentPresent, replayed = false, status }) {
  if (!matched) return "unmatched";
  if (kind === "discovery" || kind === "referral") return "discovery";
  if (kind !== "paid") return "request";
  if (status === 402) return "challenge";
  if (status >= 500) return "service_failure";
  if (status >= 400) return "validation_failure";
  if (route === "/mcp" && !paymentPresent && status >= 200 && status < 300) {
    return "protocol_discovery";
  }
  if (replayed && paymentPresent && status >= 200 && status < 300) return "replay_success";
  if (paymentPresent && status >= 200 && status < 300) return "paid_success";
  return "paid_route_response";
}

function eventResult(event) {
  return classifyCommerceResult({
    route: event.route,
    kind: event.kind,
    matched: event.matched,
    paymentPresent: event.paymentPresent,
    replayed: event.replayed,
    status: event.status,
  });
}

export function isSemanticUnmatched(event) {
  return eventResult(event) === "unmatched"
    && (SEMANTIC_UNMATCHED_ROUTE_PATTERN.test(String(event?.route || ""))
      || MCP_TRANSPORT_PROBE_ROUTES.has(String(event?.route || "")));
}

function emptyCounts() {
  return Object.create(null);
}

function increment(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function incrementActorBySource(actorCountsBySource, source, actor) {
  if (!actorCountsBySource.has(source)) actorCountsBySource.set(source, new Map());
  const actors = actorCountsBySource.get(source);
  actors.set(actor, (actors.get(actor) || 0) + 1);
}

function actorCount(actorCountsBySource, source) {
  return actorCountsBySource.get(source)?.size || 0;
}

function repeatActorCount(actorCountsBySource, source) {
  return [...(actorCountsBySource.get(source)?.values() || [])]
    .filter((count) => count > 1).length;
}

function controlledEventSource(event, fallback) {
  return typeof event?.agentDiscoverySource === "string"
    && /^[a-z][a-z0-9-]{1,39}$/.test(event.agentDiscoverySource)
    ? event.agentDiscoverySource
    : fallback;
}

function buildAgentSourceFunnel({
  discoveryEvents,
  credentialAttemptEvents,
  paidSuccessEvents,
  paymentClassByActor,
}) {
  const discoveryBySource = emptyCounts();
  const discoveryActorCountsBySource = new Map();
  const paidRouteBySource = emptyCounts();
  const paidRouteActorCountsBySource = new Map();
  const challengeBySource = emptyCounts();
  const challengeActorCountsBySource = new Map();
  const credentialBySource = emptyCounts();
  const credentialActorCountsBySource = new Map();
  const paidBySource = emptyCounts();
  const paidActorCountsBySource = new Map();
  const independentPaidBySource = emptyCounts();
  const independentPaidActorCountsBySource = new Map();
  const convertedBySource = emptyCounts();
  const convertedActorCountsBySource = new Map();
  const challengeFirstAt = new Map();
  const challengeFirstSource = new Map();

  for (const event of discoveryEvents) {
    const source = controlledEventSource(event, "unattributed-crawler");
    increment(discoveryBySource, source);
    incrementActorBySource(discoveryActorCountsBySource, source, event.actor);
    if (event.kind !== "paid") continue;
    increment(paidRouteBySource, source);
    incrementActorBySource(paidRouteActorCountsBySource, source, event.actor);
    if (eventResult(event) !== "challenge") continue;
    increment(challengeBySource, source);
    incrementActorBySource(challengeActorCountsBySource, source, event.actor);
    const observedAt = Date.parse(event.ts);
    const prior = challengeFirstAt.get(event.actor);
    if (Number.isFinite(observedAt) && (!Number.isFinite(prior) || observedAt < prior)) {
      challengeFirstAt.set(event.actor, observedAt);
      challengeFirstSource.set(event.actor, source);
    }
  }

  for (const event of credentialAttemptEvents) {
    const source = controlledEventSource(event, "direct-or-unattributed");
    const actor = event.paymentActor || event.actor;
    increment(credentialBySource, source);
    incrementActorBySource(credentialActorCountsBySource, source, actor);
  }

  for (const event of paidSuccessEvents) {
    const source = controlledEventSource(event, "direct-or-unattributed");
    const paidActor = event.paymentActor || event.actor;
    const paymentClass = event.paymentActor
      ? paymentClassByActor.get(event.paymentActor) || "unclassified"
      : "unclassified";
    increment(paidBySource, source);
    incrementActorBySource(paidActorCountsBySource, source, paidActor);
    if (paymentClass === "independent") {
      increment(independentPaidBySource, source);
      incrementActorBySource(independentPaidActorCountsBySource, source, paidActor);
    }
    const challengedAt = challengeFirstAt.get(event.actor);
    const challengeSource = challengeFirstSource.get(event.actor);
    const paidAt = Date.parse(event.ts);
    if (Number.isFinite(challengedAt)
      && challengeSource
      && Number.isFinite(paidAt)
      && paidAt >= challengedAt) {
      increment(convertedBySource, challengeSource);
      incrementActorBySource(convertedActorCountsBySource, challengeSource, event.actor);
    }
  }

  const funnel = Object.create(null);
  const sourceKeys = new Set([
    ...Object.keys(discoveryBySource),
    ...Object.keys(paidRouteBySource),
    ...Object.keys(challengeBySource),
    ...Object.keys(credentialBySource),
    ...Object.keys(paidBySource),
    ...Object.keys(independentPaidBySource),
    ...convertedActorCountsBySource.keys(),
  ]);
  for (const source of [...sourceKeys].sort()) {
    const paidRouteObservations = paidRouteBySource[source] || 0;
    const paidRouteActors = actorCount(paidRouteActorCountsBySource, source);
    const challengeObservations = challengeBySource[source] || 0;
    const challengeActors = actorCount(challengeActorCountsBySource, source);
    const challengeConvertedActors = actorCount(convertedActorCountsBySource, source);
    funnel[source] = {
      discoveryObservations: discoveryBySource[source] || 0,
      discoveryActors: actorCount(discoveryActorCountsBySource, source),
      repeatDiscoveryActors: repeatActorCount(discoveryActorCountsBySource, source),
      paidRouteObservations,
      paidRouteActors,
      repeatPaidRouteActors: repeatActorCount(paidRouteActorCountsBySource, source),
      challengeObservations,
      challengeActors,
      repeatChallengeActors: repeatActorCount(challengeActorCountsBySource, source),
      challengeObservationRate: paidRouteObservations
        ? challengeObservations / paidRouteObservations
        : null,
      challengeActorRate: paidRouteActors ? challengeActors / paidRouteActors : null,
      credentialAttemptEvents: credentialBySource[source] || 0,
      credentialAttemptActors: actorCount(credentialActorCountsBySource, source),
      repeatCredentialAttemptActors: repeatActorCount(credentialActorCountsBySource, source),
      challengeConvertedPaidSuccesses: convertedBySource[source] || 0,
      challengeConvertedActors,
      challengeActorConversionRate: challengeActors
        ? challengeConvertedActors / challengeActors
        : null,
      paidSuccesses: paidBySource[source] || 0,
      paidSuccessActors: actorCount(paidActorCountsBySource, source),
      repeatPaidSuccessActors: repeatActorCount(paidActorCountsBySource, source),
      independentPaidSuccesses: independentPaidBySource[source] || 0,
      independentPaidSuccessActors: actorCount(independentPaidActorCountsBySource, source),
    };
  }
  return funnel;
}

async function readEvents(filePath) {
  try {
    const contents = await readFile(filePath, "utf8");
    return contents
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export function createCommerceTelemetry({
  dataDir = process.env.COMMERCE_DATA_DIR || path.join(process.cwd(), "data"),
  secret = process.env.COMMERCE_ACTOR_SECRET || randomBytes(32).toString("hex"),
  internalToken = process.env.COMMERCE_INTERNAL_TOKEN || "",
  externalSince = process.env.COMMERCE_EXTERNAL_SINCE || "",
  agentDiscoverySince = process.env.COMMERCE_AGENT_DISCOVERY_SINCE || "",
  agentSourceDetailSince = process.env.COMMERCE_AGENT_SOURCE_DETAIL_SINCE || "",
  mcpTransportProbeSince = process.env.COMMERCE_MCP_TRANSPORT_PROBE_SINCE || "2026-08-09T18:56:00.000Z",
  credentialAttemptSince = process.env.COMMERCE_CREDENTIAL_ATTEMPT_SINCE || "",
  settlementEvidenceSince = process.env.COMMERCE_SETTLEMENT_EVIDENCE_SINCE || "",
  payerClasses = process.env.COMMERCE_PAYER_CLASSES || "",
  maxBytes = 5 * 1024 * 1024,
} = {}) {
  const currentPath = path.join(dataDir, "commerce-events.ndjson");
  const rotatedPath = path.join(dataDir, "commerce-events.1.ndjson");
  const parsedExternalSince = Date.parse(externalSince);
  const externalSinceMs = Number.isFinite(parsedExternalSince) ? parsedExternalSince : null;
  const parsedAgentDiscoverySince = Date.parse(agentDiscoverySince);
  const agentDiscoverySinceMs = Number.isFinite(parsedAgentDiscoverySince)
    ? parsedAgentDiscoverySince
    : null;
  const parsedAgentSourceDetailSince = Date.parse(agentSourceDetailSince);
  const agentSourceDetailSinceMs = Number.isFinite(parsedAgentSourceDetailSince)
    ? parsedAgentSourceDetailSince
    : null;
  const parsedMcpTransportProbeSince = Date.parse(mcpTransportProbeSince);
  const mcpTransportProbeSinceMs = Number.isFinite(parsedMcpTransportProbeSince)
    ? parsedMcpTransportProbeSince
    : null;
  const parsedCredentialAttemptSince = Date.parse(credentialAttemptSince);
  const credentialAttemptSinceMs = Number.isFinite(parsedCredentialAttemptSince)
    ? parsedCredentialAttemptSince
    : null;
  const parsedSettlementEvidenceSince = Date.parse(settlementEvidenceSince);
  const settlementEvidenceSinceMs = Number.isFinite(parsedSettlementEvidenceSince)
    ? parsedSettlementEvidenceSince
    : null;
  const normalizedPayerClasses = normalizeCommercePayerClasses(payerClasses);
  const paymentClassByActor = new Map([...normalizedPayerClasses].map(([address, paymentClass]) => [
    createHmac("sha256", secret).update(`payer:${address}`).digest("hex").slice(0, 24),
    paymentClass,
  ]));
  let queue = Promise.resolve();

  async function appendEvent(event) {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await chmod(dataDir, 0o700).catch(() => {});
    const size = await stat(currentPath).then((entry) => entry.size).catch(() => 0);
    if (size >= maxBytes) {
      await unlink(rotatedPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      await rename(currentPath, rotatedPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
    await appendFile(currentPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(currentPath, 0o600).catch(() => {});
  }

  function enqueue(event) {
    queue = queue.then(() => appendEvent(event)).catch((error) => {
      console.error(`commerce telemetry write failed: ${error.message}`);
    });
  }

  function middleware(req, res, next) {
    const route = classifyCommerceRoute(req.path || req.url);
    if (route.kind === "excluded") return next();

    const startedAt = Date.now();
    const headers = req.headers || {};
    const userAgent = headerValue(headers, "user-agent");
    const declaredAgentDiscoverySource = classifyDeclaredAgentDiscoverySource(
      headerValue(headers, "x-samedaydesk-agent-source"),
    );
    const agentDiscoverySource = declaredAgentDiscoverySource || classifyAgentDiscoverySource(userAgent);
    const suppliedInternal = headerValue(headers, "x-samedaydesk-internal");
    const protocol = paymentProtocol(headers);
    const paymentPresent = Boolean(protocol);
    const originClass = safeEqual(suppliedInternal, internalToken)
      ? "internal"
      : EXPLOIT_PROBE_PATH_PATTERN.test(req.path || req.url || "")
        ? "scanner"
      : OWNER_MONITOR_USER_AGENT_PATTERN.test(userAgent)
        ? "owner_monitor"
      : paymentPresent
        ? "external"
      : agentDiscoverySource
        ? "crawler"
        : "external";
    const actorMaterial = `${req.ip || req.socket?.remoteAddress || "unknown"}|${userAgent}`;
    const actor = createHmac("sha256", secret).update(actorMaterial).digest("hex").slice(0, 24);
    const paymentMetadata = decodePaymentMetadata(headers);
    const paymentActor = paymentMetadata.payer
      ? createHmac("sha256", secret).update(`payer:${paymentMetadata.payer}`).digest("hex").slice(0, 24)
      : null;
    const paymentIdentifier = paymentMetadata.paymentId
      ? createHmac("sha256", secret).update(`payment-id:${paymentMetadata.paymentId}`).digest("hex").slice(0, 24)
      : null;
    const queryKeys = Object.keys(req.query || {}).sort().slice(0, 20);

    res.once("finish", () => {
      const status = Number(res.statusCode || 0);
      const replayed = String(res.getHeader?.("x-payment-replay") || "").toLowerCase() === "hit";
      const protocolsOffered = offeredPaymentProtocols(res);
      const settlement = decodeResponseSettlement(res);
      enqueue({
        v: 2,
        id: randomUUID(),
        ts: new Date().toISOString(),
        actor,
        originClass,
        agentDiscoverySource,
        method: String(req.method || "GET").toUpperCase(),
        route: route.route,
        matched: route.matched,
        kind: route.kind,
        queryKeys,
        paymentPresent,
        paymentCredentialParsed: paymentMetadata.credentialParsed === true,
        paymentProtocol: protocol,
        protocolsOffered,
        replayed,
        paymentActor,
        paymentIdentifier,
        settlementReference: settlement?.reference || null,
        settlementAmountAtomic: settlement?.amountAtomic || null,
        settlementNetwork: settlement?.network || null,
        settlementCurrency: settlement?.currency || null,
        status,
        result: classifyCommerceResult({
          route: route.route,
          kind: route.kind,
          matched: route.matched,
          paymentPresent,
          replayed,
          status,
        }),
        durationMs: Math.max(0, Date.now() - startedAt),
      });
    });
    return next();
  }

  async function snapshot({ days = 90 } = {}) {
    await queue;
    const safeDays = Math.max(1, Math.min(365, Number(days) || 90));
    const windowCutoff = Date.now() - safeDays * 86_400_000;
    const cutoff = externalSinceMs === null
      ? windowCutoff
      : Math.max(windowCutoff, externalSinceMs);
    const observedEvents = [
      ...(await readEvents(rotatedPath)),
      ...(await readEvents(currentPath)),
    ].filter((event) => Date.parse(event.ts) >= cutoff);
    const events = observedEvents.filter((event) => event.originClass === "external");
    const credentialHeaderEvents = events.filter((event) => (
      event.paymentPresent === true
      && event.kind === "paid"
      && event.matched === true
      && (credentialAttemptSinceMs === null || Date.parse(event.ts) >= credentialAttemptSinceMs)
    ));
    const credentialAttemptEvents = credentialHeaderEvents.filter((event) => event.paymentCredentialParsed === true);
    const agentDiscoveryEvents = observedEvents.filter((event) => (
      event.originClass === "crawler"
      && (agentDiscoverySinceMs === null || Date.parse(event.ts) >= agentDiscoverySinceMs)
      && event.matched === true
      && (event.kind === "discovery" || event.kind === "paid")
    ));

    const agentDiscoveryBySource = emptyCounts();
    const agentDiscoveryByRoute = emptyCounts();
    const agentDiscoveryBySourceRoute = Object.create(null);
    const agentDiscoveryActors = new Map();
    const agentChallengeBySource = emptyCounts();
    const agentChallengeByRoute = emptyCounts();
    const agentChallengeBySourceRoute = Object.create(null);
    const agentChallengeActors = new Map();
    const agentChallengeFirstAt = new Map();
    const agentChallengeFirstSource = new Map();
    let agentPaidRouteObservations = 0;
    let agentChallengeObservations = 0;
    for (const event of agentDiscoveryEvents) {
      const source = typeof event.agentDiscoverySource === "string"
        && /^[a-z][a-z0-9-]{1,39}$/.test(event.agentDiscoverySource)
        ? event.agentDiscoverySource
        : "unattributed-crawler";
      increment(agentDiscoveryBySource, source);
      increment(agentDiscoveryByRoute, event.route);
      if (!agentDiscoveryBySourceRoute[source]) agentDiscoveryBySourceRoute[source] = emptyCounts();
      increment(agentDiscoveryBySourceRoute[source], event.route);
      agentDiscoveryActors.set(event.actor, (agentDiscoveryActors.get(event.actor) || 0) + 1);
      if (event.kind === "paid") {
        agentPaidRouteObservations += 1;
        if (eventResult(event) === "challenge") {
          agentChallengeObservations += 1;
          increment(agentChallengeBySource, source);
          increment(agentChallengeByRoute, event.route);
          if (!agentChallengeBySourceRoute[source]) agentChallengeBySourceRoute[source] = emptyCounts();
          increment(agentChallengeBySourceRoute[source], event.route);
          agentChallengeActors.set(event.actor, (agentChallengeActors.get(event.actor) || 0) + 1);
          const observedAt = Date.parse(event.ts);
          const prior = agentChallengeFirstAt.get(event.actor);
          if (Number.isFinite(observedAt) && (!Number.isFinite(prior) || observedAt < prior)) {
            agentChallengeFirstAt.set(event.actor, observedAt);
            agentChallengeFirstSource.set(event.actor, source);
          }
        }
      }
    }

    const byResult = emptyCounts();
    const byRoute = emptyCounts();
    const unmatchedRequests = emptyCounts();
    const semanticUnmatched = emptyCounts();
    const mcpTransportProbeByRoute = emptyCounts();
    const actors = new Map();
    const semanticUnmatchedActors = new Map();
    const mcpTransportProbeActors = new Map();
    const paidActors = new Map();
    const paidSuccessByRoute = emptyCounts();
    const byProtocolResult = emptyCounts();
    const paidSuccessByProtocol = emptyCounts();
    const paidSuccessByDiscoverySource = emptyCounts();
    const paidSuccessByDiscoverySourceRoute = Object.create(null);
    const paidSuccessByClass = emptyCounts();
    const paidSuccessByClassRoute = Object.create(null);
    const independentPaidSuccessByDiscoverySource = emptyCounts();
    const independentPaidActors = new Map();
    const agentChallengeConvertedActors = new Map();
    const independentAgentChallengeConvertedActors = new Map();
    const agentChallengeConvertedBySource = emptyCounts();
    const agentChallengeConvertedByClass = emptyCounts();
    let agentChallengeConvertedPaidSuccesses = 0;
    const credentialAttemptByProtocol = emptyCounts();
    const credentialAttemptByResult = emptyCounts();
    const credentialAttemptByRoute = emptyCounts();
    const credentialAttemptBySource = emptyCounts();
    const credentialAttemptByClass = emptyCounts();
    const credentialAttemptActors = new Map();
    for (const event of credentialAttemptEvents) {
      if (event.paymentProtocol) increment(credentialAttemptByProtocol, event.paymentProtocol);
      increment(credentialAttemptByResult, eventResult(event));
      increment(credentialAttemptByRoute, event.route);
      const source = typeof event.agentDiscoverySource === "string"
        && /^[a-z][a-z0-9-]{1,39}$/.test(event.agentDiscoverySource)
        ? event.agentDiscoverySource
        : "direct-or-unattributed";
      increment(credentialAttemptBySource, source);
      const paymentClass = event.paymentActor
        ? paymentClassByActor.get(event.paymentActor) || "unclassified"
        : "unclassified";
      increment(credentialAttemptByClass, paymentClass);
      const attemptActor = event.paymentActor || event.actor;
      credentialAttemptActors.set(attemptActor, (credentialAttemptActors.get(attemptActor) || 0) + 1);
    }
    let paymentIdentifierEvents = 0;
    let replaySuccessEvents = 0;
    let settlementReferenceEligiblePaidSuccesses = 0;
    let settlementReferencePaidSuccesses = 0;
    const settlementReferences = new Set();
    const settlementEvidenceByClass = Object.create(null);
    for (const event of events) {
      const result = eventResult(event);
      increment(byResult, result);
      increment(byRoute, event.route);
      if (result === "unmatched") {
        increment(unmatchedRequests, event.route);
        if (MCP_TRANSPORT_PROBE_ROUTES.has(event.route)
          && (mcpTransportProbeSinceMs === null || Date.parse(event.ts) >= mcpTransportProbeSinceMs)) {
          increment(mcpTransportProbeByRoute, event.route);
          mcpTransportProbeActors.set(
            event.actor,
            (mcpTransportProbeActors.get(event.actor) || 0) + 1,
          );
        }
        if (isSemanticUnmatched(event)) {
          increment(semanticUnmatched, event.route);
          semanticUnmatchedActors.set(
            event.actor,
            (semanticUnmatchedActors.get(event.actor) || 0) + 1,
          );
        }
      }
      if (event.paymentIdentifier) paymentIdentifierEvents += 1;
      if (result === "replay_success") replaySuccessEvents += 1;
      if (result === "paid_success") {
        increment(paidSuccessByRoute, event.route);
        if (event.paymentProtocol) increment(paidSuccessByProtocol, event.paymentProtocol);
        const paidActor = event.paymentActor || event.actor;
        paidActors.set(paidActor, (paidActors.get(paidActor) || 0) + 1);
        const paymentClass = event.paymentActor
          ? paymentClassByActor.get(event.paymentActor) || "unclassified"
          : "unclassified";
        const discoverySource = typeof event.agentDiscoverySource === "string"
          && /^[a-z][a-z0-9-]{1,39}$/.test(event.agentDiscoverySource)
          ? event.agentDiscoverySource
          : "direct-or-unattributed";
        increment(paidSuccessByDiscoverySource, discoverySource);
        if (!paidSuccessByDiscoverySourceRoute[discoverySource]) {
          paidSuccessByDiscoverySourceRoute[discoverySource] = emptyCounts();
        }
        increment(paidSuccessByDiscoverySourceRoute[discoverySource], event.route);
        increment(paidSuccessByClass, paymentClass);
        if (!paidSuccessByClassRoute[paymentClass]) paidSuccessByClassRoute[paymentClass] = emptyCounts();
        increment(paidSuccessByClassRoute[paymentClass], event.route);
        if (paymentClass === "independent") {
          independentPaidActors.set(paidActor, (independentPaidActors.get(paidActor) || 0) + 1);
          increment(independentPaidSuccessByDiscoverySource, discoverySource);
        }
        const challengeFirstAt = agentChallengeFirstAt.get(event.actor);
        const challengeSource = agentChallengeFirstSource.get(event.actor);
        const paidAt = Date.parse(event.ts);
        if (Number.isFinite(challengeFirstAt)
          && challengeSource
          && Number.isFinite(paidAt)
          && paidAt >= challengeFirstAt) {
          agentChallengeConvertedPaidSuccesses += 1;
          agentChallengeConvertedActors.set(
            event.actor,
            (agentChallengeConvertedActors.get(event.actor) || 0) + 1,
          );
          increment(agentChallengeConvertedBySource, challengeSource);
          increment(agentChallengeConvertedByClass, paymentClass);
          if (paymentClass === "independent") {
            independentAgentChallengeConvertedActors.set(
              event.actor,
              (independentAgentChallengeConvertedActors.get(event.actor) || 0) + 1,
            );
          }
        }
        if (settlementEvidenceSinceMs !== null && Date.parse(event.ts) >= settlementEvidenceSinceMs) {
          settlementReferenceEligiblePaidSuccesses += 1;
          if (!settlementEvidenceByClass[paymentClass]) {
            settlementEvidenceByClass[paymentClass] = { paidSuccesses: 0, withReference: 0, missingReference: 0 };
          }
          settlementEvidenceByClass[paymentClass].paidSuccesses += 1;
          if (TRANSACTION_HASH_PATTERN.test(String(event.settlementReference || ""))) {
            settlementReferencePaidSuccesses += 1;
            settlementReferences.add(String(event.settlementReference).toLowerCase());
            settlementEvidenceByClass[paymentClass].withReference += 1;
          } else {
            settlementEvidenceByClass[paymentClass].missingReference += 1;
          }
        }
      }
      if (result === "challenge") {
        for (const protocol of event.protocolsOffered || []) {
          increment(byProtocolResult, `${protocol}_challenge`);
        }
      } else if (event.paymentProtocol) {
        increment(byProtocolResult, `${event.paymentProtocol}_${result}`);
      }
      actors.set(event.actor, (actors.get(event.actor) || 0) + 1);
    }

    const paidSuccessEvents = events.filter((event) => eventResult(event) === "paid_success");
    const agentSourceFunnel = buildAgentSourceFunnel({
      discoveryEvents: agentDiscoveryEvents,
      credentialAttemptEvents,
      paidSuccessEvents,
      paymentClassByActor,
    });
    const agentSourceDetailDiscoveryEvents = agentSourceDetailSinceMs === null
      ? []
      : agentDiscoveryEvents.filter((event) => Date.parse(event.ts) >= agentSourceDetailSinceMs);
    const agentSourceDetailCredentialEvents = agentSourceDetailSinceMs === null
      ? []
      : credentialAttemptEvents.filter((event) => Date.parse(event.ts) >= agentSourceDetailSinceMs);
    const agentSourceDetailPaidSuccessEvents = agentSourceDetailSinceMs === null
      ? []
      : paidSuccessEvents.filter((event) => Date.parse(event.ts) >= agentSourceDetailSinceMs);
    const agentSourceDetailFunnel = buildAgentSourceFunnel({
      discoveryEvents: agentSourceDetailDiscoveryEvents,
      credentialAttemptEvents: agentSourceDetailCredentialEvents,
      paidSuccessEvents: agentSourceDetailPaidSuccessEvents,
      paymentClassByActor,
    });

    return {
      generatedAt: new Date().toISOString(),
      windowDays: safeDays,
      externalSince: externalSinceMs === null ? null : new Date(externalSinceMs).toISOString(),
      externalEvents: events.length,
      externalActors: actors.size,
      repeatExternalActors: [...actors.values()].filter((count) => count > 1).length,
      paidSuccessActors: paidActors.size,
      repeatPaidSuccessActors: [...paidActors.values()].filter((count) => count > 1).length,
      independentPaidSuccessActors: independentPaidActors.size,
      repeatIndependentPaidSuccessActors: [...independentPaidActors.values()].filter((count) => count > 1).length,
      agentDiscoverySince: agentDiscoverySinceMs === null ? null : new Date(agentDiscoverySinceMs).toISOString(),
      agentDiscoveryObservations: agentDiscoveryEvents.length,
      agentDiscoveryActors: agentDiscoveryActors.size,
      repeatAgentDiscoveryActors: [...agentDiscoveryActors.values()].filter((count) => count > 1).length,
      agentDiscoveryBySource,
      agentDiscoveryByRoute,
      agentDiscoveryBySourceRoute,
      agentSourceFunnel,
      agentSourceTaxonomyVersion: "ai-provider-purpose-v1",
      agentSourceTaxonomyLabels: AI_PROVIDER_SOURCE_PATTERNS.map(([source]) => source),
      agentSourceDetailSince: agentSourceDetailSinceMs === null
        ? null
        : new Date(agentSourceDetailSinceMs).toISOString(),
      agentSourceDetailObservations: agentSourceDetailDiscoveryEvents.length,
      agentSourceDetailActors: new Set(
        agentSourceDetailDiscoveryEvents.map((event) => event.actor),
      ).size,
      agentSourceDetailFunnel,
      agentPaidRouteObservations,
      agentChallengeObservations,
      agentChallengeActors: agentChallengeActors.size,
      repeatAgentChallengeActors: [...agentChallengeActors.values()].filter((count) => count > 1).length,
      agentChallengeRate: agentPaidRouteObservations
        ? agentChallengeObservations / agentPaidRouteObservations
        : null,
      agentChallengeBySource,
      agentChallengeByRoute,
      agentChallengeBySourceRoute,
      agentChallengeConvertedPaidSuccesses,
      agentChallengeConvertedActors: agentChallengeConvertedActors.size,
      independentAgentChallengeConvertedActors: independentAgentChallengeConvertedActors.size,
      agentChallengeActorConversionRate: agentChallengeActors.size
        ? agentChallengeConvertedActors.size / agentChallengeActors.size
        : null,
      agentChallengeConvertedBySource,
      agentChallengeConvertedByClass,
      credentialAttemptSince: credentialAttemptSinceMs === null ? null : new Date(credentialAttemptSinceMs).toISOString(),
      paymentHeaderEvents: credentialHeaderEvents.length,
      parseableCredentialAttemptEvents: credentialAttemptEvents.length,
      unparseablePaymentHeaderEvents: credentialHeaderEvents.length - credentialAttemptEvents.length,
      parseableCredentialAttemptActors: credentialAttemptActors.size,
      repeatParseableCredentialAttemptActors: [...credentialAttemptActors.values()].filter((count) => count > 1).length,
      credentialAttemptByProtocol,
      credentialAttemptByResult,
      credentialAttemptByRoute,
      credentialAttemptBySource,
      credentialAttemptByClass,
      paidSuccessByRoute,
      paidSuccessByProtocol,
      paidSuccessByDiscoverySource,
      paidSuccessByDiscoverySourceRoute,
      paidSuccessByClass,
      paidSuccessByClassRoute,
      independentPaidSuccessByDiscoverySource,
      settlementEvidenceSince: settlementEvidenceSinceMs === null ? null : new Date(settlementEvidenceSinceMs).toISOString(),
      settlementReferenceEligiblePaidSuccesses,
      settlementReferencePaidSuccesses,
      missingSettlementReferencePaidSuccesses: settlementReferenceEligiblePaidSuccesses - settlementReferencePaidSuccesses,
      distinctSettlementReferences: settlementReferences.size,
      settlementReferenceCoverage: settlementReferenceEligiblePaidSuccesses
        ? settlementReferencePaidSuccesses / settlementReferenceEligiblePaidSuccesses
        : null,
      settlementEvidenceByClass,
      byProtocolResult,
      paymentIdentifierEvents,
      replaySuccessEvents,
      byResult,
      byRoute,
      unmatchedRequests,
      mcpTransportProbeSince: mcpTransportProbeSinceMs === null ? null : new Date(mcpTransportProbeSinceMs).toISOString(),
      mcpTransportProbeEvents: Object.values(mcpTransportProbeByRoute).reduce((sum, count) => sum + count, 0),
      mcpTransportProbeActors: mcpTransportProbeActors.size,
      repeatMcpTransportProbeActors: [...mcpTransportProbeActors.values()].filter((count) => count > 1).length,
      mcpTransportProbeByRoute,
      semanticUnmatchedEvents: Object.values(semanticUnmatched).reduce((sum, count) => sum + count, 0),
      semanticUnmatchedActors: semanticUnmatchedActors.size,
      repeatSemanticUnmatchedActors: [...semanticUnmatchedActors.values()].filter((count) => count > 1).length,
      semanticUnmatched,
      semanticUnmatchedHeuristic: "v1-high-precision-route-keywords",
      mcpTransportProbePolicy: "After the declared MCP transport-probe baseline, only four common public client expectations are counted: /mcp/sse, /mcp/messages, /mcp/tools, and /mcp/events. Arbitrary MCP subpaths remain grouped as /mcp/*, and probe counts remain acquisition-friction evidence rather than demand until an independent actor repeats or converts.",
      agentDiscoveryPolicy: "After the declared machine-discovery baseline, recognized crawler and agent-indexer user-agent families are reduced to a controlled source label at ingestion. SameDayDesk-owned monitor user agents are excluded. Raw user-agent strings and network addresses are not retained in the public snapshot. Per-source observations, distinct and repeat secret-keyed actors, paid-route reach, HTTP 402 challenge delivery, credential attempts, and paid outcomes distinguish broad machine reach from repeated crawler volume and later payment conversion. Challenge-to-payment conversion is attributed to the source of the first observed same-actor challenge. These observations are not authenticated referrals, buyer intent, or demand.",
      agentSourceDetailPolicy: "The ai-provider-purpose-v1 cohort begins only at agentSourceDetailSince and classifies exact provider-published HTTP user-agent tokens for OpenAI search, user fetch, and training; Anthropic search, user fetch, and training; Perplexity search and user fetch; and Google Cloud Vertex agent crawls. Google-Extended is intentionally absent because Google documents that it has no separate HTTP user-agent string. Labels are user-agent observations rather than IP-verified identities or referral proof. Historical generic events are not reclassified.",
      unmatched: unmatchedRequests,
      paymentClassPolicy: "Explicit known-payer rules classify internal, marketplace validation, incentivized, affiliated, or independently confirmed buyers. Unknown or missing payer identities remain unclassified and never become independent by inference.",
      discoveryConversionPolicy: "A submitted payment credential overrides crawler classification so paying agents remain in economic telemetry. Controlled user-agent source labels attribute the client channel but are self-declared and do not independently authenticate a registry referral. Challenge-to-paid conversion uses the same secret-keyed network-and-user-agent actor before and after the challenge and is therefore a conservative continuity lower bound, not an identity claim. SameDayDesk owner monitors remain excluded before this rule.",
      credentialAttemptPolicy: "After the declared credential-attempt baseline, a parseable attempt must carry a syntactically complete x402 v2 exact Base-style binding or MPP evm/charge credential. Signature validity and settlement are separate later outcomes. Public output contains only aggregate protocol, result, route, controlled source, and explicit payer-class counts; raw credentials, actors, and payer addresses are not exposed.",
      settlementEvidencePolicy: "After the declared settlement-evidence baseline, a successful paid response should carry a valid Base transaction reference in PAYMENT-RESPONSE or Payment-Receipt. Raw response headers and transaction references remain private; public output exposes only coverage counts by evidence class.",
      boundary: "Aggregate external observations after the declared experiment baseline only. Known internal, SameDayDesk-owned monitor, crawler, and exploit-probe traffic is excluded from demand, but unidentified automated fetchers can remain. Separately reported agent-discovery observations begin at their own declared baseline and are user-agent-declared crawler or indexer fetches of known discovery and paid routes; SameDayDesk-owned monitor user agents are excluded, and the remainder are neither authenticated catalog referrals nor buyer intent. Unmatched requests are acquisition misses, not intents. Known MCP transport probes and semantic-unmatched counts remain acquisition-friction evidence and do not become demand until an independent caller repeats or converts. Paid-success actors use a secret-keyed payer pseudonym when an x402 payload exposes a valid EVM payer, otherwise the network/user-agent pseudonym. Payment classes are applied against those pseudonyms at read time, so known marketplace verification can be reclassified without storing a raw address. Unknown payers remain unclassified. Protocol counts distinguish submitted x402 and MPP credentials plus protocols advertised by a 402; they do not expose credentials. Settlement-reference coverage begins only at its declared baseline; raw transaction references remain on the private volume and are not returned publicly. Idempotent replay successes are reported separately and do not create a second paid-success event. Counts are not public buyer identities or calibrated forecasts.",
    };
  }

  async function storageStatus() {
    try {
      await queue;
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      const [currentBytes, rotatedBytes] = await Promise.all([
        stat(currentPath).then((entry) => entry.size).catch(() => 0),
        stat(rotatedPath).then((entry) => entry.size).catch(() => 0),
      ]);
      return {
        ready: true,
        currentBytes,
        rotatedBytes,
        boundedBytes: maxBytes * 2,
      };
    } catch {
      return {
        ready: false,
        currentBytes: null,
        rotatedBytes: null,
        boundedBytes: maxBytes * 2,
      };
    }
  }

  return {
    middleware,
    snapshot,
    storageStatus,
    flush: () => queue,
    paths: { currentPath, rotatedPath },
  };
}
