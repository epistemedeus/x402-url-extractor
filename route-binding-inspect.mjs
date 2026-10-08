// Inspect Express method/handler bindings and compare them with the catalog,
// OpenAPI document, and MCP tool handlers. Never pays, settles, or deploys.

import { mcpToolNameForRoute } from "./machine-surface-parity.mjs";

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const OPENAPI_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

function normalizePath(value) {
  const path = String(value || "").split("?")[0];
  if (path.length > 1 && path.endsWith("/")) return path.replace(/\/+$/, "");
  return path;
}

function isAllMethodRoute(methods) {
  return Boolean(methods?.get && methods?.post && methods?.put && methods?.patch && methods?.delete);
}

function handlerName(handle) {
  if (typeof handle !== "function") return null;
  return handle.name || "(anonymous)";
}

function ensureMethod(entry, method) {
  if (!entry.methods[method]) {
    entry.methods[method] = { explicit: true, handlerCount: 0, handlerNames: [] };
  }
  return entry.methods[method];
}

function joinRoutePath(prefix, routePath) {
  const path = normalizePath(routePath);
  if (!prefix) return path;
  if (!path || path === "/") return prefix;
  return normalizePath(`${prefix}${path.startsWith("/") ? path : `/${path}`}`);
}

// Express 4 stores a router mount only in its regexp. Recover a static prefix
// so nested routes and path aliases keep the public path. A parameter or an
// unrecognized regexp adds nothing, which leaves those layers on the parent path.
function staticMountPrefix(layer) {
  if (!layer || layer.route || layer.regexp?.fast_slash || layer.regexp?.fast_star) return "";
  const source = layer.regexp?.source;
  if (typeof source !== "string") return "";
  const suffix = "\\/?(?=\\/|$)";
  if (!source.endsWith(suffix)) return "";
  const body = source.slice(0, -suffix.length);
  if (body.includes("(")) return "";
  const match = /^\^((?:\\\/(?:\\.|[^\\])+)*)/.exec(body);
  if (!match?.[1]) return "";
  const decoded = match[1].replace(/\\(.)/g, "$1");
  return decoded.startsWith("/") ? normalizePath(decoded) : "";
}

function consumeRoute(route, into, prefix = "") {
  if (!route || isAllMethodRoute(route.methods)) return;
  const paths = Array.isArray(route.path) ? route.path : [route.path];
  for (const rawPath of paths) {
    if (typeof rawPath !== "string" || !rawPath.startsWith("/")) continue;
    const path = joinRoutePath(prefix, rawPath);
    if (!into.has(path)) into.set(path, { path, methods: {} });
    const entry = into.get(path);
    for (const layer of route.stack || []) {
      const method = String(layer.method || "").toUpperCase();
      if (!HTTP_METHODS.has(method)) continue;
      const bucket = ensureMethod(entry, method);
      if (typeof layer.handle === "function") {
        bucket.handlerCount += 1;
        bucket.handlerNames.push(handlerName(layer.handle));
      }
    }
  }
}

function walk(stack, into, prefix = "") {
  for (const layer of stack || []) {
    if (layer?.route) consumeRoute(layer.route, into, prefix);
    else if (Array.isArray(layer?.handle?.stack)) {
      const mounted = staticMountPrefix(layer);
      walk(layer.handle.stack, into, mounted ? joinRoutePath(prefix, mounted) : prefix);
    }
  }
}

export function collectExpressBindings(app) {
  const into = new Map();
  walk(app?._router?.stack, into);
  return [...into.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function openApiOperations(document) {
  const operations = [];
  for (const [path, item] of Object.entries(document?.paths || {})) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    for (const method of OPENAPI_METHODS) {
      const operation = item[method];
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) continue;
      operations.push({ method: method.toUpperCase(), path: normalizePath(path), operation });
    }
  }
  return operations;
}

function methodBinding(bindings, path, method) {
  return bindings.find((entry) => entry.path === path)?.methods?.[method] || null;
}

function requireHandler(bindings, method, path, problems, label) {
  const binding = methodBinding(bindings, path, method);
  const entry = bindings.find((item) => item.path === path);
  if (!binding) {
    const present = Object.keys(entry?.methods || {});
    if (present.length) {
      problems.push(`method-mismatch ${path} ${label} ${method} express ${present.join(",")}`);
    } else {
      problems.push(`missing-handler ${method} ${path}`);
    }
    return false;
  }
  if (binding.handlerCount < 1) {
    problems.push(`missing-handler ${method} ${path}`);
    return false;
  }
  return true;
}

