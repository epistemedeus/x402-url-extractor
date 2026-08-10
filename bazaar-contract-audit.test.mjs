import assert from "node:assert/strict";
import test from "node:test";

import { declareDiscoveryContract } from "./discovery-contract.mjs";
import { buildAuditTarget, validatePaymentRequiredHeader } from "./bazaar-contract-audit.mjs";

test("builds a safe credential-free target from required OpenAPI parameters", () => {
  const target = buildAuditTarget("https://example.com", "/work", {
    parameters: [
      { name: "rewardUsd", in: "query", required: true, schema: { type: "number", exclusiveMinimum: 0 } },
      { name: "domain", in: "query", required: true, schema: { type: "string" } },
      { name: "optional", in: "query", required: false, schema: { type: "string" } },
    ],
  });
  assert.equal(target, "https://example.com/work?domain=example.com&rewardUsd=1");
  assert.throws(() => buildAuditTarget("https://example.com", "/work", {
    parameters: [{ name: "apiKey", in: "query", required: true, schema: { type: "string" } }],
  }), /unsafe required query parameter/);
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
