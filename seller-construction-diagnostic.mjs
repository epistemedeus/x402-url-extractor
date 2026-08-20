import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

import { fetchPinnedTargetJson } from "./agent-discoverability-audit.mjs";
import {
  PaymentOfferPreflightError,
  createPinnedLookup,
  normalizePaymentTarget,
  resolvePublicAddress,
} from "./payment-offer-preflight.mjs";

const PRODUCT = "samedaydesk-seller-construction-diagnostic";
const VERSION = "1.0.0";
const ROUTE = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/;
const SENSITIVE_INPUT_NAME = /(?:^|[-_.])(auth|authorization|bearer|cookie|credential|jwt|key|otp|pass(?:word)?|secret|session|signature|token)(?:$|[-_.])/i;
const SENSITIVE_INPUT_NAME_COLLAPSED = /(?:api|access|auth|authorization|bearer|client|cookie|credential|private|session)?(?:jwt|key|otp|pass|password|secret|signature|token)$/i;
const SAFE_INPUT_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const MAX_ROUTES = 16;
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5_000;
const USER_AGENT = "SameDayDesk-Seller-Construction-Diagnostic/1.0 (+https://samedaydesk.com)";
const SURFACES = Object.freeze({
  openapi: "/openapi.json",
  x402: "/.well-known/x402",
  a2a: "/.well-known/agent-card.json",
  catalog: "/api/actions",
  mcp: "/mcp",
});

export class SellerConstructionDiagnosticError extends Error {
  constructor(message, { code = "invalid_request", statusCode = 400 } = {}) {
    super(message);
    this.name = "SellerConstructionDiagnosticError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function safeInputName(name) {
  const value = String(name || "");
  return SAFE_INPUT_NAME.test(value)
    && !SENSITIVE_INPUT_NAME.test(value)
    && !SENSITIVE_INPUT_NAME_COLLAPSED.test(value.replaceAll(/[-_.]/g, ""));
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))].sort();
}

function missingKeys(required, present) {
  const have = new Set(present);
  return required.filter((key) => !have.has(key));
}

function urlQueryKeys(value) {
  if (typeof value !== "string" || !value.startsWith("https://")) return [];
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return [];
    return uniqueSorted([...url.searchParams.keys()].filter(safeInputName));
  } catch {
    return [];
  }
}

function urlPathname(value) {
  if (typeof value !== "string" || !value.startsWith("https://")) return null;
  try {
    const url = new URL(value);
    return url.pathname || null;
  } catch {
    return null;
  }
}

