import {
  callableGetExample,
  postSchemaBodyExample,
} from "./publication-examples.mjs";

/**
 * Declarative inclusion policy for paid machine surfaces.
 *
 * Canonical paid actions (RESOURCES / action catalog) belong on OpenAPI,
 * x402, MCP, A2A, the free action catalog, and llms.txt.
 *
 * The Circle Gateway path is an alternate settlement rail for the same
 * payment-offer-preflight product. It belongs on OpenAPI, the x402 manifest
 * as an alternate item, and llms.txt with same-product wording. It is killed
 * from MCP, A2A route skills, the free catalog actions array, and MPP OpenAPI
 * because those surfaces would advertise a distinct x402+MPP buyable action.
 */

export const CIRCLE_ALTERNATE_KIND = "circle-alternate";

export const SURFACE_POLICY = Object.freeze({
  canonical: Object.freeze({
    openapi: "include",
    mppOpenapi: "include",
    x402Manifest: "include",
    mcp: "include",
    a2a: "include",
    actionCatalog: "include",
    llms: "include",
  }),
  [CIRCLE_ALTERNATE_KIND]: Object.freeze({
    openapi: "include",
    mppOpenapi: "kill",
    x402Manifest: "include",
    mcp: "kill",
    a2a: "kill",
    actionCatalog: "kill",
    llms: "include",
  }),
});

export const CIRCLE_KILLED_SURFACES = Object.freeze(
  Object.entries(SURFACE_POLICY[CIRCLE_ALTERNATE_KIND])
    .filter(([, decision]) => decision === "kill")
    .map(([surface]) => surface),
);

function fail(message) {
  throw new Error(`Machine surface parity invalid: ${message}`);
}

function flatten(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function mcpToolNameForRoute(route) {
  const segment = String(route || "").split("/").filter(Boolean).at(-1);
  if (!segment) throw new Error(`cannot derive MCP tool name from ${route || "empty route"}`);
  return segment.replaceAll("-", "_");
}

export function formatLlmsPrice(priceAtomicUsdc) {
  const atomic = String(priceAtomicUsdc ?? "");
  if (!/^[1-9][0-9]*$/.test(atomic)) throw new Error(`invalid atomic price: ${priceAtomicUsdc}`);
  const padded = atomic.padStart(7, "0");
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/, "") || "0";
  let fraction = padded.slice(-6).replace(/0+$/, "");
  if (fraction.length === 1) fraction += "0";
  return fraction ? `$${whole}.${fraction}` : `$${whole}`;
}

export function parseLlmsPaidRoutes(text) {
  const routes = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const link = /^\s*-\s*\[([^\]]+)\]\((https:[^)]+)\)/.exec(line);
    if (link) {
      const url = new URL(link[2]);
      const label = link[1].trim();
      const method = /^POST\b/i.test(label) || /:\s*POST\b/i.test(line) || /\bPOST\b/.test(label)
        ? "POST"
        : "GET";
      const price = /\$([0-9]+(?:\.[0-9]+)?)\s*USDC/.exec(line)?.[1] || null;
      routes.push({
        method,
        route: url.pathname,
        url: url.href,
        query: url.search,
        transmissible: method === "GET",
        price,
        line,
        sameProduct: /same (?:payment-offer )?preflight product/i.test(line),
        notSecondCatalogAction: /not a second catalog action/i.test(line),
      });
      continue;
    }
    const post = /^\s*-\s*POST\s+(\/[^:\s]+)\s*:/.exec(line);
    if (!post) continue;
    const price = /\$([0-9]+(?:\.[0-9]+)?)\s*USDC/.exec(line)?.[1] || null;
    routes.push({
      method: "POST",
      route: post[1],
      url: null,
      query: "",
      transmissible: false,
      bodyExample: /JSON body example \(do not transmit\)/i.test(line),
      price,
      line,
      sameProduct: false,
      notSecondCatalogAction: /not a second catalog action/i.test(line),
    });
  }
  return routes;
}

function llmsLine({ origin, method, route, priceAtomicUsdc, description, request = null }) {
  const body = method === "POST" && !/^POST\b/i.test(description)
    ? `POST ${description}`
    : description;
  const price = formatLlmsPrice(priceAtomicUsdc);
  const flat = flatten(body);
  if (method === "GET") {
    const example = callableGetExample({ method, route, request });
    const parsed = new URL(example.exampleUrl);
    const pathLabel = `${parsed.pathname}${parsed.search}`;
    return `- [${pathLabel}](${example.exampleUrl}): ${price} USDC - ${flat}`;
  }
  if (method === "POST") {
    const example = postSchemaBodyExample({ method, route, request });
    return `- POST ${route}: ${price} USDC - JSON body example (do not transmit): ${example.bodyJson}. ${flat}`;
  }
  fail(`${method} ${route} uses an unsupported llms method`);
}

