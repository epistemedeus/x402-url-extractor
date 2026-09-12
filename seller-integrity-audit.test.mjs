import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  SellerIntegrityAuditError,
  classifySellerIntegrityAcquisition,
  normalizeSellerIntegrityAuditInput,
  sellerIntegrityAudit,
  sellerIntegrityAuditMcpOutputSchema,
  sellerIntegrityAuditOutputSchema,
} from "./seller-integrity-audit.mjs";

const REPORT = {
  schemaVersion: "agent-payment-integrity.audit.v4",
  checkedAt: "2026-08-12T07:50:00.000Z",
  versions: { x402: "1.0.0", mpp: "1.0.0" },
  ok: true,
  machineBuyable: true,
  routes: [{
    status: 402,
    method: "GET",
    runtimeChallengeVerified: true,
    probe: { attempted: true, reason: null },
    protocols: ["mpp", "x402"],
    valid: true,
    findings: [],
    economics: { x402: { amountAtomic: "5000" }, mpp: { amountAtomic: "5000" } },
    discovery: { bazaar: { present: true, valid: true } },
    responseContract: { decision: "admissible", requiredPaths: ["ok", "title"] },
    repairPlan: {
      mode: "advisory_openapi_repair",
      requiredPaths: [],
      guaranteedPaths: [],
      actions: [],
      complete: true,
      boundary: { schemaMutationApplied: false, propertyTypesInferred: false, sellerRuntimeVerified: false, statement: "Seller must verify runtime semantics." },
    },
  }],
};

test("normalizes one exact public seller route", () => {
  assert.deepEqual(normalizeSellerIntegrityAuditInput({
    origin: "https://seller.example",
    route: "/paid/read",
    requireBazaar: "true",
  }), { origin: "https://seller.example", route: "/paid/read", method: "GET", requiredPaths: [], requireBazaar: true, referral: null });
  assert.deepEqual(normalizeSellerIntegrityAuditInput({
    origin: "https://seller.example",
    route: "/simulate",
    method: "post",
    requiredPaths: "data.attributes,data.type,data.attributes",
    referral: `r1_${"a".repeat(64)}`,
  }), { origin: "https://seller.example", route: "/simulate", method: "POST", requiredPaths: ["data.attributes", "data.type"], requireBazaar: false, referral: `r1_${"a".repeat(64)}` });
  assert.throws(() => normalizeSellerIntegrityAuditInput({ origin: "http://seller.example", route: "/paid" }), SellerIntegrityAuditError);
  assert.throws(() => normalizeSellerIntegrityAuditInput({ origin: "https://seller.example", route: "//other.example/paid" }), /exact absolute path/);
  assert.throws(() => normalizeSellerIntegrityAuditInput({ origin: "https://seller.example", route: "/paid", token: "secret" }), /unsupported input field/);
  assert.throws(() => normalizeSellerIntegrityAuditInput({ origin: "https://seller.example", route: "/paid", method: "PUT" }), /GET or POST/);
  assert.throws(() => normalizeSellerIntegrityAuditInput({ origin: "https://seller.example", route: "/paid", requiredPaths: "data..secret" }), /safe dotted/);
  assert.throws(() => normalizeSellerIntegrityAuditInput({ origin: "https://seller.example", route: "/paid", referral: "r1_NOT_A_DIGEST" }), /lowercase SHA-256/);
});

test("returns bounded machine-buyable evidence without schemas or target payment", async () => {
  let received;
  const result = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, {
    auditImpl: async (input) => { received = input; return REPORT; },
  });
  assert.deepEqual(received, { origin: "https://seller.example", route: "/paid", method: "GET", requiredPaths: [], requireBazaar: false, maxRoutes: 1, publicDns: true });
  assert.equal(result.decision, "machine_buyable");
  assert.deepEqual(result.nextActions, []);
  assert.equal(result.boundary.targetPaymentSent, false);
  assert.equal(result.boundary.targetRequestSent, false);
  assert.equal(JSON.stringify(result).includes("schema"), true);
  assert.equal(JSON.stringify(result).includes("properties"), false);
  assert.deepEqual(sellerIntegrityAuditOutputSchema().required, ["ok", "product", "version", "checkedAt", "decision", "request", "report", "nextActions", "referralOffer", "boundary"]);
  assert.equal(result.version, "1.3.0");
  assert.equal(result.request.referral, null);
  assert.equal(result.referralOffer.status, "available");
  assert.equal(result.referralOffer.broadcastRequired, false);
  assert.equal(result.referralOffer.reward, "one_free_changed_state_recheck");
  assert.equal(result.referralOffer.attributionOnly, true);
  assert.equal(result.report.auditCompleted, true);
  assert.equal(result.report.failureCode, null);
  assert.equal(result.report.observedHttpStatus, null);
  assert.equal(result.report.evidenceClass, null);
  assert.equal(result.report.repairPlan.complete, true);
  assert.equal(sellerIntegrityAuditOutputSchema().properties.decision.enum.includes("unverified"), true);
  assert.equal(sellerIntegrityAuditMcpOutputSchema.safeParse(result).success, true);
});

