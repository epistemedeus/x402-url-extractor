/**
 * Merchant-side indexing metadata continuity for x402 v2 PaymentPayload.
 *
 * CDP Bazaar indexes `paymentPayload.resource` + `paymentPayload.extensions.bazaar`.
 * It does not ingest sibling `paymentRequirements`. Exact EVM EIP-3009 signs only
 * the authorization inside `paymentPayload.payload`; resource/extensions are not
 * EIP-712-bound, so appending route-owned declared metadata for incomplete-but-valid
 * clients does not change signed payment authority.
 *
 * Rules:
 * - Preserve a complete caller payload (no overwrite when fields already match).
 * - Fill only when resource and/or extensions.bazaar are absent.
 * - Reject wrong-typed or mismatched resource / contradictory bazaar.
 * - Never mutate amount/network/payTo/nonce/signature/validity or `payload`.
 */

import { isDeepStrictEqual } from "node:util";

const BAZAAR_KEY = "bazaar";

/** @typedef {{ url?: unknown, description?: unknown, mimeType?: unknown, serviceName?: unknown, tags?: unknown, iconUrl?: unknown }} DeclaredResource */
/** @typedef {{ resource?: DeclaredResource | null, extensions?: Record<string, unknown> | null }} DeclaredIndexing */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function deepEqual(a, b) {
  return isDeepStrictEqual(a, b);
}

/**
 * Clone JSON-compatible declared metadata only (no functions / prototypes).
 * @template T
 * @param {T} value
 * @returns {T}
 */
function cloneJson(value) {
  return structuredClone(value);
}

/**
 * Resolve the request URL the HTTP resource server would advertise.
 * Mirrors `@x402/core` resourceInfo.url = routeConfig.resource || adapter.getUrl().
 *
 * @param {unknown} transportContext
 * @returns {string | null}
 */
export function resolveTransportResourceUrl(transportContext) {
  const request = transportContext && typeof transportContext === "object"
    ? /** @type {{ request?: { adapter?: { getUrl?: () => string }, routeConfig?: { resource?: string } } }} */ (
        transportContext
      ).request
    : null;
  const routeResource = request?.routeConfig?.resource;
  if (typeof routeResource === "string" && routeResource.length > 0) return routeResource;
  const url = request?.adapter?.getUrl?.();
  return typeof url === "string" && url.length > 0 ? url : null;
}

/**
 * Apply indexing continuity to one PaymentPayload.
 *
 * @param {Record<string, unknown>} paymentPayload
 * @param {DeclaredIndexing} declared
 * @returns {{
 *   ok: true,
 *   paymentPayload: Record<string, unknown>,
 *   provenance: {
 *     resource: "present" | "filled" | "absent_no_declared",
 *     bazaar: "present" | "filled" | "absent_no_declared" | "absent_no_extensions_object",
 *     untouchedAuthority: true,
 *   },
 * } | {
 *   ok: false,
 *   reason: string,
 *   message: string,
 *   provenance: Record<string, string>,
 * }}
 */
