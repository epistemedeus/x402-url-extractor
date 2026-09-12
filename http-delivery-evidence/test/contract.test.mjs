import assert from "node:assert/strict";
import test from "node:test";

import { extractBatchOutputSchema } from "../../extract-batch.mjs";
import { extractMcpOutputSchema, readMcpOutputSchema } from "../../extract.mjs";
import { lockfilePinDeltaOutputExample, lockfilePinDeltaOutputSchema } from "../../lockfile-pin-delta.mjs";
import { vendorBudgetImpactOutputExample, vendorBudgetImpactOutputSchema } from "../../vendor-budget-impact.mjs";
import { bindMerchantHttpDeliveryContracts } from "../bind-merchant-contracts.mjs";
import {
  DELIVERY,
  MAX_RESPONSE_BYTES,
  RESOURCES,
  SCHEMA_CONFORMANCE,
  SETTLEMENT_CLASS,
  VERDICT,
  checkDeclaredContract,
  evaluateResponseBytes,
  generatedBatchMcpSchema,
  generatedHttpSchema,
  jsonSchemaSafeParse,
  parseJsonBytes,
  recordFromObservedResponse,
} from "../index.mjs";
import {
  extractCapture,
  merchantCatchEnvelope,
  validBatchBody,
  validExtractBody,
  validReadBody,
} from "./helpers.mjs";

bindMerchantHttpDeliveryContracts();

function evaluateExtract(body, extra = {}) {
  return evaluateResponseBytes({
    method: "GET",
    resource: RESOURCES.EXTRACT,
    responseBytes: Buffer.from(JSON.stringify(body)),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
    ...extra,
  });
}

test("live schemas agree with generated snapshot and HTTP batch is not MCP Zod", () => {
  const full = validExtractBody();
  const refused = validExtractBody({
    status: 403,
    sourceOk: false,
    error: { code: "http_403", message: "source refused: HTTP 403" },
  });
  const timedOut = merchantCatchEnvelope({ code: "timeout", message: "aborted" });
  assert.equal(extractMcpOutputSchema.safeParse(full).success, true);
  assert.equal(checkDeclaredContract(RESOURCES.EXTRACT, full).ok, true);
  assert.equal(jsonSchemaSafeParse(generatedHttpSchema(RESOURCES.EXTRACT), full).ok, true);
  assert.equal(extractMcpOutputSchema.safeParse(refused).success, true);
  assert.equal(checkDeclaredContract(RESOURCES.EXTRACT, refused).ok, true);
  assert.equal(extractMcpOutputSchema.safeParse(timedOut).success, false);
  assert.equal(checkDeclaredContract(RESOURCES.EXTRACT, timedOut).ok, false);

  const batch = validBatchBody();
  assert.equal(checkDeclaredContract(RESOURCES.EXTRACT_BATCH, batch, "POST").ok, true);
  assert.equal(jsonSchemaSafeParse(extractBatchOutputSchema(), batch).ok, true);
  const quoted = validBatchBody({
    quote: { ...validBatchBody().quote, extra: "not-in-mcp-zod" },
  });
  assert.equal(jsonSchemaSafeParse(extractBatchOutputSchema(), quoted).ok, true);
  assert.equal(jsonSchemaSafeParse(generatedBatchMcpSchema(), quoted).ok, false);
});

test("HTTP 200 plus nonempty text is not a pass without the declared contract", () => {
  const bytes = Buffer.from(JSON.stringify({ ok: true, status: 200, text: "hello from a page" }));
  const result = evaluateExtract(JSON.parse(bytes.toString("utf8")));
  assert.equal(result.validatorVerdict, VERDICT.INVALID);
  assert.equal(result.deliveryClass, DELIVERY.MALFORMED_BODY);
  assert.equal(result.usefulness, "unknown");
  assert.equal(result.schemaConformance, SCHEMA_CONFORMANCE.FAILS);
});

