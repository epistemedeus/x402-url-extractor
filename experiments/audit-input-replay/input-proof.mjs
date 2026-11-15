import { createHash } from "node:crypto";
import { auditOrigin } from "agent-payment-integrity";
import { sellerIntegrityAudit } from "../../seller-integrity-audit.mjs";

const PROFILE = "samedaydesk.seller-audit-x402-inputs.v1";
const HEX = /^[0-9a-f]{64}$/;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashDocument = (bytes) => bytes instanceof Uint8Array && bytes.byteLength > 0
  && bytes.byteLength <= 1_048_576 ? sha(bytes) : null;
const hashQuote = (field) => typeof field === "string" && field.length > 0
  && Buffer.byteLength(field) <= 65_536 ? sha(field) : null;

function inputHashes(input) {
  const { document, mpp, href, quote } = input ?? {};
  const documentHash = hashDocument(document);
  const quoteHash = hashQuote(quote);
  const mppHash = mpp?.status === 200 ? hashDocument(mpp.document) : null;
  if (!documentHash || !quoteHash || typeof href !== "string" || !href.length || href.length > 8192
      || (mpp?.status !== 404 && !mppHash)) return null;
  return [documentHash, mpp.status, mppHash, sha(href), quoteHash];
}

function evidenceFields(proof) {
  return [proof.documentSha256, proof.mppDocumentStatus, proof.mppDocumentSha256,
    proof.probeUrlSha256, proof.paymentRequiredSha256];
}

function manifestDigest(proof) {
  return sha(JSON.stringify([proof.profile, proof.origin, proof.route, ...evidenceFields(proof)]));
}

// This is an input comparison, not signature, attribution, freshness or policy verification.
// The buyer must hold the original digest from a separately trusted delivery.
export function matchesAuditInputs(proof, expectedDigest, input) {
  if (!proof || proof.profile !== PROFILE || typeof expectedDigest !== "string" || !HEX.test(expectedDigest)
      || expectedDigest !== proof.digest || manifestDigest(proof) !== expectedDigest) return false;
  const hashes = inputHashes(input);
  return !!hashes && hashes.every((hash, i) => hash === evidenceFields(proof)[i]);
}

// A captive replay of the existing audit. Deliberately has no network default.
// This trial binds same-origin discovery and a single x402 GET field.
// No proof for MPP quotes, additional inputs or incomplete/unsupported reads.
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
        if (observed.has(url.pathname)) unsupported = true;
        const record = { status: response.status };
        if (url.pathname === "/openapi.json" || url.pathname === "/mpp-openapi.json") {
          if (url.search) unsupported = true;
          if (response.status === 200) record.digest = hashDocument(response.body);
        } else if (url.pathname === options.route && response.status === 402) {
          if (response.headers?.["www-authenticate"]) unsupported = true;
          record.digest = hashQuote(response.headers?.["payment-required"]);
          if (url.href.length <= 8192) record.targetDigest = sha(url.href);
        } else {
          unsupported = true;
        }
        observed.set(url.pathname, record);
        return response;
      },
    }),
  });
  const { request, report } = result;
  const document = observed.get("/openapi.json");
  const mpp = observed.get("/mpp-openapi.json");
  const quote = observed.get(request.route);
  if (unsupported || observed.size !== 3 || (mpp?.status !== 404 && (mpp?.status !== 200 || !mpp.digest))
      || request.method !== "GET" || request.requireBazaar || request.requiredPaths.length
      || !report.auditCompleted || !report.runtimeChallengeVerified
      || report.protocols.length !== 1 || report.protocols[0] !== "x402"
      || document?.status !== 200 || quote?.status !== 402 || !document.digest || !quote.digest || !quote.targetDigest) {
    return { result, proof: null };
  }
  const manifest = {
    profile: PROFILE,
    origin: request.origin,
    route: request.route,
    documentSha256: document.digest,
    mppDocumentStatus: mpp.status,
    mppDocumentSha256: mpp.status === 200 ? mpp.digest : null,
    probeUrlSha256: quote.targetDigest,
    paymentRequiredSha256: quote.digest,
  };
  return { result, proof: { ...manifest, digest: manifestDigest(manifest) } };
}
