import { isIP } from "node:net";

import { FORBIDDEN_CLI_FLAGS } from "./constants.mjs";
import { fail } from "./errors.mjs";

const BLOCKED_HOST_RE =
  /^(localhost|0\.0\.0\.0|::1)$|(\.local)$|^(10\.|127\.|169\.254\.|192\.168\.|fc00:|fe80:)/i;
const BLOCKED_IPV4_172 = /^172\.(1[6-9]|2\d|3[01])\./;

function isPublicV4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}

function assertPublicHost(host, field) {
  const hostname = String(host || "").toLowerCase();
  if (!hostname) fail("host is required", { code: "invalid_url", field });
  if (hostname.includes(":")) {
    fail("private or IPv6 address unsupported", { code: "ssrf_blocked", field });
  }
  if (isIP(hostname) && !isPublicV4(hostname)) {
    fail("private/non-public host blocked", { code: "ssrf_blocked", field });
  }
  if (BLOCKED_HOST_RE.test(hostname) || BLOCKED_IPV4_172.test(hostname)) {
    fail("private/loopback host blocked", { code: "ssrf_blocked", field });
  }
}

export function admitPublicHttpsUrl(raw, { field = "url" } = {}) {
  if (typeof raw !== "string" || raw.trim() === "") {
    fail("url must be a public HTTPS URL", { code: "invalid_url", field });
  }
  if (raw.length > 2048) fail("url exceeds 2048 characters", { code: "invalid_url", field });
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("url must be a public HTTPS URL", { code: "invalid_url", field });
  }
  if (url.protocol !== "https:") {
    fail("only public HTTPS URLs are accepted", { code: "invalid_protocol", field });
  }
  if (url.username || url.password) {
    fail("URL credentials unsupported", { code: "invalid_url", field });
  }
  if (url.hash) fail("URL fragment unsupported", { code: "invalid_url", field });
  assertPublicHost(url.hostname, field);
  return url;
}

export function admitPublicHttpsOrigin(raw, { field = "origin" } = {}) {
  const url = admitPublicHttpsUrl(raw, { field });
  return url.origin;
}

export function refuseForbiddenArgv(argv) {
  for (const arg of argv) {
    const flag = String(arg).split("=")[0];
    if (FORBIDDEN_CLI_FLAGS.includes(flag)) {
      fail(
        `${flag} is refused: this example lists unpaid Anthropic/Claude discovery only and never pays, checks out, publishes, or touches neo`,
        { code: "operation_refused", field: flag },
      );
    }
    const lower = flag.toLowerCase();
    if (lower.startsWith("--payment") || lower.startsWith("--x-payment") || lower === "--mcp-method") {
      fail(`${flag} is refused`, { code: "operation_refused", field: flag });
    }
  }
}

export function refusePaymentHeaders(headers) {
  if (!headers) return;
  const entries = headers instanceof Headers
    ? [...headers.entries()]
    : Object.entries(headers);
  for (const [name] of entries) {
    const key = String(name).toLowerCase();
    if (
      key === "authorization"
      || key === "proxy-authorization"
      || key === "cookie"
      || key === "x-api-key"
      || key === "x-api-token"
      || key === "api-key"
      || key === "x-payment"
      || key === "payment-signature"
      || key === "x-payment-signature"
      || key === "payment-response"
      || key === "x-payment-response"
      || key === "mcp-method"
    ) {
      fail(`request header ${name} is refused`, { code: "payment_refused", field: name });
    }
  }
}

export function assertNotMcpResource(raw, field = "origin") {
  if (String(raw || "").startsWith("mcp://")) {
    fail("mcp:// resources are refused; unpaid list uses HTTPS discovery only", {
      code: "invalid_protocol",
      field,
    });
  }
}
