import { auditOrigin, normalizeOrigin } from "agent-payment-integrity";
import { z } from "zod";
import {
  createReceiptReferralOffer,
  normalizeReceiptReferralId,
  receiptReferralOfferSchema,
} from "./receipt-referral.mjs";

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
  const allowed = new Set(["origin", "route", "method", "requiredPaths", "requireBazaar", "referral"]);
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
    referral: normalizeReceiptReferralId(input.referral),
  });
}

export function sellerIntegrityAuditOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean" },
      product: { type: "string", const: "samedaydesk-seller-integrity-audit" },
      version: { type: "string", const: "1.3.0" },
      checkedAt: { type: "string", format: "date-time" },
      decision: { type: "string", enum: ["machine_buyable", "contract_ready", "repair_required", "unverified"] },
      request: {
        type: "object",
        additionalProperties: false,
        properties: {
          origin: { type: "string", format: "uri" },
          route: { type: "string" },
          method: { type: "string", enum: ["GET", "POST"] },
          requiredPaths: { type: "array", maxItems: 16, items: { type: "string" } },
          requireBazaar: { type: "boolean" },
          referral: { type: ["string", "null"], pattern: "^r1_[0-9a-f]{64}$" },
        },
        required: ["origin", "route", "method", "requiredPaths", "requireBazaar", "referral"],
      },
      report: {
        type: "object",
        additionalProperties: false,
        properties: {
          auditCompleted: { type: "boolean" },
          failureCode: { type: ["string", "null"] },
          observedHttpStatus: { type: ["integer", "null"], minimum: 100, maximum: 599 },
          evidenceClass: {
            type: ["string", "null"],
            enum: [
              "missing_declared_operation",
              "invalid_declaration",
              "declared_url_unavailable",
              "local_acquisition_limit",
              "transport_unknown",
              "seller_contract",
              null,
            ],
          },
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
        required: ["auditCompleted", "failureCode", "observedHttpStatus", "evidenceClass", "schemaVersion", "sellerVersions", "status", "runtimeChallengeVerified", "probe", "protocols", "valid", "findings", "economics", "discovery", "responseContract", "repairPlan"],
      },
      nextActions: { type: "array", items: { type: "string" } },
      referralOffer: receiptReferralOfferSchema(),
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
    required: ["ok", "product", "version", "checkedAt", "decision", "request", "report", "nextActions", "referralOffer", "boundary"],
  };
}

const nullableObject = z.object({}).passthrough().nullable();
const sellerIntegrityEvidenceClass = z.enum([
  "missing_declared_operation",
  "invalid_declaration",
  "declared_url_unavailable",
  "local_acquisition_limit",
  "transport_unknown",
  "seller_contract",
]).nullable();
const sellerIntegrityReferralOfferMcpSchema = z.object({
  v: z.literal("1"),
  status: z.enum(["available", "declared", "unavailable"]),
  id: z.string().regex(/^r1_[0-9a-f]{64}$/).nullable(),
  proof: z.literal("x402-offer-receipt-jcs-sha256-v1"),
  reward: z.enum(["one_free_changed_state_recheck", "none"]),
  qualifiesOn: z.enum(["two_distinct_seller_signed_settlement_receipts", "none"]),
  broadcastRequired: z.literal(false),
  attributionOnly: z.literal(true),
  instructions: z.string(),
}).strict();

