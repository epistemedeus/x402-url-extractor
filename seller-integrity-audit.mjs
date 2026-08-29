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
  const allowed = new Set(["origin", "route", "method", "requiredPaths", "requireBazaar"]);
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
  const method = String(input.method || "GET").toUpperCase();
  if (!["GET", "POST"].includes(method)) throw new SellerIntegrityAuditError("method must be GET or POST");
  const rawPaths = Array.isArray(input.requiredPaths)
    ? input.requiredPaths
    : String(input.requiredPaths || "").split(",").filter(Boolean);
  const requiredPaths = [...new Set(rawPaths.map((path) => String(path).trim()))].sort();
  if (requiredPaths.length > 16 || requiredPaths.some((path) => !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,7}$/.test(path))) {
    throw new SellerIntegrityAuditError("requiredPaths must contain at most 16 safe dotted JSON paths");
  }
  return Object.freeze({
    origin,
    route,
    method,
    requiredPaths: Object.freeze(requiredPaths),
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
      version: { type: "string", const: "1.2.0" },
      checkedAt: { type: "string", format: "date-time" },
      decision: { type: "string", enum: ["machine_buyable", "contract_ready", "repair_required"] },
      request: {
        type: "object",
        additionalProperties: false,
        properties: {
          origin: { type: "string", format: "uri" },
          route: { type: "string" },
          method: { type: "string", enum: ["GET", "POST"] },
          requiredPaths: { type: "array", maxItems: 16, items: { type: "string" } },
          requireBazaar: { type: "boolean" },
        },
        required: ["origin", "route", "method", "requiredPaths", "requireBazaar"],
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
          runtimeChallengeVerified: { type: "boolean" },
          probe: { type: ["object", "null"] },
          protocols: { type: "array", items: { type: "string" } },
          valid: { type: "boolean" },
          findings: { type: "array", items: { type: "string" } },
          economics: { type: ["object", "null"] },
          discovery: { type: ["object", "null"] },
          responseContract: { type: ["object", "null"] },
          repairPlan: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
              mode: { type: "string", const: "advisory_openapi_repair" },
              requiredPaths: { type: "array", maxItems: 16, items: { type: "string" } },
              guaranteedPaths: { type: "array", maxItems: 16, items: { type: "string" } },
              actions: {
                type: "array",
                maxItems: 16,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    requiredPath: { type: "string" },
                    action: { type: "string", enum: ["add_property_to_required", "define_and_require_property", "define_nested_property_path"] },
                    parentPath: { type: "string" },
                    property: { type: "string" },
                    propertyDeclared: { type: "boolean" },
                    propertyType: { type: ["string", "null"] },
                  },
                  required: ["requiredPath", "action", "parentPath", "property", "propertyDeclared", "propertyType"],
                },
              },
              complete: { type: "boolean" },
              boundary: {
                type: "object",
                additionalProperties: false,
                properties: {
                  schemaMutationApplied: { type: "boolean", const: false },
                  propertyTypesInferred: { type: "boolean", const: false },
                  sellerRuntimeVerified: { type: "boolean", const: false },
                  statement: { type: "string" },
                },
                required: ["schemaMutationApplied", "propertyTypesInferred", "sellerRuntimeVerified", "statement"],
              },
            },
            required: ["mode", "requiredPaths", "guaranteedPaths", "actions", "complete", "boundary"],
          },
        },
        required: ["auditCompleted", "failureCode", "schemaVersion", "sellerVersions", "status", "runtimeChallengeVerified", "probe", "protocols", "valid", "findings", "economics", "discovery", "responseContract", "repairPlan"],
      },
      nextActions: { type: "array", items: { type: "string" } },
      boundary: {
        type: "object",
        additionalProperties: false,
        properties: {
          credentialsUsed: { type: "boolean", const: false },
          targetPaymentSigned: { type: "boolean", const: false },
          targetPaymentSent: { type: "boolean", const: false },
          targetRequestSent: { type: "boolean", const: false },
          redirectsFollowed: { type: "boolean", const: false },
          responseBodyRead: { type: "boolean", const: false },
          schemaRetained: { type: "boolean", const: false },
          queryValuesRetained: { type: "boolean", const: false },
        },
        required: ["credentialsUsed", "targetPaymentSigned", "targetPaymentSent", "targetRequestSent", "redirectsFollowed", "responseBodyRead", "schemaRetained", "queryValuesRetained"],
      },
    },
    required: ["ok", "product", "version", "checkedAt", "decision", "request", "report", "nextActions", "boundary"],
  };
}

