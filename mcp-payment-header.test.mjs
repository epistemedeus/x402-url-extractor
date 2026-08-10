import assert from "node:assert/strict";
import test from "node:test";

import { injectPaymentSignatureHeader } from "./mcp-server.mjs";

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const payment = {
  x402Version: 2,
  resource: { url: "mcp://tool/morpho_position" },
  accepted: { scheme: "exact", network: "eip155:8453", amount: "20000" },
  payload: { authorization: { from: "0xabc" }, signature: "0xsig" },
};

function request(body, header) {
  return {
    body,
    get(name) {
      return name === "PAYMENT-SIGNATURE" ? header : undefined;
    },
  };
}

test("bridges a bounded payment header into tools/call metadata", () => {
  const req = request({ jsonrpc: "2.0", method: "tools/call", params: { name: "morpho_position", arguments: {} } }, encode(payment));
  assert.equal(injectPaymentSignatureHeader(req), true);
  assert.deepEqual(req.body.params._meta["x402/payment"], payment);
});

test("preserves canonical MCP payment metadata instead of overriding it", () => {
  const canonical = { x402Version: 2, payload: { signature: "canonical" } };
  const req = request({ method: "tools/call", params: { _meta: { "x402/payment": canonical } } }, encode(payment));
  assert.equal(injectPaymentSignatureHeader(req), false);
  assert.equal(req.body.params._meta["x402/payment"], canonical);
});

test("ignores malformed, oversized, and incomplete headers", () => {
  const cases = [
    "not base64!",
    "A".repeat(32 * 1024 + 1),
    encode({ x402Version: 2 }),
    encode([]),
  ];
  for (const header of cases) {
    const req = request({ method: "tools/call", params: {} }, header);
    assert.equal(injectPaymentSignatureHeader(req), false);
    assert.equal(req.body.params._meta, undefined);
  }
});

test("ignores payment headers outside tools/call", () => {
  const req = request({ method: "tools/list", params: {} }, encode(payment));
  assert.equal(injectPaymentSignatureHeader(req), false);
  assert.equal(req.body.params._meta, undefined);
});

