import {
  SellerIntegrityAuditError,
  normalizeSellerIntegrityAuditInput,
  sellerIntegrityAudit,
  sellerIntegrityAuditOutputSchema,
  SELLER_INTEGRITY_AUDIT_EXAMPLE,
} from "./seller-integrity-audit.mjs";

const DEFAULT_MONITOR_ORIGIN = "https://agents.samedaydesk.com";

export class X402MonitorError extends SellerIntegrityAuditError {
  constructor(message, options) {
    super(message, options);
    this.name = "X402MonitorError";
  }
}

export function normalizeX402MonitorInput(input = {}, { defaultOrigin = DEFAULT_MONITOR_ORIGIN } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new X402MonitorError("input must be an object");
  }
  const allowed = new Set(["origin", "route", "method", "requiredPaths", "requireBazaar", "referral"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) throw new X402MonitorError(`unsupported input field: ${unknown.sort()[0]}`);
  if (input.referral !== undefined && input.referral !== null) {
    throw new X402MonitorError("unsupported input field: referral");
  }
  if (!String(input.route || "").trim()) {
    throw new X402MonitorError("route must be one exact absolute path without parameters, query, or fragment");
  }
  try {
    return normalizeSellerIntegrityAuditInput({
      ...input,
      origin: String(input.origin || defaultOrigin).trim() || defaultOrigin,
      referral: null,
    });
  } catch (error) {
    throw new X402MonitorError(error?.message || "invalid monitor request", {
      code: error?.code,
      statusCode: error?.statusCode,
    });
  }
}

export function x402MonitorOutputSchema() {
  return {
    ...sellerIntegrityAuditOutputSchema(),
    properties: {
      ...sellerIntegrityAuditOutputSchema().properties,
      product: { type: "string", const: "samedaydesk-x402-monitor" },
    },
  };
}

export const X402_MONITOR_EXAMPLE = Object.freeze({
  ...SELLER_INTEGRITY_AUDIT_EXAMPLE,
  product: "samedaydesk-x402-monitor",
});

export async function x402Monitor(input, options = {}) {
  const request = normalizeX402MonitorInput(input, options);
  const result = await sellerIntegrityAudit(request, options);
  return {
    ...result,
    product: "samedaydesk-x402-monitor",
  };
}
