import { createHash } from "node:crypto";

const PROFILE = "samedaydesk.seller-audit-inputs.v1";
const MAX_DOCUMENT_BYTES = 1_048_576;
const MAX_HEADER_BYTES = 65_536;
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const headerDigest = (value) => typeof value === "string" && value.length > 0
  && Buffer.byteLength(value) <= MAX_HEADER_BYTES ? sha256(value) : null;
const bodyDigest = (value) => value instanceof Uint8Array && value.byteLength <= MAX_DOCUMENT_BYTES
  ? sha256(value) : null;
const kinds = ["openapi", "mpp_openapi", "probe", "purchase_evidence"];

function row(item) {
  return [item.kind, item.status, item.locatorDigest, item.documentDigest, item.linkDigest,
    item.x402ChallengeDigest, item.mppChallengeDigest];
}

export function sellerAuditInputEvidenceSchema() {
  const digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
  const optionalDigest = { ...digest, type: ["string", "null"] };
  const observation = {
    kind: { type: "string", enum: kinds }, status: { type: "integer", minimum: 100, maximum: 599 },
    locatorDigest: digest, documentDigest: optionalDigest, linkDigest: optionalDigest,
    x402ChallengeDigest: optionalDigest, mppChallengeDigest: optionalDigest,
  };
  return {
    description: "Hashes of the public inputs this run observed, not source authentication, historical availability, payment, or proof of delivery.",
    type: "object", additionalProperties: false,
    properties: {
      schema: { type: "string", const: PROFILE },
      scope: { type: "string", enum: ["public_probe", "public_declarations"] },
      digest,
      observations: { type: "array", minItems: 2, maxItems: 4, items: {
        type: "object", additionalProperties: false, properties: observation, required: Object.keys(observation),
      } },
    },
    required: ["schema", "scope", "digest", "observations"],
  };
}

// The recorder never changes the request, result, or verdict of the actual auditor.
// An unrecordable observation withholds evidence rather than exporting partial proof.
export function recordSellerAuditInputs({ origin, route, method, requireBazaar, requiredPaths }, requestImpl) {
  const seen = new Map();
  let withheld = false;
  return {
    async request(urlInput, options) {
      try {
        const response = await requestImpl(urlInput, options);
        try {
          const url = new URL(urlInput);
          const status = response.status;
          if (url.origin !== origin || url.username || url.password || url.hash || url.href.length > 8192
              || !Number.isInteger(status) || status < 100 || status > 599) throw new Error("outside evidence profile");
          const kind = url.pathname === "/openapi.json" ? "openapi"
            : url.pathname === "/mpp-openapi.json" ? "mpp_openapi"
              : method === "GET" && url.pathname === new URL(route, origin).pathname ? "probe" : "purchase_evidence";
          if (seen.has(kind)) throw new Error("duplicate evidence role");
          const documents = kind !== "probe";
          const documentDigest = documents && status === 200 ? bodyDigest(response.body) : null;
          if (documents && !documentDigest && !(kind === "mpp_openapi" && status === 404)) throw new Error("unavailable evidence document");
          const headers = response.headers || {};
          const link = headers.link || null;
          const x402 = !documents ? headers["payment-required"] || headers["x-payment-required"] || null : null;
          // Record only Payment challenges. Never include a generic authentication header.
          const mpp = !documents && /^Payment\s/i.test(headers["www-authenticate"] || "")
            ? headers["www-authenticate"] : null;
          const linkDigest = headerDigest(link);
          const x402ChallengeDigest = headerDigest(x402);
          const mppChallengeDigest = headerDigest(mpp);
          if ((link && !linkDigest) || (x402 && !x402ChallengeDigest) || (mpp && !mppChallengeDigest)) throw new Error("oversized evidence field");
          seen.set(kind, { kind, status, locatorDigest: sha256(url.href), documentDigest, linkDigest, x402ChallengeDigest, mppChallengeDigest });
        } catch {
          withheld = true;
        }
        return response;
      } catch (error) {
        withheld = true;
        throw error;
      }
    },
    finish(probe) {
      if (withheld || !seen.has("openapi") || !seen.has("mpp_openapi") || !probe
          || (probe.attempted === true && !seen.has("probe"))) return null;
      const observations = kinds.map((kind) => seen.get(kind)).filter(Boolean);
      const scope = seen.has("probe") ? "public_probe" : "public_declarations";
      return {
        schema: PROFILE,
        scope,
        digest: sha256(JSON.stringify([PROFILE, scope, origin, route, method,
          requireBazaar, requiredPaths, observations.map(row)])),
        observations,
      };
    },
  };
}
