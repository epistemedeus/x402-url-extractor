import test from "node:test";
import assert from "node:assert/strict";
import {
  CIRCLE_GATEWAY_FACILITATOR,
  CIRCLE_GATEWAY_NAME,
  CIRCLE_GATEWAY_PATH,
  buildCircleGatewayRoute,
} from "./circle-gateway-route.mjs";

const SELLER = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const RESOURCE_METADATA = {
  serviceName: "SameDayDesk",
  tags: ["x402", "payment-preflight"],
  iconUrl: "https://samedaydesk.com/favicon.svg",
};

test("builds a Base representative contract and official middleware", () => {
  let config;
  let requiredPrice;
  const integration = buildCircleGatewayRoute({
    sellerAddress: SELLER,
    resourceMetadata: RESOURCE_METADATA,
    middlewareFactory(input) {
      config = input;
      return { require(price) { requiredPrice = price; return () => {}; } };
    },
  });
  assert.equal(integration.enabled, true);
  assert.equal(integration.resource.urlPath, CIRCLE_GATEWAY_PATH);
  assert.equal(integration.resource.amount, "5000");
  assert.equal(integration.resource.accepts[0].network, "eip155:8453");
  assert.equal(integration.resource.accepts[0].amount, "5000");
  assert.equal(integration.resource.accepts[0].payTo, SELLER);
  assert.equal(integration.resource.accepts[0].extra.name, CIRCLE_GATEWAY_NAME);
  assert.equal(integration.resource.accepts[0].extra.verifyingContract.toLowerCase(), "0x77777777dcc4d5a8b6e418fd04d8997ef11000ee");
  assert.equal(integration.resource.accepts[0].maxTimeoutSeconds, 604900);
  assert.equal(integration.resource.serviceName, RESOURCE_METADATA.serviceName);
  assert.deepEqual(integration.resource.tags, RESOURCE_METADATA.tags);
  assert.equal(integration.resource.iconUrl, RESOURCE_METADATA.iconUrl);
  assert.equal(config.facilitatorUrl, CIRCLE_GATEWAY_FACILITATOR);
  assert.equal(config.sellerAddress, SELLER);
  assert.deepEqual(config.networks, ["eip155:8453"]);
  assert.equal(requiredPrice, "$0.005");
});

test("projects exact service metadata into the direct payment-required resource", () => {
  let challengeHeader;
  const integration = buildCircleGatewayRoute({
    sellerAddress: SELLER,
    resourceMetadata: RESOURCE_METADATA,
    middlewareFactory() {
      return {
        require() {
          return (_req, res) => res.setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify({
            x402Version: 2,
            resource: { url: CIRCLE_GATEWAY_PATH, description: "fixture", mimeType: "application/json" },
            accepts: [{ scheme: "exact", network: "eip155:8453" }],
          })).toString("base64"));
        },
      };
    },
  });
  integration.middleware({}, {
    setHeader(name, value) {
      if (String(name).toLowerCase() === "payment-required") challengeHeader = value;
    },
  }, () => {});
  const challenge = JSON.parse(Buffer.from(challengeHeader, "base64").toString("utf8"));
  assert.deepEqual(challenge.resource, {
    url: CIRCLE_GATEWAY_PATH,
    description: "fixture",
    mimeType: "application/json",
    ...RESOURCE_METADATA,
  });
});

test("kill switch preserves discovery metadata without constructing middleware", () => {
  const integration = buildCircleGatewayRoute({
    sellerAddress: SELLER,
    enabled: false,
    middlewareFactory() {
      throw new Error("must not run");
    },
  });
  assert.equal(integration.enabled, false);
  assert.equal(integration.middleware, null);
  assert.equal(integration.resource.amount, "5000");
});

test("fails closed on invalid seller, price, or middleware", () => {
  assert.throws(() => buildCircleGatewayRoute({ sellerAddress: "0x123" }), /sellerAddress/);
  assert.throws(() => buildCircleGatewayRoute({ sellerAddress: SELLER, price: "$0.0000001" }), /six decimals/);
  assert.throws(() => buildCircleGatewayRoute({ sellerAddress: SELLER, middlewareFactory: () => ({}) }), /invalid gateway/);
  assert.throws(() => buildCircleGatewayRoute({
    sellerAddress: SELLER,
    resourceMetadata: { ...RESOURCE_METADATA, iconUrl: "javascript:alert(1)" },
  }), /iconUrl is invalid/);
});
