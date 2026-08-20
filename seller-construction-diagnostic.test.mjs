import assert from "node:assert/strict";
import test from "node:test";

import { sellerIntegrityAuditOutputSchema } from "./seller-integrity-audit.mjs";
import { BAZAAR_RESOURCE_METADATA } from "./bazaar-resource-metadata.mjs";
import { SERVICE_DEPLOYMENT_ROUTES } from "./service-deployment-routes.mjs";
import {
  SellerConstructionDiagnosticError,
  createSellerConstructionDiagnosticHandler,
  normalizeSellerConstructionDiagnosticInput,
  sellerConstructionDiagnostic,
  sellerConstructionDiagnosticOutputSchema,
} from "./seller-construction-diagnostic.mjs";

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

const ORIGIN = "https://seller.example";

function passingSurfaces() {
  return {
    "/openapi.json": {
      paths: {
        "/extract": {
          get: {
            parameters: [{ name: "url", in: "query", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "ok" }, "402": { description: "payment required" } },
            "x-payment-info": { protocols: [{ x402: {} }] },
          },
        },
      },
    },
    "/.well-known/x402": {
      x402Version: 2,
      items: [{
        resource: {
          url: "https://seller.example/extract?url=https%3A%2F%2Fexample.com",
          routeTemplate: "/extract",
        },
        request: {
          exampleUrl: "https://seller.example/extract?url=https%3A%2F%2Fexample.com",
          example: { type: "http", method: "GET", queryParams: { url: "https://example.com" } },
          schema: { type: "object", properties: { queryParams: { required: ["url"] } } },
        },
      }],
    },
    "/.well-known/agent-card.json": {
      skills: [{
        id: "discover-paid-action-extract",
        description: "Discover /extract and call https://seller.example/extract?url=https%3A%2F%2Fexample.com",
        examples: ["Find the /extract paid action, then call https://seller.example/extract?url=https%3A%2F%2Fexample.com"],
      }],
    },
    "/api/actions": {
      actions: [{
        method: "GET",
        route: "/extract",
        url: "https://seller.example/extract",
        request: {
          exampleUrl: "https://seller.example/extract?url=https%3A%2F%2Fexample.com",
          example: { type: "http", method: "GET", queryParams: { url: "https://example.com" } },
          schema: { type: "object", properties: { queryParams: { required: ["url"] } } },
        },
      }],
    },
    "/mcp": { name: "seller", transport: "streamable-http", toolCount: 1 },
  };
}

function fetchSurfaces(documents) {
  return async (urlValue) => {
    const path = new URL(urlValue).pathname;
    if (!documents[path]) throw new Error(`${path} returned HTTP 404`);
    return structuredClone(documents[path]);
  };
}

const mcpTools = async () => [{ name: "extract", required: ["url"] }];

test("normalizes a public origin and optional exact route", () => {
  assert.deepEqual(normalizeSellerConstructionDiagnosticInput({ origin: ORIGIN }), {
    origin: ORIGIN,
    method: null,
    route: null,
  });
  assert.deepEqual(normalizeSellerConstructionDiagnosticInput({
    origin: ORIGIN,
    route: "/extract",
  }), { origin: ORIGIN, method: "GET", route: "/extract" });
  assert.deepEqual(normalizeSellerConstructionDiagnosticInput({
    origin: ORIGIN,
    route: "/extract",
    method: "post",
  }), { origin: ORIGIN, method: "POST", route: "/extract" });
  assert.throws(() => normalizeSellerConstructionDiagnosticInput({ origin: "http://seller.example" }), SellerConstructionDiagnosticError);
  assert.throws(() => normalizeSellerConstructionDiagnosticInput({ origin: `${ORIGIN}/extract` }), /must not contain/);
  assert.throws(() => normalizeSellerConstructionDiagnosticInput({ origin: ORIGIN, method: "GET" }), /method requires an exact route/);
  assert.throws(() => normalizeSellerConstructionDiagnosticInput({ origin: ORIGIN, route: "/paid?url=1" }), /exact absolute path/);
  assert.throws(() => normalizeSellerConstructionDiagnosticInput({ origin: ORIGIN, token: "secret" }), /unsupported input field/);
});

test("returns pass when MCP, OpenAPI, x402, A2A, and catalog stay constructible", async () => {
  const result = await sellerConstructionDiagnostic({ origin: ORIGIN, route: "/extract" }, {
    surfaceFetchImpl: fetchSurfaces(passingSurfaces()),
    mcpToolsImpl: mcpTools,
    now: () => new Date("2026-08-20T12:00:00.000Z"),
  });
  assert.equal(result.decision, "pass");
  assert.equal(result.ok, true);
  assert.equal(result.product, "samedaydesk-seller-construction-diagnostic");
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.acceptance, []);
  assert.equal(result.routes[0].requiredInputs[0], "url");
  assert.equal(result.boundary.paidTargetBodyRead, false);
  assert.equal(result.boundary.queryValuesRetained, false);
  assert.equal(JSON.stringify(result).includes("https://example.com"), false);
  assert.deepEqual(sellerConstructionDiagnosticOutputSchema().required, [
    "ok", "product", "version", "checkedAt", "decision", "request", "surfaces", "routes", "findings", "acceptance", "boundary",
  ]);
});

