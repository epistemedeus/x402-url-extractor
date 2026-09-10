import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyIndexingPayloadContinuity,
  planIndexingPayloadContinuity,
  applyIndexingContinuityPatches,
  buildDeclaredIndexing,
  canonicalResourceUrlFromOriginAndPath,
  resolveDeclaredResourceUrl,
  isExactEvmV2IndexingContinuitySupported,
  registerIndexingPayloadContinuity,
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

const REQUIREMENTS = {
  scheme: "exact",
  network: "eip155:8453",
  amount: "10000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
  maxTimeoutSeconds: 300,
};

function basePayload(overrides = {}) {
  return {
    x402Version: 2,
    accepted: structuredClone(REQUIREMENTS),
    payload: {
      stub: true,
      authorization: { from: "0xabc", to: "0xdef", value: "10000", nonce: "0x1", validAfter: "1", validBefore: "9" },
      signature: "0xsig",
    },
    resource: structuredClone(DECLARED_RESOURCE),
    extensions: {
      bazaar: structuredClone(DECLARED_BAZAAR),
      unrelated: { keep: true },
      "payment-identifier": { id: "pid" },
    },
    ...overrides,
  };
}

function authorityFingerprint(payload) {
  return JSON.stringify({
    payload: payload.payload,
    accepted: payload.accepted,
    unrelated: payload.extensions?.unrelated,
    paymentIdentifier: payload.extensions?.["payment-identifier"],
  });
}

describe("isExactEvmV2IndexingContinuitySupported", () => {
  it("accepts v2 exact eip155 only", () => {
    assert.equal(isExactEvmV2IndexingContinuitySupported(basePayload(), REQUIREMENTS), true);
    assert.equal(isExactEvmV2IndexingContinuitySupported({ ...basePayload(), x402Version: 1 }, REQUIREMENTS), false);
    assert.equal(
      isExactEvmV2IndexingContinuitySupported(basePayload(), { ...REQUIREMENTS, scheme: "upto" }),
      false,
    );
    assert.equal(
      isExactEvmV2IndexingContinuitySupported(basePayload(), { ...REQUIREMENTS, network: "solana:mainnet" }),
      false,
    );
  });
});

describe("canonical resource URL", () => {
  it("uses public origin + path and ignores Host", () => {
    assert.equal(
      canonicalResourceUrlFromOriginAndPath("https://agents.samedaydesk.com", "/commerce/seller-integrity-audit"),
      "https://agents.samedaydesk.com/commerce/seller-integrity-audit",
    );
    const poisoned = {
      request: {
        adapter: {
          getPath: () => "/commerce/seller-integrity-audit",
          getUrl: () => "https://evil.example/commerce/seller-integrity-audit",
        },
      },
    };
    assert.equal(
      resolveDeclaredResourceUrl(poisoned, { publicOrigin: "https://agents.samedaydesk.com" }),
      "https://agents.samedaydesk.com/commerce/seller-integrity-audit",
    );
  });

  it("prefers explicit route resource override over path join", () => {
    const ctx = {
      request: {
        routeConfig: { resource: "https://agents.samedaydesk.com/fixed" },
        adapter: { getPath: () => "/other" },
      },
    };
    assert.equal(
      resolveDeclaredResourceUrl(ctx, { publicOrigin: "https://agents.samedaydesk.com" }),
      "https://agents.samedaydesk.com/fixed",
    );
  });
});

describe("planIndexingPayloadContinuity", () => {
  it("preserves complete payload without patches and without declining", () => {
    const payload = basePayload();
    const before = authorityFingerprint(payload);
    const planned = planIndexingPayloadContinuity(payload, {
      resource: DECLARED_RESOURCE,
      extensions: { bazaar: DECLARED_BAZAAR },
    });
    assert.deepEqual(planned.patches, {});
    assert.equal(planned.provenance.resource, "present");
    assert.equal(planned.provenance.bazaar, "present");
    assert.equal(planned.provenance.declinedPayment, false);
    assert.equal(authorityFingerprint(payload), before);
  });

  it("plans atomic fills for omitted resource and bazaar", () => {
    const payload = basePayload();
    delete payload.resource;
    delete payload.extensions.bazaar;
    const planned = planIndexingPayloadContinuity(payload, {
      resource: DECLARED_RESOURCE,
      extensions: { bazaar: DECLARED_BAZAAR },
    });
    assert.equal(planned.provenance.resource, "filled");
    assert.equal(planned.provenance.bazaar, "filled");
    assert.ok(planned.patches.resource);
    assert.ok(planned.patches.extensions.bazaar);
    assert.equal(payload.resource, undefined);
    applyIndexingContinuityPatches(payload, planned.patches);
    assert.equal(payload.resource.url, DECLARED_RESOURCE.url);
    assert.deepEqual(payload.extensions.bazaar, DECLARED_BAZAAR);
    assert.equal(payload.extensions.unrelated.keep, true);
  });

  it("retains wrong-typed resource/bazaar without declining or patching", () => {
    const payload = basePayload({ resource: "https://agents.samedaydesk.com/commerce/seller-integrity-audit" });
    payload.extensions.bazaar = "not-an-object";
    const before = authorityFingerprint(payload);
    const planned = planIndexingPayloadContinuity(payload, {
      resource: DECLARED_RESOURCE,
      extensions: { bazaar: DECLARED_BAZAAR },
    });
    assert.deepEqual(planned.patches, {});
    assert.equal(planned.provenance.resource, "present_wrong_type_retained");
    assert.equal(planned.provenance.bazaar, "present_wrong_type_retained");
    assert.equal(planned.provenance.declinedPayment, false);
    assert.equal(authorityFingerprint(payload), before);
  });

  it("retains enriched bazaar that differs from declared (no deep-equal reject)", () => {
    const payload = basePayload();
    payload.extensions.bazaar = {
      ...structuredClone(DECLARED_BAZAAR),
      info: {
        ...DECLARED_BAZAAR.info,
        input: {
          ...DECLARED_BAZAAR.info.input,
          headers: { "x-extra": { type: "string" } },
        },
      },
      routeTemplate: "/commerce/seller-integrity-audit",
    };
    const before = JSON.stringify(payload.extensions.bazaar);
    const planned = planIndexingPayloadContinuity(payload, {
      resource: DECLARED_RESOURCE,
      extensions: { bazaar: DECLARED_BAZAAR },
    });
    assert.deepEqual(planned.patches, {});
    assert.equal(planned.provenance.bazaar, "present");
    assert.equal(JSON.stringify(payload.extensions.bazaar), before);
  });

  it("does not rebind mismatched resource.url", () => {
    const payload = basePayload({
      resource: { ...DECLARED_RESOURCE, url: "https://evil.example/commerce/seller-integrity-audit" },
    });
    const planned = planIndexingPayloadContinuity(payload, {
      resource: DECLARED_RESOURCE,
      extensions: { bazaar: DECLARED_BAZAAR },
    });
    assert.deepEqual(planned.patches, {});
    assert.equal(payload.resource.url, "https://evil.example/commerce/seller-integrity-audit");
  });
});

