import {
  ALLOWED_HTTP_METHODS,
  ALLOWED_RPC_METHODS,
  CREDENTIAL_HEADER_NAMES,
  LIVE_MCP_HOST,
  LIVE_MCP_PATH,
  REFUSED_CLI_FLAGS,
} from "./constants.mjs";
import { PolicyRefusal } from "./errors.mjs";

const ALLOWED_RPC = new Set(ALLOWED_RPC_METHODS);
const ALLOWED_HTTP = new Set(ALLOWED_HTTP_METHODS);
const CREDENTIAL_HEADERS = new Set(CREDENTIAL_HEADER_NAMES);

export function assertMcpListUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    throw new PolicyRefusal("url must be an absolute HTTP(S) URL", { field: "url" });
  }
  if (url.username || url.password) {
    throw new PolicyRefusal("url must not contain credentials", { field: "url" });
  }
  if (url.hash) {
    throw new PolicyRefusal("url must not contain a fragment", { field: "url" });
  }
  if (url.search) {
    throw new PolicyRefusal("url must not contain a query", { field: "url" });
  }
  if (url.pathname !== LIVE_MCP_PATH) {
    throw new PolicyRefusal("url path must be /mcp", { field: "url" });
  }

  const host = url.hostname.toLowerCase();
  if (host === LIVE_MCP_HOST) {
    if (url.protocol !== "https:") {
      throw new PolicyRefusal("SameDayDesk MCP url must use HTTPS", { field: "url" });
    }
    if (url.port && url.port !== "443") {
      throw new PolicyRefusal("SameDayDesk MCP url must use the default HTTPS port", { field: "url" });
    }
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  }

  if (host === "127.0.0.1" || host === "localhost") {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new PolicyRefusal("loopback MCP url must use HTTP(S)", { field: "url" });
    }
    return url.origin + url.pathname;
  }

  throw new PolicyRefusal("url host is not SameDayDesk MCP or loopback", { field: "url" });
}

export function assertNoCredentialHeaders(headers) {
  const names = headerNames(headers);
  for (const name of names) {
    if (CREDENTIAL_HEADERS.has(name)) {
      throw new PolicyRefusal(`credential or payment header refused: ${name}`, { field: name });
    }
  }
}

export function assertAllowedHttpMethod(method) {
  const normalized = String(method || "GET").toUpperCase();
  if (!ALLOWED_HTTP.has(normalized)) {
    throw new PolicyRefusal(`HTTP method ${normalized} is refused`, { field: "method" });
  }
  return normalized;
}

export function assertAllowedRpcMethod(method) {
  if (method == null || method === "") return null;
  const name = String(method);
  if (name === "tools/call") {
    throw new PolicyRefusal("tools/call is refused; this example only lists tools unpaid", {
      field: "method",
    });
  }
  if (!ALLOWED_RPC.has(name)) {
    throw new PolicyRefusal(
      `MCP method ${name} is refused; this example only lists tools unpaid`,
      { field: "method" },
    );
  }
  return name;
}

export function refusedCliFlag(arg) {
  const token = String(arg || "");
  const flag = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
  if (REFUSED_CLI_FLAGS.includes(flag)) return flag;
  return null;
}

function headerNames(headers) {
  if (!headers) return [];
  if (typeof headers.forEach === "function") {
    const names = [];
    headers.forEach((_value, name) => names.push(String(name).toLowerCase()));
    return names;
  }
  if (Array.isArray(headers)) {
    return headers.map((entry) => String(entry?.[0] || "").toLowerCase());
  }
  return Object.keys(headers).map((name) => name.toLowerCase());
}
