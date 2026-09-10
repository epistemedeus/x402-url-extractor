/**
 * Merchant-side indexing metadata continuity for x402 v2 exact-EVM payloads.
 *
 * CDP Bazaar indexes `paymentPayload.resource` + `paymentPayload.extensions.bazaar`
 * and does not ingest sibling `paymentRequirements`. For Exact EVM EIP-3009,
 * `@x402/evm` signs only `payload` (authorization + signature); resource and
 * extensions are attached by `@x402/core` outside that typed data. Filling
 * omitted route-owned indexing hints therefore does not change signed authority.
 *
 * Scope (everything else retains the prior forward-as-received path):
 * - `paymentPayload.x402Version === 2`
 * - `requirements.scheme === "exact"`
 * - `requirements.network` is an EVM CAIP-2 id (`eip155:*`)
 *
 * Behavior:
 * - Fill only absent `resource` / `extensions.bazaar` from route-owned declared
 *   metadata (canonical PUBLIC origin + path; never request Host).
 * - Never abort verify/settle for discovery-hint shape or mismatch; SDK
 *   `validateExtensions` already owns echo checks, and buyers with enriched or
 *   dynamic bazaar fields must not be declined here.
 * - Apply fills atomically after planning; never partially mutate then fail.
 * - Preserve `payload`, accepted payment terms, and unrelated extensions.
 *
 * Installed via supported ResourceServer `onBeforeVerify` / `onBeforeSettle`
 * hooks (no `verifyPayment` / `settlePayment` reassignment).
 */

const BAZAAR_KEY = "bazaar";
const EXACT_SCHEME = "exact";
const EVM_NETWORK_PREFIX = "eip155:";

/** @typedef {{ url?: unknown, description?: unknown, mimeType?: unknown, serviceName?: unknown, tags?: unknown, iconUrl?: unknown }} DeclaredResource */
/** @typedef {{ resource?: DeclaredResource | null, extensions?: Record<string, unknown> | null }} DeclaredIndexing */
/** @typedef {{ resource?: Record<string, unknown>, extensions?: Record<string, unknown> }} ContinuityPatches */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function cloneJson(value) {
  return structuredClone(value);
}

/**
 * True when continuity is justified for this verify/settle pair.
 * @param {unknown} paymentPayload
 * @param {unknown} requirements
 */
export function isExactEvmV2IndexingContinuitySupported(paymentPayload, requirements) {
  if (!isPlainObject(paymentPayload) || !isPlainObject(requirements)) return false;
  if (paymentPayload.x402Version !== 2) return false;
  if (requirements.scheme !== EXACT_SCHEME) return false;
  const network = requirements.network;
  return typeof network === "string" && network.startsWith(EVM_NETWORK_PREFIX);
}

/**
 * Build a Host-independent canonical resource URL from a fixed public origin
 * and the request path (pathname only). Never reads `Host` / forwarded host.
 *
 * @param {string} publicOrigin
 * @param {string} path
 * @returns {string | null}
 */
export function canonicalResourceUrlFromOriginAndPath(publicOrigin, path) {
  if (typeof publicOrigin !== "string" || !publicOrigin) return null;
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  try {
    const origin = new URL(publicOrigin);
    if (origin.protocol !== "https:" && origin.protocol !== "http:") return null;
    return `${origin.origin}${path}`;
  } catch {
    return null;
  }
}

/**
 * Resolve declared resource URL for fill: optional route override, else
 * PUBLIC origin + adapter path. Ignores adapter.getUrl() (Host-poisonable).
 *
 * @param {unknown} transportContext
 * @param {{ publicOrigin?: string, routeResourceUrl?: string | null }} [options]
 * @returns {string | null}
 */
export function resolveDeclaredResourceUrl(transportContext, options = {}) {
  if (typeof options.routeResourceUrl === "string" && options.routeResourceUrl) {
    return options.routeResourceUrl;
  }
  const request = isPlainObject(transportContext) && isPlainObject(transportContext.request)
    ? transportContext.request
    : null;
  const routeResource = request && isPlainObject(request.routeConfig)
    ? request.routeConfig.resource
    : null;
  if (typeof routeResource === "string" && routeResource) return routeResource;

  const path = request?.adapter && typeof request.adapter.getPath === "function"
    ? request.adapter.getPath()
    : null;
  return canonicalResourceUrlFromOriginAndPath(options.publicOrigin || "", path || "");
}