function httpsUrlInText(value) {
  if (typeof value !== "string") return [];
  return uniqueSorted((value.match(/https:\/\/[^\s"'<>]+/g) || []).map((item) => item.replace(/[),.;]+$/, "")));
}

function routeToToolName(route) {
  return String(route || "").replace(/^\//, "").replaceAll("/", "_").replaceAll("-", "_");
}

function mentionsRoute(value, route) {
  if (typeof value !== "string") return false;
  return value.split(/\s+/).some((token) => token
    .replace(/^[('"`]+/, "")
    .replace(/[)'"`,.;:!?]+$/, "") === route);
}

export function normalizeSellerConstructionDiagnosticInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SellerConstructionDiagnosticError("input must be an object");
  }
  const allowed = new Set(["origin", "route", "method"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) throw new SellerConstructionDiagnosticError(`unsupported input field: ${unknown.sort()[0]}`);

  let target;
  try {
    target = normalizePaymentTarget(String(input.origin || ""));
  } catch {
    throw new SellerConstructionDiagnosticError("origin must be a credential-free public HTTPS origin on port 443");
  }
  if (target.pathname !== "/" || target.search || target.port) {
    throw new SellerConstructionDiagnosticError("origin must not contain a path, query, fragment, or non-default port");
  }

  const hasRoute = input.route !== undefined && input.route !== null && input.route !== "";
  const hasMethod = input.method !== undefined && input.method !== null && input.method !== "";
  if (hasMethod && !hasRoute) {
    throw new SellerConstructionDiagnosticError("method requires an exact route");
  }
  let route = null;
  if (hasRoute) {
    route = String(input.route);
    if (!ROUTE.test(route) || route.includes("{") || route.includes("?") || route.includes("#")) {
      throw new SellerConstructionDiagnosticError("route must be one exact absolute path without parameters, query, or fragment");
    }
  }
  let method = null;
  if (hasMethod || hasRoute) {
    method = String(hasMethod ? input.method : "GET").toUpperCase();
    if (!["GET", "POST"].includes(method)) {
      throw new SellerConstructionDiagnosticError("method must be GET or POST");
    }
  }
  return Object.freeze({ origin: target.origin, method, route });
}

export function sellerConstructionDiagnosticOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean" },
      product: { type: "string", const: PRODUCT },
      version: { type: "string", const: VERSION },
      checkedAt: { type: "string", format: "date-time" },
      decision: { type: "string", enum: ["pass", "repair_required"] },
      request: {
        type: "object",
        additionalProperties: false,
        properties: {
          origin: { type: "string", format: "uri" },
          method: { type: ["string", "null"], enum: ["GET", "POST", null] },
          route: { type: ["string", "null"] },
        },
        required: ["origin", "method", "route"],
      },
      surfaces: {
        type: "object",
        additionalProperties: false,
        properties: {
          mcp: { type: "object" },
          openapi: { type: "object" },
          x402: { type: "object" },
          a2a: { type: "object" },
          catalog: { type: "object" },
        },
        required: ["mcp", "openapi", "x402", "a2a", "catalog"],
      },
      routes: {
        type: "array",
        maxItems: MAX_ROUTES,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            method: { type: "string", enum: ["GET", "POST"] },
            route: { type: "string" },
            requiredInputs: { type: "array", items: { type: "string" } },
            findings: { type: "array", items: { type: "string" } },
          },
          required: ["method", "route", "requiredInputs", "findings"],
        },
      },
      findings: { type: "array", items: { type: "string" } },
      acceptance: { type: "array", items: { type: "string" } },
      boundary: {
        type: "object",
        additionalProperties: false,
        properties: {
          credentialsUsed: { type: "boolean", const: false },
          targetPaymentSigned: { type: "boolean", const: false },
          targetPaymentSent: { type: "boolean", const: false },
          paidTargetBodyRead: { type: "boolean", const: false },
          redirectsFollowed: { type: "boolean", const: false },
          queryValuesRetained: { type: "boolean", const: false },
          toolsCalled: { type: "boolean", const: false },
        },
        required: [
          "credentialsUsed",
          "targetPaymentSigned",
          "targetPaymentSent",
          "paidTargetBodyRead",
          "redirectsFollowed",
          "queryValuesRetained",
          "toolsCalled",
        ],
      },
    },
    required: ["ok", "product", "version", "checkedAt", "decision", "request", "surfaces", "routes", "findings", "acceptance", "boundary"],
  };
}

export const SELLER_CONSTRUCTION_DIAGNOSTIC_EXAMPLE = Object.freeze({
  ok: false,
  product: PRODUCT,
  version: VERSION,
  checkedAt: "2026-08-20T12:00:00.000Z",
  decision: "repair_required",
  request: { origin: "https://seller.example", method: "GET", route: "/extract" },
  surfaces: {
    mcp: { available: true, failureCode: null, toolCount: 1, toolsListed: true },
    openapi: { available: true, failureCode: null, paidOperationCount: 1 },
    x402: { available: true, failureCode: null, itemCount: 1, x402Version: 2 },
    a2a: { available: true, failureCode: null, skillCount: 2 },
    catalog: { available: true, failureCode: null, actionCount: 1 },
  },
  routes: [{
    method: "GET",
    route: "/extract",
    requiredInputs: ["url"],
    findings: ["x402_resource_url_drops_required_input", "catalog_example_url_drops_required_input", "a2a_example_url_drops_required_input"],
  }],
  findings: ["x402_resource_url_drops_required_input", "catalog_example_url_drops_required_input", "a2a_example_url_drops_required_input"],
  acceptance: [
    "GET /extract x402 resource URL drops required query key url. Publish a callable resource URL that includes every required non-secret query key.",
    "GET /extract catalog example URL drops required query key url. Refresh the action catalog so request.exampleUrl includes url.",
    "GET /extract A2A skill drops required query key url. Include the complete callable example URL in the paid-action skill.",
  ],
  boundary: {
    credentialsUsed: false,
    targetPaymentSigned: false,
    targetPaymentSent: false,
    paidTargetBodyRead: false,
    redirectsFollowed: false,
    queryValuesRetained: false,
    toolsCalled: false,
  },
});

function surfaceFailure(error) {
  const message = String(error?.message || error);
  const code = error?.code === "ssrf_rejected" || /not public|ssrf/i.test(message)
    ? "ssrf_rejected"
    : error?.code === "dns_failed" || /could not be resolved|no resolved address/i.test(message)
      ? "dns_failed"
      : /timed out/i.test(message)
        ? "transport_timeout"
        : /HTTP 401|HTTP 403/.test(message)
          ? "authentication_required"
          : /HTTP 402/.test(message)
            ? "payment_required"
            : /HTTP 404|surface unavailable/i.test(message)
              ? "surface_unavailable"
              : /malformed JSON|did not return JSON|must be an object/i.test(message)
                ? "surface_invalid"
                : /too large|exceeded/i.test(message)
                  ? "surface_too_large"
                  : "bounded_transport_failure";
  return { available: false, failureCode: code };
}

function unavailableSurface(kind) {
  return {
    available: false,
    failureCode: "surface_unavailable",
    ...(kind === "mcp" ? { toolCount: 0, toolsListed: false } : {}),
    ...(kind === "openapi" ? { paidOperationCount: 0 } : {}),
    ...(kind === "x402" ? { itemCount: 0, x402Version: null } : {}),
    ...(kind === "a2a" ? { skillCount: 0 } : {}),
    ...(kind === "catalog" ? { actionCount: 0 } : {}),
  };
}

export async function fetchDiagnosticJson(urlValue, {
  lookupImpl = dnsLookup,
  requestImpl = httpsRequest,
} = {}) {
  return fetchPinnedTargetJson(urlValue, {
    lookupImpl,
    requestImpl,
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
  });
}

function parseRpc(text, label) {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.startsWith("data: "));
  const raw = lines.length ? lines.at(-1).slice(6) : text;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
  if (payload?.error) throw new Error(`${label} returned JSON-RPC error`);
  return payload;
}

export async function acquireMcpTools(origin, {
  lookupImpl = dnsLookup,
  requestImpl = httpsRequest,
} = {}) {
  const endpoint = new URL("/mcp", origin);
  const resolved = await resolvePublicAddress(endpoint.hostname.replace(/^\[|\]$/g, ""), { lookupImpl });
  const rpc = async (method, params, id) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const response = await new Promise((resolve, reject) => {
      let settled = false;
      const req = requestImpl(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": USER_AGENT,
        },
        lookup: createPinnedLookup(resolved),
      }, (incoming) => {
        const status = Number(incoming.statusCode || 0);
        if (status !== 200) {
          settled = true;
          incoming.destroy();
          reject(new Error(`/mcp returned HTTP ${status}`));
          return;
        }
        const chunks = [];
        let size = 0;
        incoming.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            settled = true;
            incoming.destroy();
            reject(new Error("/mcp response exceeded the byte ceiling"));
          } else {
            chunks.push(chunk);
          }
        });
        incoming.on("end", () => {
          if (settled) return;
          settled = true;
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      });
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("/mcp request timed out")));
      req.once("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      req.write(body);
      req.end();
    });
    return parseRpc(response, method);
  };
  await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "samedaydesk-seller-construction-diagnostic", version: VERSION },
  }, 1);
  const listed = await rpc("tools/list", {}, 2);
  const tools = Array.isArray(listed?.result?.tools) ? listed.result.tools.slice(0, 500) : [];
  return tools.map((tool) => ({
    name: typeof tool?.name === "string" ? tool.name.slice(0, 128) : "",
    required: uniqueSorted((Array.isArray(tool?.inputSchema?.required) ? tool.inputSchema.required : [])
      .filter(safeInputName)),
  })).filter((tool) => tool.name);
}