export const sellerIntegrityAuditMcpOutputSchema = z.object({
  ok: z.boolean(),
  product: z.literal("samedaydesk-seller-integrity-audit"),
  version: z.literal("1.3.0"),
  checkedAt: z.string().datetime(),
  decision: z.enum(["machine_buyable", "contract_ready", "repair_required", "unverified"]),
  request: z.object({
    origin: z.string().url(),
    route: z.string(),
    method: z.enum(["GET", "POST"]),
    requiredPaths: z.array(z.string()).max(16),
    requireBazaar: z.boolean(),
    referral: z.string().regex(/^r1_[0-9a-f]{64}$/).nullable(),
  }).strict(),
  report: z.object({
    auditCompleted: z.boolean(),
    failureCode: z.string().nullable(),
    observedHttpStatus: z.number().int().min(100).max(599).nullable(),
    evidenceClass: sellerIntegrityEvidenceClass,
    schemaVersion: z.string().nullable(),
    sellerVersions: z.object({ x402: z.string().nullable(), mpp: z.string().nullable() }).passthrough().nullable(),
    status: z.number().int().nullable(),
    runtimeChallengeVerified: z.boolean(),
    probe: nullableObject,
    protocols: z.array(z.string()),
    valid: z.boolean(),
    findings: z.array(z.string()),
    economics: nullableObject,
    discovery: nullableObject,
    responseContract: nullableObject,
    repairPlan: z.object({
      mode: z.literal("advisory_openapi_repair"),
      requiredPaths: z.array(z.string()).max(16),
      guaranteedPaths: z.array(z.string()).max(16),
      actions: z.array(z.object({
        requiredPath: z.string(),
        action: z.enum(["add_property_to_required", "define_and_require_property", "define_nested_property_path"]),
        parentPath: z.string(),
        property: z.string(),
        propertyDeclared: z.boolean(),
        propertyType: z.string().nullable(),
      }).strict()).max(16),
      complete: z.boolean(),
      boundary: z.object({
        schemaMutationApplied: z.literal(false),
        propertyTypesInferred: z.literal(false),
        sellerRuntimeVerified: z.literal(false),
        statement: z.string(),
      }).strict(),
    }).strict().nullable(),
  }).strict(),
  nextActions: z.array(z.string()),
  referralOffer: sellerIntegrityReferralOfferMcpSchema,
  boundary: z.object({
    credentialsUsed: z.literal(false),
    targetPaymentSigned: z.literal(false),
    targetPaymentSent: z.literal(false),
    targetRequestSent: z.literal(false),
    redirectsFollowed: z.literal(false),
    responseBodyRead: z.literal(false),
    schemaRetained: z.literal(false),
    queryValuesRetained: z.literal(false),
  }).strict(),
}).strict();

