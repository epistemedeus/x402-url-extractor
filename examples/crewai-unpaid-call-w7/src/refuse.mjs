import { fail } from "./errors.mjs";
import { NEO_LABS_CREWAI, SDS_MCP_URL } from "./pins.mjs";

export const FORBIDDEN_FLAGS = Object.freeze([
  "--live",
  "--approve",
  "--pay",
  "--payment",
  "--payment-header",
  "--payment-signature",
  "--private-key",
  "--private-key-env",
  "--wallet",
  "--kickoff",
  "--akickoff",
  "--crew",
  "--neo",
  "--publish",
  "--deploy",
]);

export const PAYMENT_HEADER_NAMES = Object.freeze([
  "authorization",
  "payment-signature",
  "x-payment",
  "x-payment-signature",
  "payment-required",
  "payment-response",
]);

const FORBIDDEN_SET = new Set(FORBIDDEN_FLAGS);

export function refuseForbiddenArgv(argv) {
  for (const arg of argv) {
    const flag = arg.split("=")[0];
    if (FORBIDDEN_SET.has(flag)) {
      fail(`refused ${flag}: this example never pays, kickoff, publishes, or uses --live`, {
        code: "BOUNDARY_REFUSED",
        kind: "refused",
        details: { flag },
      });
    }
    if (flag.startsWith("--payment") || flag.startsWith("--live") || flag.startsWith("--kickoff")) {
      fail(`refused ${flag}: payment/live/kickoff flags are out of bounds`, {
        code: "BOUNDARY_REFUSED",
        kind: "refused",
        details: { flag },
      });
    }
  }
}

export function refusePaymentHeaders(headers) {
  if (!headers || typeof headers !== "object") return;
  for (const name of Object.keys(headers)) {
    if (PAYMENT_HEADER_NAMES.includes(name.toLowerCase())) {
      fail(`refused payment header ${name}: unpaid tools/call sends no credentials`, {
        code: "PAYMENT_HEADER_REFUSED",
        kind: "refused",
        details: { header: name },
      });
    }
  }
}

export function refusePaymentMeta(meta) {
  if (!meta || typeof meta !== "object") return;
  for (const key of Object.keys(meta)) {
    if (key === "x402/payment" || key === "mpp/payment" || /payment/i.test(key)) {
      fail(`refused tools/call _meta.${key}: this example never attaches a credential`, {
        code: "PAYMENT_META_REFUSED",
        kind: "refused",
        details: { key },
      });
    }
  }
}

export function assertLoopbackMcpUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    fail(`invalid MCP URL: ${urlString}`, { code: "INVALID_URL", kind: "refused" });
  }
  if (url.protocol !== "http:") {
    fail("MCP URL must be loopback HTTP; HTTPS live merchant URLs are refused", {
      code: "NON_LOOPBACK_REFUSED",
      kind: "refused",
      details: { url: urlString },
    });
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    fail("MCP URL must be loopback (127.0.0.1); live merchant and neo labs are refused", {
      code: "NON_LOOPBACK_REFUSED",
      kind: "refused",
      details: { url: urlString },
    });
  }
  if (url.username || url.password) {
    fail("MCP URL must not contain credentials", {
      code: "CREDENTIAL_URL_REFUSED",
      kind: "refused",
    });
  }
  return url;
}

export function refuseLiveOrNeoUrl(value) {
  if (typeof value !== "string") return;
  const lower = value.toLowerCase();
  if (lower.includes("neomorphic") || lower.includes("/labs/crewai") || value === NEO_LABS_CREWAI) {
    fail("refused neo labs CrewAI URL: /labs/crewai is not a live lab in this example", {
      code: "NEO_REFUSED",
      kind: "refused",
      details: { url: value },
    });
  }
  if (value === SDS_MCP_URL || lower.includes("agents.samedaydesk.com")) {
    fail("refused live SDS MCP URL: this example is a local unpaid fixture, not --live", {
      code: "LIVE_URL_REFUSED",
      kind: "refused",
      details: { url: value },
    });
  }
}
