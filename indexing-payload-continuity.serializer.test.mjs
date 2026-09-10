import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isExactEvmV2IndexingContinuitySupported,
  planIndexingPayloadContinuity,
  applyIndexingContinuityPatches,
} from "./indexing-payload-continuity.mjs";

const MERCHANT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(MERCHANT, "package.json"));
const { x402Client } = await import(pathToFileURL(require.resolve("@x402/core/client")).href);
const { HTTPFacilitatorClient } = await import(pathToFileURL(require.resolve("@x402/core/http")).href);

const NETWORK = "eip155:8453";
const PUBLIC = "https://agents.samedaydesk.com";

class UnsignedExactScheme {
  constructor() {
    this.scheme = "exact";
  }
  async createPaymentPayload(x402Version) {
    return {
      x402Version,
      payload: {
        stub: true,
        authorization: {
          from: "0x0000000000000000000000000000000000000001",
          to: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
          value: "10000",
          validAfter: "1",
          validBefore: "9999999999",
          nonce: "0x01",
        },
        signature: "0xstub",
      },
    };
  }
}

describe("official x402Client serializer + continuity", () => {
  it("createPaymentPayload copies resource/extensions; continuity fills only omissions", async () => {
    const paymentRequired = {
      x402Version: 2,
      resource: {
        url: `${PUBLIC}/commerce/seller-integrity-audit`,
        description: "sia",
        mimeType: "application/json",
      },
      accepts: [
        {
          scheme: "exact",
          network: NETWORK,
          amount: "10000",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
          maxTimeoutSeconds: 300,
          extra: { name: "USD Coin", version: "2" },
        },
      ],
      extensions: {
        bazaar: {
          info: { input: { type: "http", method: "GET" } },
          schema: { type: "object" },
        },
      },
    };
    const client = new x402Client().register(NETWORK, new UnsignedExactScheme());
    const complete = await client.createPaymentPayload(paymentRequired);
    assert.equal(complete.resource.url, paymentRequired.resource.url);
    assert.ok(complete.extensions.bazaar);
    assert.equal(complete.payload.stub, true);
    assert.equal(
      isExactEvmV2IndexingContinuitySupported(complete, paymentRequired.accepts[0]),
      true,
    );

    const omitted = structuredClone(complete);
    delete omitted.resource;
    delete omitted.extensions.bazaar;
    const authBefore = JSON.stringify(omitted.payload);
    const planned = planIndexingPayloadContinuity(omitted, {
      resource: paymentRequired.resource,
      extensions: paymentRequired.extensions,
    });
    applyIndexingContinuityPatches(omitted, planned.patches);
    assert.equal(omitted.resource.url, paymentRequired.resource.url);
    assert.deepEqual(omitted.extensions.bazaar, paymentRequired.extensions.bazaar);
    assert.equal(JSON.stringify(omitted.payload), authBefore);

    // Enriched bazaar retained
    const enriched = structuredClone(complete);
    enriched.extensions.bazaar = {
      ...enriched.extensions.bazaar,
      info: { ...enriched.extensions.bazaar.info, input: { ...enriched.extensions.bazaar.info.input, queryParams: { a: { type: "string" } } } },
    };
    const plannedEnriched = planIndexingPayloadContinuity(enriched, {
      resource: paymentRequired.resource,
      extensions: paymentRequired.extensions,
    });
    assert.deepEqual(plannedEnriched.patches, {});
    assert.equal(plannedEnriched.provenance.bazaar, "present");
  });

  it("HTTPFacilitatorClient verify/settle JSON keeps filled fields and never puts them on requirements", async () => {
    const bodies = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const parsedUrl = String(url);
      if (parsedUrl.endsWith("/supported")) {
        return new Response(
          JSON.stringify({
            kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }],
            extensions: [],
            signers: {},
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const body = JSON.parse(init.body);
      bodies.push({ url: parsedUrl, body });
      if (parsedUrl.endsWith("/verify")) {
        return new Response(JSON.stringify({ isValid: true, payer: "0x1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ success: true, transaction: `0x${"a".repeat(64)}`, network: NETWORK }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    try {
      const client = new HTTPFacilitatorClient({ url: "http://127.0.0.1:9" });
      const paymentPayload = {
        x402Version: 2,
        resource: { url: `${PUBLIC}/commerce/seller-integrity-audit` },
        accepted: {
          scheme: "exact",
          network: NETWORK,
          amount: "10000",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
          maxTimeoutSeconds: 300,
        },
        payload: { stub: true },
        extensions: { bazaar: { info: { input: { type: "http", method: "GET" } }, schema: { type: "object" } } },
      };
      const requirements = paymentPayload.accepted;
      await client.verify(paymentPayload, requirements);
      await client.settle(paymentPayload, requirements);
      assert.equal(bodies.length, 2);
      for (const entry of bodies) {
        assert.equal(entry.body.paymentPayload.resource.url, paymentPayload.resource.url);
        assert.ok(entry.body.paymentPayload.extensions.bazaar);
        assert.equal(Object.prototype.hasOwnProperty.call(entry.body.paymentRequirements, "resource"), false);
        assert.equal(Object.prototype.hasOwnProperty.call(entry.body.paymentRequirements, "extensions"), false);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