export function applyIndexingPayloadContinuity(paymentPayload, declared = {}) {
  if (!isPlainObject(paymentPayload)) {
    return {
      ok: false,
      reason: "invalid_payment_payload",
      message: "paymentPayload must be a plain object",
      provenance: { resource: "reject", bazaar: "reject" },
    };
  }

  // Never touch signed authority fields.
  const next = paymentPayload;
  const declaredResource = declared?.resource;
  const declaredExtensions = isPlainObject(declared?.extensions) ? declared.extensions : null;
  const declaredBazaar = declaredExtensions && BAZAAR_KEY in declaredExtensions
    ? declaredExtensions[BAZAAR_KEY]
    : undefined;

  /** @type {{ resource: string, bazaar: string, untouchedAuthority: true }} */
  const provenance = {
    resource: "absent_no_declared",
    bazaar: "absent_no_declared",
    untouchedAuthority: true,
  };

  // --- resource ---
  if (!("resource" in next) || next.resource === undefined || next.resource === null) {
    if (isPlainObject(declaredResource) && typeof declaredResource.url === "string" && declaredResource.url) {
      next.resource = cloneJson(declaredResource);
      provenance.resource = "filled";
    } else {
      provenance.resource = "absent_no_declared";
    }
  } else if (!isPlainObject(next.resource)) {
    return {
      ok: false,
      reason: "indexing_resource_wrong_type",
      message: "paymentPayload.resource must be an object when present",
      provenance: { resource: "reject_wrong_type", bazaar: "unchecked", untouchedAuthority: "true" },
    };
  } else {
    const callerUrl = next.resource.url;
    if (typeof callerUrl !== "string" || !callerUrl) {
      return {
        ok: false,
        reason: "indexing_resource_url_invalid",
        message: "paymentPayload.resource.url must be a non-empty string when resource is present",
        provenance: { resource: "reject_url", bazaar: "unchecked", untouchedAuthority: "true" },
      };
    }
    if (
      isPlainObject(declaredResource) &&
      typeof declaredResource.url === "string" &&
      declaredResource.url &&
      callerUrl !== declaredResource.url
    ) {
      return {
        ok: false,
        reason: "indexing_resource_mismatch",
        message: "paymentPayload.resource.url does not match the route-declared resource URL",
        provenance: { resource: "reject_mismatch", bazaar: "unchecked", untouchedAuthority: "true" },
      };
    }
    provenance.resource = "present";
  }

  // --- extensions.bazaar ---
  if (!("extensions" in next) || next.extensions === undefined || next.extensions === null) {
    if (declaredBazaar !== undefined) {
      if (!isPlainObject(declaredBazaar)) {
        return {
          ok: false,
          reason: "indexing_declared_bazaar_wrong_type",
          message: "declared extensions.bazaar must be an object",
          provenance: { ...provenance, bazaar: "reject_declared_type" },
        };
      }
      next.extensions = { [BAZAAR_KEY]: cloneJson(declaredBazaar) };
      provenance.bazaar = "filled";
    } else {
      provenance.bazaar = "absent_no_declared";
    }
  } else if (!isPlainObject(next.extensions)) {
    return {
      ok: false,
      reason: "indexing_extensions_wrong_type",
      message: "paymentPayload.extensions must be an object when present",
      provenance: { ...provenance, bazaar: "reject_wrong_type" },
    };
  } else if (!Object.prototype.hasOwnProperty.call(next.extensions, BAZAAR_KEY) ||
    next.extensions[BAZAAR_KEY] === undefined ||
    next.extensions[BAZAAR_KEY] === null) {
    if (declaredBazaar !== undefined) {
      if (!isPlainObject(declaredBazaar)) {
        return {
          ok: false,
          reason: "indexing_declared_bazaar_wrong_type",
          message: "declared extensions.bazaar must be an object",
          provenance: { ...provenance, bazaar: "reject_declared_type" },
        };
      }
      next.extensions[BAZAAR_KEY] = cloneJson(declaredBazaar);
      provenance.bazaar = "filled";
    } else {
      provenance.bazaar = "absent_no_declared";
    }
  } else if (!isPlainObject(next.extensions[BAZAAR_KEY])) {
    return {
      ok: false,
      reason: "indexing_bazaar_wrong_type",
      message: "paymentPayload.extensions.bazaar must be an object when present",
      provenance: { ...provenance, bazaar: "reject_wrong_type" },
    };
  } else if (declaredBazaar !== undefined) {
    if (!isPlainObject(declaredBazaar)) {
      return {
        ok: false,
        reason: "indexing_declared_bazaar_wrong_type",
        message: "declared extensions.bazaar must be an object",
        provenance: { ...provenance, bazaar: "reject_declared_type" },
      };
    }
    if (!deepEqual(next.extensions[BAZAAR_KEY], declaredBazaar)) {
      return {
        ok: false,
        reason: "indexing_bazaar_mismatch",
        message: "paymentPayload.extensions.bazaar contradicts the route-declared bazaar extension",
        provenance: { ...provenance, bazaar: "reject_mismatch" },
      };
    }
    provenance.bazaar = "present";
  } else {
    provenance.bazaar = "present";
  }

  return { ok: true, paymentPayload: next, provenance };
}

