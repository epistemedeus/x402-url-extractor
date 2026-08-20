import assert from "node:assert/strict";
import test from "node:test";

import { SERVICE_DEPLOYMENT_ROUTES } from "./service-deployment-routes.mjs";
import {
  catalogContainsService,
  compareDirectoryToDeploymentRoutes,
  compareDirectoryToOpenApiOffers,
  evmOffersFromOpenApi,
  loadMppDirectoryService,
  renderServicesTsEntry,
  validateMppDirectoryService,
} from "./mpp-directory-publication.mjs";

const service = loadMppDirectoryService();

test("official catalog descriptor stays inside the current ServiceDef schema", () => {
  assert.deepEqual(validateMppDirectoryService(service), {
    endpointCount: 24,
    id: "samedaydesk",
    paymentMethod: "evm",
  });
  assert.equal(service.docs.apiReference, "https://agents.samedaydesk.com/mpp-openapi.json");
  assert.equal(service.realm, "agents.samedaydesk.com");
  assert.equal(service.payments[0].currency, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(service.payments[0].decimals, 6);
});

test("catalog descriptor lists exactly the 24 production MPP deployment routes", () => {
  const comparison = compareDirectoryToDeploymentRoutes(service);
  assert.equal(comparison.routeCount, 24);
  assert.equal(SERVICE_DEPLOYMENT_ROUTES.length, 24);
  assert.deepEqual(
    comparison.routes,
    SERVICE_DEPLOYMENT_ROUTES.map((route) => `${route.method} ${route.path}`).sort(),
  );
});

function openApiFromDirectory(source) {
  const paths = {};
  for (const endpoint of source.endpoints) {
    const [method, path] = endpoint.route.split(" ");
    paths[path] = paths[path] || {};
    paths[path][method.toLowerCase()] = {
      "x-payment-info": {
        offers: [
          { amount: endpoint.amount, method: "evm" },
          { amount: endpoint.amount, method: "x402" },
        ],
      },
      responses: {
        200: { content: { "application/json": { schema: { type: "object" } } } },
        402: {},
      },
    };
  }
  return { paths };
}

test("catalog descriptor economics match OpenAPI evm offers and reject schema extras", () => {
  const document = openApiFromDirectory(service);
  assert.equal(compareDirectoryToOpenApiOffers(service, document).offerCount, 24);
  assert.equal(evmOffersFromOpenApi(document).length, 24);

  const drifted = structuredClone(document);
  drifted.paths["/extract"].get["x-payment-info"].offers[0].amount = "1";
  assert.throws(() => compareDirectoryToOpenApiOffers(service, drifted), /drift/);

  const invalid = structuredClone(service);
  invalid.endpoints[0].outputSchema = { type: "object" };
  assert.throws(() => validateMppDirectoryService(invalid), /unsupported endpoint field/);
  const withOpenapiDocs = structuredClone(service);
  withOpenapiDocs.docs.openapi = service.docs.apiReference;
  assert.throws(() => validateMppDirectoryService(withOpenapiDocs), /unsupported docs field/);
});

test("official catalog presence is a separate index check", () => {
  assert.equal(catalogContainsService({ version: 1, services: [] }), false);
  assert.equal(catalogContainsService({ services: [{ id: "exa" }] }), false);
  assert.equal(catalogContainsService({ services: [{ id: "samedaydesk", serviceUrl: "https://agents.samedaydesk.com" }] }), true);
});

test("maintainer TypeScript entry keeps 24 priced routes and no invented contract fields", () => {
  const rendered = renderServicesTsEntry(service);
  assert.match(rendered, /id: "samedaydesk"/);
  assert.match(rendered, /method: "evm"/);
  assert.match(rendered, /apiReference: "https:\/\/agents\.samedaydesk\.com\/mpp-openapi\.json"/);
  assert.equal([...rendered.matchAll(/route: "/g)].length, 24);
  assert.doesNotMatch(rendered, /outputSchema|requestSchema|openapi:/);
});


