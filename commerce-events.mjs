import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Credential } from "mppx";
import { classifyDiscoveryRequestConstruction } from "./discovery-contract.mjs";
import { isReceiptReferralId } from "./receipt-referral.mjs";

const CRAWLER_PATTERN = /bot|crawler|spider|slurp|uptime|monitor|observer|probe|indexer|headless|preview|liveness|healthcheck|sentineloracle|mcpbeat|agentreeve|agent402|trust[- ]?oracle/i;
const EXPLOIT_PROBE_PATH_PATTERN = /(?:^|\/)\.(?:env|git)(?:[./]|$)|^\/(?:wp-admin|wp-login\.php|wp-json|xmlrpc\.php)(?:\/|$)|^\/(?:api\/)?(?:config|env|settings)(?:[./]|$)|^\/js\/(?:config|env)\.js$/i;
const PAYMENT_HEADERS = ["payment-signature", "x-payment", "x-payment-signature"];
const PAYMENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const PAYMENT_CLASSES = new Set(["internal", "validation", "incentivized", "affiliated", "independent"]);
const SEMANTIC_UNMATCHED_ROUTE_PATTERN = /(?:morpho|liquidat|underwrit|protect|risk|readiness|audit|schema|enrich|extract|wallet|payment|settle|receipt|bount|opportunit|reputation|research|scan)/i;
const POLICY_CONTRACT_FUNNELS = Object.freeze({
  exactAction: Object.freeze({
    contractRoute: "/schemas/wallet-policy-conformance-v1.json",
    paidRoute: "/security/wallet-policy-conformance",
  }),
  stateful: Object.freeze({
    contractRoute: "/schemas/stateful-wallet-policy-conformance-v1.json",
    paidRoute: "/security/stateful-wallet-policy-conformance",
  }),
});
const OWNER_MONITOR_USER_AGENT_PATTERN = /^SameDayDesk(?:[- /]|[A-Z])/i;
const MCP_TRANSPORT_PROBE_ROUTES = new Set(["/mcp/sse", "/mcp/messages", "/mcp/tools", "/mcp/events"]);
// Every nested array is one required group; any key in that group satisfies it.
// Keep this map smaller than the route catalog and add only requirements proven
// by the first-party request handlers. Unknown routes remain explicit unknowns.
const REQUIRED_QUERY_KEY_GROUPS_BY_ROUTE = new Map([
  ["/extract", [["url"]]],
  ["/read", [["url"]]],
  ["/scan", [["repo"]]],
  ["/schemaforge", [["site"]]],
  ["/enrich", [["domain", "url"]]],
  ["/wallet-enrich", [["address", "wallet", "addr"]]],
  ["/deep-audit", [["domain", "url"]]],
  ["/defi/morpho-position", [["address", "wallet", "borrower"]]],
  ["/defi/morpho-protection", [["address", "wallet", "borrower"]]],
  ["/defi/morpho-market-underwrite", [["marketId", "market", "id"]]],
  ["/defi/morpho-preliquidation-replay", [["transactionHash", "tx", "hash"]]],
  ["/distribution/agent-discoverability-audit", [["origin"], ["intent"]]],
  ["/commerce/payment-offer-preflight", [["url"]]],
  ["/commerce/seller-integrity-audit", [["origin"], ["route"]]],
  ["/commerce/contract-qualified-search", [["query"], ["requiredPaths"]]],
  ["/distribution/agent-surface-budget-audit", [["origin"]]],
]);
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
  ["agentverse-a2a-v1", "agentverse"],
  ["aws-agentcore-v1", "aws-agentcore"],
  ["agentcash-v1", "agentcash"],
]);
const CANONICAL_AGENT_DISCOVERY_SOURCES = new Set([
  ...AGENT_DISCOVERY_SOURCE_PATTERNS.map(([source]) => source),
  ...DECLARED_AGENT_DISCOVERY_SOURCES.values(),
  "generic-agent-indexer",
  "declared-receipt-referral",
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
  ["/commerce/referral-recheck", { route: "/commerce/referral-recheck", kind: "excluded" }],
  ["/schemas/platform-health-card-v0.json", { route: "/schemas/platform-health-card-v0.json", kind: "discovery" }],
  ["/schemas/wallet-policy-conformance-v1.json", { route: "/schemas/wallet-policy-conformance-v1.json", kind: "discovery" }],
  ["/schemas/stateful-wallet-policy-conformance-v1.json", { route: "/schemas/stateful-wallet-policy-conformance-v1.json", kind: "discovery" }],
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
  ["/commerce/seller-integrity-audit", { route: "/commerce/seller-integrity-audit", kind: "paid" }],
  ["/commerce/contract-qualified-search", { route: "/commerce/contract-qualified-search", kind: "paid" }],
  ["/commerce/settlement-proof", { route: "/commerce/settlement-proof", kind: "paid" }],
  ["/chain/transaction-receipt", { route: "/chain/transaction-receipt", kind: "paid" }],
  ["/chain/solana-transaction-receipt", { route: "/chain/solana-transaction-receipt", kind: "paid" }],
  ["/security/wallet-policy-conformance", { route: "/security/wallet-policy-conformance", kind: "paid" }],
  ["/security/stateful-wallet-policy-conformance", { route: "/security/stateful-wallet-policy-conformance", kind: "paid" }],
  ["/gateway/commerce/payment-offer-preflight", { route: "/gateway/commerce/payment-offer-preflight", kind: "paid" }],
  ["/mcp", { route: "/mcp", kind: "paid" }],
]);

// Classifier-produced public route forms only. Unmatched traffic is stored as
// `/${safePathSegment}/*` or `/:opaque`, never as an arbitrary private path.
const CLASSIFIER_ROUTE_MAX_LENGTH = 64;
const CLASSIFIER_UNMATCHED_ROUTE_FORM = /^\/(?:[a-z][a-z0-9_-]{0,39}|:opaque)\/\*$/;
const CANONICAL_CLASSIFIER_ROUTES = new Set([
  ...[...EXACT_ROUTES.values()].map((entry) => entry.route),
  ...MCP_TRANSPORT_PROBE_ROUTES,
  "/platforms/:platformId",
  "/go/:offer",
  "/integrations/:private",
  "/:opaque",
]);
const CANONICAL_ROUTE_METADATA = new Map([
  ...[...EXACT_ROUTES.values()].map((entry) => [entry.route, { kind: entry.kind, matched: true }]),
  ...[...MCP_TRANSPORT_PROBE_ROUTES].map((route) => [route, { kind: "unmatched", matched: false }]),
  ["/platforms/:platformId", { kind: "discovery", matched: true }],
  ["/go/:offer", { kind: "referral", matched: true }],
  ["/integrations/:private", { kind: "excluded", matched: true }],
  ["/:opaque", { kind: "unmatched", matched: false }],
]);
const WRITER_QUERY_KEY_LIMIT = 20;
const WRITER_QUERY_KEY_MAX_LENGTH = 64;
const WRITER_EVENT_ID_MAX_LENGTH = 36;
const WRITER_ACTOR_KEY_MAX_LENGTH = 24;
const WRITER_ACTOR_KEY_PATTERN = /^[0-9a-f]{24}$/;
const WRITER_EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WRITER_HTTP_METHOD_MAX_LENGTH = 16;
const WRITER_SETTLEMENT_NETWORK_MAX_LENGTH = 100;
const WRITER_SETTLEMENT_CURRENCY_MAX_LENGTH = 200;
const WRITER_SETTLEMENT_AMOUNT_MAX_LENGTH = 78;
const PAID_EVIDENCE_REQUEST_DOMAIN = "samedaydesk.commerce-paid-success-evidence.request.v1\0";
const PAID_EVIDENCE_CREDENTIAL_DOMAIN = "samedaydesk.commerce-paid-success-evidence.credential.v1\0";
const PAID_EVIDENCE_RESPONSE_DOMAIN = "samedaydesk.commerce-paid-success-evidence.response.v1\0";
const PAID_EVIDENCE_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const PAID_EVIDENCE_RUNTIME_ATTRIBUTION = "http";
const PAID_EVIDENCE_VALIDATOR_VERDICT = "not_checked";
const PAID_EVIDENCE_VALIDATOR_AUTHORITY = "none";
const PAID_EVIDENCE_VALIDATOR_SOURCE = "http_runtime_not_checked";

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
  try {
    const value = headers?.[name];
    return Array.isArray(value) ? value.join(",") : String(value || "");
  } catch {
    return "";
  }
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

export function listDeclaredAgentDiscoverySources() {
  return [...DECLARED_AGENT_DISCOVERY_SOURCES].map(([value, source]) => ({ value, source }));
}

function hasMppAuthorization(headers) {
  return /(?:^|,)\s*Payment\s+[A-Za-z0-9_-]+/i.test(headerValue(headers, "authorization"));
}

function paymentProtocol(headers) {
  if (hasMppAuthorization(headers)) return "mpp";
  if (PAYMENT_HEADERS.some((name) => Boolean(headerValue(headers, name)))) return "x402";
  return null;
}

// The dual-stack runtime routes any present x402-family credential to the
// x402 middleware before considering MPP. Evidence must mirror that routing
// rule even though aggregate credential telemetry prefers a parseable MPP
// header over an unrelated malformed x402-family header.
function paidEvidencePaymentProtocol(headers) {
  if (PAYMENT_HEADERS.some((name) => Boolean(headerValue(headers, name)))) return "x402";
  if (hasMppAuthorization(headers)) return "mpp";
  return null;
}

function exactPaymentCredential(headers, protocol) {
  if (protocol === "mpp") {
    return Credential.extractPaymentScheme(headerValue(headers, "authorization"));
  }
  if (protocol === "x402") {
    return PAYMENT_HEADERS.map((name) => headerValue(headers, name)).find(Boolean) || null;
  }
  return null;
}

function runtimePaymentProtocol(res) {
  const protocol = res?.locals?.samedaydeskPayment?.protocol;
  return protocol === "x402" || protocol === "mpp" ? protocol : null;
}

