import { isIP } from "node:net";
/**
 * SSRF guard shared by live transport hops (initial URL and every redirect).
 */

const BLOCKED_HOST_RE =
  /^(localhost|0\.0\.0\.0|::1)$|(\.local)$|^(10\.|127\.|169\.254\.|192\.168\.|fc00:|fe80:)/i;
const BLOCKED_IPV4_172 = /^172\.(1[6-9]|2\d|3[01])\./;

export function assertPublicHttpUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw Object.assign(new Error("invalid url"), { code: "invalid_url" });
  }
  if (!/^https?:$/.test(u.protocol)) {
    throw Object.assign(new Error("only http/https supported"), { code: "invalid_protocol" });
  }
  const host = u.hostname.toLowerCase();
  if (u.username || u.password) throw Object.assign(new Error("URL credentials unsupported"), { code: "invalid_url" });
  if (host.includes(":")) throw Object.assign(new Error("private or IPv6 address unsupported in this prototype"), { code: "ssrf_blocked" });
  if (isIP(host) && !isPublicV4(host)) throw Object.assign(new Error("private/non-public host blocked"), { code: "ssrf_blocked" });
  if (BLOCKED_HOST_RE.test(host) || BLOCKED_IPV4_172.test(host)) {
    throw Object.assign(new Error("private/loopback host blocked"), { code: "ssrf_blocked" });
  }
  // Literal IPv6 loopback / unique-local without brackets quirks already covered via hostname.
  if (host === "[::1]" || host.startsWith("[fc") || host.startsWith("[fe80")) {
    throw Object.assign(new Error("private/loopback host blocked"), { code: "ssrf_blocked" });
  }
  return u;
}

export function isPublicV4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export function normalizeSourceKey(source) {
  if (typeof source !== "string") return "";
  const trimmed = source.trim();
  if (trimmed.startsWith("fixture:")) {
    return `fixture:${trimmed.slice("fixture:".length).replace(/^\/+/, "")}`;
  }
  try {
    const u = new URL(trimmed);
    u.hash = "";
    return u.href;
  } catch {
    return trimmed;
  }
}
