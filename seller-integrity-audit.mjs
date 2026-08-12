import { auditOrigin, normalizeOrigin } from "agent-payment-integrity";

const ROUTE = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/;

export class SellerIntegrityAuditError extends Error {
  constructor(message, { code = "invalid_request", statusCode = 400 } = {}) {
    super(message);
    this.name = "SellerIntegrityAuditError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function normalizeSellerIntegrityAuditInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SellerIntegrityAuditError("input must be an object");
  }
  const allowed = new Set(["origin", "route", "requireBazaar"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) throw new SellerIntegrityAuditError(`unsupported input field: ${unknown.sort()[0]}`);

  let origin;
  try {
    origin = normalizeOrigin(String(input.origin || "")).origin;
  } catch {
    throw new SellerIntegrityAuditError("origin must be a credential-free public HTTPS origin on port 443");
  }
  const route = String(input.route || "");
  if (!ROUTE.test(route) || route.includes("{") || route.includes("?") || route.includes("#")) {
    throw new SellerIntegrityAuditError("route must be one exact absolute path without parameters, query, or fragment");
  }
  if (input.requireBazaar !== undefined && typeof input.requireBazaar !== "boolean" && !["true", "false"].includes(input.requireBazaar)) {
    throw new SellerIntegrityAuditError("requireBazaar must be true or false");
  }
  return Object.freeze({
    origin,
    route,
    requireBazaar: input.requireBazaar === true || input.requireBazaar === "true",
  });
}

export function sellerIntegrityAuditOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean" },
      product: { type: "string", const: "samedaydesk-seller-integrity-audit" },
      version: { type: "string", const: "1.0.0" },
      checkedAt: { type: "string", format: "date-time" },
      decision: { type: "string", enum: ["machine_buyable", "repair_required"] },
      request: {
        type: "object",
        additionalProperties: false,
        properties: {
          origin: { type: "string", format: "uri" },
          route: { type: "string" },
          requireBazaar: { type: "boolean" },
        },
        required: ["origin", "route", "requireBazaar"],
      },
      report: {
        type: "object",
        additionalProperties: false,
        properties: {
          auditCompleted: { type: "boolean" },
          failureCode: { type: ["string", "null"] },
          schemaVersion: { type: ["string", "null"] },
          sellerVersions: {
            type: ["object", "null"],
            properties: { x402: { type: ["string", "null"] }, mpp: { type: ["string", "null"] } },
          },
          status: { type: ["integer", "null"] },
          protocols: { type: "array", items: { type: "string" } },
          valid: { type: "boolean" },
          findings: { type: "array", items: { type: "string" } },
          economics: { type: ["object", "null"] },
          discovery: { type: ["object", "null"] },
          responseContract: { type: ["object", "null"] },
        },
        required: ["auditCompleted", "failureCode", "schemaVersion", "sellerVersions", "status", "protocols", "valid", "findings", "economics", "discovery", "responseContract"],
      },
      nextActions: { type: "array", items: { type: "string" } },
      boundary: {
        type: "object",
        additionalProperties: false,
        properties: {
          credentialsUsed: { type: "boolean", const: false },
          targetPaymentSigned: { type: "boolean", const: false },
          targetPaymentSent: { type: "boolean", const: false },
          redirectsFollowed: { type: "boolean", const: false },
          responseBodyRead: { type: "boolean", const: false },
          schemaRetained: { type: "boolean", const: false },
          queryValuesRetained: { type: "boolean", const: false },
        },
        required: ["credentialsUsed", "targetPaymentSigned", "targetPaymentSent", "redirectsFollowed", "responseBodyRead", "schemaRetained", "queryValuesRetained"],
      },
    },
    required: ["ok", "product", "version", "checkedAt", "decision", "request", "report", "nextActions", "boundary"],
  };
}

export const SELLER_INTEGRITY_AUDIT_EXAMPLE = Object.freeze({
  ok: true,
  product: "samedaydesk-seller-integrity-audit",
  version: "1.0.0",
  checkedAt: "2026-08-12T07:50:00.000Z",
  decision: "machine_buyable",
  request: { origin: "https://agents.samedaydesk.com", route: "/commerce/payment-offer-preflight", requireBazaar: true },
  report: {
    auditCompleted: true,
    failureCode: null,
    schemaVersion: "agent-payment-integrity.audit.v2",
    sellerVersions: { x402: "1.18.3", mpp: "1.18.3" },
    status: 402,
    protocols: ["mpp", "x402"],
    valid: true,
    findings: [],
    economics: { x402: { amountAtomic: "5000" }, mpp: { amountAtomic: "5000" } },
    discovery: { bazaar: { present: true, valid: true } },
    responseContract: { decision: "admissible", requiredPaths: ["boundary", "decision", "offers", "ok"] },
  },
  nextActions: [],
  boundary: {
    credentialsUsed: false,
    targetPaymentSigned: false,
    targetPaymentSent: false,
    redirectsFollowed: false,
    responseBodyRead: false,
    schemaRetained: false,
    queryValuesRetained: false,
  },
});

