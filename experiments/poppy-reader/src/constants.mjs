// Lab identity for this optional adapter. These names are configuration, not a deployment
// and not a public Poppy support claim. Protocol URLs stay https origins.

export const PROTOCOL_VERSION = "0.3";

export const DEFAULT_ORIGIN = "https://reader.lab.example";
export const DEFAULT_ISSUER = "https://issuer.lab.example";
export const DEFAULT_ORGANIZATION = "Reader lab";

// Merchant defaults from server.js. The paid guard passes the same price string,
// recipient, and network into the existing x402 middleware. It does not settle.
export const DEFAULT_PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
export const DEFAULT_NETWORK = "eip155:8453";
export const DEFAULT_READ_PRICE = "$0.005";

export const POPPY_DISCOVERY_PATH = "/.well-known/poppy.json";
export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
export const OPENAPI_PATH = "/poppy/v0/openapi.json";
export const EXCLUDED_TASKS_PATH = "/poppy/v0/excluded-tasks.json";
export const TRIAL_READ_PATH = "/poppy/v0/trial-read";
export const PAID_READ_GUARD_PATH = "/poppy/v0/paid-read";
export const TRIAL_OPERATION_ID = "trialRead";

export const SESSION_HEADER = "poppy-session";
export const MAX_SESSION_HEADER_CHARS = 16384;

export const PAYMENT_HEADER_NAMES = Object.freeze([
  "payment-signature",
  "x-payment",
  "x-payment-signature",
]);

export function assertHttpsOrigin(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an https origin`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`${label} must be an https origin without a path, query, or userinfo`);
  }
  if (!url.hostname.includes(".")) throw new Error(`${label} host must be a domain`);
  return url.origin;
}
