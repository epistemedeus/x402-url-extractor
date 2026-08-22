import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  buildRegisteredCatalog,
  CLOSED_MCP_PRODUCTS,
  createMcpTypedTelemetryAttempt,
  digestIssuedOffer,
  digestMcpIssuedOfferV1,
  evaluateMcpTypedTelemetryOutcome,
  isMcpTypedTelemetryDecision,
  MCP_TYPED_TELEMETRY_DECISION_SCHEMA,
  productSkuForTool,
  resourceForTool,
} from "./mcp-typed-telemetry-producer.mjs";

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "test-fixtures/mcp-typed-telemetry-producer-v1.json",
);

const OUTPUT_KEYS = [
  "action",
  "applicationOutcome",
  "binding",
  "handlerInvoked",
  "paymentCredentialParsed",
  "paymentPresent",
  "reason",
  "result",
  "schemaVersion",
  "settlementState",
].sort();

function clone(value) {
  return structuredClone(value);
}

function applyMutations(base, mutations) {
  const input = clone(base);
  for (const mutation of mutations) {
    const pieces = mutation.path.split(".");
    let cursor = input;
    for (const piece of pieces.slice(0, -1)) cursor = cursor[piece];
    cursor[pieces.at(-1)] = clone(mutation.value);
  }
  return input;
}

function priorRawResponseInference({ httpStatus, body, notification }) {
  const text = typeof body === "string" ? body : JSON.stringify(body || {});
  const paymentPresent = /x402\/payment|PAYMENT-SIGNATURE|Payment Required/i.test(text);
  if (notification) {
    return paymentPresent && httpStatus >= 200 && httpStatus < 300 ? "paid_success" : "protocol_discovery";
  }
  if (/isError"\s*:\s*true/.test(text) && httpStatus >= 200 && httpStatus < 300 && paymentPresent) {
    return "paid_success";
  }
  if (httpStatus >= 200 && httpStatus < 300 && paymentPresent) return "paid_success";
  return "challenge";
}

function successInput(overrides = {}) {
  const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  return {
    schemaVersion: "samedaydesk.mcp-typed-telemetry-input.v1",
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/enrich",
      issuedOfferDigest: digest,
    },
    request: { jsonrpc: "2.0", hasId: true, id: 7, method: "tools/call" },
    response: { hasId: true, id: 7, kind: "tool_result" },
    credential: { state: "verified", offerDigest: digest },
    execution: { state: "handler_success", handlerInvoked: true, resultIsError: false },
    settlement: { state: "succeeded", offerDigest: digest },
    ...overrides,
  };
}

test("evaluateMcpTypedTelemetryOutcome matches the reviewer fixture matrix", async () => {
  const fixtures = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  assert.equal(fixtures.cases.length, 20);
  for (const testCase of fixtures.cases) {
    const input = applyMutations(fixtures.baseInput, testCase.mutations);
    const output = evaluateMcpTypedTelemetryOutcome(input);
    assert.equal(output.schemaVersion, MCP_TYPED_TELEMETRY_DECISION_SCHEMA);
    assert.deepEqual(Object.keys(output).sort(), OUTPUT_KEYS);
    assert.equal(output.action, testCase.expected.action);
    assert.equal(output.result, testCase.expected.result);
    assert.equal(output.reason, testCase.expected.reason);
    assert.equal(output.paymentPresent, testCase.expected.paymentPresent);
    assert.equal(output.paymentCredentialParsed, testCase.expected.paymentCredentialParsed);
    assert.equal(output.handlerInvoked, testCase.expected.handlerInvoked);
    assert.equal(output.applicationOutcome, testCase.expected.applicationOutcome);
    assert.equal(output.settlementState, testCase.expected.settlementState);
    assert.equal(isMcpTypedTelemetryDecision(output), true, testCase.id);
  }
});

test("pure evaluator rejects unknown fields, mutation, and unbounded side effects", () => {
  const frozen = Object.freeze(successInput({ rawResponse: "must-not-pass" }));
  const before = JSON.stringify(frozen);
  const first = evaluateMcpTypedTelemetryOutcome(frozen);
  const second = evaluateMcpTypedTelemetryOutcome(frozen);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(frozen), before);
  assert.equal(first.result, "invalid");
  assert.equal(first.binding.tool, null);
  assert.equal(JSON.stringify(first).includes("must-not-pass"), false);
});