function nextActionsFor(routeReport) {
  const actions = new Set();
  for (const finding of routeReport.findings || []) {
    if (finding.startsWith("target_invalid:")) actions.add("Publish machine-constructible examples for every required non-secret query parameter.");
    else if (finding === "seller_response_contract_absent") actions.add("Declare the exact successful application/json response schema for this operation.");
    else if (finding === "seller_response_contract_partial") actions.add("Replace the underconstrained response schema with typed required fields and recursively guaranteed paths.");
    else if (finding === "seller_response_contract_invalid") actions.add("Repair the successful response declaration so it is structurally valid and self-contained.");
    else if (finding === "x402_full_request_binding_mismatch") actions.add("Bind the x402 resource URL to the complete exact request, including query values.");
    else if (finding === "x402_mpp_economics_mismatch" || finding.endsWith("_declaration_runtime_mismatch")) actions.add("Reconcile x402, MPP, OpenAPI, and live runtime economics.");
    else if (finding.startsWith("bazaar_")) actions.add("Publish and validate a complete Bazaar input and output contract for catalog eligibility.");
    else actions.add(`Repair seller contract finding: ${finding}.`);
  }
  return [...actions];
}

export async function sellerIntegrityAudit(input, { auditImpl = auditOrigin } = {}) {
  const request = normalizeSellerIntegrityAuditInput(input);
  let report;
  try {
    report = await auditImpl({ ...request, maxRoutes: 1 });
  } catch (error) {
    const message = String(error?.message || error);
    const failureCode = /not declared/.test(message)
      ? "exact_route_not_declared"
      : /document returned HTTP/.test(message)
        ? "openapi_unavailable"
        : /document did not return JSON/.test(message)
          ? "openapi_invalid"
          : /route count exceeds/.test(message)
            ? "route_ceiling_exceeded"
            : "bounded_transport_failure";
    return {
      ok: false,
      product: "samedaydesk-seller-integrity-audit",
      version: "1.0.0",
      checkedAt: new Date().toISOString(),
      decision: "repair_required",
      request,
      report: {
        auditCompleted: false,
        failureCode,
        schemaVersion: null,
        sellerVersions: null,
        status: null,
        protocols: [],
        valid: false,
        findings: [failureCode],
        economics: null,
        discovery: null,
        responseContract: null,
      },
      nextActions: [failureCode === "exact_route_not_declared"
        ? "Declare the exact paid GET route in the seller OpenAPI document."
        : failureCode.startsWith("openapi_")
          ? "Publish a valid same-origin /openapi.json document with the exact paid GET operation."
          : "Restore the seller declaration and unpaid challenge surfaces, then rerun the bounded audit."],
      boundary: {
        credentialsUsed: false,
        targetPaymentSigned: false,
        targetPaymentSent: false,
        redirectsFollowed: false,
        responseBodyRead: false,
        schemaRetained: false,
        queryValuesRetained: false,
      },
    };
  }
  const routeReport = report.routes[0];
  return {
    ok: report.ok,
    product: "samedaydesk-seller-integrity-audit",
    version: "1.0.0",
    checkedAt: report.checkedAt,
    decision: report.ok ? "machine_buyable" : "repair_required",
    request,
    report: {
      auditCompleted: true,
      failureCode: null,
      schemaVersion: report.schemaVersion,
      sellerVersions: report.versions,
      status: routeReport.status,
      protocols: routeReport.protocols,
      valid: routeReport.valid,
      findings: routeReport.findings,
      economics: routeReport.economics,
      discovery: routeReport.discovery,
      responseContract: routeReport.responseContract,
    },
    nextActions: nextActionsFor(routeReport),
    boundary: {
      credentialsUsed: false,
      targetPaymentSigned: false,
      targetPaymentSent: false,
      redirectsFollowed: false,
      responseBodyRead: false,
      schemaRetained: false,
      queryValuesRetained: false,
    },
  };
}
