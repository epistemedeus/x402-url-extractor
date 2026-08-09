import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentCard,
  buildCatalogMessage,
  validateA2aMessage,
  versionProblem,
} from "./a2a-storefront.mjs";

test("agent card exposes one bounded storefront skill over A2A HTTP+JSON", () => {
  const card = buildAgentCard({ publicUrl: "https://agents.example" });
  assert.equal(card.supportedInterfaces[0].url, "https://agents.example/a2a");
  assert.equal(card.supportedInterfaces[0].protocolBinding, "HTTP+JSON");
  assert.equal(card.supportedInterfaces[0].protocolVersion, "1.0");
  assert.equal(card.skills.length, 1);
  assert.equal(card.skills[0].id, "discover-x402-paid-actions");
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

test("message validation rejects missing or empty parts", () => {
  assert.equal(validateA2aMessage(null), "Request body must be a JSON object.");
  assert.equal(validateA2aMessage({}), "message is required.");
  assert.equal(validateA2aMessage({ message: { parts: [] } }), "message.parts must contain at least one part.");
  assert.equal(validateA2aMessage({ message: { parts: [{ text: "list" }] } }), null);
});

test("version problem advertises supported A2A version", () => {
  const problem = versionProblem("0.3");
  assert.equal(problem.status, 400);
  assert.deepEqual(problem.supportedVersions, ["1.0"]);
});