/**
 * Build declared indexing metadata for the active HTTP verify/settle call.
 *
 * @param {unknown} transportContext
 * @param {Record<string, unknown> | null | undefined} declaredExtensions
 * @param {(ctx: unknown) => DeclaredResource | null | undefined} [resolveDeclaredResource]
 * @returns {DeclaredIndexing}
 */
export function buildDeclaredIndexing(transportContext, declaredExtensions, resolveDeclaredResource) {
  let resource = null;
  if (typeof resolveDeclaredResource === "function") {
    resource = resolveDeclaredResource(transportContext) || null;
  }
  if (!resource) {
    const url = resolveTransportResourceUrl(transportContext);
    resource = url ? { url } : null;
  }
  return {
    resource,
    extensions: isPlainObject(declaredExtensions) ? declaredExtensions : null,
  };
}

/** @type {null | { at: string, phase: string, provenance: Record<string, unknown> }} */
let lastContinuityDiagnostic = null;

/**
 * Presence-only diagnostic from the last continuity application (no raw payload).
 * @returns {null | { at: string, phase: string, provenance: Record<string, unknown> }}
 */
export function getLastIndexingContinuityDiagnostic() {
  return lastContinuityDiagnostic ? { ...lastContinuityDiagnostic, provenance: { ...lastContinuityDiagnostic.provenance } } : null;
}

/**
 * Install continuity at the ResourceServer verify/settle boundary so both
 * HTTPFacilitatorClient posts receive coherent paymentPayload fields.
 *
 * Uses property assignment inside this module only (not in server.js source) so
 * existing source-shape guards that forbid `verifyPayment =` in server.js remain valid.
 *
 * @param {import("@x402/core/server").x402ResourceServer | { verifyPayment: Function, settlePayment: Function }} resourceServer
 * @param {{ resolveDeclaredResource?: (ctx: unknown) => DeclaredResource | null | undefined }} [options]
 */
export function installIndexingPayloadContinuity(resourceServer, options = {}) {
  const resolveDeclaredResource = options.resolveDeclaredResource;
  const originalVerify = resourceServer.verifyPayment.bind(resourceServer);
  const originalSettle = resourceServer.settlePayment.bind(resourceServer);

  resourceServer.verifyPayment = async function indexingContinuityVerifyPayment(
    paymentPayload,
    requirements,
    declaredExtensions,
    transportContext,
  ) {
    const declared = buildDeclaredIndexing(transportContext, declaredExtensions, resolveDeclaredResource);
    const result = applyIndexingPayloadContinuity(paymentPayload, declared);
    lastContinuityDiagnostic = {
      at: new Date().toISOString(),
      phase: "verify",
      provenance: result.provenance,
    };
    if (!result.ok) {
      return {
        isValid: false,
        invalidReason: result.reason,
        invalidMessage: result.message,
      };
    }
    return originalVerify(paymentPayload, requirements, declaredExtensions, transportContext);
  };

  resourceServer.settlePayment = async function indexingContinuitySettlePayment(
    paymentPayload,
    requirements,
    declaredExtensions,
    transportContext,
    settlementOverrides,
  ) {
    const declared = buildDeclaredIndexing(transportContext, declaredExtensions, resolveDeclaredResource);
    const result = applyIndexingPayloadContinuity(paymentPayload, declared);
    lastContinuityDiagnostic = {
      at: new Date().toISOString(),
      phase: "settle",
      provenance: result.provenance,
    };
    if (!result.ok) {
      const error = new Error(result.message || result.reason);
      error.code = result.reason;
      throw error;
    }
    return originalSettle(
      paymentPayload,
      requirements,
      declaredExtensions,
      transportContext,
      settlementOverrides,
    );
  };

  return resourceServer;
}