test("missing and malformed bodies stay unknown or invalid, never pass", () => {
  const missing = evaluateResponseBytes({
    method: "GET",
    resource: RESOURCES.EXTRACT,
    responseBytes: Buffer.alloc(0),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(missing.validatorVerdict, VERDICT.UNKNOWN);
  assert.equal(missing.deliveryClass, DELIVERY.MISSING_BODY);
  const malformed = evaluateResponseBytes({
    method: "GET",
    resource: RESOURCES.EXTRACT,
    responseBytes: Buffer.from("<html>not json"),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(malformed.validatorVerdict, VERDICT.INVALID);
  assert.equal(malformed.deliveryClass, DELIVERY.MALFORMED_BODY);
  assert.equal(parseJsonBytes(Buffer.from("{")).ok, false);
});

test("declared extract distinguishes refusal, truncation, and full capture", () => {
  const full = evaluateExtract(validExtractBody());
  assert.equal(full.validatorVerdict, VERDICT.PASS);
  assert.equal(full.deliveryClass, DELIVERY.FULL_BOUNDED_CAPTURE);
  assert.equal(full.usefulness, "unknown");

  const refused = evaluateExtract(validExtractBody({
    status: 403,
    sourceOk: false,
    error: { code: "http_403", message: "source refused: HTTP 403" },
    text: "Access Denied block copy",
  }));
  assert.equal(refused.deliveryClass, DELIVERY.SOURCE_REFUSAL);
  assert.equal(refused.counters.sourceRefusalMarks, 1);

  const truncated = evaluateExtract(validExtractBody({
    capture: extractCapture({ textTruncated: true }),
  }));
  assert.equal(truncated.deliveryClass, DELIVERY.TRUNCATED_PARTIAL);
  assert.ok(truncated.counters.truncateMarks >= 1);
});

test("source refusal is principal when truncation is also present", () => {
  const both = evaluateExtract(validExtractBody({
    status: 403,
    sourceOk: false,
    error: { code: "http_403", message: "source refused: HTTP 403" },
    capture: extractCapture({ textTruncated: true, bodyTruncated: true }),
  }));
  assert.equal(both.deliveryClass, DELIVERY.SOURCE_REFUSAL);
  assert.notEqual(both.deliveryClass, DELIVERY.TRUNCATED_PARTIAL);
  assert.equal(both.counters.sourceRefusalMarks, 1);
  assert.ok(both.counters.truncateMarks >= 2);
});

test("schema-shaped HTTP 500 is not completed delivery", () => {
  const result = evaluateExtract(validExtractBody(), { merchantHttpStatus: 500 });
  assert.equal(result.schemaConformance, SCHEMA_CONFORMANCE.HOLDS);
  assert.equal(result.validatorVerdict, VERDICT.INVALID);
  assert.equal(result.deliveryClass, DELIVERY.MERCHANT_HTTP_FAILURE);
  assert.notEqual(result.validatorVerdict, VERDICT.PASS);
});

test("unsupported method or resource stays unknown", () => {
  const put = evaluateResponseBytes({
    method: "PUT",
    resource: RESOURCES.EXTRACT,
    responseBytes: Buffer.from(JSON.stringify(validExtractBody())),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(put.deliveryClass, DELIVERY.UNSUPPORTED_TARGET);
  const scan = evaluateResponseBytes({
    method: "GET",
    resource: "/scan",
    responseBytes: Buffer.from(JSON.stringify({ ok: true })),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(scan.deliveryClass, DELIVERY.UNSUPPORTED_TARGET);
});

test("timeout and unsupported encoding stay distinct from source refusal", () => {
  assert.equal(evaluateExtract(merchantCatchEnvelope({ code: "timeout" })).deliveryClass, DELIVERY.TRANSPORT_FAILURE);
  assert.equal(evaluateExtract(merchantCatchEnvelope({ code: "unsupported_encoding" })).deliveryClass, DELIVERY.UNSUPPORTED_CONTENT);
  assert.equal(evaluateExtract(merchantCatchEnvelope({ code: "fetch_error" })).deliveryClass, DELIVERY.ENGINE_FAILURE);
});

test("read, batch, lockfile, and vendor-budget no-change hold as completed capture", () => {
  assert.equal(readMcpOutputSchema.safeParse(validReadBody()).success, true);
  const readEval = evaluateResponseBytes({
    method: "GET",
    resource: RESOURCES.READ,
    responseBytes: Buffer.from(JSON.stringify(validReadBody())),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(readEval.deliveryClass, DELIVERY.FULL_BOUNDED_CAPTURE);

  const batchEval = evaluateResponseBytes({
    method: "POST",
    resource: RESOURCES.EXTRACT_BATCH,
    responseBytes: Buffer.from(JSON.stringify(validBatchBody())),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(batchEval.deliveryClass, DELIVERY.FULL_BOUNDED_CAPTURE);

  const lockfile = { ...lockfilePinDeltaOutputExample(), analysis: "informational" };
  const lockParse = jsonSchemaSafeParse(lockfilePinDeltaOutputSchema(), lockfile);
  const lockEval = evaluateResponseBytes({
    method: "POST",
    resource: RESOURCES.LOCKFILE,
    responseBytes: Buffer.from(JSON.stringify(lockfile)),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(lockParse.ok, true);
  assert.equal(lockEval.deliveryClass, DELIVERY.FULL_BOUNDED_CAPTURE);

  const vendorBudget = { ...vendorBudgetImpactOutputExample(), analysis: "informational" };
  const vendorParse = jsonSchemaSafeParse(vendorBudgetImpactOutputSchema(), vendorBudget);
  const vendorEval = evaluateResponseBytes({
    method: "POST",
    resource: RESOURCES.VENDOR_BUDGET,
    responseBytes: Buffer.from(JSON.stringify(vendorBudget)),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(vendorParse.ok, true);
  assert.equal(vendorEval.deliveryClass, DELIVERY.FULL_BOUNDED_CAPTURE);
});

test("bounded oversized capture is never full_bounded_capture", () => {
  const huge = Buffer.alloc(MAX_RESPONSE_BYTES + 1, 0x7b);
  const result = evaluateResponseBytes({
    method: "GET",
    resource: RESOURCES.EXTRACT,
    responseBytes: huge,
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.notEqual(result.deliveryClass, DELIVERY.FULL_BOUNDED_CAPTURE);
  const record = recordFromObservedResponse({
    method: "GET",
    resource: RESOURCES.EXTRACT,
    responseBytes: huge,
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
    paidEvidenceId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(record.responseByteLength, MAX_RESPONSE_BYTES + 1);
  assert.equal(record.retainedByteLength, MAX_RESPONSE_BYTES);
  assert.notEqual(record.deliveryClass, DELIVERY.FULL_BOUNDED_CAPTURE);
});
