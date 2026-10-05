import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { capturePaidEvidenceResponseDigest } from "../../commerce-events.mjs";
import { SELLER_INTEGRITY_AUDIT_EXAMPLE } from "../../seller-integrity-audit.mjs";
import { asToolResult } from "../../mcp-server.mjs";
import { morphoPosition } from "../../morpho-position.mjs";
import { runMeasurement } from "../../experiments/morpho-useful-delivery-1005/measure.mjs";
import { FIXTURE_ADDRESS, FREE_INDEX_ITEM, fixtureFetch, graphqlPage } from "../../experiments/morpho-useful-delivery-1005/fixture.mjs";
import { bindMerchantHttpDeliveryContracts } from "../bind-merchant-contracts.mjs";
import { sealStreamedHttpCapture } from "../observation.mjs";
import {
  DELIVERY,
  MAX_RESPONSE_BYTES,
  MCP_MORPHO_RESOURCE,
  MCP_TOOL_VALIDATOR_SOURCE,
  RESOURCES,
  SETTLEMENT_CLASS,
  VERDICT,
  checkDeclaredContract,
  declareCallerUsefulness,
  digestResponseBytes,
  evaluateMcpToolDelivery,
  evaluateResponseBytes,
  mcpDeliveryAttaches,
  openStore,
  recordFromObservedMcpDelivery,
  recordFromObservedResponse,
  sealObservedMcpToolResult,
} from "../index.mjs";
import { historicalV1Row, validExtractBody } from "./helpers.mjs";

bindMerchantHttpDeliveryContracts();

const EVENT = "44444444-4444-4444-8444-444444444444";
const OTHER_EVENT = "55555555-5555-4555-8555-555555555555";
const UNRETAINED_A = "77777777-7777-4777-8777-777777777777";
const UNRETAINED_B = "88888888-8888-4888-8888-888888888888";
const SETTLEMENT = `0x${"a".repeat(64)}`;
const OTHER_SETTLEMENT = `0x${"b".repeat(64)}`;
const REQUEST = "d".repeat(64);
const OTHER_REQUEST = "e".repeat(64);

function evaluate(body, extra = {}) {
  return evaluateResponseBytes({
    method: "GET",
    resource: RESOURCES.MORPHO_POSITION,
    responseBytes: Buffer.from(JSON.stringify(body)),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
    ...extra,
  });
}

async function snapshot() {
  return morphoPosition(FIXTURE_ADDRESS, {
    shocks: [-10, -50],
    rpcCheck: false,
    fetchImpl: fixtureFetch(graphqlPage(FREE_INDEX_ITEM, { count: 1, countTotal: 1, limit: 100, skip: 0 })),
  });
}

function record(body, extra = {}) {
  return recordFromObservedResponse({
    method: "GET",
    resource: RESOURCES.MORPHO_POSITION,
    responseBytes: Buffer.from(JSON.stringify(body)),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
    settlementReference: SETTLEMENT,
    requestDigest: REQUEST,
    paidEvidenceId: EVENT,
    ...extra,
  });
}