function requiredQueryKeys(operation) {
  const keys = [];
  for (const parameter of operation?.parameters || []) {
    if (parameter?.in !== "query" || parameter?.required !== true) continue;
    if (safeInputName(parameter.name)) keys.push(String(parameter.name));
  }
  const bodyRequired = operation?.requestBody?.content?.["application/json"]?.schema?.required;
  if (Array.isArray(bodyRequired)) {
    for (const name of bodyRequired) {
      if (safeInputName(name)) keys.push(String(name));
    }
  }
  return uniqueSorted(keys);
}

function isPaidOperation(operation) {
  return Boolean(operation?.["x-payment-info"] || operation?.responses?.["402"] || operation?.responses?.[402]);
}

function extractOpenApiOperations(document, request) {
  const operations = [];
  for (const [path, pathItem] of Object.entries(record(document?.paths) || {})) {
    if (!ROUTE.test(path) || path.includes("{")) continue;
    for (const method of ["get", "post"]) {
      const operation = record(pathItem?.[method]);
      if (!operation || !isPaidOperation(operation)) continue;
      if (request.route && (path !== request.route || method.toUpperCase() !== request.method)) continue;
      operations.push({
        method: method.toUpperCase(),
        route: path,
        requiredInputs: requiredQueryKeys(operation),
      });
      if (operations.length >= MAX_ROUTES) return operations;
    }
  }
  return operations.sort((left, right) => `${left.method} ${left.route}`.localeCompare(`${right.method} ${right.route}`));
}

