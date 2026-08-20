const DECLARED_HEADER = {
  "agent-skills-v1": "agent-skills",
  "agentictrade-v1": "agentictrade",
  "aws-agentcore-v1": "aws-agentcore",
};
export const PUBLISHED_EXAMPLE = "https://agents.samedaydesk.com/extract?url=https://example.com";
export const REQUIRED_QUERY_KEY_GROUPS_BY_ROUTE = new Map([
  ["/extract", [["url"]]],
  ["/commerce/payment-offer-preflight", [["url"]]],
  ["/enrich", [["domain", "url"]]],
]);
// Identity set remains three families. apify-mcpc is initialize-shaped only
// (MCP clientInfo.name === "mcpc"). This merchant has no GET-visible producer
// signal for mcpc; do not invent a UA, header, or query heuristic.
export const OFFICIAL_CONSTRUCTOR_SOURCES = Object.freeze(["apify-mcpc", "mppx", "solana-pay"]);
// Public GET 402 constructed coverage. A zero for apify-mcpc here is expected.
export const GET_OFFICIAL_CONSTRUCTOR_SOURCES = Object.freeze(["mppx", "solana-pay"]);
const OWNER_MONITOR_VALUE_PATTERN = /^SameDayDesk(?:[- /]|[A-Z])/i;

function scalarNonEmpty(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(scalarNonEmpty);
  return false;
}

function decodeQueryValue(value) {
  if (typeof value !== "string") return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function decodeQuery(query = {}) {
  if (typeof query === "string") {
    const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
    return Object.fromEntries([...params.entries()].map(([key, value]) => [key, decodeQueryValue(value)]));
  }
  if (!query || typeof query !== "object" || Array.isArray(query)) return {};
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, decodeQueryValue(value)]),
  );
}

function hasRequiredQuery(route, query) {
  const groups = REQUIRED_QUERY_KEY_GROUPS_BY_ROUTE.get(String(route || ""));
  if (!groups) return false;
  const decoded = decodeQuery(query);
  return groups.every((group) => group.some((key) => scalarNonEmpty(decoded[key])));
}

function headerTexts(headers = {}) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return [];
  return Object.entries(headers).flatMap(([name, value]) => {
    const joined = Array.isArray(value) ? value.join(",") : String(value || "");
    return [String(name || ""), joined];
  });
}

function hasOwnerPrefix(value) {
  const text = String(value || "");
  return text.startsWith("SameDayDesk-")
    || text.startsWith("Pilot-")
    || OWNER_MONITOR_VALUE_PATTERN.test(text);
}

export function isGetOfficialConstructorSource(source) {
  return GET_OFFICIAL_CONSTRUCTOR_SOURCES.includes(source);
}

export function isOwnerMonitor({
  userAgent = "",
  originClass = "",
  paymentClass = "",
  declaredHeader = "",
  headers = {},
  internalAuthorized = false,
} = {}) {
  if (internalAuthorized === true) return true;
  if (originClass === "owner_monitor" || originClass === "internal") return true;
  if (paymentClass === "internal" || paymentClass === "validation") return true;
  if (hasOwnerPrefix(userAgent) || hasOwnerPrefix(declaredHeader)) return true;
  return headerTexts(headers).some((text) => hasOwnerPrefix(text));
}

export function classifyConstructor({
  userAgent = "",
  originClass = "",
  paymentClass = "",
  mcpClientInfoName = "",
  declaredHeader = "",
  headers = {},
  internalAuthorized = false,
} = {}) {
  if (isOwnerMonitor({
    userAgent,
    originClass,
    paymentClass,
    declaredHeader,
    headers,
    internalAuthorized,
  })) {
    return { source: null, officialConstructor: false, excludedFromPublic: true };
  }

  const ua = String(userAgent || "");
  let source = "direct-or-unattributed";
  if (ua.startsWith("mppx/")) source = "mppx";
  else if (ua.startsWith("pay/cli/") || ua.startsWith("pay/mcp/")) source = "solana-pay";
  else if (String(mcpClientInfoName || "") === "mcpc") source = "apify-mcpc";
  else if (ua.includes("Google-Agent")) source = "google-agent";
  else if (ua.includes("Agent402/1.0")) source = "agent402";
  else if (/^(axios|curl|got)\//i.test(ua) || ua.includes("Chrome")) source = "generic-or-unattributed";
  else {
    const declared = DECLARED_HEADER[String(declaredHeader || "").trim().toLowerCase()];
    if (declared) source = declared;
  }

  return {
    source,
    officialConstructor: OFFICIAL_CONSTRUCTOR_SOURCES.includes(source),
    excludedFromPublic: false,
  };
}

export function isConstructedChallenge({
  method,
  kind,
  matched,
  status,
  protocolsOffered = [],
  route,
  query = {},
} = {}) {
  if (String(method || "").toUpperCase() !== "GET") return false;
  if (kind !== "paid") return false;
  if (matched !== true) return false;
  if (Number(status) !== 402) return false;
  const protocols = Array.isArray(protocolsOffered) ? protocolsOffered : [];
  if (!protocols.includes("x402") && !protocols.includes("mpp")) return false;
  return hasRequiredQuery(route, query);
}

export function matchesPublishedExample({ constructed, route, query } = {}) {
  if (!constructed) return false;
  if (route !== "/extract") return false;
  const decoded = decodeQuery(query);
  const keys = Object.keys(decoded);
  return keys.length === 1 && keys[0] === "url" && decoded.url === "https://example.com";
}

export function classifyEvent(row = {}) {
  const constructor = classifyConstructor(row);
  const constructed = row.constructedChallenge === true || row.constructedChallenge === false
    ? row.constructedChallenge
    : isConstructedChallenge(row);
  const publishedExample = typeof row.matchesPublishedExample === "boolean"
    ? row.matchesPublishedExample
    : matchesPublishedExample({ ...row, constructed });
  const agentConstructed = constructed && !constructor.excludedFromPublic && row.originClass === "crawler";
  // GET-constructed public join is only {mppx, solana-pay}. apify-mcpc may be
  // official on initialize-shaped traffic and must not appear here.
  const externalOfficial = constructed
    && constructor.officialConstructor
    && isGetOfficialConstructorSource(constructor.source)
    && !publishedExample
    && row.originClass === "external"
    && !constructor.excludedFromPublic;

  return {
    source: constructor.source,
    officialConstructor: constructor.officialConstructor,
    excludedFromPublic: constructor.excludedFromPublic,
    constructed,
    matchesPublishedExample: publishedExample,
    independentPaidSuccessActors: 0,
    agentConstructedObservations: agentConstructed ? 1 : 0,
    agentConstructedActors: agentConstructed ? 1 : 0,
    externalConstructedActors: externalOfficial ? 1 : 0,
    officialConstructorCoverage: externalOfficial && constructor.source ? [constructor.source] : [],
  };
}

export function labeledConstructorSource(constructor) {
  const source = constructor?.source;
  if (!source || source === "direct-or-unattributed" || source === "generic-or-unattributed") return null;
  return source;
}

export function extractMcpClientInfoName(req) {
  const name = req?.body?.params?.clientInfo?.name;
  return typeof name === "string" ? name : "";
}
