import assert from "node:assert/strict";
import test from "node:test";

import { declareDiscoveryContract } from "./discovery-contract.mjs";
import {
  buildAuditTarget,
  cdpBazaarEligibility,
  validatePaymentRequiredHeader,
} from "./bazaar-contract-audit.mjs";

test("builds a safe credential-free target from required OpenAPI parameters", () => {
  const target = buildAuditTarget("https://example.com", "/work", {
    parameters: [
      { name: "rewardUsd", in: "query", required: true, schema: { type: "number", exclusiveMinimum: 0 } },
      { name: "domain", in: "query", required: true, schema: { type: "string" } },
      { name: "recipient", in: "query", required: true, schema: { type: "string" } },
      { name: "amountAtomic", in: "query", required: true, schema: { type: "string" } },
      { name: "optional", in: "query", required: false, schema: { type: "string" } },
    ],
  });
  assert.equal(
    target,
    `https://example.com/work?amountAtomic=1&domain=example.com&recipient=0x${"0".repeat(40)}&rewardUsd=1`,
  );
  assert.throws(() => buildAuditTarget("https://example.com", "/work", {
    parameters: [{ name: "apiKey", in: "query", required: true, schema: { type: "string" } }],
  }), /unsafe required query parameter/);
});

test("separates CDP Bazaar routes from alternate x402 settlement rails", () => {
  assert.deepEqual(cdpBazaarEligibility({
    "x-payment-info": { protocols: [{ x402: { scheme: "exact", network: "eip155:8453" } }] },
  }), { eligible: true, settlement: "cdp-default" });
  assert.deepEqual(cdpBazaarEligibility({
    "x-payment-info": { protocols: [{ x402: { scheme: "exact", settlement: "circle-gateway-batched" } }] },
  }), { eligible: false, settlement: "circle-gateway-batched" });
  assert.deepEqual(cdpBazaarEligibility({
    "x-payment-info": { protocols: [{ mpp: { method: "evm", intent: "charge" } }] },
  }), { eligible: false, settlement: null });
});

test("validates the exact Bazaar extension carried by a payment challenge", () => {
  const extension = declareDiscoveryContract({
    routeKey: "GET /audit-fixture",
    input: { url: "https://example.com" },
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    output: { example: { ok: true } },
    outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  }).bazaar;
  extension.info.input.method = "GET";
  const header = Buffer.from(JSON.stringify({
    resource: {
      serviceName: "SameDayDesk Audit Fixture",
      tags: ["audit", "fixture"],
    },
    extensions: { bazaar: extension },
  })).toString("base64");
  assert.deepEqual(validatePaymentRequiredHeader(header), { valid: true, errors: [] });
  const missingMetadata = Buffer.from(JSON.stringify({ extensions: { bazaar: extension } })).toString("base64");
  const missingValidation = validatePaymentRequiredHeader(missingMetadata);
  assert.equal(missingValidation.valid, false);
  assert.ok(missingValidation.errors.some((error) => error.includes("resource_metadata")));
  assert.deepEqual(validatePaymentRequiredHeader("not-json"), { valid: false, errors: ["malformed_payment_required"] });
});
