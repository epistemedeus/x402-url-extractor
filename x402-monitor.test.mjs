import assert from "node:assert/strict";
import test from "node:test";

import {
  X402MonitorError,
  normalizeX402MonitorInput,
  x402Monitor,
  x402MonitorOutputSchema,
} from "./x402-monitor.mjs";

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
    responseContract: { decision: "admissible", requiredPaths: ["ok"] },
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

test("requires one exact route and defaults origin to the hosted merchant", () => {
  assert.deepEqual(normalizeX402MonitorInput({ route: "/commerce/payment-offer-preflight" }), {
    origin: "https://agents.samedaydesk.com",
    route: "/commerce/payment-offer-preflight",
    method: "GET",
    requiredPaths: [],
    requireBazaar: false,
    referral: null,
  });
  assert.throws(() => normalizeX402MonitorInput({}), X402MonitorError);
  assert.throws(() => normalizeX402MonitorInput({ origin: "https://seller.example" }), /route must be one exact/);
  assert.throws(() => normalizeX402MonitorInput({ route: "/paid", token: "secret" }), /unsupported input field/);
  assert.throws(() => normalizeX402MonitorInput({ route: "/paid", referral: `r1_${"a".repeat(64)}` }), /unsupported input field: referral/);
  assert.equal(normalizeX402MonitorInput({ route: "/paid", referral: null }).referral, null);
});

test("runs the existing seller-integrity audit and labels the monitor product", async () => {
  let received;
  const result = await x402Monitor({ origin: "https://seller.example", route: "/paid" }, {
    auditImpl: async (input) => { received = input; return REPORT; },
  });
  assert.deepEqual(received, { origin: "https://seller.example", route: "/paid", method: "GET", requiredPaths: [], requireBazaar: false, maxRoutes: 1, publicDns: true });
  assert.equal(result.product, "samedaydesk-x402-monitor");
  assert.equal(result.decision, "machine_buyable");
  assert.equal(result.report.auditCompleted, true);
  assert.deepEqual(x402MonitorOutputSchema().required, ["ok", "product", "version", "checkedAt", "decision", "request", "report", "nextActions", "referralOffer", "boundary"]);
  assert.equal(x402MonitorOutputSchema().properties.product.const, "samedaydesk-x402-monitor");
});