/**
 * Plan indexing fills without mutating the payload. Never declines a payment.
 *
 * @param {Record<string, unknown>} paymentPayload
 * @param {DeclaredIndexing} declared
 * @returns {{
 *   supported: boolean,
 *   patches: ContinuityPatches,
 *   provenance: {
 *     resource: string,
 *     bazaar: string,
 *     untouchedAuthority: true,
 *     declinedPayment: false,
 *   },
 * }}
 */
export function planIndexingPayloadContinuity(paymentPayload, declared = {}) {
  /** @type {ContinuityPatches} */
  const patches = {};
  const provenance = {
    resource: "skipped",
    bazaar: "skipped",
    untouchedAuthority: true,
    declinedPayment: false,
  };

  if (!isPlainObject(paymentPayload)) {
    return {
      supported: false,
      patches,
      provenance: { ...provenance, resource: "skipped_invalid_payload", bazaar: "skipped_invalid_payload" },
    };
  }

  const declaredResource = declared?.resource;
  const declaredExtensions = isPlainObject(declared?.extensions) ? declared.extensions : null;
  const declaredBazaar = declaredExtensions && Object.prototype.hasOwnProperty.call(declaredExtensions, BAZAAR_KEY)
    ? declaredExtensions[BAZAAR_KEY]
    : undefined;

  // --- resource: fill only when absent ---
  if (!("resource" in paymentPayload) || paymentPayload.resource === undefined || paymentPayload.resource === null) {
    if (isPlainObject(declaredResource) && typeof declaredResource.url === "string" && declaredResource.url) {
      patches.resource = cloneJson(declaredResource);
      provenance.resource = "filled";
    } else {
      provenance.resource = "absent_no_declared";
    }
  } else if (!isPlainObject(paymentPayload.resource)) {
    // Wrong type: retain prior path; do not decline.
    provenance.resource = "present_wrong_type_retained";
  } else {
    provenance.resource = "present";
  }

  // --- extensions.bazaar: fill only when absent; never deep-equal reject ---
  if (!("extensions" in paymentPayload) || paymentPayload.extensions === undefined || paymentPayload.extensions === null) {
    if (declaredBazaar !== undefined && isPlainObject(declaredBazaar)) {
      patches.extensions = { [BAZAAR_KEY]: cloneJson(declaredBazaar) };
      provenance.bazaar = "filled";
    } else if (declaredBazaar !== undefined) {
      provenance.bazaar = "absent_declared_unusable";
    } else {
      provenance.bazaar = "absent_no_declared";
    }
  } else if (!isPlainObject(paymentPayload.extensions)) {
    provenance.bazaar = "present_extensions_wrong_type_retained";
  } else if (
    !Object.prototype.hasOwnProperty.call(paymentPayload.extensions, BAZAAR_KEY) ||
    paymentPayload.extensions[BAZAAR_KEY] === undefined ||
    paymentPayload.extensions[BAZAAR_KEY] === null
  ) {
    if (declaredBazaar !== undefined && isPlainObject(declaredBazaar)) {
      patches.extensions = {
        ...paymentPayload.extensions,
        [BAZAAR_KEY]: cloneJson(declaredBazaar),
      };
      provenance.bazaar = "filled";
    } else if (declaredBazaar !== undefined) {
      provenance.bazaar = "absent_declared_unusable";
    } else {
      provenance.bazaar = "absent_no_declared";
    }
  } else if (!isPlainObject(paymentPayload.extensions[BAZAAR_KEY])) {
    provenance.bazaar = "present_wrong_type_retained";
  } else {
    // Present object may include SDK enrichment / dynamic fields. Keep it.
    provenance.bazaar = "present";
  }

  return { supported: true, patches, provenance };
}

