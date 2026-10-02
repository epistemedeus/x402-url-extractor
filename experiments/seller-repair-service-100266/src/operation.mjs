const ROUTE = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/;
const PATH = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,7}$/;
export const ORIGIN_ERROR = "origin must be a credential-free public HTTPS origin on port 443";

function fail(message) {
  const error = new Error(message);
  error.code = "invalid_operation";
  throw error;
}

export function operationIdFor(method, resource) {
  return `${String(method || "").toUpperCase()} ${resource || ""}`;
}

export function normalizeOperation({ origin, route, method, requiredPaths }) {
  let url;
  try {
    url = new URL(String(origin || ""));
  } catch {
    fail(ORIGIN_ERROR);
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || (url.port && url.port !== "443")
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search
    || url.hash
    || !url.hostname.includes(".")
    || url.hostname === "localhost"
    || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
    || url.hostname.includes(":")
    || !/^[a-z0-9.-]+$/i.test(url.hostname)
  ) {
    fail(ORIGIN_ERROR);
  }
  const methodName = String(method || "GET").toUpperCase();
  if (methodName !== "GET") fail("method must be GET");
  const resource = String(route || "");
  if (!ROUTE.test(resource) || resource.includes("{") || resource.includes("?") || resource.includes("#")) {
    fail("route must be one exact absolute path without parameters, query, or fragment");
  }
  const rawPaths = Array.isArray(requiredPaths) ? requiredPaths : [];
  const paths = [...new Set(rawPaths.map((path) => String(path).trim()))].sort();
  if (paths.length > 16 || paths.some((path) => !PATH.test(path))) {
    fail("requiredPaths must contain at most 16 safe dotted JSON paths");
  }
  return Object.freeze({
    origin: url.origin,
    route: resource,
    method: methodName,
    requiredPaths: Object.freeze(paths),
  });
}