export function renderLlmsTxt({
  origin,
  facilitator,
  payTo,
  actions,
  alternate = null,
  buyerPolicyRelease,
  purchaseEvidencePath,
} = {}) {
  if (!origin || !facilitator || !payTo) fail("origin, facilitator, and payTo are required");
  if (!Array.isArray(actions) || actions.length === 0) fail("actions are required");
  const publicOrigin = new URL(origin).origin;
  const lines = actions.map((action) => llmsLine({
    origin: publicOrigin,
    method: String(action.method || "GET").toUpperCase(),
    route: action.route,
    priceAtomicUsdc: action.priceAtomicUsdc,
    description: action.description,
    request: action.request,
  }));
  if (alternate) {
    lines.push(llmsLine({
      origin: publicOrigin,
      method: "GET",
      route: alternate.route,
      priceAtomicUsdc: alternate.priceAtomicUsdc,
      description: "the same payment-offer preflight product through Circle Gateway x402 Nanopayments, with gasless buyer authorization and batched USDC settlement. It is not a second catalog action.",
      request: alternate.request,
    }));
  }
  return `# SameDayDesk machine commerce gateway

> Machine-discoverable HTTP capabilities settle USDC on Base through either x402 or native MPP Payment authentication. Payment-offer preflight also has a Circle Gateway x402 path for gasless batched USDC Nanopayments. MCP remains Base x402-gated. No account or subscription is required. Current standard facilitator: ${facilitator}. payTo ${payTo}.

## Endpoints
${lines.join("\n")}

## How to pay
1. GET an endpoint such as ${publicOrigin}/enrich?domain=stripe.com. One HTTP 402 advertises both protocols.
2. For x402, use PAYMENT-REQUIRED with an x402 v2 client and replay with PAYMENT-SIGNATURE. A successful response carries PAYMENT-RESPONSE.
3. For MPP, use WWW-Authenticate: Payment with an mppx EVM charge client and replay with Authorization: Payment. A successful response carries Payment-Receipt.
4. The Circle Gateway route advertises GatewayWalletBatched x402 requirements and settles the same quoted amount into the seller's Gateway balance.
5. Runtime payment challenges are authoritative. Enforce the chosen scheme, network, amount, and recipient before signing.

## Discovery
- x402 manifest: ${publicOrigin}/.well-known/x402
- OpenAPI: ${publicOrigin}/openapi.json
- Skill contract: ${publicOrigin}/skill.md
- Action catalog: ${publicOrigin}/api/actions
- A2A agent card: ${publicOrigin}/.well-known/agent-card.json
- Solana Agent Registry metadata: ${publicOrigin}/.well-known/agent-registration.json
- Aggregate demand telemetry: ${publicOrigin}/v0/commerce-demand.json
- Purchase evidence: ${publicOrigin}${purchaseEvidencePath}
- Buyer policy reference: ${buyerPolicyRelease}
- Wallet-policy conformance contract: ${publicOrigin}/schemas/wallet-policy-conformance-v1.json
- Stateful wallet-policy conformance contract: ${publicOrigin}/schemas/stateful-wallet-policy-conformance-v1.json
- Source: https://github.com/epistemedeus/x402-url-extractor
`;
}

function paidOpenApiOperations(document) {
  const operations = [];
  if (!document?.paths || typeof document.paths !== "object") return operations;
  for (const [route, pathItem] of Object.entries(document.paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== "object") continue;
      if (!operation["x-payment-info"]) continue;
      operations.push({
        method: method.toUpperCase(),
        route,
        operationId: operation.operationId || null,
      });
    }
  }
  return operations;
}

function operationKey(method, route) {
  return `${String(method || "GET").toUpperCase()} ${route}`;
}

