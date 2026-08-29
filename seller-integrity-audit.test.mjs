import assert from "node:assert/strict";
import test from "node:test";

import {
  SellerIntegrityAuditError,
  normalizeSellerIntegrityAuditInput,
  sellerIntegrityAudit,
  sellerIntegrityAuditOutputSchema,
} from "./seller-integrity-audit.mjs";

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
    protocols: ["mpp", "x402"],
    valid: true,
    findings: [],
    economics: { x402: { amountAtomic: "5000" }, mpp: { amountAtomic: "5000" } },
    discovery: { bazaar: { present: true, valid: true } },
    responseContract: { decision: "admissible", requiredPaths: ["ok", "title"] },
    repairPlan: {
      mode: "advisory_openapi_repair",
      requiredPaths: [],
      guaranteedPaths: [],
      actions: [],
      complete: true,
      boundary: { schemaMutationApplied: false, propertyTypesInferred: false, sellerRuntimeVerified: false, statement: "Seller must verify runtime semantics." },
    },
  }],
};

test("normalizes one exact public seller route", () => {
  assert.deepEqual(normalizeSellerIntegrityAuditInput({
    origin: "https://seller.example",
    route: "/paid/read",
    requireBazaar: "true",
  }), { origin: "https://seller.example", route: "/paid/read", method: "GET", requiredPaths: [], requireBazaar: true });
  assert.deepEqual(normalizeSellerIntegrityAuditInput({
    origin: "https://seller.example",
    route: "/simulate",
    method: "post",
    requiredPaths: "data.attributes,data.type,data.attributes",
  }), { origin: "https://seller.example", route: "/simulate", method: "POST", requiredPaths: ["data.attributes", "data.type"], requireBazaar: false });
  assert.throws(() => normalizeSellerIntegrityAuditInput({ origin: "http://seller.example", route: "/paid" }), SellerIntegrityAuditError);
  assert.throws(() => normalizeSellerIntegrityAuditInput({ origin: "https://seller.example", route: "//other.example/paid" }), /exact absolute path/);
  assert.throws(() => normalizeSellerIntegrityAuditInput({ origin: "https://seller.example", route: "/paid", token: "secret" }), /unsupported input field/);
  assert.throws(() => normalizeSellerIntegrityAuditInput({ origin: "https://seller.example", route: "/paid", method: "PUT" }), /GET or POST/);
  assert.throws(() => normalizeSellerIntegrityAuditInput({ origin: "https://seller.example", route: "/paid", requiredPaths: "data..secret" }), /safe dotted/);
});

test("returns bounded machine-buyable evidence without schemas or target payment", async () => {
  let received;
  const result = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, {
    auditImpl: async (input) => { received = input; return REPORT; },
  });
  assert.deepEqual(received, { origin: "https://seller.example", route: "/paid", method: "GET", requiredPaths: [], requireBazaar: false, maxRoutes: 1, publicDns: true });
  assert.equal(result.decision, "machine_buyable");
  assert.deepEqual(result.nextActions, []);
  assert.equal(result.boundary.targetPaymentSent, false);
  assert.equal(result.boundary.targetRequestSent, false);
  assert.equal(JSON.stringify(result).includes("schema"), true);
  assert.equal(JSON.stringify(result).includes("properties"), false);
  assert.deepEqual(sellerIntegrityAuditOutputSchema().required, ["ok", "product", "version", "checkedAt", "decision", "request", "report", "nextActions", "boundary"]);
  assert.equal(result.report.auditCompleted, true);
  assert.equal(result.report.failureCode, null);
  assert.equal(result.report.repairPlan.complete, true);
});

test("separates static POST contract readiness from live machine buyability", async () => {
  const staticPost = structuredClone(REPORT);
  staticPost.machineBuyable = false;
  staticPost.routes[0].method = "POST";
  staticPost.routes[0].status = null;
  staticPost.routes[0].runtimeChallengeVerified = false;
  staticPost.routes[0].probe = { attempted: false, reason: "post_requires_explicit_non_secret_fixture" };
  staticPost.routes[0].protocols = ["mpp", "x402"];
  staticPost.routes[0].economics = null;
  const result = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/simulate", method: "POST", requiredPaths: ["data.attributes"] }, { auditImpl: async () => staticPost });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "contract_ready");
  assert.equal(result.report.runtimeChallengeVerified, false);
  assert.equal(result.boundary.targetRequestSent, false);
  assert.equal(result.report.repairPlan.mode, "advisory_openapi_repair");
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

test("turns invalid x402 protocol documents into one exact repair action", async () => {
  const invalidProtocol = structuredClone(REPORT);
  invalidProtocol.ok = false;
  invalidProtocol.routes[0].valid = false;
  invalidProtocol.routes[0].findings = ["x402_payment_required_schema_invalid", "x402_resource_schema_invalid"];
  const result = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, { auditImpl: async () => invalidProtocol });
  assert.equal(result.decision, "repair_required");
  assert.deepEqual(result.nextActions, [
    "Publish an x402 PaymentRequired document that passes the official protocol schemas, including bounded resource metadata.",
  ]);
});

test("maps bounded seller-contract and transport failures", async () => {
  const absent = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, { auditImpl: async () => { throw new Error("exact paid GET route was not declared"); } });
  assert.equal(absent.decision, "repair_required");
  assert.equal(absent.report.auditCompleted, false);
  assert.equal(absent.report.failureCode, "exact_route_not_declared");

  const transport = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, { auditImpl: async () => { throw new Error("request timed out"); } });
  assert.equal(transport.report.failureCode, "bounded_transport_failure");
});
