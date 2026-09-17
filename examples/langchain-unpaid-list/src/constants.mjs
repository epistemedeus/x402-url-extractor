export const PRODUCT = "samedaydesk-langchain-unpaid-list";
export const SCHEMA_VERSION = "samedaydesk.langchain-unpaid-list.v0";

export const LIVE_ORIGIN = "https://agents.samedaydesk.com";
export const DISCOVERY_PATH = "/.well-known/x402";
export const DISCOVERY_PATHS = Object.freeze([
  "/.well-known/x402",
  "/.well-known/x402.json",
  "/x402.json",
  "/api/x402",
]);

export const SUPPORTED_X402_VERSION = 2;
export const MAX_CATALOG_BYTES = 1_000_000;
export const MAX_ITEMS = 64;
export const FETCH_TIMEOUT_MS = 15_000;

export const TOOL_NAME = "list_unpaid_x402_resources";
export const TOOL_DESCRIPTION =
  "List advertised x402 HTTP resources from a seller well-known catalog without paying. " +
  "Returns method, route, advertised amount, network, and asset from the free discovery document. " +
  "Does not sign, send payment headers, open a wallet, follow redirects, or read paid response bodies. " +
  "A listed amount is a catalog advertisement, not a live 402 challenge and not authorization to spend.";

export const TOOL_INPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    query: {
      type: "string",
      maxLength: 200,
      description: "Optional case-insensitive substring filter on route, description, service name, or tags.",
    },
    route: {
      type: "string",
      maxLength: 200,
      description: "Optional exact routeTemplate such as /extract or /extract/batch.",
    },
  },
});
