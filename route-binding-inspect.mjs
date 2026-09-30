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

function consumeRoute(route, into) {
  if (!route || isAllMethodRoute(route.methods)) return;
  const paths = Array.isArray(route.path) ? route.path : [route.path];
  for (const rawPath of paths) {
    if (typeof rawPath !== "string" || !rawPath.startsWith("/")) continue;
    const path = normalizePath(rawPath);
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

function walk(stack, into) {
  for (const layer of stack || []) {
    if (layer?.route) consumeRoute(layer.route, into);
    else if (Array.isArray(layer?.handle?.stack)) walk(layer.handle.stack, into);
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

function toolMatchesRoute(tool, route) {
  if (!tool || !route) return false;
  if (tool.route && tool.route !== route) return false;
  if (tool.paidHttp?.path && tool.paidHttp.path !== route) return false;
  return true;
}

export function routeBindingProblems({ bindings = [], catalog = {}, openapi = null, mcpTools = [] } = {}) {
  const problems = [];
  const actions = Array.isArray(catalog.actions) ? catalog.actions : [];
  const freeRecipes = Array.isArray(catalog.freeRecipes) ? catalog.freeRecipes : [];
  const operations = openApiOperations(openapi);
  const tools = Array.isArray(mcpTools) ? mcpTools : [];

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
    } else if (typeof tool.run !== "function") {
      problems.push(`missing-handler MCP ${name}`);
    } else if (tool.free === true) {
      problems.push(`method-mismatch ${path} catalog paid mcp free`);
    } else if (!toolMatchesRoute(tool, path)) {
      problems.push(`method-mismatch ${path} catalog ${path} mcp ${tool.route || tool.paidHttp?.path || "unbound"}`);
    } else if (tool.method && String(tool.method).toUpperCase() !== method) {
      problems.push(`method-mismatch ${path} catalog ${method} mcp ${String(tool.method).toUpperCase()}`);
    } else if (tool.paidHttp && String(tool.paidHttp.method || "").toUpperCase() !== method) {
      problems.push(`method-mismatch ${path} catalog ${method} mcp ${String(tool.paidHttp.method || "missing").toUpperCase()}`);
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
    if (typeof tool.run !== "function") problems.push(`missing-handler MCP ${tool.name || "unnamed"}`);
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
