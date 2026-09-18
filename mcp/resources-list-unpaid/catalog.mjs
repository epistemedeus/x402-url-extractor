/** Frozen unpaid MCP resources/list catalog. Listing and reading these is discovery, not a paid tool call. */

export const SCHEMA = "x402-url-extractor.mcp.resources-list-unpaid.v1";
export const RESOURCE_URI_PREFIX = "mcp://x402-url-extractor/unpaid/";
export const SERVER_INFO = Object.freeze({
  name: "x402-url-extractor-resources-list-unpaid",
  version: "1.0.0",
});
export const BOUNDARY = "MCP resources/list and resources/read are unpaid protocol discovery. tools/call and paid HTTP routes remain x402-gated. This surface does not send, verify, or settle payment.";

const PAYMENT_META = Object.freeze({
  "x402/paymentRequired": false,
});

function resource(entry) {
  return Object.freeze({
    uri: `${RESOURCE_URI_PREFIX}${entry.name}`,
    name: entry.name,
    title: entry.title,
    description: entry.description,
    mimeType: entry.mimeType,
    publicUrl: entry.publicUrl,
    paymentRequired: false,
    _meta: Object.freeze({
      ...PAYMENT_META,
      "samedaydesk/publicUrl": entry.publicUrl,
    }),
  });
}

export const UNPAID_RESOURCES = Object.freeze([
  resource({
    name: "agent-card",
    title: "A2A Agent Card",
    description: "Public Agent Card. Catalog discovery is unpaid. Paid actions remain x402-gated on their HTTP and MCP tool surfaces.",
    mimeType: "application/json",
    publicUrl: "https://agents.samedaydesk.com/.well-known/agent-card.json",
  }),
  resource({
    name: "x402-manifest",
    title: "x402 Resource Manifest",
    description: "Public well-known x402 resource manifest. Listing it here is unpaid discovery, not a paid extract or read.",
    mimeType: "application/json",
    publicUrl: "https://agents.samedaydesk.com/.well-known/x402",
  }),
  resource({
    name: "openapi",
    title: "OpenAPI Document",
    description: "Public OpenAPI document for paid HTTP routes. Fetching this document is unpaid; calling those routes is not.",
    mimeType: "application/json",
    publicUrl: "https://agents.samedaydesk.com/openapi.json",
  }),
  resource({
    name: "skill-contract",
    title: "Skill Contract",
    description: "Public skill contract markdown. Reading this resource is unpaid discovery.",
    mimeType: "text/markdown",
    publicUrl: "https://agents.samedaydesk.com/skill.md",
  }),
]);

export const UNPAID_RESOURCE_URIS = Object.freeze(UNPAID_RESOURCES.map((item) => item.uri));
export const UNPAID_RESOURCE_NAMES = Object.freeze(UNPAID_RESOURCES.map((item) => item.name));

export function listResourceDescriptors() {
  return UNPAID_RESOURCES.map((item) => Object.freeze({
    uri: item.uri,
    name: item.name,
    title: item.title,
    description: item.description,
    mimeType: item.mimeType,
    _meta: item._meta,
  }));
}

export function readResourceDocument(uri) {
  const item = UNPAID_RESOURCES.find((entry) => entry.uri === uri);
  if (!item) return null;
  return Object.freeze({
    uri: item.uri,
    name: item.name,
    title: item.title,
    mimeType: item.mimeType,
    publicUrl: item.publicUrl,
    paymentRequired: false,
    boundary: BOUNDARY,
  });
}
