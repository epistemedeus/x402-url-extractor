import { isIP } from "node:net";
import { DISCOVERY_PATH, DISCOVERY_PATHS } from "./constants.mjs";
import { fail } from "./errors.mjs";

const BLOCKED_HOST_RE = /^(localhost|0\.0\.0\.0|::1)$|(\.local)$/i;

function isPublicV4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}

export function admitPublicHttpsUrl(raw, { field = "url", allowQuery = true } = {}) {
  if (typeof raw !== "string" || raw.trim() === "") {
    fail("url must be a public HTTPS URL", "invalid_discovery_url", field);
  }
  if (raw.length > 2048) fail("url exceeds 2048 characters", "invalid_discovery_url", field);
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("url must be a public HTTPS URL", "invalid_discovery_url", field);
  }
  if (String(url.protocol).toLowerCase() === "mcp:") {
    fail("mcp:// resources are refused; use HTTPS well-known discovery only", "invalid_discovery_url", field);
  }
  if (url.protocol !== "https:") {
    fail("only public HTTPS URLs are accepted", "invalid_discovery_url", field);
  }
  if (url.username || url.password) {
    fail("URL credentials unsupported", "invalid_discovery_url", field);
  }
  if (url.hash) fail("URL fragment unsupported", "invalid_discovery_url", field);
  if (!allowQuery && url.search) fail("discovery origin must not include a query", "invalid_origin", field);
  const host = url.hostname.toLowerCase();
  if (host.includes(":")) fail("private or IPv6 address unsupported", "invalid_discovery_url", field);
  if (BLOCKED_HOST_RE.test(host)) fail("private or local host unsupported", "invalid_discovery_url", field);
  if (isIP(host) && !isPublicV4(host)) fail("private or local host unsupported", "invalid_discovery_url", field);
  if (url.port && url.port !== "443") fail("non-443 ports unsupported", "invalid_discovery_url", field);
  return url;
}

export function admitOrigin(raw) {
  const url = admitPublicHttpsUrl(raw, { field: "origin", allowQuery: false });
  if (url.pathname !== "/" && url.pathname !== "") {
    fail("origin must not include a path; pass --url for a discovery document", "invalid_origin", "origin");
  }
  return url.origin;
}

export function admitDiscoveryUrl(raw) {
  const url = admitPublicHttpsUrl(raw, { field: "url", allowQuery: false });
  if (!DISCOVERY_PATHS.includes(url.pathname)) {
    fail(
      `discovery URL path must be one of ${DISCOVERY_PATHS.join(", ")}; paid routes are not listed by fetching them`,
      "invalid_discovery_url",
      "url",
    );
  }
  return url.toString();
}

export function discoveryUrlForOrigin(origin) {
  return `${admitOrigin(origin)}${DISCOVERY_PATH}`;
}
