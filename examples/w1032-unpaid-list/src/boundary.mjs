import {
  ALLOWED_METHODS,
  FORBIDDEN_FLAGS,
  FORBIDDEN_HOST_FRAGMENTS,
  FORBIDDEN_PROTOCOL,
  PAYMENT_HEADER_NAMES,
} from "./constants.mjs";
import { fail } from "./errors.mjs";

export function assertAllowedMethod(method) {
  if (method === "tools/call") {
    fail("BOUNDARY_REFUSED", "tools/call is outside this unpaid list example", {
      kind: "tools_called",
    });
  }
  if (!ALLOWED_METHODS.includes(method)) {
    fail("BOUNDARY_REFUSED", `MCP method ${method} is not unpaid discovery`, {
      kind: "method_refused",
    });
  }
}

export function headerLooksPaidOrCredential(name) {
  const key = String(name || "").toLowerCase();
  if (PAYMENT_HEADER_NAMES.includes(key)) return true;
  if (key.includes("payment")) return true;
  if (key === "mcp-method") return true;
  return false;
}

export function assertNoPaymentHeaders(headers) {
  for (const [name, value] of Object.entries(headers || {})) {
    const key = String(name).toLowerCase();
    if (headerLooksPaidOrCredential(name) && (value || key === "mcp-method")) {
      if (key === "mcp-method") {
        fail("BOUNDARY_REFUSED", "refusing Mcp-Method header", { kind: "mcp_method" });
      }
      fail("BOUNDARY_REFUSED", `refusing payment or credential header ${name}`, {
        kind: "payment_header",
      });
    }
  }
}

export function assertUnpaidProtocol(protocolVersion) {
  if (protocolVersion === FORBIDDEN_PROTOCOL) {
    fail("PROTOCOL_REFUSED", `refusing protocolVersion ${FORBIDDEN_PROTOCOL}`, {
      kind: "forbidden_protocol",
    });
  }
}

export function assertNoForbiddenFlags(argv) {
  for (const flag of argv) {
    const token = String(flag || "");
    const name = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
    if (FORBIDDEN_FLAGS.includes(name)) {
      fail("BOUNDARY_REFUSED", `refusing ${name}; this example never calls tools, pays, publishes, or uses neo`, {
        kind: "forbidden_flag",
        details: { flag: name },
      });
    }
  }
}

export function hostLooksNeo(value) {
  const text = String(value || "").toLowerCase();
  return FORBIDDEN_HOST_FRAGMENTS.some((fragment) => text.includes(fragment));
}

export function assertNotNeoHost(value, label = "url") {
  if (hostLooksNeo(value)) {
    fail("BOUNDARY_REFUSED", `refusing neo host on ${label}`, {
      kind: "neo_host",
    });
  }
}

export function assertNoPublish(methods) {
  const list = Array.isArray(methods) ? methods : [];
  for (const method of list) {
    const name = String(method || "");
    if (/publish|registry|marketplace/i.test(name)) {
      fail("BOUNDARY_REFUSED", `refusing publish method ${name}`, {
        kind: "publish",
      });
    }
  }
}

export function unpaidBoundary() {
  return {
    paymentSent: false,
    toolsCalled: false,
    published: false,
    neoUsed: false,
    methods: [...ALLOWED_METHODS],
  };
}
