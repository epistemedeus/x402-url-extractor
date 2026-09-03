export function sellerIntegrityAuditSummarySchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean" },
      product: { type: "string", const: "samedaydesk-seller-integrity-audit" },
      version: { type: "string" },
      checkedAt: { type: "string", format: "date-time" },
      decision: { type: "string", enum: ["machine_buyable", "contract_ready", "repair_required"] },
      access: { type: "string", const: "summary" },
      request: {
        type: "object",
        additionalProperties: false,
        properties: {
          origin: { type: "string", format: "uri" },
          route: { type: "string" },
          method: { type: "string", enum: ["GET", "POST"] },
          requiredPaths: { type: "array", maxItems: 16, items: { type: "string" } },
          requireBazaar: { type: "boolean" },
          referral: { type: ["string", "null"] },
        },
        required: ["origin", "route", "method", "requiredPaths", "requireBazaar", "referral"],
      },
      findingCount: { type: "integer", minimum: 0 },
      auditCompleted: { type: "boolean" },
      failureCode: { type: ["string", "null"] },
      nextActions: { type: "array", items: { type: "string" } },
      report: { type: "null", description: "Field-level report is gated behind x402." },
      detail: {
        type: "object",
        additionalProperties: false,
        properties: {
          access: { type: "string", const: "payment_required" },
          priceUsdc: { type: "number", const: 0.25 },
          network: { type: "string", const: "eip155:8453" },
        },
        required: ["access", "priceUsdc", "network"],
      },
      boundary: {
        type: "object",
        additionalProperties: false,
        properties: {
          credentialsUsed: { type: "boolean", const: false },
          targetPaymentSigned: { type: "boolean", const: false },
          targetPaymentSent: { type: "boolean", const: false },
          fieldLevelReportIncluded: { type: "boolean", const: false },
        },
        required: ["credentialsUsed", "targetPaymentSigned", "targetPaymentSent", "fieldLevelReportIncluded"],
      },
    },
    required: [
      "ok",
      "product",
      "version",
      "checkedAt",
      "decision",
      "access",
      "request",
      "findingCount",
      "auditCompleted",
      "failureCode",
      "nextActions",
      "report",
      "detail",
      "boundary",
    ],
  };
}

export function summarizeSellerIntegrityAudit(full) {
  if (!full || typeof full !== "object") throw new Error("seller-integrity summary requires a completed audit");
  return Object.freeze({
    ok: Boolean(full.ok),
    product: "samedaydesk-seller-integrity-audit",
    version: full.version,
    checkedAt: full.checkedAt,
    decision: full.decision,
    access: "summary",
    request: full.request,
    findingCount: Array.isArray(full.report?.findings) ? full.report.findings.length : 0,
    auditCompleted: Boolean(full.report?.auditCompleted),
    failureCode: full.report?.failureCode ?? null,
    nextActions: [...(full.nextActions || [])],
    report: null,
    detail: Object.freeze({
      access: "payment_required",
      priceUsdc: 0.25,
      network: "eip155:8453",
    }),
    boundary: Object.freeze({
      credentialsUsed: false,
      targetPaymentSigned: false,
      targetPaymentSent: false,
      fieldLevelReportIncluded: false,
    }),
  });
}

export function attachSellerIntegritySummaryToPaymentRequired(body, summary) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !summary) return body;
  return {
    ...body,
    summary,
    detail: summary.detail,
  };
}
