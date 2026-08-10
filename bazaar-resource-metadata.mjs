const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

export const BAZAAR_RESOURCE_METADATA = Object.freeze({
  "/extract": Object.freeze({
    serviceName: "SameDayDesk",
    tags: Object.freeze(["web", "url-extraction", "clean-text", "structured-data", "json-ld"]),
  }),
  "/read": Object.freeze({
    serviceName: "SameDayDesk",
    tags: Object.freeze(["web", "webpage-to-markdown", "llm-context", "clean-text", "url-reader"]),
  }),
  "/scan": Object.freeze({
    serviceName: "SameDayDesk",
    tags: Object.freeze(["github", "repository-security", "supply-chain", "skill-scan", "pre-install"]),
  }),
  "/schemaforge": Object.freeze({
    serviceName: "SameDayDesk",
    tags: Object.freeze(["json-ld", "schema-org", "structured-data", "business-website", "ai-search"]),
  }),
  "/enrich": Object.freeze({
    serviceName: "SameDayDesk",
    tags: Object.freeze(["company-enrichment", "domain-research", "firmographics", "dns-email", "tech-stack"]),
  }),
  "/wallet-enrich": Object.freeze({
    serviceName: "SameDayDesk",
    tags: Object.freeze(["evm-wallet", "contract-profile", "base", "token-holdings", "onchain"]),
  }),
  "/deep-audit": Object.freeze({
    serviceName: "SameDayDesk",
    tags: Object.freeze(["ai-search-readiness", "website-audit", "structured-data", "company-data", "geo"]),
  }),
  "/defi/morpho-position": Object.freeze({
    serviceName: "SameDayDesk",
    tags: Object.freeze(["morpho", "borrower-risk", "ltv", "health-factor", "price-shock"]),
  }),
  "/defi/morpho-protection": Object.freeze({
    serviceName: "SameDayDesk",
    tags: Object.freeze(["morpho", "loan-protection", "repay-plan", "collateral", "health-factor"]),
  }),
  "/defi/morpho-market-underwrite": Object.freeze({
    serviceName: "SameDayDesk",
    tags: Object.freeze(["morpho", "market-risk", "underwriting", "liquidity", "bad-debt"]),
  }),
  "/defi/morpho-preliquidation-replay": Object.freeze({
    serviceName: "SameDayDesk",
    tags: Object.freeze(["morpho", "preliquidation", "transaction-replay", "incentive", "gas"]),
  }),
  "/work/opportunity-preflight": Object.freeze({
    serviceName: "SameDayDesk",
    tags: Object.freeze(["agent-work", "opportunity", "expected-value", "bounty", "preflight"]),
  }),
  "/distribution/agent-discoverability-audit": Object.freeze({
    serviceName: "SameDayDesk",
    tags: Object.freeze(["x402", "mpp", "agent-discovery", "rank-audit", "api-discoverability"]),
  }),
  "/commerce/payment-offer-preflight": Object.freeze({
    serviceName: "SameDayDesk",
    tags: Object.freeze(["x402", "mpp", "payment-preflight", "buyer-safety", "offer-parity"]),
  }),
});

export function validateBazaarResourceMetadata(metadata = BAZAAR_RESOURCE_METADATA) {
  const errors = [];
  for (const [route, entry] of Object.entries(metadata)) {
    if (!/^\/[^?#]+$/.test(route)) errors.push(`${route}: invalid route`);
    const serviceName = entry?.serviceName;
    if (typeof serviceName !== "string" || serviceName.length < 1 || serviceName.length > 32 || !PRINTABLE_ASCII.test(serviceName)) {
      errors.push(`${route}: invalid serviceName`);
    }
    if (!Array.isArray(entry?.tags) || entry.tags.length < 1 || entry.tags.length > 5) {
      errors.push(`${route}: invalid tag count`);
      continue;
    }
    if (new Set(entry.tags.map((tag) => String(tag).toLowerCase())).size !== entry.tags.length) errors.push(`${route}: duplicate tag`);
    for (const tag of entry.tags) {
      if (typeof tag !== "string" || tag.length < 1 || tag.length > 32 || !PRINTABLE_ASCII.test(tag)) {
        errors.push(`${route}: invalid tag`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function bazaarResourceMetadataFor(route) {
  const entry = BAZAAR_RESOURCE_METADATA[route];
  if (!entry) throw new Error(`Missing Bazaar resource metadata for ${route}`);
  return { serviceName: entry.serviceName, tags: [...entry.tags] };
}