/**
 * Apply planned patches atomically. Does not touch payload authority fields.
 *
 * @param {Record<string, unknown>} paymentPayload
 * @param {ContinuityPatches} patches
 */
export function applyIndexingContinuityPatches(paymentPayload, patches) {
  if (!isPlainObject(paymentPayload) || !isPlainObject(patches)) return paymentPayload;
  if (patches.resource) {
    paymentPayload.resource = patches.resource;
  }
  if (patches.extensions) {
    paymentPayload.extensions = patches.extensions;
  }
  return paymentPayload;
}

/**
 * Plan + apply for a supported exact-EVM v2 context. No-op otherwise.
 *
 * @param {Record<string, unknown>} paymentPayload
 * @param {unknown} requirements
 * @param {DeclaredIndexing} declared
 */
export function applyIndexingPayloadContinuity(paymentPayload, declared = {}, requirements = null) {
  if (requirements != null && !isExactEvmV2IndexingContinuitySupported(paymentPayload, requirements)) {
    return {
      ok: true,
      skipped: true,
      paymentPayload,
      provenance: {
        resource: "skipped_unsupported_scheme_or_version",
        bazaar: "skipped_unsupported_scheme_or_version",
        untouchedAuthority: true,
        declinedPayment: false,
      },
    };
  }
  const planned = planIndexingPayloadContinuity(paymentPayload, declared);
  applyIndexingContinuityPatches(paymentPayload, planned.patches);
  return {
    ok: true,
    skipped: false,
    paymentPayload,
    provenance: planned.provenance,
  };
}

/**
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
  return {
    resource,
    extensions: isPlainObject(declaredExtensions) ? declaredExtensions : null,
  };
}

/** @type {null | { at: string, phase: string, provenance: Record<string, unknown> }} */
let lastContinuityDiagnostic = null;

/**
 * Presence-only diagnostic from the last continuity application (no raw payload).
 */
export function getLastIndexingContinuityDiagnostic() {
  return lastContinuityDiagnostic
    ? { ...lastContinuityDiagnostic, provenance: { ...lastContinuityDiagnostic.provenance } }
    : null;
}

/**
 * Register continuity on supported ResourceServer lifecycle hooks.
 * Does not reassign `verifyPayment` or `settlePayment`.
 *
 * @param {{ onBeforeVerify: Function, onBeforeSettle: Function }} resourceServer
 * @param {{
 *   resolveDeclaredResource?: (ctx: unknown) => DeclaredResource | null | undefined,
 *   publicOrigin?: string,
 * }} [options]
 */
export function registerIndexingPayloadContinuity(resourceServer, options = {}) {
  const resolveDeclaredResource = options.resolveDeclaredResource || ((transportContext) => {
    const url = resolveDeclaredResourceUrl(transportContext, { publicOrigin: options.publicOrigin });
    return url ? { url } : null;
  });

  const run = (phase, context) => {
    const paymentPayload = context?.paymentPayload;
    const requirements = context?.requirements;
    if (!isExactEvmV2IndexingContinuitySupported(paymentPayload, requirements)) {
      lastContinuityDiagnostic = {
        at: new Date().toISOString(),
        phase,
        provenance: {
          resource: "skipped_unsupported_scheme_or_version",
          bazaar: "skipped_unsupported_scheme_or_version",
          untouchedAuthority: true,
          declinedPayment: false,
        },
      };
      return;
    }
    const declared = buildDeclaredIndexing(
      context.transportContext,
      context.declaredExtensions,
      resolveDeclaredResource,
    );
    const result = applyIndexingPayloadContinuity(paymentPayload, declared, requirements);
    lastContinuityDiagnostic = {
      at: new Date().toISOString(),
      phase,
      provenance: result.provenance,
    };
  };

  resourceServer.onBeforeVerify(async (context) => {
    run("verify", context);
  });
  resourceServer.onBeforeSettle(async (context) => {
    run("settle", context);
  });

  return resourceServer;
}

/** @deprecated Use registerIndexingPayloadContinuity (hook-based). */
export function installIndexingPayloadContinuity(resourceServer, options = {}) {
  return registerIndexingPayloadContinuity(resourceServer, options);
}
