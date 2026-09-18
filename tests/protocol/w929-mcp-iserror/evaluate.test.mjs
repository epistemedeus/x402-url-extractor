import assert from "node:assert/strict";
import { test } from "node:test";

import { CODES, SDS } from "./constants.mjs";
import { classifyToolsCallObservation, classifyToolsListObservation } from "./classify.mjs";
import { classifyFixture, evaluateFixture, evaluateFixtureCorpus, evaluateToolsCall } from "./evaluate.mjs";
import {
  FIXTURE_SCHEMA,
  loadFixture,
  loadFixtures,
  loadManifest,
  listPassFixtureFiles,
  listRejectFixtureFiles,
} from "./paths.mjs";

test("manifest lists every pass and reject fixture", () => {
  const manifest = loadManifest();
  assert.equal(manifest.schema, FIXTURE_SCHEMA);
  const listedPass = manifest.fixtures.filter((entry) => entry.expect === "pass").map((entry) => entry.path).sort();
  const listedReject = manifest.fixtures.filter((entry) => entry.expect === "reject").map((entry) => entry.path).sort();
  assert.deepEqual(listedPass, listPassFixtureFiles());
  assert.deepEqual(listedReject, listRejectFixtureFiles());
});

test("live unpaid tools/list is HTTP 200 paymentRequired amount 5000 without Payment-Required", () => {
  const fixture = loadFixture("pass/live-unpaid-tools-list.json");
  const classified = classifyToolsListObservation(fixture.observation, fixture.request);
  assert.equal(classified.httpStatus, 200);
  assert.equal(classified.paymentRequired, true);
  assert.equal(classified.amount, SDS.amountAtomic);
  assert.equal(classified.payTo, SDS.payTo);
  assert.equal(classified.hasPaymentRequiredHeader, false);
  assert.equal(classified.charged, false);
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.code, CODES.UNPAID_MCP_CHALLENGE);
});

test("live unpaid tools/call is HTTP 200 isError mcp://tool/extract amount 5000 not settlement", () => {
  const fixture = loadFixture("pass/live-unpaid-tools-call.json");
  const classified = classifyToolsCallObservation(fixture.observation, fixture.request);
  assert.equal(classified.kind, "unpaid_mcp_challenge");
  assert.equal(classified.httpStatus, 200);
  assert.equal(classified.isError, true);
  assert.equal(classified.hasJsonRpcError, false);
  assert.equal(classified.charged, false);
  assert.equal(classified.paidDelivery, false);
  assert.equal(classified.successProven, false);
  assert.equal(classified.hasPaymentRequiredHeader, false);
  assert.equal(classified.resourceUrl, SDS.mcpResourceUrl);
  assert.equal(classified.amount, SDS.amountAtomic);
  assert.equal(classified.hasStructuredContent, true);
  assert.equal(classified.hasTextContent, true);
  assert.match(classified.error, /Payment required to access this tool/);
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.code, CODES.UNPAID_MCP_CHALLENGE);
});

test("seeded HTTP 200 as charged/paid delivery is rejected", () => {
  const fixture = loadFixture("reject/seeded-http-200-as-charged.json");
  const evaluated = evaluateToolsCall(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.HTTP_200_CLASSIFIED_AS_CHARGED);
  assert.equal(evaluated.claimsRejected, true);
  assert.equal(evaluated.classified.kind, "unpaid_mcp_challenge");
  assert.equal(evaluated.classified.charged, false);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("JSON-RPC error -32042 is not MCP isError", () => {
  const fixture = loadFixture("reject/seeded-jsonrpc-error.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.JSONRPC_ERROR_NOT_ISERROR);
  assert.equal(evaluated.classified.kind, "jsonrpc_error_not_iserror");
  assert.equal(evaluated.classified.jsonRpcErrorCode, -32042);
  assert.equal(evaluated.classified.isError, false);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("PaymentRequired without isError is rejected", () => {
  const fixture = loadFixture("reject/seeded-iserror-omitted.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ISERROR_OMITTED);
  assert.equal(evaluated.classified.kind, "iserror_omitted");
  assert.equal(evaluated.classified.isError, false);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("snake_case is_error is rejected", () => {
  const fixture = loadFixture("reject/seeded-snake-is-error.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.SNAKE_CASE_IS_ERROR);
  assert.equal(evaluated.classified.snakeIsError, true);
  assert.equal(evaluated.classified.isError, false);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("Payment-Required header fixture is rejected", () => {
  const fixture = loadFixture("reject/seeded-payment-required-header.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.PAYMENT_REQUIRED_HEADER);
  assert.equal(evaluated.classified.hasPaymentRequiredHeader, true);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("invented loyaltyPoints field is rejected", () => {
  const fixture = loadFixture("reject/seeded-invented-field.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.INVENTED_RECEIPT_FIELD);
  assert.ok(evaluated.classified.invented.includes("loyaltyPoints"));
  assert.ok(evaluated.classified.invented.includes("throughBlock"));
});

test("copying scan amount 200000 onto extract is amount_mismatch", () => {
  const fixture = loadFixture("reject/seeded-amount-mismatch.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.AMOUNT_MISMATCH);
  assert.equal(evaluated.classified.amount, "200000");
});

test("HTTP 402 is not the MCP unpaid tools/call shape", () => {
  const evaluated = evaluateToolsCall({
    kind: "mcp-tools-call-unpaid",
    observation: {
      httpStatus: 402,
      headers: {},
      jsonrpc: {
        jsonrpc: "2.0",
        id: 3,
        result: {
          isError: true,
          structuredContent: {
            x402Version: 2,
            error: "Payment required to access this tool",
            resource: { url: SDS.mcpResourceUrl },
            accepts: [{ scheme: "exact", network: SDS.network, amount: SDS.amountAtomic, payTo: SDS.payTo, asset: SDS.asset }],
          },
          content: [{
            type: "text",
            text: JSON.stringify({
              x402Version: 2,
              error: "Payment required to access this tool",
              resource: { url: SDS.mcpResourceUrl },
              accepts: [{ scheme: "exact", network: SDS.network, amount: SDS.amountAtomic, payTo: SDS.payTo, asset: SDS.asset }],
            }),
          }],
        },
      },
    },
    claims: { charged: false },
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.HTTP_402_NOT_MCP_ISERROR);
});

test("claims.charged cannot override an unpaid HTTP 200 isError wire", () => {
  const live = loadFixture("pass/live-unpaid-tools-call.json");
  const evaluated = evaluateToolsCall({
    ...live,
    claims: { charged: true, paidDelivery: true, successProven: true },
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.HTTP_200_CLASSIFIED_AS_CHARGED);
  assert.equal(evaluated.classified.charged, false);
});

test("PAYMENT-SIGNATURE on the request is refused", () => {
  const live = loadFixture("pass/live-unpaid-tools-call.json");
  const evaluated = evaluateToolsCall({
    ...live,
    request: { ...live.request, paymentSignatureSent: true },
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.PAYMENT_SIGNATURE_SENT);
});

test("classifyFixture matches expect for the on-disk corpus", () => {
  const report = evaluateFixtureCorpus(loadFixtures("pass"), loadFixtures("reject"));
  assert.equal(report.ok, true, JSON.stringify(report.failed));
  assert.equal(report.counted, 9);
  assert.equal(classifyFixture(loadFixture("reject/seeded-http-200-as-charged.json")).verdict, "rejected");
  assert.equal(classifyFixture(loadFixture("pass/live-unpaid-tools-call.json")).verdict, "pass");
});