export const SELLER_INTEGRITY_AUDIT_EXAMPLE = Object.freeze({
  ok: true,
  product: "samedaydesk-seller-integrity-audit",
  version: "1.2.0",
  checkedAt: "2026-08-12T07:50:00.000Z",
  decision: "machine_buyable",
  request: { origin: "https://agents.samedaydesk.com", route: "/commerce/payment-offer-preflight", method: "GET", requiredPaths: ["decision", "offers"], requireBazaar: true },
  report: {
    auditCompleted: true,
    failureCode: null,
    schemaVersion: "agent-payment-integrity.audit.v4",
    sellerVersions: { x402: "1.18.3", mpp: "1.18.3" },
    status: 402,
    runtimeChallengeVerified: true,
    probe: { attempted: true, reason: null },
    protocols: ["mpp", "x402"],
    valid: true,
    findings: [],
    economics: { x402: { amountAtomic: "5000" }, mpp: { amountAtomic: "5000" } },
    discovery: { bazaar: { present: true, valid: true } },
    responseContract: { decision: "admissible", requiredPaths: ["boundary", "decision", "offers", "ok"] },
    repairPlan: {
      mode: "advisory_openapi_repair",
      requiredPaths: ["decision", "offers"],
      guaranteedPaths: ["decision", "offers"],
      actions: [],
      complete: true,
      boundary: {
        schemaMutationApplied: false,
        propertyTypesInferred: false,
        sellerRuntimeVerified: false,
        statement: "Apply only after the seller confirms each property's real runtime type and semantics, then rerun integrity CI.",
      },
    },
  },
  nextActions: [],
  boundary: {
    credentialsUsed: false,
    targetPaymentSigned: false,
    targetPaymentSent: false,
    targetRequestSent: false,
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
    else if (finding.startsWith("seller_response_required_path_missing:")) actions.add(`Require the buyer-needed response path ${finding.split(":", 2)[1]} in the successful JSON schema.`);
    else if (finding === "x402_full_request_binding_mismatch") actions.add("Bind the x402 resource URL to the complete exact request, including query values.");
    else if (finding === "x402_payment_required_schema_invalid" || finding === "x402_resource_schema_invalid") actions.add("Publish an x402 PaymentRequired document that passes the official protocol schemas, including bounded resource metadata.");
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
    report = await auditImpl({ ...request, maxRoutes: 1, publicDns: true });
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
      version: "1.2.0",
      checkedAt: new Date().toISOString(),
      decision: "repair_required",
      request,
      report: {
        auditCompleted: false,
        failureCode,
        schemaVersion: null,
        sellerVersions: null,
        status: null,
        runtimeChallengeVerified: false,
        probe: null,
        protocols: [],
        valid: false,
        findings: [failureCode],
        economics: null,
        discovery: null,
        responseContract: null,
        repairPlan: null,
      },
      nextActions: [failureCode === "exact_route_not_declared"
        ? `Declare the exact paid ${request.method} route in the seller OpenAPI document.`
        : failureCode.startsWith("openapi_")
          ? `Publish a valid same-origin /openapi.json document with the exact paid ${request.method} operation.`
          : "Restore the seller declaration and unpaid challenge surfaces, then rerun the bounded audit."],
      boundary: {
        credentialsUsed: false,
        targetPaymentSigned: false,
        targetPaymentSent: false,
        targetRequestSent: false,
        redirectsFollowed: false,
        responseBodyRead: false,
        schemaRetained: false,
        queryValuesRetained: false,
      },
    };
  }
  const routeReport = report.routes[0];
  const decision = !report.ok
    ? "repair_required"
    : report.machineBuyable
      ? "machine_buyable"
      : "contract_ready";
  return {
    ok: decision !== "repair_required",
    product: "samedaydesk-seller-integrity-audit",
    version: "1.2.0",
    checkedAt: report.checkedAt,
    decision,
    request,
    report: {
      auditCompleted: true,
      failureCode: null,
      schemaVersion: report.schemaVersion,
      sellerVersions: report.versions,
      status: routeReport.status,
      runtimeChallengeVerified: routeReport.runtimeChallengeVerified,
      probe: routeReport.probe,
      protocols: routeReport.protocols,
      valid: routeReport.valid,
      findings: routeReport.findings,
      economics: routeReport.economics,
      discovery: routeReport.discovery,
      responseContract: routeReport.responseContract,
      repairPlan: routeReport.repairPlan,
    },
    nextActions: nextActionsFor(routeReport),
    boundary: {
      credentialsUsed: false,
      targetPaymentSigned: false,
      targetPaymentSent: false,
      targetRequestSent: false,
      redirectsFollowed: false,
      responseBodyRead: false,
      schemaRetained: false,
      queryValuesRetained: false,
    },
  };
}
