// Browser CORS for the agents.samedaydesk.com discovery surfaces.
// Wildcard origin is credential-free. Paid 402 headers stay on the response
// and are listed in Access-Control-Expose-Headers so a browser can read them.

export const BROWSER_AGENT_CORS_PATHS = Object.freeze([
  "/mcp",
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/openapi.json",
  "/llms.txt",
  "/skill.md",
  "/.well-known/x402",
]);

export const BROWSER_AGENT_CORS_ALLOW_ORIGIN = "*";
export const BROWSER_AGENT_CORS_ALLOW_METHODS = "GET, POST, OPTIONS";
export const BROWSER_AGENT_CORS_ALLOW_HEADERS = "content-type";
export const BROWSER_AGENT_CORS_MAX_AGE = "86400";

// Response headers this gateway actually writes or replays for x402 and MPP.
export const GATEWAY_PAYMENT_EXPOSE_HEADERS = Object.freeze([
  "PAYMENT-REQUIRED",
  "PAYMENT-RESPONSE",
  "X-PAYMENT-RESPONSE",
  "WWW-Authenticate",
  "Payment-Receipt",
]);

const CREDENTIALS_HEADER = "access-control-allow-credentials";

export function createBrowserAgentCorsPolicy({
  allowOrigin = BROWSER_AGENT_CORS_ALLOW_ORIGIN,
  allowCredentials = false,
} = {}) {
  if (allowOrigin === "*" && allowCredentials) {
    throw new Error("refusing Access-Control-Allow-Credentials with Access-Control-Allow-Origin *");
  }
  if (allowCredentials) {
    throw new Error("browser agent CORS does not allow credentials");
  }
  return Object.freeze({
    allowOrigin,
    allowCredentials: false,
    allowMethods: BROWSER_AGENT_CORS_ALLOW_METHODS,
    allowHeaders: BROWSER_AGENT_CORS_ALLOW_HEADERS,
    maxAge: BROWSER_AGENT_CORS_MAX_AGE,
    exposeHeaders: GATEWAY_PAYMENT_EXPOSE_HEADERS.join(", "),
  });
}

export const BROWSER_AGENT_CORS_POLICY = createBrowserAgentCorsPolicy();

export function isBrowserAgentCorsPath(pathname) {
  const path = String(pathname || "").split("?", 1)[0];
  if (path.length > 1 && path.endsWith("/")) return false;
  return BROWSER_AGENT_CORS_PATHS.includes(path);
}

function blockCredentialHeader(res) {
  const original = res.setHeader.bind(res);
  res.setHeader = function setHeaderWithoutCredentials(name, value) {
    if (String(name).toLowerCase() === CREDENTIALS_HEADER) return res;
    return original(name, value);
  };
}

export function browserAgentCorsMiddleware(req, res, next) {
  if (!isBrowserAgentCorsPath(req.path)) return next();
  const policy = BROWSER_AGENT_CORS_POLICY;
  blockCredentialHeader(res);
  res.setHeader("Access-Control-Allow-Origin", policy.allowOrigin);
  res.setHeader("Access-Control-Expose-Headers", policy.exposeHeaders);
  if (String(req.method || "GET").toUpperCase() !== "OPTIONS") return next();
  res.setHeader("Access-Control-Allow-Methods", policy.allowMethods);
  res.setHeader("Access-Control-Allow-Headers", policy.allowHeaders);
  res.setHeader("Access-Control-Max-Age", policy.maxAge);
  res.status(204);
  res.setHeader("Content-Length", "0");
  return res.end();
}
