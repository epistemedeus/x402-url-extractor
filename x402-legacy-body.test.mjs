import assert from "node:assert/strict";
import test from "node:test";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import {
  buildLegacyCompatiblePaymentRequired,
  mirrorLegacyX402Body,
} from "./x402-legacy-body.mjs";

const paymentRequired = {
  x402Version: 2,
  error: "Payment required",
  resource: {
    url: "https://example.com/extract-batch?view=full",
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
    maxTimeoutSeconds: 300,
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
  return encodePaymentRequiredHeader(value);
}

test("mirrors v2 payment data with legacy aliases without changing the offer", () => {
  const body = buildLegacyCompatiblePaymentRequired(encoded());
  assert.equal(body.x402Version, 2);
  assert.deepEqual(body.resource, paymentRequired.resource);
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

test("mirrors the canonical header for both known unpaid 402 placeholders", () => {
  const headers = { "PAYMENT-REQUIRED": encoded(), "Content-Type": "application/json", "Cache-Control": "no-store" };
  for (const body of [{}, { error: "Payment required" }]) {
    const original = { status: 402, headers, body };
    const mirrored = mirrorLegacyX402Body(original);
    assert.equal(mirrored.headers, headers);
    assert.equal(mirrored.status, 402);
    assert.equal(mirrored.body.accepts[0].maxAmountRequired, "5000");
    assert.deepEqual(mirrored.body.resource, paymentRequired.resource);
    assert.equal(original.body, body);
  }
});

test("preserves unrelated errors, non-402 statuses, HTML and unvalidated challenges", () => {
  const body = { error: "Payment required" };
  const headers = (header) => ({ "Content-Type": "application/json", "PAYMENT-REQUIRED": header });
  const challenge = { status: 402, body, headers: headers(encoded()) };
  for (const [name, override] of [
    ["settlement failure", { body: { error: "settlement_failed" } }],
    ["extra error fields", { body: { ...body, retry: false } }],
    ["HTML", { body: "<html></html>", isHtml: true }],
    ["precondition status", { status: 412 }],
    ["successful response", { status: 200 }],
    ["different content type", { headers: { ...headers(encoded()), "Content-Type": "text/plain" } }],
    ["no header", { headers: headers(undefined) }],
    ["duplicate header", { headers: headers([encoded(), encoded()]) }],
    ["malformed header", { headers: headers(`${encoded()}, invalid`) }],
    ["oversize header", { headers: headers("A".repeat(131_073)) }],
    ["different challenge error", { headers: headers(encoded({ ...paymentRequired, error: "No matching payment requirements" })) }],
    ["no resource", { headers: headers(encoded({ ...paymentRequired, resource: undefined })) }],
    ["no offers", { headers: headers(encoded({ ...paymentRequired, accepts: [] })) }],
    ["invalid offer", { headers: headers(encoded({ ...paymentRequired, accepts: [{ ...paymentRequired.accepts[0], maxTimeoutSeconds: 0 }] })) }],
  ]) {
    const response = { ...challenge, ...override };
    assert.equal(mirrorLegacyX402Body(response), response, name);
  }
});
