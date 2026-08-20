import { readFileSync } from "node:fs";
import { SERVICE_DEPLOYMENT_ROUTES } from "./service-deployment-routes.mjs";

export const MPP_DIRECTORY_SERVICE_URL = new URL("./mpp-directory-service.json", import.meta.url);

export const MPP_DIRECTORY_CATEGORIES = Object.freeze([
  "ai",
  "blockchain",
  "compute",
  "data",
  "media",
  "search",
  "social",
  "storage",
  "web",
]);

export const MPP_DIRECTORY_INTEGRATIONS = Object.freeze(["first-party", "third-party"]);
export const MPP_DIRECTORY_STATUSES = Object.freeze(["active", "beta", "deprecated", "maintenance"]);
export const MPP_DIRECTORY_INTENTS = Object.freeze(["charge", "session"]);
export const MPP_DIRECTORY_HTTP_METHODS = Object.freeze([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const SERVICE_ID_RE = /^[a-z0-9-]+$/;
const TAG_RE = /^[a-z0-9-]+$/;
const NUMERIC_RE = /^\d+$/;
const ROUTE_RE = new RegExp(`^(${MPP_DIRECTORY_HTTP_METHODS.join("|")}) /[a-zA-Z0-9/_:.\\-*]*$`);
const HTTPS_RE = /^https:\/\//;
const CATALOG_ENDPOINT_KEYS = new Set(["route", "desc", "amount", "dynamic", "amountHint", "intent", "unitType", "docs"]);
const CATALOG_SERVICE_KEYS = new Set([
  "id",
  "name",
  "url",
  "serviceUrl",
  "description",
  "icon",
  "categories",
  "integration",
  "tags",
  "status",
  "docs",
  "provider",
  "realm",
  "intent",
  "payments",
  "docsBase",
  "endpoints",
]);
const CATALOG_DOCS_KEYS = new Set(["homepage", "llmsTxt", "apiReference"]);
const CATALOG_PAYMENT_KEYS = new Set(["method", "currency", "decimals"]);

function fail(message) {
  throw new Error(message);
}

function requireHttps(value, label) {
  if (typeof value !== "string" || !HTTPS_RE.test(value)) fail(`${label} must be an https URL`);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") fail(`${label} must be an https URL`);
  } catch {
    fail(`${label} must be an https URL`);
  }
}

export function loadMppDirectoryService({ url = MPP_DIRECTORY_SERVICE_URL } = {}) {
  return JSON.parse(readFileSync(url, "utf8"));
}

export function directoryRouteKey(endpoint) {
  return String(endpoint?.route || "");
}

export function deploymentRouteKey(route) {
  return `${route.method} ${route.path}`;
}

/**
 * Validate an official mpp.dev `schemas/services.ts` ServiceDef-shaped object.
 * Unknown keys are rejected because discovery.schema.json sets additionalProperties: false
 * on Service and Endpoint. Request and output contracts therefore cannot live here;
 * they stay on the linked OpenAPI document at docs.apiReference.
 */
export function validateMppDirectoryService(service) {
  if (!service || typeof service !== "object" || Array.isArray(service)) {
    fail("directory service must be an object");
  }
  for (const key of Object.keys(service)) {
    if (!CATALOG_SERVICE_KEYS.has(key)) fail(`unsupported catalog field: ${key}`);
  }
  if (!SERVICE_ID_RE.test(String(service.id || ""))) fail("service id must be lowercase kebab-case");
  if (!String(service.name || "").trim()) fail("service name is required");
  requireHttps(service.url, "url");
  requireHttps(service.serviceUrl, "serviceUrl");
  if (!String(service.description || "").trim()) fail("description is required");
  if (service.icon) requireHttps(service.icon, "icon");
  if (!Array.isArray(service.categories) || service.categories.length === 0) fail("categories are required");
  const categorySet = new Set();
  for (const category of service.categories) {
    if (!MPP_DIRECTORY_CATEGORIES.includes(category)) fail(`invalid category: ${category}`);
    if (categorySet.has(category)) fail(`duplicate category: ${category}`);
    categorySet.add(category);
  }
  if (!MPP_DIRECTORY_INTEGRATIONS.includes(service.integration)) fail("integration must be first-party or third-party");
  if (!Array.isArray(service.tags) || service.tags.length === 0) fail("tags are required");
  const tagSet = new Set();
  for (const tag of service.tags) {
    if (!TAG_RE.test(tag)) fail(`tag is not lowercase kebab-case: ${tag}`);
    if (tagSet.has(tag)) fail(`duplicate tag: ${tag}`);
    tagSet.add(tag);
  }
  if (service.status && !MPP_DIRECTORY_STATUSES.includes(service.status)) fail(`invalid status: ${service.status}`);
  if (!MPP_DIRECTORY_INTENTS.includes(service.intent)) fail("intent must be charge or session");
  if (!String(service.realm || "").trim()) fail("realm is required");
  if (!service.docs || typeof service.docs !== "object") fail("docs are required");
  for (const key of Object.keys(service.docs)) {
    if (!CATALOG_DOCS_KEYS.has(key)) fail(`unsupported docs field: ${key}`);
  }
  requireHttps(service.docs.homepage, "docs.homepage");
  requireHttps(service.docs.llmsTxt, "docs.llmsTxt");
  requireHttps(service.docs.apiReference, "docs.apiReference");
  if (!service.docs.apiReference.endsWith("/mpp-openapi.json")) {
    fail("docs.apiReference must point at the live MPP OpenAPI discovery document");
  }
  if (!service.provider?.name || !service.provider?.url) fail("provider name and url are required");
  requireHttps(service.provider.url, "provider.url");
  if (!Array.isArray(service.payments) || service.payments.length === 0) fail("at least one payment method is required");
  for (const payment of service.payments) {
    for (const key of Object.keys(payment)) {
      if (!CATALOG_PAYMENT_KEYS.has(key)) fail(`unsupported payment field: ${key}`);
    }
    if (!payment.method || !payment.currency) fail("payment method and currency are required");
    if (!Number.isInteger(payment.decimals) || payment.decimals < 0 || payment.decimals > 18) {
      fail("payment decimals must be an integer 0-18");
    }
  }
  if (service.payments[0].method !== "evm") fail("SameDayDesk catalog payment method must be evm");
  if (!Array.isArray(service.endpoints) || service.endpoints.length === 0) fail("at least one endpoint is required");
  const routes = new Set();
  for (const endpoint of service.endpoints) {
    for (const key of Object.keys(endpoint)) {
      if (!CATALOG_ENDPOINT_KEYS.has(key)) fail(`unsupported endpoint field: ${key}`);
    }
    if ("request" in endpoint || "requestSchema" in endpoint || "outputSchema" in endpoint || "responses" in endpoint) {
      fail("catalog endpoints cannot carry request or output schemas");
    }
    if (!ROUTE_RE.test(endpoint.route)) fail(`invalid route: ${endpoint.route}`);
    if (routes.has(endpoint.route)) fail(`duplicate route: ${endpoint.route}`);
    routes.add(endpoint.route);
    if (!String(endpoint.desc || "").trim()) fail(`empty description for ${endpoint.route}`);
    if (endpoint.amount !== undefined) {
      if (!NUMERIC_RE.test(String(endpoint.amount))) fail(`amount must be a numeric string: ${endpoint.route}`);
      if (endpoint.dynamic === true) fail(`${endpoint.route} has both amount and dynamic`);
    }
    if (endpoint.amountHint !== undefined && endpoint.dynamic !== true) {
      fail(`${endpoint.route} has amountHint without dynamic`);
    }
    if (endpoint.unitType && endpoint.unitType !== "request") fail(`${endpoint.route} unitType must be request`);
  }
  return {
    endpointCount: service.endpoints.length,
    id: service.id,
    paymentMethod: service.payments[0].method,
  };
}

export function compareDirectoryToDeploymentRoutes(
  service,
  routes = SERVICE_DEPLOYMENT_ROUTES,
) {
  const directoryRoutes = service.endpoints.map(directoryRouteKey).sort();
  const deploymentRoutes = routes.map(deploymentRouteKey).sort();
  const missingFromDirectory = deploymentRoutes.filter((route) => !directoryRoutes.includes(route));
  const extraInDirectory = directoryRoutes.filter((route) => !deploymentRoutes.includes(route));
  if (missingFromDirectory.length || extraInDirectory.length) {
    fail(
      `directory routes drift from service deployment inventory: missing=${missingFromDirectory.join(",") || "none"}; extra=${extraInDirectory.join(",") || "none"}`,
    );
  }
  return { routeCount: directoryRoutes.length, routes: directoryRoutes };
}

export function evmOffersFromOpenApi(document) {
  const offers = [];
  for (const [path, item] of Object.entries(document?.paths || {})) {
    if (!item || typeof item !== "object") continue;
    for (const [method, operation] of Object.entries(item)) {
      if (!MPP_DIRECTORY_HTTP_METHODS.includes(method.toUpperCase())) continue;
      if (!operation || typeof operation !== "object") continue;
      const paymentOffers = operation["x-payment-info"]?.offers;
      if (!Array.isArray(paymentOffers)) continue;
      const evm = paymentOffers.find((offer) => offer?.method === "evm");
      if (!evm) continue;
      offers.push({
        amount: String(evm.amount || ""),
        hasRequestSchema: Boolean(
          Object.values(operation.requestBody?.content || {}).some((media) => media?.schema),
        ),
        hasSuccessSchema: ["200", "201"].some((code) => (
          Object.values(operation.responses?.[code]?.content || {}).some((media) => media?.schema)
        )),
        route: `${method.toUpperCase()} ${path}`,
      });
    }
  }
  return offers.sort((left, right) => left.route.localeCompare(right.route));
}

export function compareDirectoryToOpenApiOffers(service, document) {
  const directory = new Map(service.endpoints.map((endpoint) => [endpoint.route, endpoint.amount]));
  const live = new Map(evmOffersFromOpenApi(document).map((offer) => [offer.route, offer.amount]));
  const missing = [...directory.keys()].filter((route) => !live.has(route));
  const extra = [...live.keys()].filter((route) => !directory.has(route));
  const drifted = [...directory.entries()]
    .filter(([route, amount]) => live.has(route) && live.get(route) !== amount)
    .map(([route, amount]) => `${route} catalog=${amount} live=${live.get(route)}`);
  if (missing.length || extra.length || drifted.length) {
    fail(
      `directory economics drift from OpenAPI evm offers: missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}; drifted=${drifted.join(",") || "none"}`,
    );
  }
  return { offerCount: directory.size };
}

export function catalogContainsService(catalog, id = "samedaydesk") {
  const services = Array.isArray(catalog?.services) ? catalog.services : [];
  return services.some((service) => service?.id === id || String(service?.serviceUrl || "").includes("agents.samedaydesk.com"));
}

export function renderServicesTsEntry(service = loadMppDirectoryService()) {
  validateMppDirectoryService(service);
  const quote = (value) => JSON.stringify(value);
  const indent = (depth, line) => `${"  ".repeat(depth)}${line}`;
  const lines = [
    indent(1, "{"),
    indent(2, `id: ${quote(service.id)},`),
    indent(2, `name: ${quote(service.name)},`),
    indent(2, `url: ${quote(service.url)},`),
    indent(2, `serviceUrl: ${quote(service.serviceUrl)},`),
    indent(2, "description:"),
    indent(3, `${quote(service.description)},`),
    indent(2, `icon: ${quote(service.icon)},`),
    indent(2, `categories: ${JSON.stringify(service.categories)},`),
    indent(2, `integration: ${quote(service.integration)},`),
    indent(2, "tags: ["),
    ...service.tags.map((tag) => indent(3, `${quote(tag)},`)),
    indent(2, "],"),
    indent(2, `status: ${quote(service.status)},`),
    indent(2, "docs: {"),
    indent(3, `homepage: ${quote(service.docs.homepage)},`),
    indent(3, `llmsTxt: ${quote(service.docs.llmsTxt)},`),
    indent(3, `apiReference: ${quote(service.docs.apiReference)},`),
    indent(2, "},"),
    indent(2, `provider: { name: ${quote(service.provider.name)}, url: ${quote(service.provider.url)} },`),
    indent(2, `realm: ${quote(service.realm)},`),
    indent(2, `intent: ${quote(service.intent)},`),
    indent(2, "payments: ["),
    indent(3, "{"),
    indent(4, `method: ${quote(service.payments[0].method)},`),
    indent(4, `currency: ${quote(service.payments[0].currency)},`),
    indent(4, `decimals: ${service.payments[0].decimals},`),
    indent(3, "},"),
    indent(2, "],"),
    indent(2, "endpoints: ["),
  ];
  for (const endpoint of service.endpoints) {
    lines.push(indent(3, "{"));
    lines.push(indent(4, `route: ${quote(endpoint.route)},`));
    lines.push(indent(4, `desc: ${quote(endpoint.desc)},`));
    lines.push(indent(4, `amount: ${quote(endpoint.amount)},`));
    lines.push(indent(4, `unitType: ${quote(endpoint.unitType)},`));
    lines.push(indent(3, "},"));
  }
  lines.push(indent(2, "],"));
  lines.push(indent(1, "},"));
  return `${lines.join("\n")}\n`;
}