test("attributes a bounded receipt-derived referral without passing it to the target audit", async () => {
  const referral = `r1_${"b".repeat(64)}`;
  let received;
  const result = await sellerIntegrityAudit({
    origin: "https://seller.example",
    route: "/paid",
    referral,
  }, {
    auditImpl: async (input) => { received = input; return REPORT; },
  });
  assert.equal("referral" in received, false);
  assert.equal(result.request.referral, referral);
  assert.equal(result.referralOffer.status, "declared");
  assert.equal(result.referralOffer.id, referral);
  assert.equal(result.referralOffer.attributionOnly, true);
  assert.equal(result.referralOffer.qualifiesOn, "two_distinct_seller_signed_settlement_receipts");
});

test("separates static POST contract readiness from live machine buyability", async () => {
  const staticPost = structuredClone(REPORT);
  staticPost.machineBuyable = false;
  staticPost.routes[0].method = "POST";
  staticPost.routes[0].status = null;
  staticPost.routes[0].runtimeChallengeVerified = false;
  staticPost.routes[0].probe = { attempted: false, reason: "post_requires_explicit_non_secret_fixture" };
  staticPost.routes[0].protocols = ["mpp", "x402"];
  staticPost.routes[0].economics = null;
  const result = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/simulate", method: "POST", requiredPaths: ["data.attributes"] }, { auditImpl: async () => staticPost });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "contract_ready");
  assert.equal(result.report.runtimeChallengeVerified, false);
  assert.equal(result.boundary.targetRequestSent, false);
  assert.equal(result.report.repairPlan.mode, "advisory_openapi_repair");
});

test("turns controlled findings into seller repair actions", async () => {
  const partial = structuredClone(REPORT);
  partial.ok = false;
  partial.routes[0].valid = false;
  partial.routes[0].findings = ["seller_response_contract_absent", "x402_full_request_binding_mismatch", "bazaar_extension_missing"];
  const result = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid", requireBazaar: true }, { auditImpl: async () => partial });
  assert.equal(result.decision, "repair_required");
  assert.equal(result.report.evidenceClass, "seller_contract");
  assert.equal(result.report.auditCompleted, true);
  assert.equal(result.nextActions.length, 3);
  assert.equal(result.referralOffer.status, "available");
  assert.equal(result.referralOffer.reward, "one_free_changed_state_recheck");
});

test("turns invalid x402 protocol documents into one exact repair action", async () => {
  const invalidProtocol = structuredClone(REPORT);
  invalidProtocol.ok = false;
  invalidProtocol.routes[0].valid = false;
  invalidProtocol.routes[0].findings = ["x402_payment_required_schema_invalid", "x402_resource_schema_invalid"];
  const result = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, { auditImpl: async () => invalidProtocol });
  assert.equal(result.decision, "repair_required");
  assert.deepEqual(result.nextActions, [
    "Publish an x402 PaymentRequired document that passes the official protocol schemas, including bounded resource metadata.",
  ]);
});

test("maps bounded seller-contract and transport failures", async () => {
  const absent = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, { auditImpl: async () => { throw new Error("exact paid GET route was not declared"); } });
  assert.equal(absent.decision, "repair_required");
  assert.equal(absent.report.auditCompleted, false);
  assert.equal(absent.report.failureCode, "exact_route_not_declared");
  assert.equal(absent.report.evidenceClass, "missing_declared_operation");
  assert.equal(absent.referralOffer.status, "available");
  assert.equal(absent.referralOffer.reward, "one_free_changed_state_recheck");

  const invalid = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, { auditImpl: async () => { throw new Error("document did not return JSON"); } });
  assert.equal(invalid.decision, "repair_required");
  assert.equal(invalid.report.evidenceClass, "invalid_declaration");

  const unavailable = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, { auditImpl: async () => { throw new Error("document returned HTTP 404"); } });
  assert.equal(unavailable.decision, "repair_required");
  assert.equal(unavailable.report.evidenceClass, "declared_url_unavailable");
  assert.equal(unavailable.report.observedHttpStatus, 404);
  assert.match(unavailable.nextActions[0], /HTTP 404/);

  const transport = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, { auditImpl: async () => { throw new Error("request timed out"); } });
  assert.equal(transport.report.failureCode, "bounded_transport_failure");
  assert.equal(transport.decision, "unverified");
  assert.equal(transport.report.auditCompleted, false);
  assert.equal(transport.report.evidenceClass, "transport_unknown");
  assert.equal(transport.referralOffer.status, "unavailable");
  assert.equal(transport.referralOffer.reward, "none");
  assert.equal(transport.referralOffer.id, null);
  assert.equal(transport.nextActions[0].includes("not seller-repair evidence"), true);
});

