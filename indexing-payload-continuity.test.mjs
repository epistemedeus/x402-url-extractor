import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyIndexingPayloadContinuity,
  buildDeclaredIndexing,
  installIndexingPayloadContinuity,
  getLastIndexingContinuityDiagnostic,
} from "./indexing-payload-continuity.mjs";

const DECLARED_RESOURCE = {
  url: "https://agents.samedaydesk.com/commerce/seller-integrity-audit",
  description: "sia",
  mimeType: "application/json",
  serviceName: "SameDayDesk",
  tags: ["x402", "mpp"],
  iconUrl: "https://samedaydesk.com/favicon.svg",
};

const DECLARED_BAZAAR = {
  info: { input: { type: "http", method: "GET", queryParams: { origin: { type: "string" } } } },
  schema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" },
};

function basePayload(overrides = {}) {
  return {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
      maxTimeoutSeconds: 300,
    },
    payload: {
      stub: true,
      authorization: { from: "0xabc", to: "0xdef", value: "10000", nonce: "0x1" },
      signature: "0xsig",
    },
    resource: structuredClone(DECLARED_RESOURCE),
    extensions: {
      bazaar: structuredClone(DECLARED_BAZAAR),
      unrelated: { keep: true },
    },
    ...overrides,
  };
}

describe("applyIndexingPayloadContinuity", () => {
  it("preserves a complete payload and does not touch payload authority", () => {
    const payload = basePayload();
    const authBefore = structuredClone(payload.payload);
    const acceptedBefore = structuredClone(payload.accepted);
    const result = applyIndexingPayloadContinuity(payload, {
      resource: DECLARED_RESOURCE,
      extensions: { bazaar: DECLARED_BAZAAR },
    });
    assert.equal(result.ok, true);
    assert.equal(result.provenance.resource, "present");
    assert.equal(result.provenance.bazaar, "present");
    assert.deepEqual(result.paymentPayload.payload, authBefore);
    assert.deepEqual(result.paymentPayload.accepted, acceptedBefore);
    assert.equal(result.paymentPayload.extensions.unrelated.keep, true);
  });

  it("fills omitted resource and bazaar from declared metadata", () => {
    const payload = basePayload();
    delete payload.resource;
    delete payload.extensions.bazaar;
    const result = applyIndexingPayloadContinuity(payload, {
      resource: DECLARED_RESOURCE,
      extensions: { bazaar: DECLARED_BAZAAR, other: { x: 1 } },
    });
    assert.equal(result.ok, true);
    assert.equal(result.provenance.resource, "filled");
    assert.equal(result.provenance.bazaar, "filled");
    assert.equal(result.paymentPayload.resource.url, DECLARED_RESOURCE.url);
    assert.deepEqual(result.paymentPayload.extensions.bazaar, DECLARED_BAZAAR);
    assert.equal(result.paymentPayload.extensions.unrelated.keep, true);
    assert.equal(result.paymentPayload.payload.stub, true);
  });

  it("fills when all extensions are omitted", () => {
    const payload = basePayload();
    delete payload.extensions;
    const result = applyIndexingPayloadContinuity(payload, {
      resource: DECLARED_RESOURCE,
      extensions: { bazaar: DECLARED_BAZAAR },
    });
    assert.equal(result.ok, true);
    assert.equal(result.provenance.bazaar, "filled");
    assert.deepEqual(result.paymentPayload.extensions.bazaar, DECLARED_BAZAAR);
  });

  it("rejects mismatched resource.url without rebinding", () => {
    const payload = basePayload({
      resource: { ...DECLARED_RESOURCE, url: "https://evil.example/commerce/seller-integrity-audit" },
    });
    const result = applyIndexingPayloadContinuity(payload, {
      resource: DECLARED_RESOURCE,
      extensions: { bazaar: DECLARED_BAZAAR },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "indexing_resource_mismatch");
    assert.equal(
      payload.resource.url,
      "https://evil.example/commerce/seller-integrity-audit",
    );
  });

  it("rejects wrong-typed resource", () => {
    const payload = basePayload({ resource: "https://agents.samedaydesk.com/commerce/seller-integrity-audit" });
    const result = applyIndexingPayloadContinuity(payload, {
      resource: DECLARED_RESOURCE,
      extensions: { bazaar: DECLARED_BAZAAR },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "indexing_resource_wrong_type");
  });

  it("rejects wrong-typed bazaar", () => {
    const payload = basePayload();
    payload.extensions.bazaar = "not-an-object";
    const result = applyIndexingPayloadContinuity(payload, {
      resource: DECLARED_RESOURCE,
      extensions: { bazaar: DECLARED_BAZAAR },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "indexing_bazaar_wrong_type");
  });

  it("rejects contradictory bazaar without silent rewrite", () => {
    const payload = basePayload();
    payload.extensions.bazaar = {
      info: { input: { type: "http", method: "POST" } },
      schema: DECLARED_BAZAAR.schema,
    };
    const before = structuredClone(payload.extensions.bazaar);
    const result = applyIndexingPayloadContinuity(payload, {
      resource: DECLARED_RESOURCE,
      extensions: { bazaar: DECLARED_BAZAAR },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "indexing_bazaar_mismatch");
    assert.deepEqual(payload.extensions.bazaar, before);
  });

  it("preserves unrelated extensions while filling bazaar", () => {
    const payload = basePayload();
    delete payload.extensions.bazaar;
    payload.extensions.paymentIdentifier = { id: "keep-me" };
    const result = applyIndexingPayloadContinuity(payload, {
      resource: DECLARED_RESOURCE,
      extensions: { bazaar: DECLARED_BAZAAR },
    });
    assert.equal(result.ok, true);
    assert.equal(result.paymentPayload.extensions.paymentIdentifier.id, "keep-me");
    assert.deepEqual(result.paymentPayload.extensions.bazaar, DECLARED_BAZAAR);
  });
});

describe("installIndexingPayloadContinuity", () => {
  it("enriches verify and settle calls with the same filled fields", async () => {
    const calls = [];
    const fakeServer = {
      async verifyPayment(paymentPayload, requirements, declaredExtensions, transportContext) {
        calls.push({ phase: "verify", paymentPayload: structuredClone(paymentPayload) });
        return { isValid: true, payer: "0x1" };
      },
      async settlePayment(paymentPayload, requirements, declaredExtensions, transportContext) {
        calls.push({ phase: "settle", paymentPayload: structuredClone(paymentPayload) });
        return { success: true, transaction: "0xabc", network: "eip155:8453" };
      },
    };
    installIndexingPayloadContinuity(fakeServer, {
      resolveDeclaredResource: () => DECLARED_RESOURCE,
    });
    const payload = basePayload();
    delete payload.resource;
    delete payload.extensions.bazaar;
    const transportContext = {
      request: {
        adapter: {
          getUrl: () => DECLARED_RESOURCE.url,
          getPath: () => "/commerce/seller-integrity-audit",
        },
      },
    };
    const declaredExtensions = { bazaar: DECLARED_BAZAAR };
    await fakeServer.verifyPayment(payload, payload.accepted, declaredExtensions, transportContext);
    await fakeServer.settlePayment(payload, payload.accepted, declaredExtensions, transportContext);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.paymentPayload.resource.url, DECLARED_RESOURCE.url);
      assert.deepEqual(call.paymentPayload.extensions.bazaar, DECLARED_BAZAAR);
      assert.equal(call.paymentPayload.payload.signature, "0xsig");
    }
    const diagnostic = getLastIndexingContinuityDiagnostic();
    assert.equal(diagnostic.phase, "settle");
    assert.ok(["filled", "present"].includes(diagnostic.provenance.resource));
  });

  it("returns invalid verify result on resource mismatch", async () => {
    const fakeServer = {
      async verifyPayment() {
        throw new Error("should not reach original verify");
      },
      async settlePayment() {
        throw new Error("unused");
      },
    };
    installIndexingPayloadContinuity(fakeServer, {
      resolveDeclaredResource: () => DECLARED_RESOURCE,
    });
    const payload = basePayload({
      resource: { ...DECLARED_RESOURCE, url: "https://other.example/" },
    });
    const result = await fakeServer.verifyPayment(
      payload,
      payload.accepted,
      { bazaar: DECLARED_BAZAAR },
      { request: { adapter: { getUrl: () => DECLARED_RESOURCE.url, getPath: () => "/commerce/seller-integrity-audit" } } },
    );
    assert.equal(result.isValid, false);
    assert.equal(result.invalidReason, "indexing_resource_mismatch");
  });
});

describe("buildDeclaredIndexing", () => {
  it("falls back to transport adapter URL when no resolver is provided", () => {
    const declared = buildDeclaredIndexing(
      { request: { adapter: { getUrl: () => "https://example.test/r" } } },
      { bazaar: DECLARED_BAZAAR },
    );
    assert.equal(declared.resource.url, "https://example.test/r");
    assert.deepEqual(declared.extensions.bazaar, DECLARED_BAZAAR);
  });
});