function extractX402Items(document) {
  const items = Array.isArray(document?.items) ? document.items : [];
  return items.slice(0, 200).map((item) => {
    const resource = item?.resource;
    const resourceUrl = typeof resource === "string" ? resource : resource?.url;
    const route = typeof resource?.routeTemplate === "string"
      ? resource.routeTemplate
      : urlPathname(resourceUrl);
    const exampleUrl = typeof item?.request?.exampleUrl === "string" ? item.request.exampleUrl : null;
    const queryFromExample = record(item?.request?.example?.queryParams);
    const exampleKeys = queryFromExample ? uniqueSorted(Object.keys(queryFromExample).filter(safeInputName)) : [];
    const schemaRequired = Array.isArray(item?.request?.schema?.properties?.queryParams?.required)
      ? uniqueSorted(item.request.schema.properties.queryParams.required.filter(safeInputName))
      : [];
    return {
      route,
      resourceUrl,
      exampleUrl,
      urlKeys: uniqueSorted([...urlQueryKeys(resourceUrl), ...urlQueryKeys(exampleUrl), ...exampleKeys]),
      hasRequestContract: Boolean(record(item?.request?.schema) && record(item?.request?.example)),
      schemaRequired,
      resourceIsString: typeof resource === "string",
      resourceIsObject: Boolean(record(resource)),
    };
  }).filter((item) => item.route);
}

function extractCatalogActions(document) {
  const actions = Array.isArray(document?.actions) ? document.actions : [];
  return actions.slice(0, 200).map((action) => {
    const route = typeof action?.route === "string" ? action.route : urlPathname(action?.url);
    const method = String(action?.method || "GET").toUpperCase();
    const exampleUrl = typeof action?.request?.exampleUrl === "string" ? action.request.exampleUrl : null;
    const queryFromExample = record(action?.request?.example?.queryParams);
    const exampleKeys = queryFromExample ? uniqueSorted(Object.keys(queryFromExample).filter(safeInputName)) : [];
    return {
      method,
      route,
      exampleUrl,
      urlKeys: uniqueSorted([...urlQueryKeys(action?.url), ...urlQueryKeys(exampleUrl), ...exampleKeys]),
      hasRequestContract: Boolean(record(action?.request?.schema) && record(action?.request?.example)),
    };
  }).filter((action) => action.route && ["GET", "POST"].includes(action.method));
}

function extractA2aSkills(document) {
  const skills = Array.isArray(document?.skills) ? document.skills : [];
  return skills.slice(0, 200).map((skill) => {
    const texts = [skill?.id, skill?.name, skill?.description, ...(Array.isArray(skill?.examples) ? skill.examples : [])];
    const urls = uniqueSorted(texts.flatMap((value) => httpsUrlInText(value)));
    return {
      texts: texts.filter((value) => typeof value === "string"),
      urls,
      urlKeysByPath: Object.fromEntries(urls.map((url) => [urlPathname(url), urlQueryKeys(url)])),
    };
  });
}

function matchX402(items, route) {
  return items.filter((item) => item.route === route);
}

function matchCatalog(actions, method, route) {
  return actions.filter((action) => action.route === route && action.method === method);
}

function matchA2a(skills, route) {
  return skills.filter((skill) => skill.texts.some((text) => mentionsRoute(text, route))
    || Object.keys(skill.urlKeysByPath).includes(route));
}

