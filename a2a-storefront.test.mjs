import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentCard,
  buildCatalogMessage,
  validateA2aMessage,
  versionProblem,
} from "./a2a-storefront.mjs";

const actions = [
  { name: "extract", route: "/extract", priceAtomicUsdc: "5000", tags: ["extraction"], request: { exampleUrl: "https://agents.example/extract?url=https%3A%2F%2Fexample.com" } },
  { name: "defi_morpho_position", route: "/defi/morpho-position", priceAtomicUsdc: "20000", tags: ["defi"] },
];

test("agent card exposes aggregate and route-discovery skills over A2A HTTP+JSON", () => {
  const card = buildAgentCard({
    publicUrl: "https://agents.example",
    serviceVersion: "1.12.2",
    actions,
  });
  assert.equal(card.supportedInterfaces[0].url, "https://agents.example/a2a");
  assert.equal(card.supportedInterfaces[0].protocolBinding, "HTTP+JSON");
  assert.equal(card.supportedInterfaces[0].protocolVersion, "1.0");
  assert.equal(card.version, "1.12.2");
  assert.equal(card.skills.length, 3);
  assert.equal(card.skills[0].id, "discover-x402-paid-actions");
  assert.deepEqual(
    card.skills.slice(1).map(({ id }) => id),
    ["discover-paid-action-extract", "discover-paid-action-defi_morpho_position"],
  );
  assert.match(card.skills[1].description, /Discovery only/);
  assert.match(card.skills[1].description, /5000 atomic USDC/);
  assert.match(card.skills[1].description, /extract\?url=/);
  assert.match(card.skills[1].examples[0], /https%3A%2F%2Fexample.com/);
  assert.equal(card.capabilities.streaming, false);
});

test("catalog response is a direct A2A message and preserves context", () => {
  const catalog = { actions: [{ name: "morpho", priceUsdc: 0.02 }] };
  const response = buildCatalogMessage({
    request: { message: { contextId: "ctx-1", parts: [{ text: "list" }] } },
    catalog,
  });
  assert.equal(response.message.role, "ROLE_AGENT");
  assert.equal(response.message.contextId, "ctx-1");
  assert.deepEqual(response.message.parts[0].data, catalog);
  assert.equal(response.message.parts[0].mediaType, "application/json");
});

test("message validation requires the normative inbound message fields", () => {
  assert.equal(validateA2aMessage(null), "Request body must be a JSON object.");
  assert.equal(validateA2aMessage({}), "message is required.");
  assert.equal(validateA2aMessage({ message: {} }), "message.messageId is required.");
  assert.equal(
    validateA2aMessage({ message: { messageId: "message-1", role: "ROLE_AGENT", parts: [{ text: "list" }] } }),
    "message.role must be ROLE_USER.",
  );
  assert.equal(
    validateA2aMessage({ message: { messageId: "message-1", role: "ROLE_USER", parts: [] } }),
    "message.parts must contain at least one part.",
  );
  assert.equal(
    validateA2aMessage({ message: { messageId: "message-1", role: "ROLE_USER", parts: [{ text: "list" }] } }),
    null,
  );
});

test("agent card rejects a missing version and duplicate route skill IDs", () => {
  assert.throws(() => buildAgentCard({ publicUrl: "https://agents.example", actions }), /serviceVersion/);
  assert.throws(
    () => buildAgentCard({
      publicUrl: "https://agents.example",
      serviceVersion: "1.12.2",
      actions: [actions[0], { ...actions[0], route: "/other" }],
    }),
    /duplicate paid action skill/,
  );
});

test("version problem advertises supported A2A version", () => {
  const problem = versionProblem("0.3");
  assert.equal(problem.status, 400);
  assert.deepEqual(problem.supportedVersions, ["1.0"]);
});