test("incomplete acquisition is not repair and withholds referral even when a referral id is supplied", async () => {
  const referral = `r1_${"d".repeat(64)}`;
  const oversized = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid", referral }, {
    auditImpl: async () => { throw new Error("response exceeded byte limit"); },
  });
  assert.equal(oversized.decision, "unverified");
  assert.equal(oversized.report.failureCode, "openapi_exceeds_byte_limit");
  assert.equal(oversized.report.evidenceClass, "local_acquisition_limit");
  assert.equal(oversized.referralOffer.status, "unavailable");
  assert.equal(oversized.referralOffer.id, null);
  assert.equal(oversized.referralOffer.reward, "none");
  assert.equal(oversized.nextActions[0].includes("not seller-repair evidence"), true);

  const ceiling = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, {
    auditImpl: async () => { throw new Error("paid GET route count exceeds 1"); },
  });
  assert.equal(ceiling.decision, "unverified");
  assert.equal(ceiling.report.evidenceClass, "local_acquisition_limit");
  assert.equal(ceiling.referralOffer.status, "unavailable");

  const tls = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid", referral }, {
    auditImpl: async () => { throw new Error("Client network socket disconnected before secure TLS connection was established"); },
  });
  assert.equal(tls.decision, "unverified");
  assert.equal(tls.report.evidenceClass, "transport_unknown");
  assert.equal(tls.referralOffer.id, null);

  const redirect = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, {
    auditImpl: async () => { throw new Error("redirects are not allowed"); },
  });
  assert.equal(redirect.decision, "unverified");
  assert.equal(redirect.report.failureCode, "redirect_not_followed");
  assert.equal(redirect.nextActions[0].includes("not by itself a catalog"), true);
});

test("classifies acquisition failures without inventing seller blame", () => {
  assert.equal(classifySellerIntegrityAcquisition("exact paid GET route was not declared").decision, "repair_required");
  assert.equal(classifySellerIntegrityAcquisition("request timed out").decision, "unverified");
  assert.equal(classifySellerIntegrityAcquisition("response exceeded byte limit").evidenceClass, "local_acquisition_limit");
  assert.equal(classifySellerIntegrityAcquisition("TLS peer not declared available").decision, "unverified");
  assert.equal(classifySellerIntegrityAcquisition("upstream said document returned HTTP 404").decision, "unverified");
  assert.equal(classifySellerIntegrityAcquisition("document did not return JSON after timeout").decision, "unverified");
});

test("preserves transient declared-URL HTTP evidence without asserting permanence", async () => {
  const unavailable = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, {
    auditImpl: async () => { throw new Error("document returned HTTP 503"); },
  });
  assert.equal(unavailable.decision, "repair_required");
  assert.equal(unavailable.report.evidenceClass, "declared_url_unavailable");
  assert.equal(unavailable.report.observedHttpStatus, 503);
  assert.match(unavailable.nextActions[0], /point-in-time/);
  assert.match(unavailable.nextActions[0], /does not establish a permanent missing contract/);
  assert.equal(unavailable.referralOffer.status, "available");

  const reportSchema = sellerIntegrityAuditOutputSchema().properties.report;
  assert.equal(reportSchema.required.includes("observedHttpStatus"), true);
  assert.deepEqual(reportSchema.properties.observedHttpStatus, {
    type: ["integer", "null"],
    minimum: 100,
    maximum: 599,
  });
});

test("unverified output validates against the complete advertised schema", async () => {
  const result = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, {
    auditImpl: async () => { throw new Error("request timed out"); },
  });
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(sellerIntegrityAuditOutputSchema());

  assert.equal(validate(result), true, ajv.errorsText(validate.errors));
  assert.equal(result.referralOffer.status, "unavailable");
  assert.equal(result.referralOffer.reward, "none");
  assert.equal(result.referralOffer.qualifiesOn, "none");
  assert.equal(result.referralOffer.id, null);
});

test("MCP clients receive the full unverified seller-audit contract", async () => {
  const unverified = await sellerIntegrityAudit({ origin: "https://seller.example", route: "/paid" }, {
    auditImpl: async () => { throw new Error("request timed out"); },
  });
  assert.equal(sellerIntegrityAuditMcpOutputSchema.safeParse(unverified).success, true);

  const server = new McpServer({ name: "seller-schema-test", version: "1.0.0" });
  server.registerTool("seller_integrity_audit", {
    inputSchema: { origin: z.string(), route: z.string() },
    outputSchema: sellerIntegrityAuditMcpOutputSchema,
  }, async () => ({ content: [{ type: "text", text: JSON.stringify(unverified) }], structuredContent: unverified }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "seller-schema-client", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const advertised = listed.tools.find((tool) => tool.name === "seller_integrity_audit")?.outputSchema;
    assert.equal(advertised?.properties?.decision?.enum.includes("unverified"), true);
    assert.equal(Object.hasOwn(advertised?.properties?.report?.properties || {}, "observedHttpStatus"), true);
    assert.equal(advertised?.properties?.referralOffer?.properties?.status?.enum.includes("unavailable"), true);
  } finally {
    await client.close();
    await server.close();
  }
});