function paidHttpParts(paidHttp) {
  if (!paidHttp || typeof paidHttp !== "object" || Array.isArray(paidHttp)) return null;
  return {
    method: String(paidHttp.method || "").toUpperCase(),
    path: normalizePath(paidHttp.path || ""),
  };
}

function paidHttpComplete(parts) {
  return Boolean(parts && HTTP_METHODS.has(parts.method) && parts.path.startsWith("/"));
}

// extract_batch and lockfile_pin_delta are HTTP proxies: a complete paidHttp
// method and path is the handler. A callable run remains sufficient for local tools.
function paidMcpToolProblems(tool, method, path, name) {
  const problems = [];
  if (tool.route && normalizePath(tool.route) !== path) {
    problems.push(`method-mismatch ${path} catalog ${path} mcp ${normalizePath(tool.route)}`);
  }
  if (tool.method && String(tool.method).toUpperCase() !== method) {
    problems.push(`method-mismatch ${path} catalog ${method} mcp ${String(tool.method).toUpperCase()}`);
  }
  if (tool.paidHttp == null) {
    if (typeof tool.run !== "function") problems.push(`missing-handler MCP ${name}`);
    return problems;
  }
  const parts = paidHttpParts(tool.paidHttp);
  if (!paidHttpComplete(parts)) {
    problems.push(`malformed-paid-http MCP ${name}`);
    return problems;
  }
  if (parts.path !== path) {
    problems.push(`method-mismatch ${path} catalog ${path} mcp ${parts.path}`);
  }
  if (parts.method !== method) {
    problems.push(`method-mismatch ${path} catalog ${method} mcp ${parts.method}`);
  }
  return problems;
}

