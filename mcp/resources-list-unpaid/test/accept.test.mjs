import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ACCEPT_CODES, acceptInitialize, acceptResourcesList } from "../accept.mjs";
import { UNPAID_RESOURCE_URIS, listResourceDescriptors } from "../catalog.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAID_LIST = JSON.parse(readFileSync(join(HERE, "../fixtures/seeded-paid-list.json"), "utf8"));

function listedCapture(resources = listResourceDescriptors()) {
  return {
    httpStatus: 200,
    headers: { "content-type": "application/json" },
    paymentSent: false,
    json: {
      jsonrpc: "2.0",
      id: 2,
      result: { resources },
    },
  };
}

test("accepts the unpaid catalog envelope", () => {
  const decision = acceptResourcesList(listedCapture());
  assert.equal(decision.ok, true);
  assert.equal(decision.paymentRequired, false);
  assert.equal(decision.paymentSent, false);
  assert.deepEqual(decision.uris, [...UNPAID_RESOURCE_URIS]);
  assert.equal(decision.count, 4);
});

test("rejects the seeded paid-list fixture", () => {
  const decision = acceptResourcesList(PAID_LIST);
  assert.equal(decision.ok, false);
  assert.equal(decision.paymentRequired, false);
  assert.equal(decision.error.code, ACCEPT_CODES.RESOURCES_LIST_PAID);
  assert.equal(decision.error.capturePaymentRequired, true);
  assert.match(decision.error.message, /payment challenge|payment-required/i);
});

test("rejects HTTP 402", () => {
  const decision = acceptResourcesList({
    httpStatus: 402,
    headers: { "payment-required": "e30=" },
    paymentSent: false,
    json: { jsonrpc: "2.0", id: 2, error: { code: 402, message: "Payment Required" } },
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.error.code, ACCEPT_CODES.RESOURCES_LIST_PAID);
});

test("rejects JSON-RPC -32042", () => {
  const decision = acceptResourcesList({
    httpStatus: 200,
    headers: {},
    paymentSent: false,
    json: { jsonrpc: "2.0", id: 2, error: { code: -32042, message: "Payment required" } },
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.error.code, ACCEPT_CODES.RESOURCES_LIST_PAID);
});

test("rejects a payment credential on the list request", () => {
  const decision = acceptResourcesList({ ...listedCapture(), paymentSent: true });
  assert.equal(decision.ok, false);
  assert.equal(decision.error.code, ACCEPT_CODES.RESOURCES_LIST_PAYMENT_SENT);
});

test("rejects an empty list and a marked paid resource", () => {
  assert.equal(acceptResourcesList(listedCapture([])).error.code, ACCEPT_CODES.RESOURCES_LIST_EMPTY);
  const paid = listResourceDescriptors().map((item, index) => (
    index === 0 ? { ...item, _meta: { "x402/paymentRequired": true } } : item
  ));
  assert.equal(acceptResourcesList(listedCapture(paid)).error.code, ACCEPT_CODES.RESOURCES_LIST_PAID);
});

test("rejects catalog extras and omissions", () => {
  const missing = listResourceDescriptors().slice(1);
  const extra = [...listResourceDescriptors(), { uri: "mcp://x402-url-extractor/unpaid/secret", name: "secret" }];
  assert.equal(acceptResourcesList(listedCapture(missing)).error.code, ACCEPT_CODES.RESOURCES_LIST_CATALOG_MISMATCH);
  assert.equal(acceptResourcesList(listedCapture(extra)).error.code, ACCEPT_CODES.RESOURCES_LIST_CATALOG_MISMATCH);
});

test("initialize must advertise resources", () => {
  const ok = acceptInitialize({
    json: {
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { resources: {} },
        serverInfo: { name: "x402-url-extractor-resources-list-unpaid", version: "1.0.0" },
      },
    },
  });
  assert.equal(ok.ok, true);
  const missing = acceptInitialize({
    json: { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} } } },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, ACCEPT_CODES.RESOURCES_LIST_MISSING);
});