test("M08 M09 type-preserving request/response ID binding drops mismatches", () => {
  const stringId = evaluateMcpTypedTelemetryOutcome(successInput({
    request: { jsonrpc: "2.0", hasId: true, id: "7", method: "tools/call" },
    response: { hasId: true, id: "7", kind: "tool_result" },
  }));
  assert.equal(stringId.result, "paid_success");

  const typeMismatch = evaluateMcpTypedTelemetryOutcome(successInput({
    request: { jsonrpc: "2.0", hasId: true, id: 7, method: "tools/call" },
    response: { hasId: true, id: "7", kind: "tool_result" },
  }));
  assert.equal(typeMismatch.result, "invalid");
  assert.equal(typeMismatch.reason, "request_response_id_mismatch");

  const absent = evaluateMcpTypedTelemetryOutcome(successInput({
    response: { hasId: false, id: null, kind: "tool_result" },
  }));
  assert.equal(absent.reason, "request_response_id_mismatch");

  const nullId = evaluateMcpTypedTelemetryOutcome(successInput({
    request: { jsonrpc: "2.0", hasId: true, id: null, method: "tools/call" },
    response: { hasId: true, id: null, kind: "tool_result" },
  }));
  assert.equal(nullId.result, "invalid");

  const unsafe = evaluateMcpTypedTelemetryOutcome(successInput({
    request: { jsonrpc: "2.0", hasId: true, id: 9007199254740992, method: "tools/call" },
    response: { hasId: true, id: 9007199254740992, kind: "tool_result" },
  }));
  assert.equal(unsafe.reason, "invalid_typed_outcome");
});

