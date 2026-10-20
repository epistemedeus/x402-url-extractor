import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSellerIntegrityAuditInput,
  sellerIntegrityAudit,
  sellerIntegrityAuditOutputSchema,
} from "../../../seller-integrity-audit.mjs";
import { normalizeAuthorization } from "../src/authorization.mjs";
import {
  canonicalSellerAuditUrl,
  classifySellerAuditBody,
  normalizeSellerAuditInput,
  sellerAuditTerms,
} from "../src/seller-audit.mjs";

const REPORT = {
  schemaVersion: "agent-payment-integrity.audit.v4",
  checkedAt: "2026-08-12T07:50:00.000Z",
  versions: { x402: "1.0.0", mpp: "1.0.0" },
  ok: true,
  machineBuyable: true,
  routes: [{
    status: 402,
    method: "GET",
    runtimeChallengeVerified: true,
    probe: { attempted: true, reason: null },
    protocols: ["x402"],
    valid: true,
    findings: [],
    economics: null,
    discovery: null,
    responseContract: { decision: "admissible", requiredPaths: ["ok", "title"] },
    repairPlan: {
      mode: "advisory_openapi_repair",
      requiredPaths: ["ok", "title"],
      guaranteedPaths: [],
      actions: [],
      complete: true,
      boundary: {
        schemaMutationApplied: false,
        propertyTypesInferred: false,
        sellerRuntimeVerified: false,
        statement: "Seller must verify runtime semantics.",
      },
    },
  }],
};

function sameAdmission(input) {
  let merchant;
  let buyer;
  let merchantError;
  let buyerError;
  try {
    merchant = normalizeSellerIntegrityAuditInput(input);
  } catch (error) {
    merchantError = error.message;
  }
  try {
    buyer = normalizeSellerAuditInput(input);
  } catch (error) {
    buyerError = error.message;
  }
  assert.equal(buyerError || null, merchantError || null);
  if (!merchantError) assert.deepEqual(buyer, merchant);
}

test("buyer admission matches the installed seller-integrity audit normalizer", () => {
  const accepted = [
    { origin: "https://seller.example", route: "/paid/read", requireBazaar: "true" },
    {
      origin: "https://seller.example",
      route: "/simulate",
      method: "post",
      requiredPaths: "data.attributes,data.type,data.attributes",
      referral: `r1_${"a".repeat(64)}`,
    },
    { origin: "https://8.8.8.8", route: "/extract", method: "GET" },
    { origin: "https://1.1.1.1", route: "/extract", method: "GET", requiredPaths: ["title", "ok"] },
  ];
  for (const input of accepted) sameAdmission(input);
  const rejected = [
    { origin: "http://seller.example", route: "/paid" },
    { origin: "https://seller.example", route: "//other.example/paid" },
    { origin: "https://seller.example", route: "/paid", token: "secret" },
    { origin: "https://seller.example", route: "/paid", method: "PUT" },
    { origin: "https://seller.example", route: "/paid", requiredPaths: "data..secret" },
    { origin: "https://seller.example", route: "/paid", referral: "r1_NOT_A_DIGEST" },
    { origin: "https://10.0.0.1", route: "/extract" },
    { origin: "https://127.0.0.1", route: "/extract" },
    { origin: "https://192.168.1.20", route: "/extract" },
    { origin: "https://169.254.1.1", route: "/extract" },
    { origin: "https://seller.example:443", route: "/extract" },
    { origin: "https://seller.example/path", route: "/extract" },
    { origin: "https://user:pass@seller.example", route: "/extract" },
    { origin: "https://[2606:4700:4700::1111]", route: "/extract" },
  ];
  for (const input of rejected) sameAdmission(input);
  const schema = sellerIntegrityAuditOutputSchema();
  assert.equal(schema.properties.product.const, "samedaydesk-seller-integrity-audit");
  assert.equal(schema.properties.version.const, "1.3.0");
  assert.deepEqual(schema.properties.decision.enum, ["machine_buyable", "contract_ready", "repair_required"]);
});

test("classifies an audit produced by the installed merchant function", async () => {
  const input = {
    origin: "https://seller.example",
    route: "/extract",
    method: "GET",
    requiredPaths: ["ok", "title"],
    requireBazaar: true,
    referral: `r1_${"b".repeat(64)}`,
  };
  let received;
  const produced = await sellerIntegrityAudit(input, {
    auditImpl: async (request) => {
      received = request;
      return REPORT;
    },
  });
  assert.equal(received.referral, undefined);
  assert.equal(received.publicDns, true);
  assert.equal(received.maxRoutes, 1);
  assert.deepEqual(received.requiredPaths, ["ok", "title"]);
  assert.equal(produced.product, "samedaydesk-seller-integrity-audit");
  assert.equal(produced.version, "1.3.0");
  assert.equal(produced.ok, true);
  assert.equal(produced.decision, "machine_buyable");
  assert.equal(produced.boundary.targetPaymentSent, false);
  assert.equal(produced.boundary.credentialsUsed, false);
  const authorization = normalizeAuthorization(sellerAuditTerms(
    canonicalSellerAuditUrl("https://agents.samedaydesk.com", normalizeSellerAuditInput(input)),
  ));
  assert.equal(classifySellerAuditBody(produced, authorization).delivery, "audit_complete");

  const incomplete = await sellerIntegrityAudit(input, {
    auditImpl: async () => {
      throw new Error("document returned HTTP 503");
    },
  });
  assert.equal(incomplete.report.failureCode, "openapi_unavailable");
  assert.equal(incomplete.report.auditCompleted, false);
  assert.equal(classifySellerAuditBody(incomplete, authorization).delivery, "audit_incomplete");

  const refused = await sellerIntegrityAudit(
    { origin: "https://seller.example", route: "/extract", method: "GET" },
    { auditImpl: async () => ({ ...REPORT, ok: false, machineBuyable: false }) },
  );
  assert.equal(refused.decision, "repair_required");
  assert.equal(refused.ok, false);
  const refusedAuth = normalizeAuthorization(sellerAuditTerms(
    canonicalSellerAuditUrl("https://agents.samedaydesk.com", normalizeSellerAuditInput({
      origin: "https://seller.example",
      route: "/extract",
      method: "GET",
    })),
  ));
  assert.equal(classifySellerAuditBody(refused, refusedAuth).delivery, "audit_refused");
});