test("flags flattened x402, catalog, and A2A URLs that drop required inputs", async () => {
  const documents = passingSurfaces();
  documents["/.well-known/x402"].items[0].resource.url = "https://seller.example/extract";
  documents["/.well-known/x402"].items[0].request.exampleUrl = "https://seller.example/extract";
  documents["/.well-known/x402"].items[0].request.example.queryParams = {};
  documents["/api/actions"].actions[0].request.exampleUrl = "https://seller.example/extract";
  documents["/api/actions"].actions[0].request.example.queryParams = {};
  documents["/.well-known/agent-card.json"].skills[0].description = "Discover /extract without a complete example";
  documents["/.well-known/agent-card.json"].skills[0].examples = ["Find the /extract paid action"];
  const result = await sellerConstructionDiagnostic({ origin: ORIGIN, route: "/extract" }, {
    surfaceFetchImpl: fetchSurfaces(documents),
    mcpToolsImpl: mcpTools,
  });
  assert.equal(result.decision, "repair_required");
  assert.ok(result.findings.includes("x402_resource_url_drops_required_input"));
  assert.ok(result.findings.includes("x402_v1_v2_resource_split"));
  assert.ok(result.findings.includes("catalog_example_url_drops_required_input"));
  assert.ok(result.findings.includes("a2a_example_url_drops_required_input"));
  assert.ok(result.acceptance.some((item) => item.includes("x402 resource URL drops required query key url")));
  assert.ok(result.acceptance.some((item) => item.includes("v1 clients that flatten resource.url")));
  assert.ok(result.acceptance.some((item) => item.includes("Refresh the action catalog")));
  assert.equal(JSON.stringify(result).includes("https://example.com"), false);
});

test("flags a missing Bazaar contract and catalog that did not refresh", async () => {
  const documents = passingSurfaces();
  delete documents["/.well-known/x402"].items[0].request;
  documents["/api/actions"].actions = [];
  const result = await sellerConstructionDiagnostic({ origin: ORIGIN, route: "/extract" }, {
    surfaceFetchImpl: fetchSurfaces(documents),
    mcpToolsImpl: mcpTools,
  });
  assert.equal(result.decision, "repair_required");
  assert.ok(result.findings.includes("x402_request_contract_missing"));
  assert.ok(result.findings.includes("catalog_action_missing"));
  assert.ok(result.acceptance.some((item) => item.includes("missing a Bazaar request contract")));
  assert.ok(result.acceptance.some((item) => item.includes("Refresh the catalog after settlement")));
});

test("flags MCP and OpenAPI required-input drift", async () => {
  const result = await sellerConstructionDiagnostic({ origin: ORIGIN, route: "/extract" }, {
    surfaceFetchImpl: fetchSurfaces(passingSurfaces()),
    mcpToolsImpl: async () => [{ name: "extract", required: [] }],
  });
  assert.equal(result.decision, "repair_required");
  assert.ok(result.findings.includes("mcp_required_input_undeclared"));
});

test("maps missing discovery surfaces to repair_required without a 402", async () => {
  const result = await sellerConstructionDiagnostic({ origin: ORIGIN }, {
    surfaceFetchImpl: async () => { throw new Error("/openapi.json returned HTTP 404"); },
    mcpToolsImpl: async () => { throw new Error("/mcp returned HTTP 402"); },
  });
  assert.equal(result.decision, "repair_required");
  assert.ok(result.findings.includes("surface_unavailable:openapi"));
  assert.ok(result.acceptance.some((item) => item.includes("Publish a reachable same-origin openapi")));
  assert.equal(result.boundary.targetPaymentSent, false);
});

test("unpaid HTTP handler returns pass or repair_required without HTTP 402", async () => {
  const handler = createSellerConstructionDiagnosticHandler({
    diagnosticImpl: async (query) => sellerConstructionDiagnostic(query, {
      surfaceFetchImpl: fetchSurfaces(passingSurfaces()),
      mcpToolsImpl: mcpTools,
    }),
  });
  const passRes = mockRes();
  await handler({ query: { origin: ORIGIN, route: "/extract" } }, passRes);
  assert.equal(passRes.statusCode, 200);
  assert.notEqual(passRes.statusCode, 402);
  assert.equal(passRes.body.decision, "pass");
  assert.equal(passRes.headers["Cache-Control"], "no-store");

  const invalidRes = mockRes();
  await handler({ query: { origin: "http://seller.example" } }, invalidRes);
  assert.equal(invalidRes.statusCode, 400);
  assert.notEqual(invalidRes.statusCode, 402);
  assert.equal(invalidRes.body.charged, false);
  assert.equal(invalidRes.body.product, "samedaydesk-seller-construction-diagnostic");
});

test("does not change paid seller-integrity or discoverability SKUs", () => {
  assert.deepEqual(sellerIntegrityAuditOutputSchema().properties.decision.enum, [
    "machine_buyable",
    "contract_ready",
    "repair_required",
  ]);
  assert.equal(sellerIntegrityAuditOutputSchema().properties.product.const, "samedaydesk-seller-integrity-audit");
  assert.equal(Object.hasOwn(BAZAAR_RESOURCE_METADATA, "/commerce/seller-construction-diagnostic"), false);
  assert.equal(BAZAAR_RESOURCE_METADATA["/commerce/seller-integrity-audit"].serviceName, "SameDayDesk");
  assert.equal(
    SERVICE_DEPLOYMENT_ROUTES.some((route) => route.path === "/commerce/seller-construction-diagnostic"),
    false,
  );
  assert.equal(
    SERVICE_DEPLOYMENT_ROUTES.some((route) => route.path === "/commerce/seller-integrity-audit"),
    true,
  );
});
