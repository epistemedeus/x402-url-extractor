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
  assert.equal(evaluated.code, CODES.UNPAID_MCP_ISERROR);
});

test("live unpaid tools/call is HTTP 200 isError===true mcp://tool/extract amount 5000 not settlement", () => {
  const fixture = loadFixture("pass/live-unpaid-tools-call.json");
  const classified = classifyToolsCallObservation(fixture.observation, fixture.request);
  assert.equal(classified.kind, "unpaid_mcp_iserror_challenge");
  assert.equal(classified.httpStatus, 200);
  assert.equal(classified.isError, true);
  assert.equal(classified.hasJsonRpcError, false);
  assert.equal(classified.charged, false);
  assert.equal(classified.paidDelivery, false);
  assert.equal(classified.successProven, false);
  assert.equal(classified.hasPaymentRequiredHeader, false);
  assert.equal(classified.resourceUrl, SDS.mcpResourceUrl);
  assert.equal(classified.amount, SDS.amountAtomic);
  assert.match(classified.error, /Payment required to access this tool/);
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.code, CODES.UNPAID_MCP_ISERROR);
});

test("seeded HTTP 200 isError as charged/paid delivery is rejected", () => {
  const fixture = loadFixture("reject/seeded-http-200-iserror-as-charged.json");
  const evaluated = evaluateToolsCall(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.HTTP_200_ISERROR_CLASSIFIED_AS_CHARGED);
  assert.equal(evaluated.claimsRejected, true);
  assert.equal(evaluated.classified.kind, "unpaid_mcp_iserror_challenge");
  assert.equal(evaluated.classified.charged, false);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded isError:false on PaymentRequired body is rejected", () => {
  const fixture = loadFixture("reject/seeded-iserror-false.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ISERROR_NOT_TRUE);
  assert.equal(evaluated.classified.isError, false);
  assert.equal(evaluated.classified.isErrorValue, false);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded omitted isError on PaymentRequired body is rejected", () => {
  const fixture = loadFixture("reject/seeded-iserror-omitted.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ISERROR_NOT_TRUE);
  assert.equal(evaluated.classified.isErrorPresent, false);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded JSON-RPC error -32042 is rejected as not SDS isError", () => {
  const fixture = loadFixture("reject/seeded-jsonrpc-error-32042.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.JSONRPC_ERROR_NOT_ISERROR);
  assert.equal(evaluated.classified.jsonRpcErrorCode, -32042);
  assert.equal(evaluated.classified.hasJsonRpcError, true);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded HTTP 402 is not the MCP unpaid isError hop", () => {
  const fixture = loadFixture("reject/seeded-http-402.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.HTTP_402_NOT_MCP_ISERROR);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded snake_case is_error is rejected", () => {
  const fixture = loadFixture("reject/seeded-snake-is_error.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.SNAKE_IS_ERROR);
  assert.equal(evaluated.classified.snakeIsError, true);
  assert.equal(evaluated.classified.isError, false);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded isError mixed with extract delivery is rejected", () => {
  const fixture = loadFixture("reject/seeded-iserror-with-delivery.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ISERROR_MIXED_WITH_DELIVERY);
  assert.equal(evaluated.classified.isError, true);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("claims.charged cannot override an unpaid HTTP 200 isError wire", () => {
  const live = loadFixture("pass/live-unpaid-tools-call.json");
  const evaluated = evaluateToolsCall({
    ...live,
    claims: { charged: true, paidDelivery: true, successProven: true },
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.HTTP_200_ISERROR_CLASSIFIED_AS_CHARGED);
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
  assert.equal(report.counted, 13);
  assert.equal(classifyFixture(loadFixture("reject/seeded-http-200-iserror-as-charged.json")).verdict, "rejected");
  assert.equal(classifyFixture(loadFixture("pass/live-unpaid-tools-call.json")).verdict, "pass");
});

test("WETH asset on an unpaid isError challenge is rejected", () => {
  const fixture = loadFixture("reject/seeded-wrong-asset.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ASSET_MISMATCH);
  assert.equal(evaluated.classified.kind, "unpaid_mcp_iserror_challenge");
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("facilitator verify on unpaid isError is rejected", () => {
  const fixture = loadFixture("reject/seeded-verify-on-unpaid.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.VERIFY_ON_UNPAID);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("PaymentRequired isError mixed with extract delivery fields is rejected", () => {
  const fixture = loadFixture("reject/seeded-iserror-challenge-with-delivery.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ISERROR_MIXED_WITH_DELIVERY);
  assert.equal(evaluated.classified.kind, "iserror_mixed_with_delivery");
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("EIP-712 name Wrapped Ether on USDC accept is rejected", () => {
  const fixture = loadFixture("reject/seeded-wrong-eip712-name.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.PIN_MISMATCH);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("payTo mismatch is pin_mismatch, not amount_mismatch", () => {
  const live = loadFixture("pass/live-unpaid-tools-call.json");
  const fixture = structuredClone(live);
  fixture.observation.jsonrpc.result.structuredContent.accepts[0].payTo =
    "0x0000000000000000000000000000000000000001";
  const evaluated = evaluateToolsCall(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.PIN_MISMATCH);
});