test("M10 catalog and issued-offer dimensions fail closed independently", () => {
  const tool = evaluateMcpTypedTelemetryOutcome(successInput({
    binding: {
      tool: "read",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/enrich",
      issuedOfferDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  }));
  assert.equal(tool.reason, "invalid_catalog_binding");

  const sku = evaluateMcpTypedTelemetryOutcome(successInput({
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-read",
      resource: "mcp://tool/enrich",
      issuedOfferDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  }));
  assert.equal(sku.reason, "invalid_catalog_binding");

  const resource = evaluateMcpTypedTelemetryOutcome(successInput({
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/read",
      issuedOfferDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  }));
  assert.equal(resource.reason, "invalid_catalog_binding");

  const credentialOffer = evaluateMcpTypedTelemetryOutcome(successInput({
    credential: {
      state: "verified",
      offerDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  }));
  assert.equal(credentialOffer.reason, "issued_offer_binding_mismatch");

  const settlementOffer = evaluateMcpTypedTelemetryOutcome(successInput({
    settlement: {
      state: "succeeded",
      offerDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  }));
  assert.equal(settlementOffer.reason, "issued_offer_binding_mismatch");
});

test("prior raw-response inference is not the typed paid-success predicate", () => {
  const handlerError = evaluateMcpTypedTelemetryOutcome(successInput({
    execution: { state: "handler_error", handlerInvoked: true, resultIsError: true },
    settlement: { state: "not_attempted", offerDigest: null },
  }));
  assert.equal(handlerError.result, "application_failure");
  assert.notEqual(handlerError.result, "paid_success");
  assert.equal(priorRawResponseInference({
    httpStatus: 200,
    body: { jsonrpc: "2.0", id: 7, result: { isError: true, content: [{ type: "text", text: "x402/payment" }] } },
  }), "paid_success");

  const notification = evaluateMcpTypedTelemetryOutcome(successInput({
    request: { jsonrpc: "2.0", hasId: false, id: null, method: "tools/call" },
    response: { hasId: false, id: null, kind: "no_response" },
    credential: { state: "absent", offerDigest: null },
    execution: { state: "not_invoked", handlerInvoked: false, resultIsError: null },
    settlement: { state: "not_attempted", offerDigest: null },
  }));
  assert.equal(notification.result, "protocol_discovery");
  assert.equal(priorRawResponseInference({
    httpStatus: 202,
    notification: true,
    body: { jsonrpc: "2.0", method: "tools/call", params: { _meta: { "x402/payment": {} } } },
  }), "paid_success");
});

test("issued-offer digest is domain-separated, canonical, and does not store accepts", () => {
  const binding = {
    tool: "wallet_enrich",
    productSku: productSkuForTool("wallet_enrich"),
    resource: resourceForTool("wallet_enrich"),
  };
  const offer = {
    schemaVersion: "samedaydesk.mcp-issued-offer.v1",
    binding,
    accepts: [
      {
        protocol: "exact",
        network: "eip155:8453",
        asset: "0x0000000000000000000000000000000000000001",
        atomicAmount: "1000",
        atomicUnits: "6",
        recipient: "0x0000000000000000000000000000000000000002",
        resource: binding.resource,
      },
      {
        protocol: "exact",
        network: "eip155:84532",
        asset: "0x0000000000000000000000000000000000000003",
        atomicAmount: "250",
        atomicUnits: "6",
        recipient: "0x0000000000000000000000000000000000000004",
        resource: binding.resource,
      },
    ],
  };
  const reversed = {
    ...offer,
    accepts: [offer.accepts[1], offer.accepts[0]],
  };
  const first = digestMcpIssuedOfferV1(offer);
  const second = digestMcpIssuedOfferV1(reversed);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  const duplicate = digestMcpIssuedOfferV1({
    ...offer,
    accepts: [offer.accepts[0], offer.accepts[0]],
  });
  assert.equal(duplicate, null);
  const mapped = digestIssuedOffer([
    {
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x0000000000000000000000000000000000000001",
      amount: "1000",
      payTo: "0x0000000000000000000000000000000000000002",
      extra: { decimals: 6 },
    },
  ], binding);
  assert.match(mapped, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify({ digest: first }).includes("payTo"), false);
  assert.equal(digestMcpIssuedOfferV1({ ...offer, debug: "must-not-pass" }), null);
  assert.equal(digestMcpIssuedOfferV1({ ...offer, accepts: [] }), null);
});

test("registered catalog fails closed on duplicates and inconsistent names", () => {
  const catalog = buildRegisteredCatalog([
    { name: "enrich" },
    { name: "wallet_enrich" },
  ]);
  assert.equal(catalog.get("enrich").productSku, "samedaydesk-enrich");
  assert.equal(catalog.get("wallet_enrich").resource, "mcp://tool/wallet_enrich");
  assert.equal(catalog.get("enrich").httpRoute, CLOSED_MCP_PRODUCTS.enrich.httpRoute);
  assert.throws(() => buildRegisteredCatalog([{ name: "enrich" }, { name: "enrich" }]));
  assert.throws(() => buildRegisteredCatalog([{ name: "Not Closed" }]));
  assert.throws(() => buildRegisteredCatalog([{ name: "unregistered_probe" }]));
});

test("M13 request-local attempt finalizes at most once and rejects impossible transitions", async () => {
  const decisions = [];
  const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const attempt = createMcpTypedTelemetryAttempt({
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/enrich",
      issuedOfferDigest: digest,
    },
    request: { jsonrpc: "2.0", hasId: true, id: 7, method: "tools/call" },
    onAppend: (decision) => decisions.push(decision),
  });
  attempt.credentialVerified({ offerDigest: digest });
  attempt.handlerStarted();
  attempt.handlerFinished({ isError: false });
  attempt.settlementFinished({ state: "succeeded", offerDigest: digest });
  const first = attempt.finalize({ responseId: 7, kind: "tool_result" });
  const second = attempt.finalize({ responseId: 7, kind: "tool_result" });
  await Promise.resolve();
  assert.equal(first.result, "paid_success");
  assert.equal(second.result, "paid_success");
  assert.equal(decisions.length, 1);

  const broken = createMcpTypedTelemetryAttempt({
    binding: first.binding,
    request: { jsonrpc: "2.0", hasId: true, id: 8, method: "tools/call" },
    onAppend: (decision) => decisions.push(decision),
  });
  broken.handlerStarted();
  broken.credentialVerified({ offerDigest: digest });
  const dropped = broken.finalize({ responseId: 8, kind: "tool_result" });
  await Promise.resolve();
  assert.equal(dropped.result, "invalid");
  assert.equal(dropped.action, "drop");
  assert.equal(decisions.length, 2);
});

test("M08 attempt-level numeric/string response mismatch never paid_success", () => {
  const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const attempt = createMcpTypedTelemetryAttempt({
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/enrich",
      issuedOfferDigest: digest,
    },
    request: { jsonrpc: "2.0", hasId: true, id: 7, method: "tools/call" },
  });
  attempt.credentialVerified({ offerDigest: digest });
  attempt.handlerStarted();
  attempt.handlerFinished({ isError: false });
  attempt.settlementFinished({ state: "succeeded", offerDigest: digest });
  const decision = attempt.finalize({ responseId: "7", kind: "tool_result" });
  assert.equal(decision.result, "invalid");
  assert.notEqual(decision.result, "paid_success");
});

test("M15 append throw and rejected promise cannot change the decision object", async () => {
  const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const throwing = createMcpTypedTelemetryAttempt({
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/enrich",
      issuedOfferDigest: digest,
    },
    request: { jsonrpc: "2.0", hasId: true, id: 1, method: "tools/call" },
    onAppend() { throw new Error("append-throw-secret"); },
  });
  throwing.credentialRejected();
  const challenge = throwing.finalize({ responseId: 1, kind: "payment_required" });
  await Promise.resolve();
  assert.equal(challenge.result, "challenge");

  let released = false;
  const blocked = createMcpTypedTelemetryAttempt({
    binding: challenge.binding,
    request: { jsonrpc: "2.0", hasId: true, id: 2, method: "tools/call" },
    onAppend() {
      return new Promise(() => {
        released = true;
      });
    },
  });
  blocked.credentialRejected();
  const second = blocked.finalize({ responseId: 2, kind: "payment_required" });
  await Promise.resolve();
  assert.equal(second.result, "challenge");
  assert.equal(released, true);
});