export function validateMachineSurfaceParity({
  actions,
  alternate = null,
  openapi,
  mppOpenapi = null,
  manifestItems,
  mcpToolNames,
  agentCard,
  catalog,
  llms,
} = {}) {
  if (!Array.isArray(actions) || actions.length === 0) fail("actions are required");
  const actionRoutes = actions.map((action) => {
    const method = String(action.method || "GET").toUpperCase();
    const route = String(action.route || "");
    if (!/^\/[^?#]+$/.test(route)) fail(`invalid action route ${route}`);
    if (!action.priceAtomicUsdc) fail(`${method} ${route} lacks a price`);
    if (!action.description) fail(`${method} ${route} lacks a description`);
    return { method, route, priceAtomicUsdc: action.priceAtomicUsdc };
  });
  const canonicalKeys = actionRoutes.map((entry) => operationKey(entry.method, entry.route));
  if (new Set(canonicalKeys).size !== canonicalKeys.length) fail("canonical action keys must be unique");
  if (alternate) {
    if (!/^\/gateway\//.test(alternate.route || "")) fail("Circle alternate must use the /gateway path");
    if (canonicalKeys.includes(operationKey("GET", alternate.route))) {
      fail("Circle alternate must not duplicate a canonical action");
    }
  }

  const catalogActions = Array.isArray(catalog?.actions) ? catalog.actions : [];
  if (alternate && catalogActions.some((action) => action.route === alternate.route)) {
    fail("Circle alternate must not appear as a catalog action");
  }
  const catalogKeys = catalogActions.map((action) => operationKey(action.method || "GET", action.route));
  if (catalogKeys.join("\n") !== canonicalKeys.join("\n")) {
    fail("action catalog drifted from the canonical paid actions");
  }
  if (alternate) {
    if (catalog?.alternateAccess?.route !== alternate.route) {
      fail("Circle alternate is missing from catalog.alternateAccess");
    }
  } else if (catalog?.alternateAccess) {
    fail("catalog.alternateAccess is set without an alternate");
  }

  if (alternate) {
    const blob = JSON.stringify(agentCard || {});
    if (blob.includes(alternate.route)) fail("Circle alternate must not appear on the A2A agent card");
  }
  const routeSkills = (agentCard?.skills || []).filter((skill) => String(skill?.id || "").startsWith("discover-paid-action-"));
  if (routeSkills.length !== actions.length) fail("A2A route-skill count does not match canonical actions");

  if (!Array.isArray(manifestItems)) fail("manifest items are required");
  const manifestRoutes = manifestItems.map((item) => item?.resource?.routeTemplate);
  for (const action of actionRoutes) {
    if (!manifestRoutes.includes(action.route)) fail(`${action.method} ${action.route} is missing from the x402 manifest`);
  }
  if (alternate && !manifestRoutes.includes(alternate.route)) {
    fail(`alternate ${alternate.route} is missing from the x402 manifest`);
  }

  const openapiOps = paidOpenApiOperations(openapi);
  const openapiKeys = new Set(openapiOps.map((entry) => operationKey(entry.method, entry.route)));
  for (const action of actionRoutes) {
    if (!openapiKeys.has(operationKey(action.method, action.route))) {
      fail(`${action.method} ${action.route} is missing from OpenAPI payment operations`);
    }
  }
  if (alternate && !openapiKeys.has(operationKey("GET", alternate.route))) {
    fail(`alternate ${alternate.route} is missing from OpenAPI`);
  }
  if (mppOpenapi) {
    const mppKeys = new Set(paidOpenApiOperations(mppOpenapi).map((entry) => operationKey(entry.method, entry.route)));
    for (const action of actionRoutes) {
      if (!mppKeys.has(operationKey(action.method, action.route))) {
        fail(`${action.method} ${action.route} is missing from MPP OpenAPI`);
      }
    }
    if (alternate && mppKeys.has(operationKey("GET", alternate.route))) {
      fail("Circle alternate must not appear on MPP OpenAPI");
    }
  }

  const expectedMcp = actionRoutes.map((action) => mcpToolNameForRoute(action.route)).sort();
  const actualMcp = [...new Set(mcpToolNames || [])].sort();
  if (expectedMcp.join("\n") !== actualMcp.join("\n")) {
    fail("MCP tool names drifted from canonical paid actions");
  }

  const llmsRoutes = parseLlmsPaidRoutes(llms);
  const llmsByRoute = new Map(llmsRoutes.map((entry) => [entry.route, entry]));
  const liveActions = Array.isArray(actions) ? actions : [];
  const actionByRoute = new Map(liveActions.map((action) => [action.route, action]));
  for (const action of actionRoutes) {
    const listed = llmsByRoute.get(action.route);
    if (!listed) fail(`${action.method} ${action.route} is missing from llms.txt`);
    if (action.method === "POST" && listed.method !== "POST") {
      fail(`POST ${action.route} is listed in llms.txt without POST`);
    }
    const expectedPrice = formatLlmsPrice(action.priceAtomicUsdc).slice(1);
    if (listed.price && listed.price !== expectedPrice) {
      fail(`${action.route} llms price drifted from $${expectedPrice}`);
    }
    const live = actionByRoute.get(action.route);
    if (action.method === "GET" && live?.request) {
      const example = callableGetExample(live);
      if (listed.url !== example.exampleUrl) {
        fail(`GET ${action.route} llms href is not the callable example`);
      }
      if (!listed.query || listed.transmissible !== true) {
        fail(`GET ${action.route} llms line is not a callable query example`);
      }
    }
    if (action.method === "POST") {
      if (listed.transmissible !== false || listed.url) {
        fail(`POST ${action.route} must not be a transmissible llms URL`);
      }
      if (listed.bodyExample !== true) {
        fail(`POST ${action.route} llms line must keep a schema/body example`);
      }
    }
  }
  if (alternate) {
    const listed = llmsByRoute.get(alternate.route);
    if (!listed) fail(`alternate ${alternate.route} is missing from llms.txt`);
    if (!listed.sameProduct) fail("Circle alternate llms line must say it is the same preflight product");
    if (!listed.notSecondCatalogAction) fail("Circle alternate llms line must say it is not a second catalog action");
    if (alternate.request) {
      const example = callableGetExample({ method: "GET", route: alternate.route, request: alternate.request });
      if (listed.url !== example.exampleUrl) fail("Circle alternate llms href is not the callable example");
    }
  }

  return {
    ok: true,
    actionCount: actions.length,
    llmsCanonicalCount: actionRoutes.length,
    llmsAlternateCount: alternate ? 1 : 0,
    mcpToolCount: expectedMcp.length,
    killedCircleSurfaces: alternate ? [...CIRCLE_KILLED_SURFACES] : [],
  };
}