describe("applyIndexingPayloadContinuity scoping", () => {
  it("skips v1 and non-exact schemes without mutation", () => {
    const payload = basePayload({ x402Version: 1 });
    delete payload.resource;
    const before = JSON.stringify(payload);
    const result = applyIndexingPayloadContinuity(
      payload,
      { resource: DECLARED_RESOURCE, extensions: { bazaar: DECLARED_BAZAAR } },
      { ...REQUIREMENTS },
    );
    assert.equal(result.skipped, true);
    assert.equal(JSON.stringify(payload), before);
  });
});

describe("registerIndexingPayloadContinuity hooks", () => {
  it("registers onBeforeVerify/onBeforeSettle and does not reassign methods", async () => {
    const calls = [];
    const hooks = { beforeVerify: [], beforeSettle: [] };
    const fakeServer = {
      verifyPayment: async () => ({ isValid: true }),
      settlePayment: async () => ({ success: true }),
      onBeforeVerify(hook) {
        hooks.beforeVerify.push(hook);
        return this;
      },
      onBeforeSettle(hook) {
        hooks.beforeSettle.push(hook);
        return this;
      },
    };
    const originalVerify = fakeServer.verifyPayment;
    const originalSettle = fakeServer.settlePayment;
    registerIndexingPayloadContinuity(fakeServer, {
      resolveDeclaredResource: () => DECLARED_RESOURCE,
    });
    assert.equal(fakeServer.verifyPayment, originalVerify);
    assert.equal(fakeServer.settlePayment, originalSettle);
    assert.equal(hooks.beforeVerify.length, 1);
    assert.equal(hooks.beforeSettle.length, 1);

    const payload = basePayload();
    delete payload.resource;
    delete payload.extensions.bazaar;
    const context = {
      paymentPayload: payload,
      requirements: REQUIREMENTS,
      declaredExtensions: { bazaar: DECLARED_BAZAAR },
      transportContext: {
        request: {
          adapter: {
            getPath: () => "/commerce/seller-integrity-audit",
            getUrl: () => "https://evil.example/poison",
          },
        },
      },
    };
    await hooks.beforeVerify[0](context);
    await hooks.beforeSettle[0](context);
    assert.equal(payload.resource.url, DECLARED_RESOURCE.url);
    assert.deepEqual(payload.extensions.bazaar, DECLARED_BAZAAR);
    assert.equal(payload.payload.signature, "0xsig");
    const diagnostic = getLastIndexingContinuityDiagnostic();
    assert.equal(diagnostic.phase, "settle");
    calls.push(diagnostic);
    assert.equal(calls[0].provenance.declinedPayment, false);
  });

  it("does not decline verify when resource is wrong-typed", async () => {
    const hooks = { beforeVerify: [] };
    const fakeServer = {
      onBeforeVerify(hook) {
        hooks.beforeVerify.push(hook);
        return this;
      },
      onBeforeSettle() {
        return this;
      },
    };
    registerIndexingPayloadContinuity(fakeServer, {
      resolveDeclaredResource: () => DECLARED_RESOURCE,
    });
    const payload = basePayload({ resource: "string-resource" });
    await hooks.beforeVerify[0]({
      paymentPayload: payload,
      requirements: REQUIREMENTS,
      declaredExtensions: { bazaar: DECLARED_BAZAAR },
      transportContext: {},
    });
    assert.equal(payload.resource, "string-resource");
    assert.equal(getLastIndexingContinuityDiagnostic().provenance.declinedPayment, false);
  });
});

describe("buildDeclaredIndexing", () => {
  it("uses resolver output only (no Host fallback)", () => {
    const declared = buildDeclaredIndexing(
      { request: { adapter: { getUrl: () => "https://evil.example/r", getPath: () => "/r" } } },
      { bazaar: DECLARED_BAZAAR },
      () => ({ url: "https://agents.samedaydesk.com/r" }),
    );
    assert.equal(declared.resource.url, "https://agents.samedaydesk.com/r");
  });
});
