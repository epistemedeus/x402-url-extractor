import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { usdcTermsForNetwork } from "../../x402-payment-terms.mjs";
import {
  classifyHttpExchange,
  classifyUnpaid402,
  encodePaymentRequiredHeader,
  listProtocolFixtureFiles,
  loadProtocolFixtures,
  protocolFixturesRoot,
  validatePaymentRequired,
} from "./unpaid-402.mjs";

const { fixtures, manifest } = loadProtocolFixtures();
const byId = Object.fromEntries(fixtures.map((entry) => [entry.id, entry]));

test("manifest lists every unpaid and reject fixture file", () => {
  const listed = new Set(manifest.fixtures.map((entry) => entry.path));
  const onDisk = listProtocolFixtureFiles();
  assert.deepEqual([...listed].sort(), [...onDisk].sort());
});

test("unpaid 402 fixtures pass", () => {
  const unpaid = fixtures.filter((entry) => entry.expect === "pass");
  assert.ok(unpaid.length >= 3, "expected spec, SDS HTTP, and MCP unpaid fixtures");
  for (const entry of unpaid) {
    const result = classifyUnpaid402(entry.fixture);
    assert.equal(result.ok, true, `${entry.id}: ${result.errors?.join("; ")}`);
    assert.equal(result.verdict, "unpaid_402");
    assert.equal(result.code, "ok");
    assert.equal(result.paymentRequired.x402Version, 2);
    assert.ok(result.paymentRequired.accepts.length >= 1);
  }
});

test("seeded paid-as-unpaid fixtures are rejected", () => {
  const seeded = fixtures.filter((entry) => entry.expect === "reject");
  assert.ok(seeded.length >= 4, "expected multiple seeded failures");
  for (const entry of seeded) {
    const result = classifyUnpaid402(entry.fixture);
    assert.equal(result.ok, false, `${entry.id} was accepted as unpaid 402`);
    assert.equal(result.verdict, "reject");
    assert.equal(result.code, entry.rejectCode, `${entry.id} code ${result.code}`);
  }
});

test("spec HTTP 402 empty-body example is unpaid v2", () => {
  const entry = byId["http-402-spec-v2"];
  const result = classifyUnpaid402(entry.fixture);
  assert.equal(result.ok, true);
  assert.deepEqual(entry.fixture.response.body, {});
  assert.equal(result.paymentRequired.resource.url, "https://api.example.com/premium-data");
  assert.equal(result.paymentRequired.accepts[0].network, "eip155:84532");
  assert.equal(result.paymentRequired.accepts[0].amount, "10000");
});

test("SDS extract unpaid fixture matches public Base USDC terms", () => {
  const entry = byId["http-402-sds-extract"];
  const result = classifyUnpaid402(entry.fixture);
  assert.equal(result.ok, true);
  const accept = result.paymentRequired.accepts[0];
  const terms = usdcTermsForNetwork("eip155:8453");
  assert.equal(accept.scheme, "exact");
  assert.equal(accept.network, "eip155:8453");
  assert.equal(accept.amount, "5000");
  assert.equal(accept.asset, terms.asset);
  assert.equal(accept.extra.name, terms.name);
  assert.equal(accept.payTo, "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee");
  assert.equal(entry.fixture.provenance.paymentSent, false);
  assert.equal(entry.fixture.provenance.credentialsUsed, false);
});

test("MCP unpaid tool result is PaymentRequired, not HTTP 200 product", () => {
  const entry = byId["mcp-tool-extract-unpaid"];
  const result = classifyUnpaid402(entry.fixture);
  assert.equal(result.ok, true);
  assert.equal(entry.fixture.response.result.isError, true);
  assert.equal(result.paymentRequired.resource.url, "mcp://tool/extract");
});

test("seeded paid HTTP 200 settlement is quoted as paid_as_unpaid", () => {
  const entry = byId["paid-as-unpaid-http-200-settlement"];
  const result = classifyUnpaid402(entry.fixture);
  assert.equal(result.ok, false);
  assert.equal(result.code, "paid_as_unpaid");
  assert.match(result.errors[0], /payment-response/);
});

test("rewriting an unpaid 402 into a paid 200 is rejected", () => {
  const unpaid = structuredClone(byId["http-402-spec-v2"].fixture);
  const pass = classifyUnpaid402(unpaid);
  assert.equal(pass.ok, true);

  unpaid.request.headers = {
    "payment-signature": encodePaymentRequiredHeader({
      x402Version: 2,
      accepted: unpaid.response.body,
      payload: { signature: "0xpaid" },
    }),
  };
  unpaid.response.status = 200;
  unpaid.response.headers["payment-response"] = encodePaymentRequiredHeader({
    success: true,
    transaction: `0x${"ab".repeat(32)}`,
    network: "eip155:84532",
    payer: "0x857b06519E91e3A54538791bDbb0E22373e36b66",
  });
  unpaid.response.body = { data: "settled" };
  const result = classifyUnpaid402(unpaid);
  assert.equal(result.ok, false);
  assert.equal(result.code, "paid_as_unpaid");
});

test("empty accepts is not an unpaid 402", () => {
  const paymentRequired = {
    x402Version: 2,
    error: "Payment required",
    resource: { url: "https://api.example.com/premium-data" },
    accepts: [],
  };
  const result = validatePaymentRequired(paymentRequired);
  assert.equal(result.ok, false);
  assert.equal(result.code, "malformed_payment_required");
});

test("live HTTP exchange helper classifies a header-only 402", () => {
  const paymentRequired = JSON.parse(readFileSync(
    join(protocolFixturesRoot(), "unpaid", "http-402-spec-v2.json"),
    "utf8",
  )).response;
  const result = classifyHttpExchange({
    url: "https://api.example.com/premium-data",
    status: 402,
    responseHeaders: paymentRequired.headers,
    body: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, "unpaid_402");
});