export function routeBindingProblems({ bindings = [], catalog = {}, openapi = null, mcpTools = [] } = {}) {
  const problems = [];
  const actions = Array.isArray(catalog.actions) ? catalog.actions : [];
  const freeRecipes = Array.isArray(catalog.freeRecipes) ? catalog.freeRecipes : [];
  const operations = openApiOperations(openapi);
  const tools = Array.isArray(mcpTools) ? mcpTools : [];

  // Every OpenAPI method needs an Express handler. Tool names are path-derived, so a
  // second method on the same path does not mint a second MCP identity.
  for (const operation of operations) {
    requireHandler(bindings, operation.method, operation.path, problems, "openapi");
  }

  for (const action of actions) {
    const method = String(action.method || "GET").toUpperCase();
    const path = normalizePath(action.route);
    requireHandler(bindings, method, path, problems, "catalog");
    const operation = operations.find((item) => item.path === path && item.method === method);
    if (!operation) {
      const present = operations.filter((item) => item.path === path).map((item) => item.method);
      problems.push(present.length
        ? `method-mismatch ${path} catalog ${method} openapi ${present.join(",")}`
        : `openapi-missing ${method} ${path}`);
    } else if (!operation.operation["x-payment-info"]) {
      problems.push(`openapi-payment-missing ${method} ${path}`);
    }
    const name = mcpToolNameForRoute(path);
    const tool = tools.find((item) => item.name === name);
    if (!tool) {
      problems.push(`missing-handler MCP ${name}`);
    } else if (tool.free === true) {
      problems.push(`method-mismatch ${path} catalog paid mcp free`);
    } else {
      problems.push(...paidMcpToolProblems(tool, method, path, name));
    }
  }

  for (const recipe of freeRecipes) {
    const method = String(recipe.method || "POST").toUpperCase();
    const path = normalizePath(recipe.route);
    if (recipe.charged !== false) problems.push(`free-route-charged ${path}`);
    if (recipe.priceAtomicUsdc != null) problems.push(`free-route-priced ${path}`);
    if (actions.some((action) => normalizePath(action.route) === path)) {
      problems.push(`free-route-in-paid-catalog ${path}`);
    }
    requireHandler(bindings, method, path, problems, "free-recipe");
    const operation = operations.find((item) => item.path === path && item.method === method);
    if (!operation) {
      problems.push(`openapi-missing ${method} ${path}`);
    } else {
      if (operation.operation["x-payment-info"]) problems.push(`openapi-payment-on-free ${path}`);
      if (operation.operation.responses?.["402"]) problems.push(`openapi-402-on-free ${path}`);
      const chargedConst = operation.operation.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.charged?.const;
      if (chargedConst !== false) problems.push(`openapi-charged-const ${path}`);
    }
    const name = mcpToolNameForRoute(path);
    const tool = tools.find((item) => item.name === name);
    if (!tool || typeof tool.run !== "function") {
      problems.push(`missing-handler MCP ${name}`);
    } else if (tool.free !== true || tool.paidHttp) {
      problems.push(`method-mismatch ${path} free-recipe mcp paid`);
    } else if (String(tool.method || "").toUpperCase() !== method || (tool.route && tool.route !== path)) {
      problems.push(`method-mismatch ${path} catalog ${method} mcp ${String(tool.method || "missing").toUpperCase()}`);
    }
  }

  const knownNames = new Set([
    ...actions.map((action) => mcpToolNameForRoute(action.route)),
    ...freeRecipes.map((recipe) => mcpToolNameForRoute(recipe.route)),
  ]);
  for (const tool of tools) {
    const hasRun = typeof tool.run === "function";
    const completeProxy = paidHttpComplete(paidHttpParts(tool.paidHttp));
    if (!hasRun && tool.paidHttp == null) problems.push(`missing-handler MCP ${tool.name || "unnamed"}`);
    else if (!hasRun && !completeProxy) problems.push(`malformed-paid-http MCP ${tool.name || "unnamed"}`);
    if (!knownNames.has(tool.name)) problems.push(`mcp-unlisted ${tool.name || "unnamed"}`);
  }

  const alternate = catalog.alternateAccess;
  if (alternate?.route) {
    const method = String(alternate.method || "GET").toUpperCase();
    const path = normalizePath(alternate.route);
    if (actions.some((action) => normalizePath(action.route) === path && String(action.method || "GET").toUpperCase() === method)) {
      problems.push(`alternate-in-paid-catalog ${method} ${path}`);
    }
    requireHandler(bindings, method, path, problems, "alternate");
    if (!operations.some((item) => item.path === path && item.method === method)) {
      problems.push(`openapi-missing ${method} ${path}`);
    }
    if (tools.some((tool) => tool.route === path || tool.paidHttp?.path === path)) {
      problems.push(`mcp-lists-alternate ${path}`);
    }
  }

  return [...new Set(problems)].sort();
}

export function buildRouteBindingReport({ app, catalog, openapi, mcpTools }) {
  const bindings = collectExpressBindings(app);
  const problems = routeBindingProblems({ bindings, catalog, openapi, mcpTools });
  const pageChange = bindings.find((entry) => entry.path === "/recipes/page-change");
  const pageChangeTool = (mcpTools || []).find((tool) => tool.name === "page_change");
  return {
    ok: problems.length === 0,
    problems,
    inspected: bindings.length,
    catalogActions: (catalog?.actions || []).length,
    freeRecipes: (catalog?.freeRecipes || []).length,
    mcpTools: (mcpTools || []).length,
    proxyTools: (mcpTools || []).filter((tool) => paidHttpComplete(paidHttpParts(tool?.paidHttp)) && typeof tool.run !== "function").map((tool) => ({
      name: tool.name,
      method: String(tool.paidHttp.method || "").toUpperCase(),
      path: normalizePath(tool.paidHttp.path),
    })),
    pageChange: {
      method: pageChange?.methods?.POST ? "POST" : null,
      handlerPresent: (pageChange?.methods?.POST?.handlerCount || 0) > 0,
      handlerNames: pageChange?.methods?.POST?.handlerNames || [],
      catalogCharged: catalog?.freeRecipes?.find((recipe) => recipe.route === "/recipes/page-change")?.charged ?? null,
      mcpHandlerPresent: typeof pageChangeTool?.run === "function",
      mcpMethod: pageChangeTool?.method || null,
    },
    routes: bindings.map((entry) => ({
      path: entry.path,
      methods: Object.keys(entry.methods).sort().map((method) => ({
        method,
        handlerCount: entry.methods[method].handlerCount,
        handlerNames: entry.methods[method].handlerNames,
      })),
    })),
  };
}
