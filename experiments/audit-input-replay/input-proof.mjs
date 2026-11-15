import { createHash } from "node:crypto";
import { auditOrigin } from "agent-payment-integrity";
import { sellerIntegrityAudit } from "../../seller-integrity-audit.mjs";

const PROFILE = "samedaydesk.seller-audit-x402-inputs.v1";
const HEX = /^[0-9a-f]{64}$/;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function inputHashes(input) {
  const { document, quote } = input ?? {};
  if (!(document instanceof Uint8Array) || !document.byteLength || document.byteLength > 1_048_576
      || typeof quote !== "string" || !quote.length || Buffer.byteLength(quote) > 65_536) return null;
  return [sha(document), sha(quote)];
}

function manifestDigest({ profile, origin, route, documentSha256, paymentRequiredSha256 }) {
  return sha(JSON.stringify([profile, origin, route, documentSha256, paymentRequiredSha256]));
}

// This is an input comparison, not signature, attribution, freshness or policy verification.
// The buyer must hold the original digest from a separately trusted delivery.
export function matchesAuditInputs(proof, expectedDigest, input) {
  if (!proof || proof.profile !== PROFILE || typeof expectedDigest !== "string" || !HEX.test(expectedDigest)
      || expectedDigest !== proof.digest || manifestDigest(proof) !== expectedDigest) return false;
  const hashes = inputHashes(input);
  return !!hashes && hashes[0] === proof.documentSha256 && hashes[1] === proof.paymentRequiredSha256;
}

// A captive replay of the existing audit. Deliberately has no network default.
// This narrow trial binds only a same-origin OpenAPI and a single x402 v2 GET
// Payment-Required field. Do not issue a proof for another evidence set.
export async function replayAuditInputs(input, requestImpl) {
  if (typeof requestImpl !== "function") throw new TypeError("a replay transport is required");
  const observed = new Map();
  let unsupported = false;
  const result = await sellerIntegrityAudit(input, {
    auditImpl: (options) => auditOrigin({
      ...options,
      requestImpl: async (url, requestOptions) => {
        if (url.origin !== options.origin) throw new Error("off-origin replay refused");
        const response = await requestImpl(url, requestOptions);
        if (observed.has(url.pathname) || url.search || response.headers?.link) unsupported = true;
        let record = { status: response.status };
        if (url.pathname === "/openapi.json" && response.status === 200) {
          const bytes = response.body;
          if (bytes instanceof Uint8Array && bytes.byteLength && bytes.byteLength <= 1_048_576) {
            record.digest = sha(bytes);
          }
        } else if (url.pathname === options.route && response.status === 402) {
          const field = response.headers?.["payment-required"];
          if (response.headers?.["www-authenticate"]) unsupported = true;
          if (typeof field === "string" && field.length && Buffer.byteLength(field) <= 65_536) {
            record.digest = sha(field);
          }
        }
        observed.set(url.pathname, record);
        return response;
      },
    }),
  });
  const { request, report } = result;
  const document = observed.get("/openapi.json");
  const quote = observed.get(request.route);
  if (unsupported || observed.size !== 3 || observed.get("/mpp-openapi.json")?.status !== 404
      || request.method !== "GET" || request.requireBazaar || request.requiredPaths.length
      || result.decision !== "machine_buyable" || report.protocols.length !== 1 || report.protocols[0] !== "x402"
      || document?.status !== 200 || quote?.status !== 402 || !document.digest || !quote.digest) {
    return { result, proof: null };
  }
  const manifest = {
    profile: PROFILE,
    origin: request.origin,
    route: request.route,
    documentSha256: document.digest,
    paymentRequiredSha256: quote.digest,
  };
  return { result, proof: { ...manifest, digest: manifestDigest(manifest) } };
}
