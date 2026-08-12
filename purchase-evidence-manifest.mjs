import { createHash } from "node:crypto";

import { evaluateResponseContract, SCHEMAS } from "agent-payment-policy";

export const PURCHASE_EVIDENCE_MANIFEST_PATH = "/.well-known/agent-payment-evidence.json";
export const PURCHASE_EVIDENCE_MANIFEST_VERSION = "0.1.0";

function routeKey(method, path) {
  return `${String(method || "GET").toUpperCase()} ${String(path || "")}`;
}

function relativePath(value, label) {
  const path = String(value || "");
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#")) {
    throw new Error(`${label} must be one root-relative path`);
  }
  return path;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function buildPurchaseEvidenceManifest({
  origin,
  serviceVersion,
  resources,
  responseContractFor,
  readOnlyPaidPosts = [],
  serviceDeployment,
  replay,
} = {}) {
  const normalizedOrigin = new URL(origin).origin;
  const readOnlyKeys = new Set(readOnlyPaidPosts.map(({ method, path }) => routeKey(method, path)));
  const operations = [];
  const seen = new Set();

  for (const resource of resources || []) {
    const method = String(resource?.method || "GET").toUpperCase();
    const url = new URL(resource?.url, normalizedOrigin);
    if (url.origin !== normalizedOrigin) throw new Error("purchase evidence resource must be same-origin");
    const path = relativePath(url.pathname, "purchase evidence route");
    const key = routeKey(method, path);
    if (seen.has(key)) throw new Error(`duplicate purchase evidence operation: ${key}`);
    seen.add(key);
    const contract = responseContractFor(key);
    if (!contract?.schema || !contract?.example) throw new Error(`missing response contract for ${key}`);
    const report = evaluateResponseContract({
      schemaVersion: SCHEMAS.responseContractObservation,
      source: "seller_declaration",
      request: { method, url: `${normalizedOrigin}${path}` },
      response: {
        status: 200,
        mediaType: "application/json",
        schema: contract.schema,
        example: contract.example,
      },
    }, { now: Date.parse("2026-01-01T00:00:00.000Z") });
    if (report.decision !== "admissible") throw new Error(`response contract is not admissible for ${key}`);
    const effect = method === "GET" || method === "HEAD" || readOnlyKeys.has(key) ? "read_only" : "undeclared";
    if (effect === "undeclared") throw new Error(`purchase evidence effect is undeclared for ${key}`);
    operations.push({
      method,
      path,
      effect,
      output: {
        mediaType: "application/json",
        schemaDigest: report.schemaDigest,
        requiredPaths: [...report.requiredPaths],
        declaration: "seller_declared",
      },
      replay: {
        responseReplay: "conditional",
        ttlSeconds: replay.ttlSeconds,
        mismatchStatus: replay.mismatchStatus,
        x402Requirement: "payment-identifier",
        mppRequirement: "exact_settled_credential",
        requestBinding: [...replay.requestBinding],
      },
      receipt: {
        x402: "PAYMENT-RESPONSE with signed offer-receipt extension and settlement reference",
        mpp: "Payment-Receipt",
        runtimeValidationRequired: true,
      },
    });
  }
  operations.sort((left, right) => routeKey(left.method, left.path).localeCompare(routeKey(right.method, right.path)));

  const manifest = {
    schemaVersion: "samedaydesk.agent-payment-evidence.v0",
    status: "experimental",
    version: PURCHASE_EVIDENCE_MANIFEST_VERSION,
    service: { origin: normalizedOrigin, version: String(serviceVersion) },
    protocols: ["x402", "mpp"],
    evidence: {
      serviceDeploymentStatement: relativePath(serviceDeployment.statement, "deployment statement"),
      serviceDeploymentPublicKey: relativePath(serviceDeployment.publicKey, "deployment public key"),
      serviceDeploymentStatementId: String(serviceDeployment.statementId),
      serviceDeploymentExpiresAt: String(serviceDeployment.expiresAt),
      paidActionEffects: relativePath(serviceDeployment.paidActionEffects, "paid action effects"),
    },
    operations,
    boundary: {
      claims: "seller_declared_until_independently_verified",
      authorization: "This manifest is evidence for a separate buyer policy decision and is not permission to spend.",
      runtime: "The buyer must still verify the exact live payment challenge, paid response, receipt, settlement, and required output.",
      adoption: "SameDayDesk dogfood only; no external standard or marketplace adoption is claimed.",
    },
  };
  const digestInput = JSON.stringify(canonical(manifest));
  return Object.freeze({ ...manifest, manifestDigest: sha256(digestInput) });
}

export function purchaseEvidenceLinkHeader({ origin, path = PURCHASE_EVIDENCE_MANIFEST_PATH } = {}) {
  const target = new URL(relativePath(path, "purchase evidence manifest"), new URL(origin).origin).toString();
  return `<${target}>; rel="describedby"; type="application/json"`;
}

export function purchaseEvidenceHeaders({ origin, paidRoutes, path = PURCHASE_EVIDENCE_MANIFEST_PATH } = {}) {
  const routes = paidRoutes instanceof Set ? paidRoutes : new Set(paidRoutes || []);
  const link = purchaseEvidenceLinkHeader({ origin, path });
  return (req, res, next) => {
    if (routes.has(req.path)) res.append("Link", link);
    return next();
  };
}
