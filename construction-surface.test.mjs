import assert from "node:assert/strict";
import test from "node:test";

import {
  buildX402ManifestItems,
  validateConstructionSurfaceParity,
} from "./construction-surface.mjs";
import {
  createExactUsdcAcceptsFor,
  usdcTermsForNetwork,
} from "./x402-payment-terms.mjs";

const getAction = {
  name: "extract",
  method: "GET",
  route: "/extract",
  url: "https://agents.example/extract",
  serviceName: "Example Service",
  tags: ["extract", "web"],
  iconUrl: "https://agents.example/icon.svg",
  request: {
    method: "GET",
    url: "https://agents.example/extract",
    example: { type: "http", method: "GET", queryParams: { url: "https://example.com" } },
    schema: { type: "object" },
    exampleUrl: "https://agents.example/extract?url=https%3A%2F%2Fexample.com",
  },
};
const postAction = {
  name: "policy",
  method: "POST",
  route: "/policy",
  url: "https://agents.example/policy",
  serviceName: "Example Service",
  tags: ["policy"],
  iconUrl: "https://agents.example/icon.svg",
  request: {
    method: "POST",
    url: "https://agents.example/policy",
    example: { type: "http", method: "POST", bodyType: "json", body: { case: "safe" } },
    schema: { type: "object" },
  },
};
const resources = [
  { url: getAction.url, amount: "5000", description: "Extract", mimeType: "application/json" },
  { url: postAction.url, method: "POST", amount: "10000", description: "Policy", mimeType: "application/json" },
];
const alternate = {
  route: "/gateway/extract",
  url: "https://agents.example/gateway/extract",
  description: "Alternate extract",
  mimeType: "application/json",
  accepts: [{ amount: "5000" }],
  serviceName: "Example Service",
  tags: ["alternate"],
  iconUrl: "https://agents.example/icon.svg",
  request: { ...getAction.request, url: "https://agents.example/gateway/extract", exampleUrl: "https://agents.example/gateway/extract?url=https%3A%2F%2Fexample.com" },
};

function card(actions = [getAction, postAction]) {
  return {
    skills: [
      { id: "discover-all", description: "Discover all" },
      ...actions.map((action) => ({
        id: `discover-paid-action-${action.name}`,
        description: action.request.exampleUrl
          ? `Discover ${action.route} and call ${action.request.exampleUrl}`
          : `Discover ${action.route} and its exact request`,
      })),
    ],
  };
}

test("accepts exact GET, POST, alternate, manifest, and A2A construction parity", () => {
  const actions = [getAction, postAction];
  const manifestItems = buildX402ManifestItems({ resources, actions, acceptsFor: (amount) => [{ amount }], alternate });
  const receipt = validateConstructionSurfaceParity({
    actions,
    manifestItems,
    agentCard: card(),
    alternateAccess: { route: alternate.route, request: alternate.request },
  });
  assert.deepEqual(receipt, { ok: true, actionCount: 2, getExamples: 1, postExamples: 1, alternateExamples: 1 });
  assert.equal(manifestItems[0].resource.url, getAction.request.exampleUrl);
  assert.equal(manifestItems[1].resource.url, postAction.url);
  assert.equal(manifestItems[2].resource.url, alternate.request.exampleUrl);
  assert.deepEqual(manifestItems[0].resource, {
    url: getAction.request.exampleUrl,
    routeTemplate: getAction.route,
    description: "Extract",
    mimeType: "application/json",
    serviceName: getAction.serviceName,
    tags: getAction.tags,
    iconUrl: getAction.iconUrl,
  });
  assert.equal(manifestItems[2].resource.iconUrl, alternate.iconUrl);
});

test("fails when a transform drops a contract or callable example", () => {
  const actions = [getAction, postAction];
  const manifestItems = buildX402ManifestItems({ resources, actions, acceptsFor: () => [], alternate });
  const drifted = structuredClone(manifestItems);
  drifted[0].request = null;
  assert.throws(() => validateConstructionSurfaceParity({ actions, manifestItems: drifted, agentCard: card() }), /request contract drifted/);
  const metadataDrifted = structuredClone(manifestItems);
  delete metadataDrifted[0].resource.iconUrl;
  assert.throws(() => validateConstructionSurfaceParity({ actions, manifestItems: metadataDrifted, agentCard: card() }), /iconUrl drifted/);
  assert.throws(() => validateConstructionSurfaceParity({ actions: [{ ...getAction, request: { ...getAction.request, exampleUrl: null } }, postAction], manifestItems, agentCard: card() }), /callable example URL/);
  assert.throws(() => validateConstructionSurfaceParity({ actions, manifestItems, agentCard: { skills: [] } }), /route-skill count/);
  assert.throws(() => validateConstructionSurfaceParity({ actions, manifestItems, agentCard: card(), alternateAccess: { route: alternate.route, request: null } }), /alternate.*callable/);
});

const exactNetworkTerms = [
  ["eip155:8453", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USD Coin", "2"],
  ["eip155:84532", "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "USDC", "2"],
];

for (const [network, asset, name, version] of exactNetworkTerms) {
  test(`generates mapped USDC construction terms for ${network}`, () => {
    const payTo = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
    const acceptsFor = createExactUsdcAcceptsFor({ network, payTo });
    const manifestItems = buildX402ManifestItems({ resources, actions: [getAction, postAction], acceptsFor });

    assert.deepEqual(usdcTermsForNetwork(network), { asset, name, version });
    for (const [index, item] of manifestItems.entries()) {
      assert.deepEqual(item.accepts, [{
        scheme: "exact",
        network,
        asset,
        amount: resources[index].amount,
        payTo,
        maxTimeoutSeconds: 300,
        extra: { name, version },
      }]);
    }
  });
}

test("rejects an unsupported USDC construction network", () => {
  assert.throws(() => usdcTermsForNetwork("eip155:1"), /Unsupported USDC network: eip155:1/);
  assert.throws(() => usdcTermsForNetwork("constructor"), /Unsupported USDC network: constructor/);
  assert.throws(() => createExactUsdcAcceptsFor({ network: "eip155:1", payTo: "0x0" }), /Unsupported USDC network: eip155:1/);
});