function updateLengthFramed(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function paidEvidenceRequestDigest(method, target, rawBody) {
  const hash = createHash("sha256");
  hash.update(PAID_EVIDENCE_REQUEST_DOMAIN, "utf8");
  updateLengthFramed(hash, method);
  updateLengthFramed(hash, target);
  updateLengthFramed(hash, rawBody);
  return hash.digest("hex");
}

function paidEvidenceCredentialFingerprint(secret, credential) {
  const hmac = createHmac("sha256", secret);
  hmac.update(PAID_EVIDENCE_CREDENTIAL_DOMAIN, "utf8");
  updateLengthFramed(hmac, credential);
  return hmac.digest("hex");
}

function responseChunkBytes(chunk, encoding) {
  if (chunk === undefined || chunk === null) return null;
  if (typeof chunk === "string") {
    return Buffer.from(chunk, typeof encoding === "string" ? encoding : undefined);
  }
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return null;
}

function responseBodyIsTransferred(method, statusCode) {
  const status = Number(statusCode);
  return method !== "HEAD"
    && !(status >= 100 && status < 200)
    && status !== 204
    && status !== 304;
}

function capturePaidEvidenceResponseDigest(res, method) {
  const hash = createHash("sha256");
  hash.update(PAID_EVIDENCE_RESPONSE_DOMAIN, "utf8");
  let valid = true;
  let finalized = false;
  let endObserved = false;

  const observe = (chunk, encoding) => {
    if (chunk === undefined || chunk === null || typeof chunk === "function") return;
    try {
      const bytes = responseChunkBytes(chunk, encoding);
      if (!bytes) {
        valid = false;
        return;
      }
      if (responseBodyIsTransferred(method, res.statusCode)) hash.update(bytes);
    } catch {
      valid = false;
    }
  };

  let originalWrite = null;
  let originalEnd = null;
  try {
    if (typeof res.write === "function") {
      originalWrite = res.write;
      res.write = function paidEvidenceWrite(chunk, encoding) {
        observe(chunk, encoding);
        try {
          return Reflect.apply(originalWrite, this, arguments);
        } catch (error) {
          valid = false;
          throw error;
        }
      };
    }
    if (typeof res.end === "function") {
      originalEnd = res.end;
      res.end = function paidEvidenceEnd(chunk, encoding) {
        endObserved = true;
        observe(chunk, encoding);
        try {
          return Reflect.apply(originalEnd, this, arguments);
        } catch (error) {
          valid = false;
          throw error;
        }
      };
    }
  } catch {
    valid = false;
    try {
      if (originalWrite) res.write = originalWrite;
      if (originalEnd) res.end = originalEnd;
    } catch {
      // A hostile response object cannot produce paid evidence.
    }
  }

  return () => {
    if (finalized || !valid || !originalEnd || !endObserved) return null;
    finalized = true;
    try {
      return hash.digest("hex");
    } catch {
      return null;
    }
  };
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
        amountAtomic: boundedSettlementAmountAtomic(amount),
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

function boundedFailureText(value) {
  if (typeof value !== "string") return "";
  return value.slice(0, 1_000).toLowerCase();
}

const PAYMENT_FAILURE_CODE = Object.freeze({
  missingRequiredInput: "missing_required_input",
  extensionMismatch: "extension_mismatch",
  paymentTermsMismatch: "payment_terms_mismatch",
  signatureInvalid: "signature_invalid",
  paymentExpired: "payment_expired",
  paymentReplayRejected: "payment_replay_rejected",
  insufficientFunds: "insufficient_funds",
  paymentServiceUnavailable: "payment_service_unavailable",
  paymentVerificationFailed: "payment_verification_failed",
  requestBindingConflict: "request_binding_conflict",
  applicationValidationFailed: "application_validation_failed",
  unknownFailure: "unknown_failure",
});
const CANONICAL_PAYMENT_FAILURE_CODES = new Set(Object.values(PAYMENT_FAILURE_CODE));

export function classifyPaymentFailureCode({ route, status, queryKeys = [], error = "", problem = null } = {}) {
  const code = Number(status);
  if (!Number.isInteger(code) || code < 400) return null;
  const presentKeys = new Set(Array.isArray(queryKeys) ? queryKeys.filter((key) => typeof key === "string") : []);
  const requiredGroups = REQUIRED_QUERY_KEY_GROUPS_BY_ROUTE.get(String(route || "")) || [];
  if (requiredGroups.some((group) => !group.some((key) => presentKeys.has(key)))) {
    return PAYMENT_FAILURE_CODE.missingRequiredInput;
  }

  const problemRecord = problem && typeof problem === "object" && !Array.isArray(problem) ? problem : {};
  const text = [error, problemRecord.type, problemRecord.title, problemRecord.detail]
    .map(boundedFailureText)
    .filter(Boolean)
    .join(" ");
  if (/extension.*(?:echo|mismatch)|extension_echo_mismatch/.test(text)) return PAYMENT_FAILURE_CODE.extensionMismatch;
  if (/no matching payment requirements|requirements?.*mismatch|wrong (?:network|asset|amount|recipient|payto)/.test(text)) {
    return PAYMENT_FAILURE_CODE.paymentTermsMismatch;
  }
  if (/signature|authorization.*(?:invalid|mismatch)|invalid.*authorization/.test(text)) {
    return PAYMENT_FAILURE_CODE.signatureInvalid;
  }
  if (/expired|not valid yet/.test(text)) return PAYMENT_FAILURE_CODE.paymentExpired;
  if (/already (?:used|processed)|replay|nonce/.test(text)) return PAYMENT_FAILURE_CODE.paymentReplayRejected;
  if (/insufficient|balance|funds/.test(text)) return PAYMENT_FAILURE_CODE.insufficientFunds;
  if (
    code >= 500
    || /temporarily unavailable|timed? out|timeout|connection (?:refused|reset)|(?:facilitator|upstream).*\b5\d\d\b/.test(text)
  ) {
    return PAYMENT_FAILURE_CODE.paymentServiceUnavailable;
  }
  if (/verification|verify|invalid payment|invalid credential|paymentpayload.*invalid/.test(text) || code === 402) {
    return PAYMENT_FAILURE_CODE.paymentVerificationFailed;
  }
  if (/facilitator|upstream/.test(text)) return PAYMENT_FAILURE_CODE.paymentServiceUnavailable;
  if (code === 409) return PAYMENT_FAILURE_CODE.requestBindingConflict;
  if (code >= 400 && code < 500) return PAYMENT_FAILURE_CODE.applicationValidationFailed;
  return PAYMENT_FAILURE_CODE.unknownFailure;
}

function x402FailureError(res) {
  const encoded = res.getHeader?.("payment-required") || res.getHeader?.("x-payment-required");
  const candidate = Array.isArray(encoded) ? encoded[0] : encoded;
  if (typeof candidate !== "string" || !candidate || candidate.length > 131_072) return "";
  try {
    const decoded = JSON.parse(Buffer.from(candidate, "base64url").toString("utf8"));
    return boundedFailureText(decoded?.error);
  } catch {
    return "";
  }
}

function problemDetails(value) {
  let candidate = value;
  if (typeof value === "string" && value.length <= 16_384) {
    try { candidate = JSON.parse(value); } catch { return null; }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  return {
    type: boundedFailureText(candidate.type),
    title: boundedFailureText(candidate.title),
    detail: boundedFailureText(candidate.detail),
  };
}

export function isSemanticUnmatched(event) {
  return eventResult(event) === "unmatched"
    && String(event?.route || "") !== "/schemas/*"
    && (SEMANTIC_UNMATCHED_ROUTE_PATTERN.test(String(event?.route || ""))
      || MCP_TRANSPORT_PROBE_ROUTES.has(String(event?.route || "")));
}

function emptyCounts() {
  return Object.create(null);
}

function increment(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function summarizePolicyContractFunnels(events) {
  return Object.fromEntries(Object.entries(POLICY_CONTRACT_FUNNELS).map(([name, routes]) => {
    const firstReadByActor = new Map();
    let contractReads = 0;
    for (const event of events) {
      if (event.route !== routes.contractRoute || event.kind !== "discovery" || event.status < 200 || event.status >= 300) continue;
      contractReads += 1;
      const observedAt = Date.parse(event.ts);
      if (!Number.isFinite(observedAt)) continue;
      const prior = firstReadByActor.get(event.actor);
      if (!Number.isFinite(prior) || observedAt < prior) firstReadByActor.set(event.actor, observedAt);
    }
    const challenged = new Set();
    const credentialed = new Set();
    const delivered = new Set();
    for (const event of events) {
      const firstReadAt = firstReadByActor.get(event.actor);
      if (!Number.isFinite(firstReadAt) || event.route !== routes.paidRoute || Date.parse(event.ts) < firstReadAt) continue;
      const result = eventResult(event);
      if (result === "challenge") challenged.add(event.actor);
      if (event.paymentCredentialParsed === true) credentialed.add(event.actor);
      if (result === "paid_success") delivered.add(event.actor);
    }
    return [name, {
      contractRoute: routes.contractRoute,
      paidRoute: routes.paidRoute,
      contractReads,
      contractActors: firstReadByActor.size,
      challengeContinuationActors: challenged.size,
      credentialContinuationActors: credentialed.size,
      paidDeliveryContinuationActors: delivered.size,
    }];
  }));
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
    const events = [];
    const mcpTypedEvents = [];
    let unusableRecordCount = 0;
    let mcpTypedUnusableRecordCount = 0;
    for (const line of contents.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (isCanonicalCommerceEvent(parsed)) {
          events.push(parsed);
          continue;
        }
        if (isCanonicalMcpTypedCommerceEvent(parsed)) {
          mcpTypedEvents.push(parsed);
          continue;
        }
        unusableRecordCount += 1;
        if (declaresMcpTypedSource(parsed)) mcpTypedUnusableRecordCount += 1;
      } catch {
        unusableRecordCount += 1;
      }
    }
    return {
      events,
      mcpTypedEvents,
      unusableRecordCount,
      mcpTypedUnusableRecordCount,
      filePresent: true,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        events: [],
        mcpTypedEvents: [],
        unusableRecordCount: 0,
        mcpTypedUnusableRecordCount: 0,
        filePresent: false,
      };
    }
    throw error;
  }
}

export const COMMERCE_COVERAGE_COMPLETE = "complete";
export const COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW = "unknown_for_full_window";
export const COMMERCE_INTEGRITY_OK = "ok";
export const COMMERCE_INTEGRITY_UNUSABLE_RECORDS = "unusable_records_present";
export const COMMERCE_INTEGRITY_SOURCE_LOCAL_DRIFT = "source_local_integrity_drift";
const DAY_MS = 86_400_000;

const ISO_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CANONICAL_EVENT_ORIGIN_CLASSES = new Set([
  "internal",
  "scanner",
  "owner_monitor",
  "external",
  "crawler",
]);
const CANONICAL_EVENT_KINDS = new Set(["discovery", "referral", "paid", "unmatched", "excluded"]);
const CANONICAL_PAYMENT_PROTOCOLS = new Set(["x402", "mpp"]);
const CANONICAL_REQUEST_CONSTRUCTION = new Set([
  "undeclared",
  "not_measured",
  "constructed",
  "missing_required_input",
]);

function canonicalIsoTimestampMs(value) {
  if (typeof value !== "string" || value.length !== 24 || !ISO_UTC_TIMESTAMP.test(value)) return null;
  const parsed = new Date(value);
  const ms = parsed.getTime();
  if (!Number.isFinite(ms)) return null;
  if (parsed.toISOString() !== value) return null;
  return ms;
}

function eventTimestampMs(event) {
  return canonicalIsoTimestampMs(event?.ts);
}

function isBoundedString(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isBoundedNullableString(value, maxLength) {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function isCanonicalClassifierRoute(route, kind, matched) {
  if (typeof route !== "string" || route.length === 0 || route.length > CLASSIFIER_ROUTE_MAX_LENGTH) {
    return false;
  }
  if (CANONICAL_CLASSIFIER_ROUTES.has(route)) {
    const meta = CANONICAL_ROUTE_METADATA.get(route);
    return Boolean(meta) && meta.kind === kind && meta.matched === matched;
  }
  return CLASSIFIER_UNMATCHED_ROUTE_FORM.test(route)
    && kind === "unmatched"
    && matched === false;
}

function isCanonicalHttpMethod(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= WRITER_HTTP_METHOD_MAX_LENGTH
    && /^[A-Z][A-Z0-9-]*$/.test(value);
}

function isCanonicalQueryKeyName(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= WRITER_QUERY_KEY_MAX_LENGTH;
}

function isCanonicalQueryKeys(value) {
  if (!Array.isArray(value) || value.length > WRITER_QUERY_KEY_LIMIT) return false;
  const seen = new Set();
  for (const key of value) {
    if (!isCanonicalQueryKeyName(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function normalizeQueryKeyNames(query) {
  const accepted = [];
  const seen = new Set();
  for (const name of Object.keys(query || {})) {
    if (!isCanonicalQueryKeyName(name)) {
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    accepted.push(name);
  }
  accepted.sort();
  return accepted.slice(0, WRITER_QUERY_KEY_LIMIT);
}

function isCanonicalProtocolList(value) {
  if (!Array.isArray(value) || value.length > CANONICAL_PAYMENT_PROTOCOLS.size) return false;
  const seen = new Set();
  for (const item of value) {
    if (!CANONICAL_PAYMENT_PROTOCOLS.has(item) || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

function isCanonicalEventId(value) {
  return typeof value === "string"
    && value.length === WRITER_EVENT_ID_MAX_LENGTH
    && WRITER_EVENT_ID_PATTERN.test(value);
}

function isCanonicalActorKey(value) {
  return typeof value === "string"
    && value.length === WRITER_ACTOR_KEY_MAX_LENGTH
    && WRITER_ACTOR_KEY_PATTERN.test(value);
}

function isNullableCanonicalActorKey(value) {
  return value === null || isCanonicalActorKey(value);
}

function isCanonicalSettlementReference(value) {
  return value === null || TRANSACTION_HASH_PATTERN.test(value);
}

function isCanonicalSettlementAmount(value) {
  return value === null || (
    typeof value === "string"
    && value.length > 0
    && value.length <= WRITER_SETTLEMENT_AMOUNT_MAX_LENGTH
    && /^\d+$/.test(value)
  );
}

function boundedSettlementAmountAtomic(amount) {
  const text = String(amount ?? "");
  return /^\d+$/.test(text) && text.length <= WRITER_SETTLEMENT_AMOUNT_MAX_LENGTH
    ? text
    : null;
}

function isCanonicalPaymentFailureCode(value, { paymentPresent, status }) {
  if (!paymentPresent) return value === null;
  if (!Number.isInteger(status) || status < 400) return value === null;
  return CANONICAL_PAYMENT_FAILURE_CODES.has(value);
}

function isWriterMeasuredPaidGet(value) {
  return value.kind === "paid" && value.matched === true && value.method === "GET";
}

function isCanonicalRequestConstructionFields(value) {
  if (!CANONICAL_REQUEST_CONSTRUCTION.has(value.requestConstruction)) return false;
  const count = value.requestConstructionRequiredKeyCount;
  if (
    !Number.isInteger(count)
    || count < 0
    || count > WRITER_QUERY_KEY_LIMIT
    || !Number.isSafeInteger(count)
  ) {
    return false;
  }
  if (value.requestConstruction === "not_measured") return count === 0;
  if (!isWriterMeasuredPaidGet(value)) return false;
  const derived = classifyDiscoveryRequestConstruction(
    `GET ${value.route}`,
    Object.fromEntries(value.queryKeys.map((key) => [key, true])),
  );
  if (value.requestConstruction === "constructed") {
    return count === derived.requiredKeyCount
      && (
        derived.status === "constructed"
        || (
          derived.status === "missing_required_input"
          && value.queryKeys.length === WRITER_QUERY_KEY_LIMIT
        )
      );
  }
  return value.requestConstruction === derived.status && count === derived.requiredKeyCount;
}

function isCanonicalOriginCrossFields(value) {
  if (value.originClass === "crawler") {
    return value.agentDiscoverySource !== null && value.paymentPresent === false;
  }
  if (value.originClass === "external") {
    return value.paymentPresent === true || value.agentDiscoverySource === null;
  }
  return true;
}

function isCanonicalPaymentCrossFields(value) {
  if (typeof value.paymentPresent !== "boolean" || typeof value.paymentCredentialParsed !== "boolean") {
    return false;
  }
  if (value.paymentPresent) {
    if (!CANONICAL_PAYMENT_PROTOCOLS.has(value.paymentProtocol)) return false;
  } else if (
    value.paymentProtocol !== null
    || value.paymentCredentialParsed !== false
    || value.paymentActor !== null
    || value.paymentIdentifier !== null
  ) {
    return false;
  }
  if (!isNullableCanonicalActorKey(value.paymentActor) || !isNullableCanonicalActorKey(value.paymentIdentifier)) {
    return false;
  }
  if (value.paymentCredentialParsed) {
    if (value.paymentPresent !== true || !isCanonicalActorKey(value.paymentActor)) return false;
  } else if (value.paymentActor !== null || value.paymentIdentifier !== null) {
    return false;
  }
  if (value.paymentIdentifier !== null) {
    return value.paymentPresent === true
      && value.paymentProtocol === "x402"
      && value.paymentCredentialParsed === true
      && isCanonicalActorKey(value.paymentActor);
  }
  return true;
}

function isCanonicalCommerceEvent(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.v !== 3) return false;
  if (eventTimestampMs(value) === null) return false;
  if (!isCanonicalEventId(value.id) || !isCanonicalActorKey(value.actor)) return false;
  if (!CANONICAL_EVENT_ORIGIN_CLASSES.has(value.originClass)) return false;
  if (value.agentDiscoverySource !== null && !CANONICAL_AGENT_DISCOVERY_SOURCES.has(value.agentDiscoverySource)) {
    return false;
  }
  if (!isCanonicalHttpMethod(value.method)) return false;
  if (!CANONICAL_EVENT_KINDS.has(value.kind) || typeof value.matched !== "boolean") return false;
  if (!isCanonicalClassifierRoute(value.route, value.kind, value.matched)) return false;
  if (!isCanonicalQueryKeys(value.queryKeys)) return false;
  if (!isCanonicalRequestConstructionFields(value)) return false;
  if (!isCanonicalPaymentCrossFields(value)) return false;
  if (!isCanonicalOriginCrossFields(value)) return false;
  if (!Number.isInteger(value.status) || value.status < 100 || value.status > 999) return false;
  if (!isCanonicalPaymentFailureCode(value.paymentFailureCode, {
    paymentPresent: value.paymentPresent,
    status: value.status,
  })) {
    return false;
  }
  if (!isCanonicalProtocolList(value.protocolsOffered)) return false;
  if (typeof value.replayed !== "boolean") return false;
  if (!isCanonicalSettlementReference(value.settlementReference)) return false;
  if (!isCanonicalSettlementAmount(value.settlementAmountAtomic)) return false;
  if (!isBoundedNullableString(value.settlementNetwork, WRITER_SETTLEMENT_NETWORK_MAX_LENGTH)) return false;
  if (!isBoundedNullableString(value.settlementCurrency, WRITER_SETTLEMENT_CURRENCY_MAX_LENGTH)) return false;
  if (
    value.settlementReference === null
    && (
      value.settlementAmountAtomic !== null
      || value.settlementNetwork !== null
      || value.settlementCurrency !== null
    )
  ) {
    return false;
  }
  if (!isBoundedString(value.result, 32)) return false;
  if (!Number.isInteger(value.durationMs) || value.durationMs < 0) return false;
  return value.result === eventResult(value);
}

const PAID_SUCCESS_EVIDENCE_KEYS = Object.freeze([
  "credentialFingerprint",
  "id",
  "method",
  "originClass",
  "payerClass",
  "paymentProtocol",
  "requestDigest",
  "requestStartedAt",
  "responseDigest",
  "responseFinishedAt",
  "route",
  "runtimeAttribution",
  "settlementReference",
  "source",
  "v",
  "validatorAuthority",
  "validatorSource",
  "validatorVerdict",
]);

function isCanonicalPaidSuccessEvidence(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== PAID_SUCCESS_EVIDENCE_KEYS.length
    || keys.some((key, index) => key !== PAID_SUCCESS_EVIDENCE_KEYS[index])
  ) {
    return false;
  }
  if (value.v !== 1 || !isCanonicalEventId(value.id)) return false;
  const startedAtMs = canonicalIsoTimestampMs(value.requestStartedAt);
  const finishedAtMs = canonicalIsoTimestampMs(value.responseFinishedAt);
  if (startedAtMs === null || finishedAtMs === null || finishedAtMs < startedAtMs) return false;
  if (!isCanonicalHttpMethod(value.method)) return false;
  if (!isCanonicalClassifierRoute(value.route, "paid", true)) return false;
  if (!CANONICAL_EVENT_ORIGIN_CLASSES.has(value.originClass)) return false;
  if (
    value.source !== "direct-or-unattributed"
    && !CANONICAL_AGENT_DISCOVERY_SOURCES.has(value.source)
  ) {
    return false;
  }
  if (value.payerClass !== "unclassified" && !PAYMENT_CLASSES.has(value.payerClass)) return false;
  if (!PAID_EVIDENCE_DIGEST_PATTERN.test(value.requestDigest)) return false;
  if (!PAID_EVIDENCE_DIGEST_PATTERN.test(value.credentialFingerprint)) return false;
  if (!PAID_EVIDENCE_DIGEST_PATTERN.test(value.responseDigest)) return false;
  if (!isCanonicalSettlementReference(value.settlementReference)) return false;
  if (!CANONICAL_PAYMENT_PROTOCOLS.has(value.paymentProtocol)) return false;
  return value.runtimeAttribution === PAID_EVIDENCE_RUNTIME_ATTRIBUTION
    && value.validatorVerdict === PAID_EVIDENCE_VALIDATOR_VERDICT
    && value.validatorAuthority === PAID_EVIDENCE_VALIDATOR_AUTHORITY
    && value.validatorSource === PAID_EVIDENCE_VALIDATOR_SOURCE;
}

function canonicalPaidSuccessEvidence(value) {
  try {
    const canonical = {
      v: value?.v,
      id: value?.id,
      requestStartedAt: value?.requestStartedAt,
      responseFinishedAt: value?.responseFinishedAt,
      method: value?.method,
      route: value?.route,
      originClass: value?.originClass,
      source: value?.source,
      payerClass: value?.payerClass,
      requestDigest: value?.requestDigest,
      credentialFingerprint: value?.credentialFingerprint,
      responseDigest: value?.responseDigest,
      settlementReference: value?.settlementReference,
      paymentProtocol: value?.paymentProtocol,
      runtimeAttribution: value?.runtimeAttribution,
      validatorVerdict: value?.validatorVerdict,
      validatorAuthority: value?.validatorAuthority,
      validatorSource: value?.validatorSource,
    };
    return isCanonicalPaidSuccessEvidence(canonical) ? Object.freeze(canonical) : null;
  } catch {
    return null;
  }
}

const MCP_TYPED_COMMERCE_SOURCE = "mcp_typed_outcome";
const MCP_TYPED_COMMERCE_AUTHORITY = "seller_declared";
const MCP_TYPED_COMMERCE_EVIDENCE_CLASS = "seller_operational";
const MCP_TYPED_ATTRIBUTION_SCHEMA = "samedaydesk.mcp-request-attribution.v1";
const MCP_TYPED_ATTRIBUTION_MARKER_DOMAIN = "samedaydesk.mcp-request-attribution-marker.v1\0";
const MCP_TYPED_ATTRIBUTION_PROOF_DOMAIN = "samedaydesk.mcp-request-attribution-proof.v1\0";
const MCP_TYPED_ATTRIBUTION_MARKER_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/u;
const MCP_TYPED_ATTRIBUTION_KEYS = Object.freeze([
  "classification",
  "evidence",
  "markerDigest",
  "schemaVersion",
]);
const MCP_TYPED_ATTESTED_ATTRIBUTION_KEYS = Object.freeze([
  ...MCP_TYPED_ATTRIBUTION_KEYS,
  "proof",
]);
const MCP_TYPED_COMMERCE_KEYS = Object.freeze([
  "accounting",
  "action",
  "applicationOutcome",
  "authority",
  "binding",
  "chainTruth",
  "demand",
  "evidenceClass",
  "handlerInvoked",
  "id",
  "independentUse",
  "payerIdentity",
  "paymentCredentialParsed",
  "paymentPresent",
  "reason",
  "result",
  "revenue",
  "settlementState",
  "sourceContract",
  "ts",
  "v",
]);
const MCP_TYPED_ATTRIBUTED_COMMERCE_KEYS = Object.freeze([
  ...MCP_TYPED_COMMERCE_KEYS,
  "requestAttribution",
]);
const MCP_TYPED_HEX = /^[0-9a-f]{64}$/u;
const MCP_TYPED_TOKEN = /^[a-z][a-z0-9_]{0,63}$/u;
const MCP_TYPED_SKU = /^[a-z][a-z0-9-]{0,95}$/u;
const MCP_TYPED_CLOSED_TOOLS = Object.freeze(new Set([
  "agent_discoverability_audit",
  "agent_surface_budget_audit",
  "contract_qualified_search",
  "deep_audit",
  "enrich",
  "extract",
  "morpho_market_underwrite",
  "morpho_position",
  "morpho_preliquidation_replay",
  "morpho_protection",
  "opportunity_preflight",
  "payment_offer_preflight",
  "read",
  "scan",
  "schemaforge",
  "seller_integrity_audit",
  "settlement_proof",
  "solana_transaction_receipt",
  "stateful_wallet_policy_conformance",
  "transaction_receipt",
  "wallet_enrich",
  "wallet_policy_conformance",
]));
const MCP_TYPED_ACTIONS = new Set(["drop", "emit"]);
const MCP_TYPED_RESULTS = new Set([
  "application_failure",
  "challenge",
  "invalid",
  "paid_success",
  "protocol_discovery",
  "replay_success",
  "settlement_failure",
  "telemetry_incomplete",
]);
const MCP_TYPED_REASONS = new Set([
  "invalid_catalog_binding",
  "invalid_notification_state",
  "invalid_typed_outcome",
  "issued_offer_binding_mismatch",
  "jsonrpc_notification",
  "request_response_id_mismatch",
  "settlement_outcome_unknown",
  "typed_application_failure",
  "typed_paid_success",
  "typed_payment_required",
  "typed_replay_success",
  "typed_settlement_failure",
  "verified_without_execution",
]);
const MCP_TYPED_APPLICATION = new Set(["error", "not_run", "replay", "success"]);
const MCP_TYPED_SETTLEMENT = new Set(["failed", "not_attempted", "succeeded", "unknown"]);
const MCP_TYPED_DROP_REASONS = new Set([
  "invalid_catalog_binding",
  "invalid_notification_state",
  "invalid_typed_outcome",
  "issued_offer_binding_mismatch",
  "request_response_id_mismatch",
]);

function exactObjectKeys(value, keys) {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

export function digestMcpTypedAttributionMarker(marker) {
  if (typeof marker !== "string" || !MCP_TYPED_ATTRIBUTION_MARKER_PATTERN.test(marker)) return null;
  return createHash("sha256")
    .update(MCP_TYPED_ATTRIBUTION_MARKER_DOMAIN)
    .update(marker)
    .digest("hex");
}

function canonicalMcpTypedAttribution(value) {
  if (!exactObjectKeys(value, MCP_TYPED_ATTRIBUTION_KEYS)) return null;
  if (value.schemaVersion !== MCP_TYPED_ATTRIBUTION_SCHEMA) return null;
  if (value.classification !== "validation") return null;
  if (value.evidence !== "internal_token") return null;
  if (!MCP_TYPED_HEX.test(value.markerDigest)) return null;
  return {
    schemaVersion: MCP_TYPED_ATTRIBUTION_SCHEMA,
    classification: "validation",
    evidence: "internal_token",
    markerDigest: value.markerDigest,
  };
}

function mcpTypedAttributionProof(value, secret) {
  return createHmac("sha256", secret)
    .update(MCP_TYPED_ATTRIBUTION_PROOF_DOMAIN)
    .update(value.schemaVersion)
    .update("\0")
    .update(value.classification)
    .update("\0")
    .update(value.evidence)
    .update("\0")
    .update(value.markerDigest)
    .digest("hex");
}

function verifyMcpTypedAttribution(value, secret) {
  if (!exactObjectKeys(value, MCP_TYPED_ATTESTED_ATTRIBUTION_KEYS)) return null;
  const canonical = canonicalMcpTypedAttribution({
    schemaVersion: value.schemaVersion,
    classification: value.classification,
    evidence: value.evidence,
    markerDigest: value.markerDigest,
  });
  if (!canonical || !MCP_TYPED_HEX.test(value.proof)) return null;
  if (!safeEqual(value.proof, mcpTypedAttributionProof(canonical, secret))) return null;
  return canonical;
}

function isCanonicalMcpTypedAttribution(value) {
  return canonicalMcpTypedAttribution(value) !== null;
}

function isClosedMcpTypedBinding(binding) {
  if (!exactObjectKeys(binding, ["issuedOfferDigest", "productSku", "resource", "tool"])) return false;
  if (!MCP_TYPED_TOKEN.test(binding.tool) || !MCP_TYPED_CLOSED_TOOLS.has(binding.tool)) return false;
  if (!MCP_TYPED_SKU.test(binding.productSku)) return false;
  if (binding.productSku !== `samedaydesk-${binding.tool.replaceAll("_", "-")}`) return false;
  if (binding.resource !== `mcp://tool/${binding.tool}`) return false;
  return MCP_TYPED_HEX.test(binding.issuedOfferDigest);
}

function isNullMcpTypedBinding(binding) {
  return exactObjectKeys(binding, ["issuedOfferDigest", "productSku", "resource", "tool"])
    && binding.issuedOfferDigest === null
    && binding.productSku === null
    && binding.resource === null
    && binding.tool === null;
}

function isStoredMcpTypedDecisionFields(value) {
  if (!MCP_TYPED_ACTIONS.has(value.action)) return false;
  if (!MCP_TYPED_RESULTS.has(value.result)) return false;
  if (!MCP_TYPED_REASONS.has(value.reason)) return false;
  if (!MCP_TYPED_APPLICATION.has(value.applicationOutcome)) return false;
  if (!MCP_TYPED_SETTLEMENT.has(value.settlementState)) return false;
  if (typeof value.paymentPresent !== "boolean") return false;
  if (typeof value.paymentCredentialParsed !== "boolean") return false;
  if (typeof value.handlerInvoked !== "boolean") return false;
  if (value.action === "drop") {
    return value.result === "invalid"
      && MCP_TYPED_DROP_REASONS.has(value.reason)
      && value.paymentPresent === false
      && value.paymentCredentialParsed === false
      && value.handlerInvoked === false
      && value.applicationOutcome === "not_run"
      && value.settlementState === "not_attempted"
      && isNullMcpTypedBinding(value.binding);
  }
  if (value.action !== "emit" || value.result === "invalid") return false;
  if (!isClosedMcpTypedBinding(value.binding)) return false;
  if (value.result === "paid_success") {
    return value.reason === "typed_paid_success"
      && value.applicationOutcome === "success"
      && value.handlerInvoked === true
      && value.paymentPresent === true
      && value.paymentCredentialParsed === true
      && value.settlementState === "succeeded";
  }
  if (value.result === "challenge") {
    return value.reason === "typed_payment_required"
      && value.applicationOutcome === "not_run"
      && value.handlerInvoked === false
      && value.paymentCredentialParsed === false
      && value.settlementState === "not_attempted"
      && (value.paymentPresent === true || value.paymentPresent === false);
  }
  if (value.result === "application_failure") {
    return value.reason === "typed_application_failure"
      && value.applicationOutcome === "error"
      && value.handlerInvoked === true
      && value.paymentPresent === true
      && value.paymentCredentialParsed === true;
  }
  if (value.result === "protocol_discovery") {
    return value.reason === "jsonrpc_notification"
      && value.applicationOutcome === "not_run"
      && value.handlerInvoked === false
      && value.paymentPresent === false
      && value.paymentCredentialParsed === false
      && value.settlementState === "not_attempted";
  }
  if (value.result === "replay_success") {
    return value.reason === "typed_replay_success"
      && value.applicationOutcome === "replay"
      && value.handlerInvoked === false
      && value.paymentPresent === true
      && value.paymentCredentialParsed === true
      && value.settlementState === "succeeded";
  }
  if (value.result === "settlement_failure") {
    return value.reason === "typed_settlement_failure"
      && value.applicationOutcome === "success"
      && value.handlerInvoked === true
      && value.paymentPresent === true
      && value.paymentCredentialParsed === true
      && value.settlementState === "failed";
  }
  if (value.result === "telemetry_incomplete") {
    return (
      (value.reason === "verified_without_execution"
        && value.handlerInvoked === false
        && value.applicationOutcome === "not_run"
        && value.settlementState === "not_attempted")
      || (value.reason === "settlement_outcome_unknown"
        && value.handlerInvoked === true
        && value.applicationOutcome === "success"
        && value.settlementState === "unknown")
    ) && value.paymentPresent === true && value.paymentCredentialParsed === true;
  }
  return false;
}

function declaresMcpTypedSource(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && value.v === 4
    && value.sourceContract === MCP_TYPED_COMMERCE_SOURCE,
  );
}

export function isCanonicalMcpTypedCommerceEvent(value) {
  const legacy = exactObjectKeys(value, MCP_TYPED_COMMERCE_KEYS);
  const attributed = exactObjectKeys(value, MCP_TYPED_ATTRIBUTED_COMMERCE_KEYS);
  if (!legacy && !attributed) return false;
  if (value.v !== 4) return false;
  if (value.sourceContract !== MCP_TYPED_COMMERCE_SOURCE) return false;
  if (eventTimestampMs(value) === null) return false;
  if (!isCanonicalEventId(value.id)) return false;
  if (value.authority !== MCP_TYPED_COMMERCE_AUTHORITY) return false;
  if (value.evidenceClass !== MCP_TYPED_COMMERCE_EVIDENCE_CLASS) return false;
  if (value.accounting !== false) return false;
  if (value.revenue !== false) return false;
  if (value.demand !== false) return false;
  if (value.independentUse !== false) return false;
  if (value.chainTruth !== false) return false;
  if (value.payerIdentity !== false) return false;
  if (attributed && !isCanonicalMcpTypedAttribution(value.requestAttribution)) return false;
  return isStoredMcpTypedDecisionFields(value);
}

export function adaptMcpTypedDecisionToCommerceEvent(decision, { id, ts } = {}) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return null;
  const event = {
    v: 4,
    sourceContract: MCP_TYPED_COMMERCE_SOURCE,
    id: id ?? randomUUID(),
    ts: ts ?? new Date().toISOString(),
    authority: MCP_TYPED_COMMERCE_AUTHORITY,
    evidenceClass: MCP_TYPED_COMMERCE_EVIDENCE_CLASS,
    accounting: false,
    revenue: false,
    demand: false,
    independentUse: false,
    chainTruth: false,
    payerIdentity: false,
    action: decision.action,
    result: decision.result,
    reason: decision.reason,
    paymentPresent: decision.paymentPresent,
    paymentCredentialParsed: decision.paymentCredentialParsed,
    handlerInvoked: decision.handlerInvoked,
    applicationOutcome: decision.applicationOutcome,
    settlementState: decision.settlementState,
    binding: decision.binding && typeof decision.binding === "object"
      ? {
        tool: decision.binding.tool,
        productSku: decision.binding.productSku,
        resource: decision.binding.resource,
        issuedOfferDigest: decision.binding.issuedOfferDigest,
      }
      : null,
  };
  return isCanonicalMcpTypedCommerceEvent(event) ? event : null;
}

function summarizeMcpTypedView(events) {
  const byResult = Object.create(null);
  const byTool = Object.create(null);
  const byReason = Object.create(null);
  for (const event of events) {
    const result = typeof event.result === "string" ? event.result : "invalid";
    byResult[result] = (byResult[result] || 0) + 1;
    const reason = typeof event.reason === "string" ? event.reason : "invalid_typed_outcome";
    byReason[reason] = (byReason[reason] || 0) + 1;
    const tool = event.binding?.tool;
    if (typeof tool === "string" && tool.length > 0) {
      byTool[tool] = (byTool[tool] || 0) + 1;
    }
  }
  return {
    sourceContract: MCP_TYPED_COMMERCE_SOURCE,
    schemaVersion: 4,
    parseableRecordCount: events.length,
    byResult,
    byTool,
    byReason,
    policy: "Seller-declared typed MCP outcomes from the mounted producer. Not payer identity, chain truth, accounting, revenue, demand, or independent use.",
  };
}

function typedTimestampBounds(events) {
  let startMs = null;
  let startTs = null;
  let endMs = null;
  let endTs = null;
  for (const event of events) {
    const ms = eventTimestampMs(event);
    if (ms === null) continue;
    if (startMs === null || ms < startMs) {
      startMs = ms;
      startTs = event.ts;
    }
    if (endMs === null || ms > endMs) {
      endMs = ms;
      endTs = event.ts;
    }
  }
  return { startMs, startTs, endMs, endTs };
}

function typedFreshnessView({ latestTs, latestMs, generatedAtMs, maxAgeMs }) {
  if (latestTs === null || latestMs === null) {
    return {
      latestObservationAt: null,
      ageMs: 0,
      maxAgeMs,
      status: "no_observations",
    };
  }
  const ageMs = Math.max(0, generatedAtMs - latestMs);
  return {
    latestObservationAt: latestTs,
    ageMs,
    maxAgeMs,
    status: ageMs <= maxAgeMs ? "fresh" : "stale",
  };
}

function describeMcpTypedSourceCoverage({
  generatedAtMs,
  requestedWindowDays,
  retainedTypedEvents,
  currentRead,
  rotatedRead,
  mcpTypedSinceMs,
  mcpTypedFreshnessMaxAgeMs,
} = {}) {
  const safeDays = Math.max(1, Math.min(365, Number(requestedWindowDays) || 90));
  const requestedWindowStartMs = generatedAtMs - safeDays * DAY_MS;
  const eligibleTypedEvents = [];
  let futureTypedCount = 0;
  for (const event of retainedTypedEvents || []) {
    const ms = eventTimestampMs(event);
    if (ms === null) continue;
    if (ms > generatedAtMs) {
      futureTypedCount += 1;
      continue;
    }
    eligibleTypedEvents.push(event);
  }
  const bounds = typedTimestampBounds(eligibleTypedEvents);
  const typedUnusable = (currentRead?.mcpTypedUnusableRecordCount || 0)
    + (rotatedRead?.mcpTypedUnusableRecordCount || 0);
  const integrityStatus = typedUnusable > 0
    ? COMMERCE_INTEGRITY_UNUSABLE_RECORDS
    : futureTypedCount > 0
      ? COMMERCE_INTEGRITY_SOURCE_LOCAL_DRIFT
      : COMMERCE_INTEGRITY_OK;
  const baselineDeclaredAtOrBeforeStart = Number.isFinite(mcpTypedSinceMs)
    && mcpTypedSinceMs <= requestedWindowStartMs;
  const evidenceReachesRequestedStart = bounds.startMs !== null
    && bounds.startMs <= requestedWindowStartMs;
  const complete = integrityStatus === COMMERCE_INTEGRITY_OK
    && baselineDeclaredAtOrBeforeStart
    && evidenceReachesRequestedStart;
  return {
    requestedWindowStart: new Date(requestedWindowStartMs).toISOString(),
    requestedWindowEnd: new Date(generatedAtMs).toISOString(),
    retainedObservationStart: bounds.startTs,
    retainedObservationEnd: bounds.endTs,
    requestedWindowComplete: complete,
    requestedWindowCoverage: complete
      ? COMMERCE_COVERAGE_COMPLETE
      : COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW,
    freshness: typedFreshnessView({
      latestTs: bounds.endTs,
      latestMs: bounds.endMs,
      generatedAtMs,
      maxAgeMs: mcpTypedFreshnessMaxAgeMs,
    }),
    integrity: {
      status: integrityStatus,
      currentFile: {
        filePresent: currentRead?.filePresent === true,
        parseableRecordCount: currentRead?.mcpTypedEvents?.length || 0,
        unusableRecordCount: currentRead?.mcpTypedUnusableRecordCount || 0,
      },
      rotatedFile: {
        filePresent: rotatedRead?.filePresent === true,
        parseableRecordCount: rotatedRead?.mcpTypedEvents?.length || 0,
        unusableRecordCount: rotatedRead?.mcpTypedUnusableRecordCount || 0,
      },
    },
  };
}

function utcDayStartMs(ms) {
  return Date.parse(`${new Date(ms).toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function finiteMs(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

function maxDefinedMs(...values) {
  const numbers = values.map(finiteMs).filter((value) => value !== null);
  return numbers.length ? Math.max(...numbers) : null;
}

function parseBaselineSpec(value) {
  if (value === null || value === undefined) {
    return { declaredMs: null, cutoffMs: null, components: null };
  }
  if (typeof value === "number") {
    return { declaredMs: finiteMs(value), cutoffMs: null, components: null };
  }
  if (typeof value === "object") {
    const components = value.components && typeof value.components === "object" && !Array.isArray(value.components)
      ? value.components
      : null;
    return {
      declaredMs: finiteMs(value.declaredMs ?? value.baselineMs),
      cutoffMs: finiteMs(value.cutoffMs),
      components,
    };
  }
  return { declaredMs: null, cutoffMs: null, components: null };
}

function metricCoverageView(status, declaredMs, extra = {}) {
  return {
    baseline: declaredMs === null ? null : new Date(declaredMs).toISOString(),
    observationStart: status.observationStart,
    complete: status.complete,
    coverage: status.coverage,
    ...extra,
  };
}

function componentCoverageViews(componentsSpec, context) {
  if (!componentsSpec) return null;
  const components = Object.create(null);
  for (const [name, spec] of Object.entries(componentsSpec)) {
    const parsed = parseBaselineSpec(spec);
    components[name] = metricCoverageView(
      metricCoverageStatus({
        ...context,
        baselineMs: parsed.declaredMs,
        cutoffMs: parsed.cutoffMs,
      }),
      parsed.declaredMs,
    );
  }
  return components;
}

function mixedMetricCoverageView({ status, declaredMs, components, integrityOk }) {
  const view = metricCoverageView(status, declaredMs);
  if (!components) return view;
  const componentList = Object.values(components);
  const observationStarts = new Set(componentList.map((component) => component.observationStart));
  const allComplete = integrityOk === true
    && componentList.every((component) => component.complete === true);
  if (!allComplete || observationStarts.size !== 1) {
    view.complete = false;
    view.coverage = COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW;
  }
  view.components = components;
  return view;
}

function fileIntegrityView({ filePresent, parseableRecordCount, unusableRecordCount }) {
  return {
    present: filePresent === true,
    parseableRecordCount: Number(parseableRecordCount) || 0,
    unusableRecordCount: Number(unusableRecordCount) || 0,
  };
}

export function conservativeRetainedUtcBounds({
  retainedObservationStartMs,
  retainedObservationEndMs,
} = {}) {
  if (!Number.isFinite(retainedObservationStartMs) || !Number.isFinite(retainedObservationEndMs)) {
    return {
      retainedObservationStartUtcDay: null,
      retainedObservationEndUtcDay: null,
      retainedDurationWholeDays: null,
    };
  }
  const startDayStartMs = utcDayStartMs(retainedObservationStartMs);
  const firstCompleteDayStartMs = retainedObservationStartMs === startDayStartMs
    ? startDayStartMs
    : startDayStartMs + DAY_MS;
  const endDayStartMs = utcDayStartMs(retainedObservationEndMs);
  const lastCompleteDayStartMs = endDayStartMs - DAY_MS;
  if (firstCompleteDayStartMs > lastCompleteDayStartMs) {
    return {
      retainedObservationStartUtcDay: null,
      retainedObservationEndUtcDay: null,
      retainedDurationWholeDays: 0,
    };
  }
  return {
    retainedObservationStartUtcDay: new Date(firstCompleteDayStartMs).toISOString().slice(0, 10),
    retainedObservationEndUtcDay: new Date(lastCompleteDayStartMs).toISOString().slice(0, 10),
    retainedDurationWholeDays: Math.floor((lastCompleteDayStartMs - firstCompleteDayStartMs) / DAY_MS) + 1,
  };
}

export function metricCoverageStatus({
  generatedAtMs,
  requestedWindowStartMs,
  retainedObservationStartMs,
  baselineMs = null,
  cutoffMs = null,
  integrityOk = true,
} = {}) {
  const observationStartMs = maxDefinedMs(requestedWindowStartMs, baselineMs, cutoffMs);
  const observationStart = new Date(observationStartMs).toISOString();
  if (!integrityOk) {
    return {
      complete: false,
      coverage: COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW,
      observationStart,
    };
  }
  if (observationStartMs > generatedAtMs) {
    return {
      complete: true,
      coverage: COMMERCE_COVERAGE_COMPLETE,
      observationStart,
    };
  }
  if (retainedObservationStartMs === null || retainedObservationStartMs === undefined) {
    return {
      complete: false,
      coverage: COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW,
      observationStart,
    };
  }
  const complete = retainedObservationStartMs <= observationStartMs;
  return {
    complete,
    coverage: complete ? COMMERCE_COVERAGE_COMPLETE : COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW,
    observationStart,
  };
}

export function describeRetentionCoverage({
  generatedAtMs,
  requestedWindowDays,
  retainedObservationStartMs,
  retainedObservationEndMs,
  retainedParseableEventCount = 0,
  baselines = {},
  integrity = {},
} = {}) {
  const safeDays = Math.max(1, Math.min(365, Number(requestedWindowDays) || 90));
  const requestedWindowStartMs = generatedAtMs - safeDays * DAY_MS;
  const currentFile = fileIntegrityView(integrity.currentFile || {});
  const rotatedFile = fileIntegrityView(integrity.rotatedFile || {});
  const integrityStatus = currentFile.unusableRecordCount > 0 || rotatedFile.unusableRecordCount > 0
    ? COMMERCE_INTEGRITY_UNUSABLE_RECORDS
    : COMMERCE_INTEGRITY_OK;
  const integrityOk = integrityStatus === COMMERCE_INTEGRITY_OK;
  const requested = metricCoverageStatus({
    generatedAtMs,
    requestedWindowStartMs,
    retainedObservationStartMs,
    baselineMs: null,
    integrityOk,
  });
  const metrics = Object.create(null);
  const metricContext = {
    generatedAtMs,
    requestedWindowStartMs,
    retainedObservationStartMs,
    integrityOk,
  };
  for (const [name, spec] of Object.entries(baselines)) {
    const { declaredMs, cutoffMs, components: componentsSpec } = parseBaselineSpec(spec);
    const status = metricCoverageStatus({
      ...metricContext,
      baselineMs: declaredMs,
      cutoffMs,
    });
    metrics[name] = mixedMetricCoverageView({
      status,
      declaredMs,
      components: componentCoverageViews(componentsSpec, metricContext),
      integrityOk,
    });
  }
  const coarse = conservativeRetainedUtcBounds({
    retainedObservationStartMs,
    retainedObservationEndMs,
  });
  return {
    requestedWindowDays: safeDays,
    requestedWindowStart: new Date(requestedWindowStartMs).toISOString(),
    requestedWindowEnd: new Date(generatedAtMs).toISOString(),
    requestedWindowComplete: requested.complete,
    requestedWindowCoverage: requested.coverage,
    retainedParseableEventCount,
    integrityStatus,
    integrity: {
      status: integrityStatus,
      currentFile,
      rotatedFile,
    },
    ...coarse,
    metrics,
  };
}

export async function drainCommerceTelemetryForShutdown({
  typedTelemetryLifecycle = null,
  commerceTelemetry,
  timeoutMs,
} = {}) {
  if (typedTelemetryLifecycle != null) {
    if (typeof typedTelemetryLifecycle.shutdown !== "function") {
      throw new Error("typed telemetry lifecycle shutdown is required");
    }
    const state = await typedTelemetryLifecycle.shutdown({ timeoutMs });
    if (state?.drained !== true || state?.pending !== 0) {
      throw new Error("typed telemetry lifecycle did not drain");
    }
  }
  if (typeof commerceTelemetry?.flush !== "function") {
    throw new Error("commerce telemetry writer flush is required");
  }
  await commerceTelemetry.flush();
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
  requestConstructionSince = process.env.COMMERCE_REQUEST_CONSTRUCTION_SINCE || "2026-08-13T16:25:03.766Z",
  payerClasses = process.env.COMMERCE_PAYER_CLASSES || "",
  maxBytes = 5 * 1024 * 1024,
  writerProcessCount = 1,
  mcpTypedSince = process.env.COMMERCE_MCP_TYPED_SINCE || "",
  mcpTypedFreshnessMaxAgeMs = 900_000,
} = {}) {
  if (!Number.isSafeInteger(writerProcessCount) || writerProcessCount !== 1) {
    throw new Error("commerce telemetry supports exactly one writer process; writerProcessCount must be the safe integer 1 until cross-process coordination exists");
  }
  const typedFreshnessMaxAgeMs = Number.isSafeInteger(mcpTypedFreshnessMaxAgeMs) && mcpTypedFreshnessMaxAgeMs >= 0
    ? mcpTypedFreshnessMaxAgeMs
    : 900_000;
  const writerGate = Object.freeze({
    mode: "single_process_only",
    configuredProcesses: 1,
    crossProcessSafe: false,
  });
  const currentPath = path.join(dataDir, "commerce-events.ndjson");
  const rotatedPath = path.join(dataDir, "commerce-events.1.ndjson");
  const paidEvidencePath = path.join(dataDir, "commerce-paid-success-evidence.ndjson");
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
  const parsedRequestConstructionSince = Date.parse(requestConstructionSince);
  const requestConstructionSinceMs = Number.isFinite(parsedRequestConstructionSince)
    ? parsedRequestConstructionSince
    : null;
  const parsedMcpTypedSince = Date.parse(mcpTypedSince);
  const mcpTypedSinceMs = Number.isFinite(parsedMcpTypedSince) ? parsedMcpTypedSince : null;
  const normalizedPayerClasses = normalizeCommercePayerClasses(payerClasses);
  const paymentClassByActor = new Map([...normalizedPayerClasses].map(([address, paymentClass]) => [
    createHmac("sha256", secret).update(`payer:${address}`).digest("hex").slice(0, 24),
    paymentClass,
  ]));
  let queue = Promise.resolve();
  let writerFailure = null;

  function mcpTypedAttributionForRequest(req) {
    const headers = req?.headers || {};
    const suppliedInternal = headerValue(headers, "x-samedaydesk-internal");
    const marker = headerValue(headers, "x-samedaydesk-validation-marker");
    if (
      typeof internalToken !== "string"
      || Buffer.byteLength(internalToken, "utf8") < 32
      || !safeEqual(suppliedInternal, internalToken)
    ) {
      return null;
    }
    const markerDigest = digestMcpTypedAttributionMarker(marker);
    if (!markerDigest) return null;
    const attribution = {
      schemaVersion: MCP_TYPED_ATTRIBUTION_SCHEMA,
      classification: "validation",
      evidence: "internal_token",
      markerDigest,
    };
    return Object.freeze({
      ...attribution,
      proof: mcpTypedAttributionProof(attribution, secret),
    });
  }

  function enqueueExclusive(work) {
    const run = queue.then(work);
    queue = run.then(
      () => undefined,
      (error) => {
        writerFailure ||= error instanceof Error ? error : new Error(String(error));
      },
    );
    return run;
  }

  async function flush() {
    await queue;
    if (writerFailure) throw writerFailure;
  }

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

  async function appendPaidSuccessEvidence(evidence) {
    if (!isCanonicalPaidSuccessEvidence(evidence)) return;
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await chmod(dataDir, 0o700).catch(() => {});
    await appendFile(paidEvidencePath, `${JSON.stringify(evidence)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(paidEvidencePath, 0o600).catch(() => {});
  }

  function enqueue(event, evidence = null) {
    const ownedEvidence = evidence === null ? null : canonicalPaidSuccessEvidence(evidence);
    enqueueExclusive(async () => {
      await appendEvent(event);
      if (ownedEvidence) await appendPaidSuccessEvidence(ownedEvidence);
    }).catch((error) => {
      console.error(`commerce telemetry write failed: ${error.message}`);
    });
  }

  function appendMcpTypedDecision(decision, attestedAttribution = null) {
    // Adapt, validate, and copy synchronously before any queue scheduling, so
    // the queued closure owns the canonical event and later caller mutation of
    // the original decision cannot alter, relabel, or add to the stored row.
    // Adapting a hostile decision (root Proxy trap, throwing accessor,
    // revoked Proxy) fails closed to the same owned null event as ordinary
    // invalid input: the writer Promise is always returned, the failure and
    // its text never escape, and the no-op still occupies its queue slot so
    // writer ordering and flush semantics are unchanged.
    let event = null;
    try {
      event = adaptMcpTypedDecisionToCommerceEvent(decision);
    } catch {
      event = null;
    }
    if (event) {
      let requestAttribution = null;
      try {
        requestAttribution = verifyMcpTypedAttribution(attestedAttribution, secret);
      } catch {
        requestAttribution = null;
      }
      if (requestAttribution) {
        event = {
          ...event,
          requestAttribution,
        };
      }
    }
    return enqueueExclusive(async () => {
      if (!event) return;
      await appendEvent(event);
    }).catch((error) => {
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
    const receiptReferralSource = isReceiptReferralId(req?.query?.referral) ? "declared-receipt-referral" : null;
    const agentDiscoverySource = receiptReferralSource || declaredAgentDiscoverySource || classifyAgentDiscoverySource(userAgent);
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
    let paidEvidenceRequest = null;
    if (route.kind === "paid" && paymentPresent) {
      try {
        const evidenceProtocol = paidEvidencePaymentProtocol(headers);
        const exactMethod = req.method;
        const exactTarget = typeof req.originalUrl === "string" ? req.originalUrl : req.url;
        const suppliedRawBody = req.rawBody;
        const contentEncoding = headerValue(headers, "content-encoding").trim().toLowerCase();
        const declaredBodyLength = headerValue(headers, "content-length");
        const transferEncoding = headerValue(headers, "transfer-encoding");
        const rawBodyKnownEmpty = suppliedRawBody === undefined
          && !transferEncoding
          && (!declaredBodyLength || declaredBodyLength === "0");
        const rawBody = Buffer.isBuffer(suppliedRawBody)
          ? Buffer.from(suppliedRawBody)
          : rawBodyKnownEmpty
            ? Buffer.alloc(0)
            : null;
        const credential = exactPaymentCredential(headers, evidenceProtocol);
        if (
          isCanonicalHttpMethod(exactMethod)
          && typeof exactTarget === "string"
          && exactTarget.length > 0
          && (!contentEncoding || contentEncoding === "identity")
          && rawBody !== null
          && typeof credential === "string"
          && credential.length > 0
        ) {
          paidEvidenceRequest = Object.freeze({
            requestStartedAt: new Date(startedAt).toISOString(),
            method: exactMethod,
            originClass,
            source: agentDiscoverySource || "direct-or-unattributed",
            payerClass: paymentMetadata.payer
              ? normalizedPayerClasses.get(paymentMetadata.payer) || "unclassified"
              : "unclassified",
            paymentProtocol: evidenceProtocol,
            requestDigest: paidEvidenceRequestDigest(exactMethod, exactTarget, rawBody),
            credentialFingerprint: paidEvidenceCredentialFingerprint(secret, credential),
          });
        }
      } catch {
        paidEvidenceRequest = null;
      }
    }
    const queryKeys = normalizeQueryKeyNames(req.query);
    let responseProblem = null;
    const originalJson = typeof res.json === "function" ? res.json.bind(res) : null;
    const originalSend = typeof res.send === "function" ? res.send.bind(res) : null;
    if (originalJson) {
      res.json = function telemetryJson(body) {
        responseProblem ||= problemDetails(body);
        return originalJson(body);
      };
    }
    if (originalSend) {
      res.send = function telemetrySend(body) {
        responseProblem ||= problemDetails(body);
        return originalSend(body);
      };
    }
    const finishPaidEvidenceResponseDigest = paidEvidenceRequest
      ? capturePaidEvidenceResponseDigest(res, paidEvidenceRequest.method)
      : null;

    res.once("finish", () => {
      try {
        const status = Number(res.statusCode || 0);
      const method = String(req.method || "GET").toUpperCase();
      // Typed MCP observation owns POST /mcp economic facts. HTTP-header
      // credentials must not create a second MCP paid row.
      if (route.route === "/mcp" && !["GET", "HEAD", "OPTIONS"].includes(method)) {
        return;
      }
      if (route.kind === "paid" && !paymentPresent && !["GET", "HEAD", "OPTIONS"].includes(method)) {
        return;
      }
      const replayed = String(res.getHeader?.("x-payment-replay") || "").toLowerCase() === "hit";
      const protocolsOffered = offeredPaymentProtocols(res);
      const settlement = decodeResponseSettlement(res);
      const requestConstruction = route.kind === "paid" && method === "GET"
        ? classifyDiscoveryRequestConstruction(`GET ${route.route}`, req.query || {})
        : { status: "not_measured", requiredKeyCount: 0 };
      const paymentFailureCode = paymentPresent
        ? classifyPaymentFailureCode({
            route: route.route,
            status,
            queryKeys: Object.keys(req.query || {}),
            error: x402FailureError(res),
            problem: responseProblem,
          })
        : null;
      const result = classifyCommerceResult({
        route: route.route,
        kind: route.kind,
        matched: route.matched,
        paymentPresent,
        replayed,
        status,
      });
      const eventId = randomUUID();
      const responseFinishedAt = new Date().toISOString();
      const event = {
        v: 3,
        id: eventId,
        ts: responseFinishedAt,
        actor,
        originClass,
        agentDiscoverySource,
        method,
        route: route.route,
        matched: route.matched,
        kind: route.kind,
        queryKeys,
        requestConstruction: requestConstruction.status,
        requestConstructionRequiredKeyCount: requestConstruction.requiredKeyCount,
        paymentPresent,
        paymentCredentialParsed: paymentMetadata.credentialParsed === true,
        paymentProtocol: protocol,
        paymentFailureCode,
        protocolsOffered,
        replayed,
        paymentActor,
        paymentIdentifier,
        settlementReference: settlement?.reference || null,
        settlementAmountAtomic: settlement?.amountAtomic || null,
        settlementNetwork: settlement?.network || null,
        settlementCurrency: settlement?.currency || null,
        status,
        result,
        durationMs: Math.max(0, Date.now() - startedAt),
      };
      let paidEvidence = null;
      if (result === "paid_success" && paidEvidenceRequest && finishPaidEvidenceResponseDigest) {
        const responseDigest = finishPaidEvidenceResponseDigest();
        const selectedProtocol = runtimePaymentProtocol(res);
        if (responseDigest && selectedProtocol === paidEvidenceRequest.paymentProtocol) {
          paidEvidence = {
            v: 1,
            id: eventId,
            requestStartedAt: paidEvidenceRequest.requestStartedAt,
            responseFinishedAt,
            method: paidEvidenceRequest.method,
            route: route.route,
            originClass: paidEvidenceRequest.originClass,
            source: paidEvidenceRequest.source,
            payerClass: paidEvidenceRequest.payerClass,
            requestDigest: paidEvidenceRequest.requestDigest,
            credentialFingerprint: paidEvidenceRequest.credentialFingerprint,
            responseDigest,
            settlementReference: settlement?.reference || null,
            paymentProtocol: selectedProtocol,
            runtimeAttribution: PAID_EVIDENCE_RUNTIME_ATTRIBUTION,
            validatorVerdict: PAID_EVIDENCE_VALIDATOR_VERDICT,
            validatorAuthority: PAID_EVIDENCE_VALIDATOR_AUTHORITY,
            validatorSource: PAID_EVIDENCE_VALIDATOR_SOURCE,
          };
        }
      }
        enqueue(event, paidEvidence);
      } catch {
        // Malformed or hostile runtime values cannot escape or produce evidence.
      }
    });
    return next();
  }

  async function snapshot(options = {}) {
    return enqueueExclusive(() => captureSnapshot(options));
  }

  async function captureSnapshot({ days = 90 } = {}) {
    const generatedAtMs = Date.now();
    const generatedAt = new Date(generatedAtMs).toISOString();
    const safeDays = Math.max(1, Math.min(365, Number(days) || 90));
    const windowCutoff = generatedAtMs - safeDays * DAY_MS;
    const externalCutoffMs = externalSinceMs === null
      ? windowCutoff
      : Math.max(windowCutoff, externalSinceMs);
    const rotatedRead = await readEvents(rotatedPath);
    const currentRead = await readEvents(currentPath);
    const retainedEvents = [...rotatedRead.events, ...currentRead.events];
    const retainedTypedEvents = [...rotatedRead.mcpTypedEvents, ...currentRead.mcpTypedEvents];
    const retainedTimes = retainedEvents
      .map(eventTimestampMs)
      .filter((ms) => ms !== null);
    const retainedObservationStartMs = retainedTimes.length ? Math.min(...retainedTimes) : null;
    const retainedObservationEndMs = retainedTimes.length ? Math.max(...retainedTimes) : null;
    const coverage = describeRetentionCoverage({
      generatedAtMs,
      requestedWindowDays: safeDays,
      retainedObservationStartMs,
      retainedObservationEndMs,
      retainedParseableEventCount: retainedTimes.length,
      integrity: {
        currentFile: {
          filePresent: currentRead.filePresent,
          parseableRecordCount: currentRead.events.length,
          unusableRecordCount: currentRead.unusableRecordCount,
        },
        rotatedFile: {
          filePresent: rotatedRead.filePresent,
          parseableRecordCount: rotatedRead.events.length,
          unusableRecordCount: rotatedRead.unusableRecordCount,
        },
      },
      baselines: {
        external: { declaredMs: externalSinceMs, cutoffMs: externalSinceMs },
        agentDiscovery: { declaredMs: agentDiscoverySinceMs, cutoffMs: null },
        agentSourceDetail: {
          declaredMs: agentSourceDetailSinceMs,
          cutoffMs: null,
          components: {
            discovery: { declaredMs: agentSourceDetailSinceMs, cutoffMs: null },
            credentialAttempt: { declaredMs: agentSourceDetailSinceMs, cutoffMs: externalSinceMs },
            paidSuccess: { declaredMs: agentSourceDetailSinceMs, cutoffMs: externalSinceMs },
          },
        },
        mcpTransportProbe: { declaredMs: mcpTransportProbeSinceMs, cutoffMs: externalSinceMs },
        credentialAttempt: { declaredMs: credentialAttemptSinceMs, cutoffMs: externalSinceMs },
        settlementEvidence: { declaredMs: settlementEvidenceSinceMs, cutoffMs: externalSinceMs },
        requestConstruction: { declaredMs: requestConstructionSinceMs, cutoffMs: null },
      },
    });
    const windowedEvents = retainedEvents.filter((event) => {
      const ms = eventTimestampMs(event);
      return ms !== null && ms >= windowCutoff;
    });
    const windowedTypedEvents = retainedTypedEvents.filter((event) => {
      const ms = eventTimestampMs(event);
      return ms !== null && ms >= windowCutoff && ms <= generatedAtMs;
    });
    const events = windowedEvents.filter((event) => (
      event.originClass === "external"
      && eventTimestampMs(event) >= externalCutoffMs
    ));
    const policyContractFunnel = summarizePolicyContractFunnels(windowedEvents.filter((event) => (
      event.originClass === "external" || event.originClass === "crawler"
    )));
    const credentialHeaderEvents = events.filter((event) => (
      event.paymentPresent === true
      && event.kind === "paid"
      && event.matched === true
      && (credentialAttemptSinceMs === null || Date.parse(event.ts) >= credentialAttemptSinceMs)
    ));
    const credentialAttemptEvents = credentialHeaderEvents.filter((event) => event.paymentCredentialParsed === true);
    const agentDiscoveryEvents = windowedEvents.filter((event) => (
      event.originClass === "crawler"
      && (agentDiscoverySinceMs === null || Date.parse(event.ts) >= agentDiscoverySinceMs)
      && event.matched === true
      && (event.kind === "discovery" || event.kind === "paid")
    ));
    const constructedRequestEvents = windowedEvents.filter((event) => (
      requestConstructionSinceMs !== null
      && Date.parse(event.ts) >= requestConstructionSinceMs
      && (event.originClass === "external" || event.originClass === "crawler")
      && event.kind === "paid"
      && event.matched === true
      && event.method === "GET"
      && event.requestConstruction === "constructed"
      && eventResult(event) === "challenge"
    ));
    const constructedRequestBySource = emptyCounts();
    const constructedRequestByRoute = emptyCounts();
    const constructedRequestActors = new Map();
    const constructedRequestActorCountsBySource = new Map();
    for (const event of constructedRequestEvents) {
      const source = controlledEventSource(
        event,
        event.originClass === "crawler" ? "unattributed-crawler" : "direct-or-unattributed",
      );
      increment(constructedRequestBySource, source);
      increment(constructedRequestByRoute, event.route);
      constructedRequestActors.set(event.actor, (constructedRequestActors.get(event.actor) || 0) + 1);
      incrementActorBySource(constructedRequestActorCountsBySource, source, event.actor);
    }
    const constructedRequestActorsBySource = Object.fromEntries(
      [...constructedRequestActorCountsBySource.keys()].sort().map((source) => [
        source,
        actorCount(constructedRequestActorCountsBySource, source),
      ]),
    );
    const repeatConstructedRequestActorsBySource = Object.fromEntries(
      [...constructedRequestActorCountsBySource.keys()].sort().map((source) => [
        source,
        repeatActorCount(constructedRequestActorCountsBySource, source),
      ]),
    );

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
    const credentialAttemptByFailureCode = emptyCounts();
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
      const failureCode = event.paymentFailureCode || classifyPaymentFailureCode({
        route: event.route,
        status: event.status,
        queryKeys: event.queryKeys,
      });
      if (failureCode) increment(credentialAttemptByFailureCode, failureCode);
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
      generatedAt,
      windowDays: safeDays,
      requestedWindowDays: safeDays,
      requestedWindowStart: coverage.requestedWindowStart,
      requestedWindowEnd: coverage.requestedWindowEnd,
      requestedWindowComplete: coverage.requestedWindowComplete,
      requestedWindowCoverage: coverage.requestedWindowCoverage,
      requestConstructionCoverage: coverage.metrics.requestConstruction.coverage,
      retainedParseableEventCount: coverage.retainedParseableEventCount,
      integrityStatus: coverage.integrityStatus,
      coverage,
      mcpTyped: {
        ...summarizeMcpTypedView(windowedTypedEvents),
        coverage: describeMcpTypedSourceCoverage({
          generatedAtMs,
          requestedWindowDays: safeDays,
          retainedTypedEvents,
          currentRead,
          rotatedRead,
          mcpTypedSinceMs,
          mcpTypedFreshnessMaxAgeMs: typedFreshnessMaxAgeMs,
        }),
      },
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
      requestConstructionSince: requestConstructionSinceMs === null
        ? null
        : new Date(requestConstructionSinceMs).toISOString(),
      constructedRequestEvents: constructedRequestEvents.length,
      constructedRequestActors: constructedRequestActors.size,
      repeatConstructedRequestActors: [...constructedRequestActors.values()].filter((count) => count > 1).length,
      constructedRequestBySource,
      constructedRequestActorsBySource,
      repeatConstructedRequestActorsBySource,
      constructedRequestByRoute,
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
      credentialAttemptByFailureCode,
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
      policyContractFunnel,
      policyContractFunnelPolicy: "Prospective exact-route measurement only. It counts privacy-safe same-client progression from a successful free policy-contract read to the matching paid-route challenge, parseable credential, and paid delivery. Historical /schemas/* events are ambiguous and excluded. Counts include external and declared crawler clients, retain no actor identifiers, and are reach or funnel evidence rather than authenticated identity or demand.",
      mcpTransportProbePolicy: "After the declared MCP transport-probe baseline, only four common public client expectations are counted: /mcp/sse, /mcp/messages, /mcp/tools, and /mcp/events. Arbitrary MCP subpaths remain grouped as /mcp/*, and probe counts remain acquisition-friction evidence rather than demand until an independent actor repeats or converts.",
      agentDiscoveryPolicy: "After the declared machine-discovery baseline, recognized crawler and agent-indexer user-agent families are reduced to a controlled source label at ingestion. SameDayDesk-owned monitor user agents are excluded. Raw user-agent strings and network addresses are not retained in the public snapshot. Per-source observations, distinct and repeat secret-keyed actors, paid-route reach, HTTP 402 challenge delivery, credential attempts, and paid outcomes distinguish broad machine reach from repeated crawler volume and later payment conversion. Challenge-to-payment conversion is attributed to the source of the first observed same-actor challenge. These observations are not authenticated referrals, buyer intent, or demand.",
      agentSourceDetailPolicy: "The ai-provider-purpose-v1 cohort begins only at agentSourceDetailSince and classifies exact provider-published HTTP user-agent tokens for OpenAI search, user fetch, and training; Anthropic search, user fetch, and training; Perplexity search and user fetch; and Google Cloud Vertex agent crawls. Google-Extended is intentionally absent because Google documents that it has no separate HTTP user-agent string. Labels are user-agent observations rather than IP-verified identities or referral proof. Historical generic events are not reclassified. Discovery counts use that detail baseline. Credential and paid components stay clipped by externalSince when that cutoff is declared. Coverage reports those component observation starts separately, and the mixed metric is complete only when every component is complete over the same observation start.",
      unmatched: unmatchedRequests,
      paymentClassPolicy: "Explicit known-payer rules classify internal, marketplace validation, incentivized, affiliated, or independently confirmed buyers. Unknown or missing payer identities remain unclassified and never become independent by inference.",
      discoveryConversionPolicy: "A submitted payment credential overrides crawler classification so paying agents remain in economic telemetry. Controlled user-agent source labels attribute the client channel but are self-declared and do not independently authenticate a registry referral. Challenge-to-paid conversion uses the same secret-keyed network-and-user-agent actor before and after the challenge and is therefore a conservative continuity lower bound, not an identity claim. SameDayDesk owner monitors remain excluded before this rule.",
      credentialAttemptPolicy: "After the declared credential-attempt baseline, a parseable attempt must carry a syntactically complete x402 v2 exact Base-style binding or MPP evm/charge credential. Signature validity and settlement are separate later outcomes. Controlled failure codes are derived from required query-key presence, x402 response error classes, or MPP Problem Details. Public output contains only aggregate protocol, result, route, source, payer class, and failure-code counts; raw credentials, errors, bodies, query values, actors, and payer addresses are not exposed.",
      requestConstructionPolicy: "Prospective seller-declared GET measurement only. A constructed request must target an exact paid route, carry a non-empty scalar for every required non-secret query key from that route's canonical Bazaar request contract, and receive an HTTP 402 challenge rather than validation failure. Values are inspected only for scalar non-emptiness and are neither retained nor published. Header, cookie, path, body, unsafe unpaid POST, credential-like required names, and undeclared contracts remain unmeasured. Public output contains aggregate events, distinct secret-keyed actor counts, controlled source labels, and canonical routes only. Construction proves neither input validity, buyer intent, payment authorization, settlement, nor demand.",
      settlementEvidencePolicy: "After the declared settlement-evidence baseline, a successful paid response should carry a valid Base transaction reference in PAYMENT-RESPONSE or Payment-Receipt. Raw response headers and transaction references remain private; public output exposes only coverage counts by evidence class.",
      boundary: "Aggregate external observations after the declared experiment baseline only. Known internal, SameDayDesk-owned monitor, crawler, and exploit-probe traffic is excluded from demand, but unidentified automated fetchers can remain. Separately reported agent-discovery observations begin at their own declared baseline and are user-agent-declared crawler or indexer fetches of known discovery and paid routes; SameDayDesk-owned monitor user agents are excluded, and the remainder are neither authenticated catalog referrals nor buyer intent. Unmatched requests are acquisition misses, not intents. Known MCP transport probes and semantic-unmatched counts remain acquisition-friction evidence and do not become demand until an independent caller repeats or converts. Paid-success actors use a secret-keyed payer pseudonym when an x402 payload exposes a valid EVM payer, otherwise the network/user-agent pseudonym. Payment classes are applied against those pseudonyms at read time, so known marketplace verification can be reclassified without storing a raw address. Unknown payers remain unclassified. Protocol counts distinguish submitted x402 and MPP credentials plus protocols advertised by a 402; they do not expose credentials. Settlement-reference coverage begins only at its declared baseline; raw transaction references remain on the private volume and are not returned publicly. Idempotent replay successes are reported separately and do not create a second paid-success event. Counts are not public buyer identities or calibrated forecasts.",
    };
  }

  async function storageStatus() {
    try {
      return await enqueueExclusive(async () => {
        await mkdir(dataDir, { recursive: true, mode: 0o700 });
        const [currentBytes, rotatedBytes, paidEvidenceBytes] = await Promise.all([
          stat(currentPath).then((entry) => entry.size).catch(() => 0),
          stat(rotatedPath).then((entry) => entry.size).catch(() => 0),
          stat(paidEvidencePath).then((entry) => entry.size).catch(() => 0),
        ]);
        return {
          ready: true,
          currentBytes,
          rotatedBytes,
          paidEvidenceBytes,
          boundedBytes: maxBytes * 2,
          writerGate,
        };
      });
    } catch {
      return {
        ready: false,
        currentBytes: null,
        rotatedBytes: null,
        paidEvidenceBytes: null,
        boundedBytes: maxBytes * 2,
        writerGate,
      };
    }
  }

  return {
    middleware,
    snapshot,
    storageStatus,
    appendMcpTypedDecision,
    mcpTypedAttributionForRequest,
    flush,
    paths: { currentPath, rotatedPath, paidEvidencePath },
  };
}
