import assert from "node:assert/strict";
import test from "node:test";

import {
  PURCHASE_EVIDENCE_MANIFEST_PATH,
  buildPurchaseEvidenceManifest,
  purchaseEvidenceHeaders,
  purchaseEvidenceLinkHeader,
} from "./purchase-evidence-manifest.mjs";

const schema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    result: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
  },
  required: ["ok", "result"],
};

function manifest() {
  return buildPurchaseEvidenceManifest({
    origin: "https://agents.samedaydesk.com",
    serviceVersion: "1.2.3",
    resources: [
      { method: "GET", url: "https://agents.samedaydesk.com/data" },
      { method: "POST", url: "https://agents.samedaydesk.com/check" },
    ],
    responseContractFor: () => ({ schema, example: { ok: true, result: { value: "ready" } } }),
    readOnlyPaidPosts: [{ method: "POST", path: "/check" }],
    serviceDeployment: {
      statement: "/.well-known/deployment.json",
      publicKey: "/.well-known/deployment.pem",
      statementId: "deployment_123",
      expiresAt: "2026-09-01T00:00:00.000Z",
      paidActionEffects: "/.well-known/effects.json",
    },
    replay: {
      ttlSeconds: 900,
      mismatchStatus: 409,
      requestBinding: ["method", "canonical_url", "exact_raw_body_sha256", "payer", "payment_terms", "exact_settled_credential"],
    },
  });
}

test("builds bounded seller-declared authorization evidence for exact operations", () => {
  const value = manifest();
  assert.equal(value.operations.length, 2);
  assert.deepEqual(value.operations.map(({ method, path, effect }) => ({ method, path, effect })), [
    { method: "GET", path: "/data", effect: "read_only" },
    { method: "POST", path: "/check", effect: "read_only" },
  ]);
  assert.deepEqual(value.operations[0].output.requiredPaths, ["ok", "result", "result.value"]);
  assert.match(value.operations[0].output.schemaDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(value.manifestDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(value.boundary.claims, "seller_declared_until_independently_verified");
});

test("rejects missing response contracts, undeclared effects, and cross-origin resources", () => {
  assert.throws(() => buildPurchaseEvidenceManifest({
    origin: "https://agents.samedaydesk.com",
    serviceVersion: "1.2.3",
    resources: [{ method: "GET", url: "https://other.example/data" }],
    responseContractFor: () => ({ schema, example: { ok: true, result: { value: "ready" } } }),
  }), /same-origin/);
  assert.throws(() => buildPurchaseEvidenceManifest({
    origin: "https://agents.samedaydesk.com",
    serviceVersion: "1.2.3",
    resources: [{ method: "POST", url: "https://agents.samedaydesk.com/check" }],
    responseContractFor: () => ({ schema, example: { ok: true, result: { value: "ready" } } }),
    serviceDeployment: { statement: "/a", publicKey: "/b", paidActionEffects: "/c" },
    replay: { ttlSeconds: 900, mismatchStatus: 409, requestBinding: [] },
  }), /effect is undeclared/);
});

test("advertises the manifest through one standard describedby link on paid routes only", () => {
  assert.equal(
    purchaseEvidenceLinkHeader({ origin: "https://agents.samedaydesk.com" }),
    '<https://agents.samedaydesk.com/.well-known/agent-payment-evidence.json>; rel="describedby"; type="application/json"',
  );
  const middleware = purchaseEvidenceHeaders({
    origin: "https://agents.samedaydesk.com",
    paidRoutes: new Set(["/paid"]),
  });
  const appended = [];
  let nextRuns = 0;
  middleware({ path: "/paid" }, { append: (name, value) => appended.push([name, value]) }, () => { nextRuns += 1; });
  middleware({ path: PURCHASE_EVIDENCE_MANIFEST_PATH }, { append: (name, value) => appended.push([name, value]) }, () => { nextRuns += 1; });
  assert.equal(nextRuns, 2);
  assert.deepEqual(appended, [["Link", purchaseEvidenceLinkHeader({ origin: "https://agents.samedaydesk.com" })]]);
});