test("morpho success schema accepts the producer and still accepts extract and seller", async () => {
  const body = await snapshot();
  assert.equal(checkDeclaredContract(RESOURCES.MORPHO_POSITION, body, "GET").ok, true);
  assert.equal(checkDeclaredContract(RESOURCES.EXTRACT, validExtractBody(), "GET").ok, true);
  assert.equal(checkDeclaredContract(RESOURCES.SELLER_INTEGRITY, SELLER_INTEGRITY_AUDIT_EXAMPLE, "GET").ok, true);
  const extract = evaluateResponseBytes({
    method: "GET",
    resource: RESOURCES.EXTRACT,
    responseBytes: Buffer.from(JSON.stringify(validExtractBody())),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(extract.deliveryClass, DELIVERY.FULL_BOUNDED_CAPTURE);
  assert.equal(extract.usefulness, "unknown");
});

test("ok snapshot, no position, HTTP 200 ok:false, and truncation stay separate", async () => {
  const ok = await snapshot();
  const okEval = evaluate(ok);
  assert.equal(okEval.deliveryClass, DELIVERY.COMPLETE_USEFUL);
  assert.equal(okEval.validatorVerdict, VERDICT.PASS);
  assert.equal(okEval.usefulness, "unknown");

  const empty = await morphoPosition(FIXTURE_ADDRESS, {
    rpcCheck: false,
    fetchImpl: fixtureFetch(graphqlPage(null, { count: 0, countTotal: 0, limit: 100, skip: 0 })),
  });
  assert.equal(evaluate(empty).deliveryClass, DELIVERY.USEFUL_NEGATIVE);
  assert.equal(evaluate(empty).validatorVerdict, VERDICT.PASS);

  const failed = {
    ok: false,
    address: FIXTURE_ADDRESS,
    error: "Morpho API HTTP 502",
    boundary: "No transaction was prepared or executed.",
  };
  const failedEval = evaluate(failed);
  assert.equal(failedEval.deliveryClass, DELIVERY.UPSTREAM_FAILED);
  assert.equal(failedEval.validatorVerdict, VERDICT.INVALID);
  assert.notEqual(failedEval.deliveryClass, DELIVERY.COMPLETE_USEFUL);
  assert.notEqual(failedEval.deliveryClass, DELIVERY.MALFORMED_BODY);
  assert.equal(failedEval.usefulness, "unknown");

  const truncated = await morphoPosition(FIXTURE_ADDRESS, {
    rpcCheck: false,
    fetchImpl: fixtureFetch(graphqlPage(FREE_INDEX_ITEM, { count: 1, countTotal: 101, limit: 100, skip: 0 })),
  });
  assert.equal(truncated.truncated, true);
  const truncatedEval = evaluate(truncated);
  assert.equal(truncatedEval.deliveryClass, DELIVERY.TRUNCATED_PARTIAL);
  assert.notEqual(truncatedEval.deliveryClass, DELIVERY.COMPLETE_USEFUL);
});

test("malformed, missing, and contradictory counts are not complete snapshots", async () => {
  const ok = await snapshot();
  assert.equal(evaluate({ ok: true }).deliveryClass, DELIVERY.MALFORMED_BODY);
  const missing = evaluateResponseBytes({
    method: "GET",
    resource: RESOURCES.MORPHO_POSITION,
    responseBytes: Buffer.alloc(0),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(missing.deliveryClass, DELIVERY.MISSING_BODY);
  assert.equal(missing.validatorVerdict, VERDICT.UNKNOWN);
  const contradictory = evaluate({ ...ok, positionCount: ok.positionCount + 1 });
  assert.equal(contradictory.deliveryClass, DELIVERY.UNKNOWN);
  assert.equal(contradictory.validatorVerdict, VERDICT.UNKNOWN);
  const httpFailure = evaluate(ok, { merchantHttpStatus: 500 });
  assert.equal(httpFailure.deliveryClass, DELIVERY.MERCHANT_HTTP_FAILURE);
  assert.notEqual(httpFailure.deliveryClass, DELIVERY.COMPLETE_USEFUL);
  const html = evaluateResponseBytes({
    method: "GET",
    resource: RESOURCES.MORPHO_POSITION,
    responseBytes: Buffer.from("<html>"),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(html.deliveryClass, DELIVERY.MALFORMED_BODY);
});

test("validation attaches only to the same route, event, settlement, and request", async () => {
  const body = await snapshot();
  const dir = await mkdtemp(path.join(tmpdir(), "morpho-delivery-"));
  try {
    const matching = record(body);
    assert.equal(JSON.stringify(matching).includes(FIXTURE_ADDRESS.toLowerCase()), false);
    assert.equal(matching.usefulness, "unknown");
    const wrongRoute = recordFromObservedResponse({
      method: "GET",
      resource: RESOURCES.EXTRACT,
      responseBytes: Buffer.from(JSON.stringify(validExtractBody())),
      merchantHttpStatus: 200,
      settlementClass: SETTLEMENT_CLASS.SIMULATED,
      settlementReference: SETTLEMENT,
      requestDigest: REQUEST,
      paidEvidenceId: EVENT,
    });
    const historical = historicalV1Row({
      id: EVENT,
      method: "GET",
      route: RESOURCES.MORPHO_POSITION,
      responseDigest: matching.responseDigest,
      settlementReference: SETTLEMENT,
      requestDigest: REQUEST,
    });
    const other = historicalV1Row({
      id: OTHER_EVENT,
      method: "GET",
      route: RESOURCES.MORPHO_POSITION,
      responseDigest: matching.responseDigest,
      settlementReference: SETTLEMENT,
      requestDigest: OTHER_REQUEST,
    });
    const wrongRouteEvent = "66666666-6666-4666-8666-666666666666";
    const wrongRouteHistorical = historicalV1Row({
      id: wrongRouteEvent,
      method: "GET",
      route: RESOURCES.EXTRACT,
      responseDigest: matching.responseDigest,
      settlementReference: SETTLEMENT,
      requestDigest: REQUEST,
    });
    await writeFile(
      path.join(dir, "commerce-paid-success-evidence.ndjson"),
      `${JSON.stringify(historical)}\n${JSON.stringify(other)}\n${JSON.stringify(wrongRouteHistorical)}\n`,
      "utf8",
    );
    const store = openStore(dir);
    await store.appendValidation(matching);
    await store.appendValidation(record(body, { settlementReference: OTHER_SETTLEMENT }));
    await store.appendValidation(record(body, { requestDigest: OTHER_REQUEST }));
    await store.appendValidation(record(body, { paidEvidenceId: wrongRouteEvent }));
    await store.appendValidation(wrongRoute);
    const joined = await store.join();
    const byId = Object.fromEntries(joined.map((row) => [row.historical.id, row]));
    assert.equal(byId[EVENT].validations.length, 1);
    assert.equal(byId[EVENT].validations[0].deliveryClass, DELIVERY.COMPLETE_USEFUL);
    assert.equal(byId[OTHER_EVENT].validations.length, 0);
    assert.equal(byId[wrongRouteEvent].validations.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("uncaptured output is refused for every event id", async () => {
  const body = await snapshot();
  const bytes = Buffer.from(JSON.stringify(body));
  const honestDigest = digestResponseBytes(bytes);
  for (const paidEvidenceId of [UNRETAINED_A, UNRETAINED_B]) {
    assert.throws(
      () => record(body, {
        paidEvidenceId,
        responseDigest: "f".repeat(64),
        responseByteLength: bytes.length,
      }),
      /retained output is absent/,
    );
    assert.throws(
      () => record(body, {
        paidEvidenceId,
        observation: {
          streamHashed: true,
          captured: true,
          outputRetained: true,
          source: "http_response_capture",
          responseDigest: honestDigest,
          responseByteLength: bytes.length,
        },
      }),
      /retained output is absent/,
    );
    const sealed = record(body, { paidEvidenceId });
    const revived = JSON.parse(JSON.stringify(sealed));
    assert.throws(
      () => recordFromObservedResponse({
        method: "GET",
        resource: RESOURCES.MORPHO_POSITION,
        responseBytes: bytes,
        responseDigest: honestDigest,
        merchantHttpStatus: 200,
        settlementClass: SETTLEMENT_CLASS.SIMULATED,
        paidEvidenceId,
        observation: revived,
      }),
      /retained output is absent/,
    );
    const declared = declareCallerUsefulness({
      validation: {
        paidEvidenceId,
        settlementReference: SETTLEMENT,
        requestDigest: REQUEST,
        usefulness: "unknown",
      },
      declaration: {
        source: "caller",
        disposition: "useful",
        paidEvidenceId,
        settlementReference: SETTLEMENT,
        requestDigest: REQUEST,
      },
    });
    assert.equal(declared.present, false);
    assert.equal(declared.reason, "historical_intent_not_retained");
    assert.equal(declared.usefulness, "unknown");
  }
  for (const relative of ["contract.mjs", "store.mjs", "caller-declaration.mjs", "index.mjs"]) {
    const source = readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
    assert.equal(source.includes("e87c5642-c177-49bb-809a-05912264d7e3"), false);
  }
});

test("bounded morpho capture is not a complete snapshot and drops the address", async () => {
  const prefix = Buffer.from(JSON.stringify(await snapshot()));
  const full = Buffer.concat([prefix, Buffer.alloc(MAX_RESPONSE_BYTES + 1 - prefix.length, 0x20)]);
  const digest = digestResponseBytes(full);
  const observation = sealStreamedHttpCapture({
    digest,
    byteLength: full.length,
    bytes: prefix,
    method: "GET",
    resource: RESOURCES.MORPHO_POSITION,
  });
  const stored = recordFromObservedResponse({
    method: "GET",
    resource: RESOURCES.MORPHO_POSITION,
    responseBytes: prefix,
    responseDigest: digest,
    responseByteLength: full.length,
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
    settlementReference: SETTLEMENT,
    paidEvidenceId: EVENT,
    observation,
  });
  assert.equal(stored.retainedByteLength, prefix.length);
  assert.equal(stored.responseByteLength, MAX_RESPONSE_BYTES + 1);
  assert.equal(stored.responseDigest, digest);
  assert.equal(stored.deliveryClass, DELIVERY.TRUNCATED_PARTIAL);
  assert.equal(JSON.stringify(stored).includes(FIXTURE_ADDRESS.toLowerCase()), false);

  const res = {
    statusCode: 200,
    write(_chunk, encoding, callback) {
      const done = typeof encoding === "function" ? encoding : callback;
      done?.();
      return true;
    },
    end(_chunk, encoding, callback) {
      const done = typeof encoding === "function" ? encoding : callback;
      done?.();
    },
  };
  const finish = capturePaidEvidenceResponseDigest(res, "GET", RESOURCES.MORPHO_POSITION);
  const chunk = Buffer.from(`{"address":"${FIXTURE_ADDRESS}"}`);
  res.write(chunk);
  chunk.fill(0);
  res.end();
  const captured = finish();
  assert.equal(captured.bytes.toString("utf8"), `{"address":"${FIXTURE_ADDRESS}"}`);
  assert.equal(captured.retainedByteLength, captured.byteLength);
});

test("MCP text and isError results use the same classes as HTTP", async () => {
  const body = await snapshot();
  const success = asToolResult(body);
  assert.equal("structuredContent" in success, false);
  const mcpOk = evaluateMcpToolDelivery({
    toolName: "morpho_position",
    toolResult: success,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(mcpOk.deliveryClass, DELIVERY.COMPLETE_USEFUL);
  assert.equal(mcpOk.usefulness, "unknown");
  assert.equal(mcpOk.transport, "mcp");
  assert.equal(mcpOk.validatorSource, MCP_TOOL_VALIDATOR_SOURCE);
  assert.notEqual(mcpOk.validatorSource, "caller_observed_http_bytes");

  const failed = {
    ...asToolResult({ ok: false, error: "Morpho API HTTP 502", charged: false }),
    isError: true,
  };
  const mcpFailed = evaluateMcpToolDelivery({
    toolName: "morpho_position",
    toolResult: failed,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(mcpFailed.deliveryClass, DELIVERY.UPSTREAM_FAILED);
  assert.equal(mcpFailed.validatorVerdict, VERDICT.INVALID);

  const missing = evaluateMcpToolDelivery({
    toolName: "morpho_position",
    toolResult: { content: [] },
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(missing.deliveryClass, DELIVERY.MISSING_BODY);

  const sneaky = {
    ...asToolResult(body),
    isError: true,
  };
  const sneakyEval = evaluateMcpToolDelivery({
    toolName: "morpho_position",
    toolResult: sneaky,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(sneakyEval.deliveryClass, DELIVERY.UPSTREAM_FAILED);
  assert.notEqual(sneakyEval.deliveryClass, DELIVERY.COMPLETE_USEFUL);
});

test("caller usefulness is a bound declaration and is not inferred from delivery", async () => {
  const body = await snapshot();
  const validation = record(body);
  assert.equal(validation.deliveryClass, DELIVERY.COMPLETE_USEFUL);
  const absent = declareCallerUsefulness({ validation, declaration: null });
  assert.equal(absent.present, false);
  assert.equal(absent.reason, "declaration_absent");
  assert.equal(absent.usefulness, "unknown");
  const inferred = declareCallerUsefulness({
    validation,
    declaration: { source: "delivery_class", inferred: true, disposition: "useful" },
  });
  assert.equal(inferred.reason, "model_inference_rejected");
  const declared = declareCallerUsefulness({
    validation,
    declaration: {
      source: "caller",
      disposition: "not_useful",
      paidEvidenceId: validation.paidEvidenceId,
      settlementReference: validation.settlementReference,
      requestDigest: validation.requestDigest,
    },
  });
  assert.equal(declared.present, true);
  assert.equal(declared.disposition, "not_useful");
  assert.equal(declared.usefulness, "unknown");
  assert.equal(validation.usefulness, "unknown");
});

test("observed mcp delivery is not an HTTP row and a spread copy cannot append", async () => {
  const body = await snapshot();
  const offer = "ab".repeat(32);
  const seal = sealObservedMcpToolResult({
    tool: "morpho_position",
    productSku: "samedaydesk-morpho-position",
    resource: MCP_MORPHO_RESOURCE,
    issuedOfferDigest: offer,
    callId: 41,
    result: asToolResult(body),
    settlementReference: SETTLEMENT,
  });
  const row = recordFromObservedMcpDelivery({
    observation: seal,
    settlementState: "succeeded",
    paidEvidenceId: EVENT,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
  assert.equal(row.transport, "mcp");
  assert.equal(row.resource, MCP_MORPHO_RESOURCE);
  assert.equal(row.validatorSource, MCP_TOOL_VALIDATOR_SOURCE);
  assert.equal(row.deliveryClass, DELIVERY.COMPLETE_USEFUL);
  assert.equal(row.usefulness, "unknown");
  assert.equal(row.callId, "41");
  assert.equal(row.settlementReference, SETTLEMENT);
  assert.equal(Object.hasOwn(row, "method"), false);
  assert.equal(JSON.stringify(row).includes(FIXTURE_ADDRESS.toLowerCase()), false);
  assert.equal(sealObservedMcpToolResult({
    tool: "enrich",
    productSku: "samedaydesk-enrich",
    resource: "mcp://tool/enrich",
    issuedOfferDigest: offer,
    callId: 1,
    result: asToolResult(body),
  }), null);
  const dir = await mkdtemp(path.join(tmpdir(), "mcp-delivery-row-"));
  try {
    const store = openStore(dir);
    await store.appendMcpDelivery(row);
    const read = await store.readMcpDeliveries();
    assert.equal(read.length, 1);
    const claim = {
      tool: "morpho_position",
      paidEvidenceId: EVENT,
      callDigest: row.callDigest,
      responseDigest: row.responseDigest,
      resource: MCP_MORPHO_RESOURCE,
      settlementReference: SETTLEMENT,
      issuedOfferDigest: offer,
    };
    assert.equal(mcpDeliveryAttaches(read[0], claim), true);
    assert.equal(mcpDeliveryAttaches(read[0], { ...claim, paidEvidenceId: OTHER_EVENT }), false);
    assert.equal(mcpDeliveryAttaches(read[0], { ...claim, tool: "enrich" }), false);
    assert.equal(mcpDeliveryAttaches(read[0], { ...claim, callDigest: "c".repeat(64) }), false);
    assert.equal(mcpDeliveryAttaches(read[0], { ...claim, responseDigest: "d".repeat(64) }), false);
    assert.equal(mcpDeliveryAttaches(read[0], { ...claim, resource: RESOURCES.MORPHO_POSITION }), false);
    assert.equal(mcpDeliveryAttaches(read[0], { ...claim, settlementReference: OTHER_SETTLEMENT }), false);
    assert.equal(mcpDeliveryAttaches(read[0], { ...claim, issuedOfferDigest: "e".repeat(64) }), false);
    await assert.rejects(
      store.appendMcpDelivery({ ...row, recordId: `mtd_${"a".repeat(32)}` }),
      /retained output is absent/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("payment price and the HTTP 200 catch stay on the existing handlers", () => {
  const server = readFileSync(new URL("../../server.js", import.meta.url), "utf8");
  const mcp = readFileSync(new URL("../../mcp-server.mjs", import.meta.url), "utf8");
  assert.match(server, /const MORPHO_POSITION_PRICE = process\.env\.MORPHO_POSITION_PRICE \|\| "\$0\.02"/);
  const start = server.indexOf('app.get("/defi/morpho-position", async');
  const slice = server.slice(start, start + 700);
  assert.match(slice, /res\.status\(200\)\.json/);
  assert.match(slice, /ok: false/);
  assert.match(mcp, /ok: false, error: String\(e\?\.message \|\| e\), charged: false \}\), isError: true/);
});

test("fixture measurement keeps the classes and proposes no new paid offer", async () => {
  const measured = await runMeasurement();
  assert.equal(measured.incrementalUtility, false);
  assert.equal(measured.proposeNewPaidOffer, false);
  assert.equal(measured.fidelity.healthFactor, "exact");
  assert.equal(measured.fidelity.shockTable, "exact_local_arithmetic");
  assert.equal(measured.classes.http200OkFalse, DELIVERY.UPSTREAM_FAILED);
  assert.equal(measured.historical.backfilled, false);
});