function matchMcp(tools, route) {
  const name = routeToToolName(route);
  return tools.filter((tool) => tool.name === name || tool.name === route.replace(/^\//, "").replaceAll("/", "_"));
}

function acceptanceFor(method, route, finding, missing) {
  const keys = missing.length ? missing.join(", ") : "required non-secret inputs";
  const target = `${method} ${route}`;
  if (finding === "x402_resource_url_drops_required_input") {
    return `${target} x402 resource URL drops required query key ${keys}. Publish a callable resource URL that includes every required non-secret query key.`;
  }
  if (finding === "x402_v1_v2_resource_split") {
    return `${target} x402 v2 resource object is path-only, so v1 clients that flatten resource.url drop ${keys}. Bind the complete callable URL on the v2 resource and keep the v1 string form identical.`;
  }
  if (finding === "x402_request_contract_missing" || finding === "bazaar_contract_missing") {
    return `${target} is missing a Bazaar request contract. Publish input schema plus example queryParams so catalog and v1 clients can construct the call.`;
  }
  if (finding === "catalog_example_url_drops_required_input") {
    return `${target} catalog example URL drops required query key ${keys}. Refresh the action catalog so request.exampleUrl includes ${keys}.`;
  }
  if (finding === "catalog_action_missing") {
    return `${target} is declared in OpenAPI or x402 but missing from the action catalog. Refresh the catalog after settlement so every paid route is listed.`;
  }
  if (finding === "catalog_request_contract_missing") {
    return `${target} catalog action has no request schema and example. Publish the Bazaar input contract on the catalog action.`;
  }
  if (finding === "a2a_example_url_drops_required_input") {
    return `${target} A2A skill drops required query key ${keys}. Include the complete callable example URL in the paid-action skill.`;
  }
  if (finding === "a2a_skill_missing") {
    return `${target} has no A2A paid-action skill. Add a route skill whose description includes the complete callable example URL.`;
  }
  if (finding === "mcp_required_input_mismatch") {
    return `${target} MCP required inputs do not match OpenAPI required query keys (${keys}). Align MCP inputSchema.required with the OpenAPI operation.`;
  }
  if (finding === "mcp_required_input_undeclared") {
    return `${target} OpenAPI requires ${keys} but MCP does not declare those inputs. Add the same required non-secret keys to the MCP tool.`;
  }
  if (finding === "openapi_route_missing") {
    return `${target} was requested but is not a paid OpenAPI operation. Declare the exact paid operation in /openapi.json.`;
  }
  return `${target} needs seller construction repair: ${finding}.`;
}

function surfaceAcceptance(name, surface) {
  if (surface.available) return null;
  if (surface.failureCode === "payment_required") {
    return `Publish a credential-free ${name} discovery surface. Construction diagnostics must not require a payment challenge.`;
  }
  if (surface.failureCode === "authentication_required") {
    return `Publish a credential-free ${name} discovery surface. Construction diagnostics use no credentials.`;
  }
  return `Publish a reachable same-origin ${name} document so inbound clients can verify constructible inputs.`;
}

function analyzeRoute(operation, { x402Items, catalogActions, a2aSkills, mcpTools, x402Version }) {
  const findings = [];
  const acceptance = [];
  const add = (finding, missing = []) => {
    if (findings.includes(finding)) return;
    findings.push(finding);
    acceptance.push(acceptanceFor(operation.method, operation.route, finding, missing));
  };

  const x402 = matchX402(x402Items, operation.route);
  const catalog = matchCatalog(catalogActions, operation.method, operation.route);
  const a2a = matchA2a(a2aSkills, operation.route);
  const mcp = matchMcp(mcpTools, operation.route);
  const required = operation.requiredInputs;

  if (mcp.length) {
    const mcpRequired = uniqueSorted(mcp.flatMap((tool) => tool.required));
    const missingFromMcp = missingKeys(required, mcpRequired);
    const extraFromOpenApi = missingKeys(mcpRequired, required);
    if (missingFromMcp.length) add("mcp_required_input_undeclared", missingFromMcp);
    else if (extraFromOpenApi.length && required.length) add("mcp_required_input_mismatch", extraFromOpenApi);
  }

  if (required.length && operation.method === "GET") {
    if (!x402.length) {
      add("x402_resource_url_drops_required_input", required);
    } else {
      for (const item of x402) {
        const missing = missingKeys(required, item.urlKeys);
        if (missing.length) add("x402_resource_url_drops_required_input", missing);
        if (item.resourceIsObject && missingKeys(required, urlQueryKeys(item.resourceUrl)).length) {
          add("x402_v1_v2_resource_split", missingKeys(required, urlQueryKeys(item.resourceUrl)));
        }
        if (x402Version === 2 && item.resourceIsString) add("x402_v1_v2_resource_split", required);
        if (!item.hasRequestContract) add("x402_request_contract_missing");
      }
    }
    if (!catalog.length) add("catalog_action_missing");
    else {
      for (const action of catalog) {
        const missing = missingKeys(required, action.urlKeys);
        if (missing.length) add("catalog_example_url_drops_required_input", missing);
        if (!action.hasRequestContract) add("catalog_request_contract_missing");
      }
    }
    if (!a2a.length) add("a2a_skill_missing");
    else {
      const skillKeys = uniqueSorted(a2a.flatMap((skill) => skill.urlKeysByPath[operation.route] || skill.urls
        .filter((url) => urlPathname(url) === operation.route)
        .flatMap((url) => urlQueryKeys(url))));
      const missing = missingKeys(required, skillKeys);
      if (missing.length) add("a2a_example_url_drops_required_input", missing);
    }
  } else {
    if (!x402.length && !catalog.length) add("catalog_action_missing");
    if (x402.length && x402.every((item) => !item.hasRequestContract) && catalog.every((action) => !action.hasRequestContract)) {
      add("bazaar_contract_missing");
    }
  }

  if (
    (x402.length && x402.every((item) => !item.hasRequestContract))
    && (catalog.length && catalog.every((action) => !action.hasRequestContract))
    && !findings.includes("bazaar_contract_missing")
    && !findings.includes("x402_request_contract_missing")
  ) {
    add("bazaar_contract_missing");
  }

  return { ...operation, findings, acceptance };
}

function boundary() {
  return {
    credentialsUsed: false,
    targetPaymentSigned: false,
    targetPaymentSent: false,
    paidTargetBodyRead: false,
    redirectsFollowed: false,
    queryValuesRetained: false,
    toolsCalled: false,
  };
}

export async function sellerConstructionDiagnostic(input, {
  surfaceFetchImpl = fetchDiagnosticJson,
  mcpToolsImpl = acquireMcpTools,
  now = () => new Date(),
} = {}) {
  const request = normalizeSellerConstructionDiagnosticInput(input);
  const fetched = {};
  await Promise.all(Object.entries(SURFACES).map(async ([name, path]) => {
    try {
      fetched[name] = { available: true, failureCode: null, document: await surfaceFetchImpl(`${request.origin}${path}`) };
    } catch (error) {
      fetched[name] = { ...unavailableSurface(name), ...surfaceFailure(error) };
    }
  }));

  let mcpTools = [];
  let toolsListed = false;
  if (fetched.mcp.available) {
    try {
      mcpTools = await mcpToolsImpl(request.origin);
      toolsListed = true;
    } catch (error) {
      fetched.mcp = {
        ...fetched.mcp,
        toolsListed: false,
        failureCode: surfaceFailure(error).failureCode === "surface_unavailable"
          ? fetched.mcp.failureCode
          : surfaceFailure(error).failureCode,
      };
    }
  }

  const openapiOps = fetched.openapi.available ? extractOpenApiOperations(fetched.openapi.document, request) : [];
  const x402Items = fetched.x402.available ? extractX402Items(fetched.x402.document) : [];
  const catalogActions = fetched.catalog.available ? extractCatalogActions(fetched.catalog.document) : [];
  const a2aSkills = fetched.a2a.available ? extractA2aSkills(fetched.a2a.document) : [];
  const x402Version = Number.isInteger(fetched.x402.document?.x402Version) ? fetched.x402.document.x402Version : null;

  const surfaces = {
    mcp: {
      available: fetched.mcp.available,
      failureCode: fetched.mcp.available && toolsListed ? null : fetched.mcp.failureCode,
      toolCount: toolsListed ? mcpTools.length : (Number.isInteger(fetched.mcp.document?.toolCount) ? fetched.mcp.document.toolCount : 0),
      toolsListed,
    },
    openapi: {
      available: fetched.openapi.available,
      failureCode: fetched.openapi.failureCode,
      paidOperationCount: openapiOps.length,
    },
    x402: {
      available: fetched.x402.available,
      failureCode: fetched.x402.failureCode,
      itemCount: x402Items.length,
      x402Version,
    },
    a2a: {
      available: fetched.a2a.available,
      failureCode: fetched.a2a.failureCode,
      skillCount: a2aSkills.length,
    },
    catalog: {
      available: fetched.catalog.available,
      failureCode: fetched.catalog.failureCode,
      actionCount: catalogActions.length,
    },
  };

  const findings = [];
  const acceptance = [];
  for (const [name, surface] of Object.entries(surfaces)) {
    const item = surfaceAcceptance(name, surface);
    if (!surface.available) {
      findings.push(`surface_unavailable:${name}`);
      if (item) acceptance.push(item);
    }
  }

  let operations = openapiOps;
  if (request.route && fetched.openapi.available && !operations.length) {
    operations = [{ method: request.method, route: request.route, requiredInputs: [] }];
    findings.push("openapi_route_missing");
    acceptance.push(acceptanceFor(request.method, request.route, "openapi_route_missing", []));
  } else if (request.route && !fetched.openapi.available) {
    operations = [{ method: request.method, route: request.route, requiredInputs: [] }];
  } else if (!request.route && !operations.length && x402Items.length) {
    operations = x402Items.slice(0, MAX_ROUTES).map((item) => ({
      method: "GET",
      route: item.route,
      requiredInputs: item.schemaRequired,
    }));
  }

  const routes = operations.slice(0, MAX_ROUTES).map((operation) => {
    const analyzed = analyzeRoute(operation, { x402Items, catalogActions, a2aSkills, mcpTools, x402Version });
    findings.push(...analyzed.findings);
    acceptance.push(...analyzed.acceptance);
    return {
      method: analyzed.method,
      route: analyzed.route,
      requiredInputs: analyzed.requiredInputs,
      findings: analyzed.findings,
    };
  });

  const uniqueFindings = uniqueSorted(findings);
  const uniqueAcceptance = [...new Set(acceptance)];
  const decision = uniqueFindings.length ? "repair_required" : "pass";
  return {
    ok: decision === "pass",
    product: PRODUCT,
    version: VERSION,
    checkedAt: now().toISOString(),
    decision,
    request,
    surfaces,
    routes,
    findings: uniqueFindings,
    acceptance: uniqueAcceptance,
    boundary: boundary(),
  };
}

export function createSellerConstructionDiagnosticHandler({
  diagnosticImpl = sellerConstructionDiagnostic,
} = {}) {
  return async function serveSellerConstructionDiagnostic(req, res) {
    res.set("Cache-Control", "no-store");
    try {
      const report = await diagnosticImpl(req.query || {});
      return res.status(200).json(report);
    } catch (error) {
      if (error instanceof SellerConstructionDiagnosticError) {
        return res.status(error.statusCode).json({
          ok: false,
          product: PRODUCT,
          error: error.message,
          charged: false,
          boundary: { credentialsUsed: false, targetPaymentSigned: false, targetPaymentSent: false },
        });
      }
      if (error instanceof PaymentOfferPreflightError && error.statusCode === 400) {
        return res.status(400).json({
          ok: false,
          product: PRODUCT,
          error: "origin must be a credential-free public HTTPS origin on port 443",
          charged: false,
          boundary: { credentialsUsed: false, targetPaymentSigned: false, targetPaymentSent: false },
        });
      }
      return res.status(200).json({
        ok: false,
        product: PRODUCT,
        version: VERSION,
        checkedAt: new Date().toISOString(),
        decision: "repair_required",
        request: { origin: String(req.query?.origin || ""), method: null, route: null },
        surfaces: {
          mcp: unavailableSurface("mcp"),
          openapi: unavailableSurface("openapi"),
          x402: unavailableSurface("x402"),
          a2a: unavailableSurface("a2a"),
          catalog: unavailableSurface("catalog"),
        },
        routes: [],
        findings: ["bounded_transport_failure"],
        acceptance: ["Restore the seller discovery surfaces, then rerun the unpaid construction diagnostic."],
        boundary: boundary(),
      });
    }
  };
}
