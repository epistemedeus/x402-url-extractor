import assert from "node:assert/strict";
import test from "node:test";

import { sellerIntegrityAudit } from "./seller-integrity-audit.mjs";
import {
  attachSellerIntegritySummaryToPaymentRequired,
  sellerIntegrityAuditSummarySchema,
  summarizeSellerIntegrityAudit,
} from "./seller-integrity-audit-summary.mjs";

const REPORT = {
  schemaVersion: "agent-payment-integrity.audit.v4",
  checkedAt: "2026-08-12T07:50:00.000Z",
  versions: { x402: "1.0.0", mpp: "1.0.0" },
  ok: false,
  machineBuyable: false,
  routes: [{
    status: 402,
    method: "GET",
    runtimeChallengeVerified: true,
    probe: { attempted: true, reason: null },
    protocols: ["mpp", "x402"],
    valid: true,
    findings: ["seller_response_contract_partial"],
    economics: { x402: { amountAtomic: "5000" }, mpp: { amountAtomic: "5000" } },
    discovery: { bazaar: { present: true, valid: true } },
    responseContract: { decision: "admissible", requiredPaths: ["ok"] },
    repairPlan: {
      mode: "advisory_openapi_repair",
      requiredPaths: ["data.id"],
      guaranteedPaths: [],
      actions: [{
        requiredPath: "data.id",
        action: "add_property_to_required",
        parentPath: "data",
        property: "id",
        propertyDeclared: true,
        propertyType: "string",
      }],
      complete: false,
      boundary: { schemaMutationApplied: false, propertyTypesInferred: false, sellerRuntimeVerified: false, statement: "Seller must verify runtime semantics." },
    },
  }],
};

test("keeps the decision summary and strips field-level report details", async () => {
  const full = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, { auditImpl: async () => REPORT });
  const summary = summarizeSellerIntegrityAudit(full);
  assert.equal(summary.access, "summary");
  assert.equal(summary.decision, "repair_required");
  assert.equal(summary.findingCount, 1);
  assert.equal(summary.report, null);
  assert.deepEqual(summary.detail, { access: "payment_required", priceUsdc: 0.25, network: "eip155:8453" });
  assert.equal(summary.boundary.fieldLevelReportIncluded, false);
  assert.equal(JSON.stringify(summary).includes("repairPlan"), false);
  assert.equal(JSON.stringify(summary).includes("economics"), false);
  assert.deepEqual(sellerIntegrityAuditSummarySchema().required.includes("summary"), false);
  assert.equal(sellerIntegrityAuditSummarySchema().properties.report.type, "null");
});

test("attaches the free summary onto an unpaid 402 payment-required document", () => {
  const summary = summarizeSellerIntegrityAudit({
    ok: true,
    version: "1.3.0",
    checkedAt: "2026-08-12T07:50:00.000Z",
    decision: "machine_buyable",
    request: { origin: "https://seller.example", route: "/paid", method: "GET", requiredPaths: [], requireBazaar: false, referral: null },
    report: { auditCompleted: true, failureCode: null, findings: [] },
    nextActions: [],
  });
  const body = attachSellerIntegritySummaryToPaymentRequired({
    x402Version: 2,
    error: "Payment required",
    accepts: [{ amount: "250000", payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee" }],
  }, summary);
  assert.equal(body.x402Version, 2);
  assert.equal(body.summary.access, "summary");
  assert.equal(body.summary.report, null);
  assert.equal(body.detail.access, "payment_required");
});
