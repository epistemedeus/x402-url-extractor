import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLegacyCompatiblePaymentRequired,
  legacyCompatibleX402Body,
} from "./x402-legacy-body.mjs";

const paymentRequired = {
  x402Version: 2,
  error: "Payment required",
  resource: {
    description: "Inspect one payment offer",
    mimeType: "application/json",
    serviceName: "SameDayDesk",
    tags: ["x402", "payments"],
  },
  accepts: [{
    scheme: "exact",
    network: "eip155:8453",
    amount: "5000",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
    extra: { name: "USD Coin" },
  }],
  extensions: {
    bazaar: {
      info: {
        input: { type: "http", method: "POST", bodyFields: { url: "https://example.com" } },
        output: { type: "json", example: { ok: true } },
      },
    },
  },
};

function encoded(value = paymentRequired) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

test("mirrors v2 payment data with legacy aliases without changing the offer", () => {
  const body = buildLegacyCompatiblePaymentRequired(encoded());
  assert.equal(body.x402Version, 2);
  assert.equal(body.accepts[0].amount, "5000");
  assert.equal(body.accepts[0].maxAmountRequired, "5000");
  assert.equal(body.accepts[0].description, "Inspect one payment offer");
  assert.equal(body.accepts[0].mimeType, "application/json");
  assert.equal(body.accepts[0].outputSchema.input.method, "POST");
  assert.equal(body.accepts[0].extra.serviceName, "SameDayDesk");
});

test("projects canonical POST body schema into legacy bodyFields for registry UIs", () => {
  const canonical = structuredClone(paymentRequired);
  canonical.extensions.bazaar.info.input = {
    type: "http",
    method: "POST",
    bodyType: "json",
    body: { url: "https://example.com" },
  };
  canonical.extensions.bazaar.schema = {
    type: "object",
    properties: {
      input: {
        type: "object",
        properties: {
          type: { type: "string", const: "http" },
          method: { type: "string", enum: ["POST"] },
          bodyType: { type: "string", enum: ["json"] },
          body: {
            type: "object",
            properties: {
              url: { type: "string", format: "uri", maxLength: 2048, description: "Exact public HTTPS URL." },
            },
            required: ["url"],
            additionalProperties: false,
          },
        },
        required: ["type", "method", "bodyType", "body"],
      },
    },
    required: ["input"],
  };

  const body = buildLegacyCompatiblePaymentRequired(encoded(canonical));
  assert.equal(body.accepts[0].outputSchema.input.method, "POST");
  assert.equal(body.accepts[0].outputSchema.input.bodyType, "json");
  assert.deepEqual(body.accepts[0].outputSchema.input.body, { url: "https://example.com" });
  assert.deepEqual(body.accepts[0].outputSchema.input.bodyFields.url, {
    type: "string",
    description: "Exact public HTTPS URL.",
    required: true,
    default: "https://example.com",
  });
});

test("fails closed for malformed or non-v2 values", () => {
  assert.equal(buildLegacyCompatiblePaymentRequired("not-base64"), null);
  assert.equal(buildLegacyCompatiblePaymentRequired(encoded({ x402Version: 1, accepts: [] })), null);
});

test("middleware replaces only an empty 402 JSON body", () => {
  const writes = [];
  const res = {
    statusCode: 402,
    getHeader(name) {
      return name === "payment-required" ? encoded() : undefined;
    },
    json(value) {
      writes.push(value);
      return this;
    },
  };
  let nextCalled = false;
  legacyCompatibleX402Body({}, res, () => { nextCalled = true; });
  res.json({});
  assert.equal(nextCalled, true);
  assert.equal(writes[0].accepts[0].maxAmountRequired, "5000");

  res.statusCode = 400;
  res.json({ error: "bad input" });
  assert.deepEqual(writes[1], { error: "bad input" });
});