test("typed decisions never retain raw IDs, credentials, or error text", () => {
  const output = evaluateMcpTypedTelemetryOutcome(successInput());
  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes("\"id\":"), false);
  assert.equal(serialized.includes("requestId"), false);
  assert.equal(serialized.includes("authorization"), false);
  assert.equal(output.binding.issuedOfferDigest.length, 64);
  assert.equal(createHash("sha256").update(serialized).digest("hex").length, 64);
});

test("consistent but unregistered tool/SKU/resource triple is rejected", () => {
  const output = evaluateMcpTypedTelemetryOutcome(successInput({
    binding: {
      tool: "unregistered_probe",
      productSku: "samedaydesk-unregistered-probe",
      resource: "mcp://tool/unregistered_probe",
      issuedOfferDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  }));
  assert.equal(output.action, "drop");
  assert.equal(output.result, "invalid");
  assert.equal(output.reason, "invalid_catalog_binding");
  assert.equal(output.binding.tool, null);
});

test("UTF-8 string ID bounds use bytes not JavaScript code units", () => {
  const atLimit = "😀".repeat(32);
  assert.equal(Buffer.byteLength(atLimit, "utf8"), 128);
  assert.ok(atLimit.length < 128);
  const ok = evaluateMcpTypedTelemetryOutcome(successInput({
    request: { jsonrpc: "2.0", hasId: true, id: atLimit, method: "tools/call" },
    response: { hasId: true, id: atLimit, kind: "tool_result" },
  }));
  assert.equal(ok.result, "paid_success");

  const oversized = "😀".repeat(33);
  assert.equal(Buffer.byteLength(oversized, "utf8"), 132);
  assert.ok(oversized.length <= 128);
  const dropped = evaluateMcpTypedTelemetryOutcome(successInput({
    request: { jsonrpc: "2.0", hasId: true, id: oversized, method: "tools/call" },
    response: { hasId: true, id: oversized, kind: "tool_result" },
  }));
  assert.equal(dropped.result, "invalid");
  assert.equal(dropped.reason, "invalid_typed_outcome");
});

test("absent and rejected payment-required challenges are both valid typed decisions", () => {
  const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const challengeInput = {
    schemaVersion: "samedaydesk.mcp-typed-telemetry-input.v1",
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/enrich",
      issuedOfferDigest: digest,
    },
    request: { jsonrpc: "2.0", hasId: true, id: 7, method: "tools/call" },
    response: { hasId: true, id: 7, kind: "payment_required" },
    credential: { state: "absent", offerDigest: null },
    execution: { state: "not_invoked", handlerInvoked: false, resultIsError: null },
    settlement: { state: "not_attempted", offerDigest: null },
  };
  const absent = evaluateMcpTypedTelemetryOutcome(challengeInput);
  assert.equal(absent.result, "challenge");
  assert.equal(absent.paymentPresent, false);
  assert.equal(absent.paymentCredentialParsed, false);
  assert.equal(isMcpTypedTelemetryDecision(absent), true);

  const rejected = evaluateMcpTypedTelemetryOutcome({
    ...challengeInput,
    credential: { state: "rejected", offerDigest: null },
  });
  assert.equal(rejected.result, "challenge");
  assert.equal(rejected.paymentPresent, true);
  assert.equal(rejected.paymentCredentialParsed, false);
  assert.equal(isMcpTypedTelemetryDecision(rejected), true);

  assert.equal(isMcpTypedTelemetryDecision({
    ...absent,
    paymentPresent: true,
    paymentCredentialParsed: true,
  }), false);
  assert.equal(isMcpTypedTelemetryDecision({
    ...absent,
    paymentPresent: false,
    paymentCredentialParsed: true,
  }), false);
});

