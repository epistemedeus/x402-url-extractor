import { LIVE_MCP_URL } from "./constants.mjs";
import { fail } from "./errors.mjs";

function isLoopback(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function assertListUrl(value, { allowLoopback = true } = {}) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    fail("URL_REFUSED", "mcp url must be an absolute http(s) URL");
  }
  if (!/^https?:$/.test(url.protocol)) {
    fail("URL_REFUSED", "mcp url must be http(s)");
  }
  if (url.username || url.password) {
    fail("URL_REFUSED", "mcp url must not include credentials");
  }
  if (url.hash) {
    fail("URL_REFUSED", "mcp url must not include a fragment");
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/mcp") {
    fail("URL_REFUSED", "mcp url path must be /mcp");
  }
  const loopback = isLoopback(url.hostname);
  if (url.protocol === "http:" && !loopback) {
    fail("URL_REFUSED", "http is only allowed for loopback test servers");
  }
  if (loopback) {
    if (!allowLoopback) fail("URL_REFUSED", "loopback mcp url is not the live pin");
    if (url.protocol !== "http:") fail("URL_REFUSED", "loopback test servers must use http");
    return `${url.origin}/mcp`;
  }
  const pinned = `${url.origin}/mcp`;
  if (pinned !== LIVE_MCP_URL) {
    fail("URL_REFUSED", `non-loopback mcp url must be ${LIVE_MCP_URL}`);
  }
  return LIVE_MCP_URL;
}
