import assert from "node:assert/strict";
import test from "node:test";

import {
  SellerIntegrityAuditError,
  normalizeSellerIntegrityAuditInput,
  sellerIntegrityAudit,
  sellerIntegrityAuditOutputSchema,
} from "./seller-integrity-audit.mjs";

const REPORT = {
  schemaVersion: "agent-payment-integrity.audit.v2",
  checkedAt: "2026-08-12T07:50:00.000Z",
  versions: { x402: "1.0.0", mpp: "1.0.0" },
  ok: true,
  routes: [{
    status: 402,
    protocols: ["mpp", "x402"],
    valid: true,
    findings: [],
    economics: { x402: { amountAtomic: "5000" }, mpp: { amountAtomic: "5000" } },
    discovery: { bazaar: { present: true, valid: true } },
    responseContract: { decision: "admissible", requiredPaths: ["ok", "title"] },
  }],
};

test("normalizes one exact public seller route", () => {
  assert.deepEqual(normalizeSellerIntegrityAuditInput({
    origin: "https://seller.example",
    route: "/paid/read",
    requireBazaar: "true",
  }), { origin: "https://seller.example", route: "/paid/read", requireBazaar: true });
  assert.throws(() => normalizeSellerIntegrityAuditInput({ origin: "http://seller.example", route: "/paid" }), SellerIntegrityAuditError);
  assert.throws(() => normalizeSellerIntegrityAuditInput({ origin: "https://seller.example", route: "//other.example/paid" }), /exact absolute path/);
  assert.throws(() => normalizeSellerIntegrityAuditInput({ origin: "https://seller.example", route: "/paid", token: "secret" }), /unsupported input field/);
});

test("returns bounded machine-buyable evidence without schemas or target payment", async () => {
  let received;
  const result = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, {
    auditImpl: async (input) => { received = input; return REPORT; },
  });
  assert.deepEqual(received, { origin: "https://seller.example", route: "/paid", requireBazaar: false, maxRoutes: 1 });
  assert.equal(result.decision, "machine_buyable");
  assert.deepEqual(result.nextActions, []);
  assert.equal(result.boundary.targetPaymentSent, false);
  assert.equal(JSON.stringify(result).includes("schema"), true);
  assert.equal(JSON.stringify(result).includes("properties"), false);
  assert.deepEqual(sellerIntegrityAuditOutputSchema().required, ["ok", "product", "version", "checkedAt", "decision", "request", "report", "nextActions", "boundary"]);
  assert.equal(result.report.auditCompleted, true);
  assert.equal(result.report.failureCode, null);
});

test("turns controlled findings into seller repair actions", async () => {
  const partial = structuredClone(REPORT);
  partial.ok = false;
  partial.routes[0].valid = false;
  partial.routes[0].findings = ["seller_response_contract_absent", "x402_full_request_binding_mismatch", "bazaar_extension_missing"];
  const result = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid", requireBazaar: true }, { auditImpl: async () => partial });
  assert.equal(result.decision, "repair_required");
  assert.equal(result.nextActions.length, 3);
});

test("maps bounded seller-contract and transport failures", async () => {
  const absent = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, { auditImpl: async () => { throw new Error("exact paid GET route was not declared"); } });
  assert.equal(absent.decision, "repair_required");
  assert.equal(absent.report.auditCompleted, false);
  assert.equal(absent.report.failureCode, "exact_route_not_declared");

  const transport = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, { auditImpl: async () => { throw new Error("request timed out"); } });
  assert.equal(transport.report.failureCode, "bounded_transport_failure");
});