test("strict decision validator is an allowlist not a substring denylist", () => {
  assert.equal(isMcpTypedTelemetryDecision(evaluateMcpTypedTelemetryOutcome(successInput())), true);
  const forged = {
    schemaVersion: "samedaydesk.mcp-typed-telemetry-decision.v1",
    action: "emit",
    result: "forged_paid_claim",
    paymentPresent: true,
    paymentCredentialParsed: true,
    handlerInvoked: true,
    applicationOutcome: "made_up",
    settlementState: "succeeded",
    reason: "api_key_live_example",
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/enrich",
      issuedOfferDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  };
  assert.equal(isMcpTypedTelemetryDecision(forged), false);
  assert.equal(isMcpTypedTelemetryDecision({
    ...evaluateMcpTypedTelemetryOutcome(successInput()),
    result: "paid_success",
    reason: "typed_application_failure",
  }), false);
  assert.equal(isMcpTypedTelemetryDecision({
    ...evaluateMcpTypedTelemetryOutcome(successInput()),
    extra: "nope",
  }), false);
});

test("digestMcpIssuedOfferV1 rejects malformed noncanonical and unknown-key offers", () => {
  const offer = {
    schemaVersion: "samedaydesk.mcp-issued-offer.v1",
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/enrich",
    },
    accepts: [
      {
        protocol: "protocol_a",
        network: "network:a",
        asset: "asset_a",
        atomicAmount: "10000",
        atomicUnits: "6",
        recipient: "synthetic-recipient-a",
        resource: "mcp://tool/enrich",
      },
    ],
  };
  assert.match(digestMcpIssuedOfferV1(offer), /^[0-9a-f]{64}$/);
  assert.equal(digestMcpIssuedOfferV1({
    ...offer,
    accepts: [{ ...offer.accepts[0], atomicAmount: "010000" }],
  }), null);
  assert.equal(digestMcpIssuedOfferV1({ ...offer, accepts: [offer.accepts[0], { extra: true }] }), null);
  assert.equal(digestMcpIssuedOfferV1(null), null);
});

test("enqueueAppend is not synchronous on the attempt stack", async () => {
  const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  let called = false;
  const attempt = createMcpTypedTelemetryAttempt({
    binding: {
      tool: "enrich",
      productSku: "samedaydesk-enrich",
      resource: "mcp://tool/enrich",
      issuedOfferDigest: digest,
    },
    request: { jsonrpc: "2.0", hasId: true, id: 9, method: "tools/call" },
    onAppend() { called = true; },
  });
  attempt.credentialRejected();
  attempt.finalize({ responseId: 9, kind: "payment_required" });
  assert.equal(called, false);
  await Promise.resolve();
  assert.equal(called, true);
});