export const SELLER_INTEGRITY_AUDIT_EXAMPLE = Object.freeze({
  ok: true,
  product: "samedaydesk-seller-integrity-audit",
  version: "1.3.0",
  checkedAt: "2026-08-12T07:50:00.000Z",
  decision: "machine_buyable",
  request: { origin: "https://agents.samedaydesk.com", route: "/commerce/payment-offer-preflight", method: "GET", requiredPaths: ["decision", "offers"], requireBazaar: true, referral: null },
  report: {
    auditCompleted: true,
    failureCode: null,
    observedHttpStatus: null,
    evidenceClass: null,
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
  referralOffer: createReceiptReferralOffer({ decision: "machine_buyable" }),
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

export function classifySellerIntegrityAcquisition(message) {
  const text = String(message || "");
  if (/^exact paid (?:GET|POST) route was not declared$/.test(text)) {
    return {
      failureCode: "exact_route_not_declared",
      observedHttpStatus: null,
      evidenceClass: "missing_declared_operation",
      decision: "repair_required",
    };
  }
  if (text === "document did not return JSON") {
    return {
      failureCode: "openapi_invalid",
      observedHttpStatus: null,
      evidenceClass: "invalid_declaration",
      decision: "repair_required",
    };
  }
  const httpFailure = /^document returned HTTP ([1-5][0-9]{2})$/.exec(text);
  if (httpFailure) {
    return {
      failureCode: "openapi_unavailable",
      observedHttpStatus: Number(httpFailure[1]),
      evidenceClass: "declared_url_unavailable",
      decision: "repair_required",
    };
  }
  if (text === "response exceeded byte limit" || text === "DoH response exceeded byte limit") {
    return {
      failureCode: "openapi_exceeds_byte_limit",
      observedHttpStatus: null,
      evidenceClass: "local_acquisition_limit",
      decision: "unverified",
    };
  }
  if (/^paid (?:GET|POST) route count exceeds [1-9][0-9]*$/.test(text)) {
    return {
      failureCode: "route_ceiling_exceeded",
      observedHttpStatus: null,
      evidenceClass: "local_acquisition_limit",
      decision: "unverified",
    };
  }
  if (text === "redirects are not allowed") {
    return {
      failureCode: "redirect_not_followed",
      observedHttpStatus: null,
      evidenceClass: "transport_unknown",
      decision: "unverified",
    };
  }
  return {
    failureCode: "bounded_transport_failure",
    observedHttpStatus: null,
    evidenceClass: "transport_unknown",
    decision: "unverified",
  };
}

function nextActionsForAcquisition(classified, request) {
  const { failureCode, observedHttpStatus } = classified;
  if (failureCode === "exact_route_not_declared") {
    return [`Declare the exact paid ${request.method} route in the seller OpenAPI document.`];
  }
  if (failureCode === "openapi_invalid") {
    return [`The declared same-origin /openapi.json did not return JSON. Publish a valid OpenAPI document with the exact paid ${request.method} operation.`];
  }
  if (failureCode === "openapi_unavailable") {
    const transient = observedHttpStatus === 429 || observedHttpStatus >= 500;
    return [transient
      ? `A same-origin seller declaration endpoint returned HTTP ${observedHttpStatus} during this point-in-time check. Restore its availability or retry; this observation does not establish a permanent missing contract.`
      : `A same-origin seller declaration endpoint returned HTTP ${observedHttpStatus} during this point-in-time check. Publish or restore the declared document at that URL.`];
  }
  if (failureCode === "openapi_exceeds_byte_limit") {
    return ["Local OpenAPI byte limit prevented a complete audit. This is not seller-repair evidence. Probe one exact advertised URL with payment-offer-preflight."];
  }
  if (failureCode === "route_ceiling_exceeded") {
    return ["Local route ceiling prevented a complete audit. Select one exact route. This is not seller-repair evidence."];
  }
  if (failureCode === "redirect_not_followed") {
    return ["The declared URL responded with a redirect that this checker does not follow. This is not by itself a catalog or seller-repair finding."];
  }
  return ["The unpaid probe did not complete because of timeout, TLS, or network transport. This is not seller-repair evidence. Retry the bounded check."];
}

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
  const { referral, ...auditRequest } = request;
  let report;
  try {
    report = await auditImpl({ ...auditRequest, maxRoutes: 1, publicDns: true });
  } catch (error) {
    const classified = classifySellerIntegrityAcquisition(error?.message || error);
    return {
      ok: false,
      product: "samedaydesk-seller-integrity-audit",
      version: "1.3.0",
      checkedAt: new Date().toISOString(),
      decision: classified.decision,
      request,
      report: {
        auditCompleted: false,
        failureCode: classified.failureCode,
        observedHttpStatus: classified.observedHttpStatus,
        evidenceClass: classified.evidenceClass,
        schemaVersion: null,
        sellerVersions: null,
        status: null,
        runtimeChallengeVerified: false,
        probe: null,
        protocols: [],
        valid: false,
        findings: [classified.failureCode],
        economics: null,
        discovery: null,
        responseContract: null,
        repairPlan: null,
      },
      nextActions: nextActionsForAcquisition(classified, request),
      referralOffer: createReceiptReferralOffer({
        referralId: classified.decision === "repair_required" ? referral : null,
        decision: classified.decision,
      }),
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
    version: "1.3.0",
    checkedAt: report.checkedAt,
    decision,
    request,
    report: {
      auditCompleted: true,
      failureCode: null,
      observedHttpStatus: null,
      evidenceClass: decision === "repair_required" ? "seller_contract" : null,
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
    referralOffer: createReceiptReferralOffer({ referralId: referral, decision }),
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
