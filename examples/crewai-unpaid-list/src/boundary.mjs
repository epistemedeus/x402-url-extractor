import { ALLOWED_METHODS, FORBIDDEN_PROTOCOL, PAYMENT_HEADER_NAMES } from "./constants.mjs";
import { fail } from "./errors.mjs";

const FORBIDDEN_FLAGS = Object.freeze([
  "--call",
  "--pay",
  "--approve",
  "--purchase",
  "--kickoff",
  "--tools-call",
  "--checkout",
]);

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

export function assertNoPaymentHeaders(headers) {
  for (const [name, value] of Object.entries(headers || {})) {
    const key = String(name).toLowerCase();
    if (PAYMENT_HEADER_NAMES.includes(key) && value) {
      fail("BOUNDARY_REFUSED", `refusing payment or credential header ${name}`, {
        kind: "payment_header",
      });
    }
    if (key === "mcp-method") {
      fail("BOUNDARY_REFUSED", "refusing Mcp-Method header", { kind: "mcp_method" });
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
    if (FORBIDDEN_FLAGS.includes(flag)) {
      fail("BOUNDARY_REFUSED", `refusing ${flag}; this example never calls tools or pays`, {
        kind: "forbidden_flag",
      });
    }
  }
}

export function unpaidBoundary() {
  return {
    paymentSent: false,
    toolsCalled: false,
    crewKickoff: false,
    methods: [...ALLOWED_METHODS],
  };
}
